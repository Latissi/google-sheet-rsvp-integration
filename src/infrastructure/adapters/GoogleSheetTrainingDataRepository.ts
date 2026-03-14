import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
  AttendanceSyncMetadata,
  PublicTrainingSource,
  RsvpStatus,
  TRAINING_DAYS,
  TrainingCancellation,
  TrainingAudience,
  TrainingDefinition,
  TrainingEnvironment,
  TrainingSession,
  TrainingSessionStatus,
  UserRecord,
} from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';

interface TableBounds {
  startRow: number;
  startColumn: number;
}

interface SheetSchema {
  sessionId?: number;
  trainingId?: number;
  title?: number;
  day?: number;
  sessionDate?: number;
  startTime?: number;
  endTime?: number;
  location?: number;
  environment?: number;
  audience?: number;
  status?: number;
  metadata?: number;
  cancelledAt?: number;
  cancelledByMemberId?: number;
  cancellationReason?: number;
}

interface SessionRowReference {
  source: PublicTrainingSource;
  rowIndex: number;
  rowValues: unknown[];
  headers: unknown[];
  schema: SheetSchema;
  bounds: TableBounds;
  session: TrainingSession;
  trainingDefinition?: TrainingDefinition;
}

const DEFAULT_MANUAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export class GoogleSheetTrainingDataRepository implements ITrainingDataRepository {
  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
    private readonly userRepository: IUserRepository,
  ) {}

  getTrainingDefinitions(): TrainingDefinition[] {
    const definitions = new Map<string, TrainingDefinition>();

    for (const row of this.getAllSessionRows()) {
      if (row.trainingDefinition) {
        definitions.set(row.trainingDefinition.trainingId, row.trainingDefinition);
      }
    }

    return Array.from(definitions.values());
  }

  getUpcomingTrainingSessions(): TrainingSession[] {
    return this.getAllSessionRows().map(entry => entry.session);
  }

  getTrainingSessionById(sessionId: string): TrainingSession | null {
    const row = this.getAllSessionRows().find(candidate => candidate.session.sessionId === sessionId);
    return row?.session ?? null;
  }

  getAttendanceForSession(sessionId: string): AttendanceRecord[] {
    const row = this.findSessionRow(sessionId);
    const metadataMap = this.parseMetadataMap(row.rowValues[row.schema.metadata ?? -1]);
    const users = this.userRepository.getAllUsers();

    return row.headers
      .slice(this.getAttendanceStartIndex(row.source, row.bounds))
      .map((header, headerOffset) => {
        const columnIndex = this.getAttendanceStartIndex(row.source, row.bounds) + headerOffset;
        const user = this.findUserForAttendanceHeader(header, users);
        if (!user) {
          return null;
        }

        const rsvpStatus = this.parseAttendanceCell(row.rowValues[columnIndex]);
        if (!rsvpStatus) {
          return null;
        }

        const metadata = metadataMap[user.memberId] ?? {
          source: 'manual',
          updatedAt: DEFAULT_MANUAL_TIMESTAMP,
        };

        return {
          memberId: user.memberId,
          sessionId,
          rsvpStatus,
          metadata,
        } satisfies AttendanceRecord;
      })
      .filter((record): record is AttendanceRecord => record !== null);
  }

  saveAttendance(record: AttendanceRecord): void {
    const row = this.findSessionRow(record.sessionId);
    const users = this.userRepository.getAllUsers();
    const user = this.userRepository.getUserByMemberId(record.memberId);
    if (!user) {
      throw new Error(`User with memberId "${record.memberId}" not found.`);
    }

    const attendanceColumn = this.findAttendanceColumnIndex(row.headers, row.source, row.bounds, user, users);
    if (attendanceColumn === null) {
      throw new Error(`No attendance column found for memberId "${record.memberId}" in session "${record.sessionId}".`);
    }

    const updatedRow = [...row.rowValues];
    updatedRow[attendanceColumn] = this.formatAttendanceCell(record.rsvpStatus);

    const metadataIndex = row.schema.metadata;
    if (metadataIndex !== undefined) {
      const metadataMap = this.parseMetadataMap(updatedRow[metadataIndex]);
      metadataMap[record.memberId] = record.metadata;
      updatedRow[metadataIndex] = JSON.stringify(metadataMap);
    }

    this.gateway.setRowValues(row.source.sheetName, row.rowIndex, updatedRow, {
      spreadsheetId: row.source.spreadsheetId,
    });
  }

  cancelTrainingSession(cancellation: TrainingCancellation): void {
    const row = this.findSessionRow(cancellation.sessionId);
    const updatedRow = [...row.rowValues];

    if (row.schema.status !== undefined) {
      updatedRow[row.schema.status] = 'Cancelled';
    }
    if (row.schema.cancelledAt !== undefined) {
      updatedRow[row.schema.cancelledAt] = cancellation.cancelledAt;
    }
    if (row.schema.cancelledByMemberId !== undefined) {
      updatedRow[row.schema.cancelledByMemberId] = cancellation.cancelledByMemberId;
    }
    if (row.schema.cancellationReason !== undefined) {
      updatedRow[row.schema.cancellationReason] = cancellation.reason ?? '';
    }

    this.gateway.setRowValues(row.source.sheetName, row.rowIndex, updatedRow, {
      spreadsheetId: row.source.spreadsheetId,
    });
  }

  private getAllSessionRows(): SessionRowReference[] {
    return this.configurationProvider.getPublicTrainingSources().flatMap(source => this.readSourceRows(source));
  }

  private readSourceRows(source: PublicTrainingSource): SessionRowReference[] {
    const bounds = this.getTableBounds(source.tableRange);
    const rawTable = this.gateway.getSheetValues(source.sheetName, {
      spreadsheetId: source.spreadsheetId,
      rangeA1: source.tableRange,
    });
    if (rawTable.length === 0) {
      return [];
    }

    const headers = rawTable[0] ?? [];
    const schema = this.getSchema(headers, source, bounds);
    const rows: SessionRowReference[] = [];

    for (let rowOffset = 1; rowOffset < rawTable.length; rowOffset += 1) {
      const rowValues = rawTable[rowOffset];
      if (!rowValues || rowValues.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const sessionContext = this.buildTrainingContext(source, schema, rowValues);
      const sessionDate = this.getCellValue(rowValues, schema.sessionDate);
      const startTime = this.getCellValue(rowValues, schema.startTime) || sessionContext.definition?.startTime || '';
      if (!sessionDate || !startTime) {
        continue;
      }

      const sessionId = this.getCellValue(rowValues, schema.sessionId)
        || this.createSessionId(source.sourceId, sessionContext.trainingId, sessionDate, startTime);
      const status = this.parseStatus(
        this.getCellValue(rowValues, schema.status),
        this.getCellValue(rowValues, schema.cancelledAt),
      );
      const session: TrainingSession = {
        sessionId,
        trainingId: sessionContext.trainingId,
        sessionDate,
        startTime,
        endTime: this.getCellValue(rowValues, schema.endTime) || sessionContext.definition?.endTime,
        location: this.getCellValue(rowValues, schema.location) || sessionContext.definition?.location,
        status,
      };

      rows.push({
        source,
        rowIndex: bounds.startRow + rowOffset,
        rowValues,
        headers,
        schema,
        bounds,
        session,
        trainingDefinition: sessionContext.definition,
      });
    }

    return rows;
  }

  private buildTrainingContext(
    source: PublicTrainingSource,
    schema: SheetSchema,
    rowValues: unknown[],
  ): { trainingId: string; definition?: TrainingDefinition } {
    const explicitTrainingId = this.getCellValue(rowValues, schema.trainingId);
    const explicitTitle = this.getCellValue(rowValues, schema.title);
    const explicitDay = this.getCellValue(rowValues, schema.day);
    const explicitStart = this.getCellValue(rowValues, schema.startTime);
    const explicitEnd = this.getCellValue(rowValues, schema.endTime);
    const explicitLocation = this.getCellValue(rowValues, schema.location);
    const explicitEnvironment = this.getCellValue(rowValues, schema.environment);
    const explicitAudience = this.getCellValue(rowValues, schema.audience);

    const selector = this.matchTrainingSelector(source, {
      trainingId: explicitTrainingId,
      title: explicitTitle,
      day: explicitDay,
      environment: explicitEnvironment,
      audience: explicitAudience,
    });

    const trainingId = explicitTrainingId || selector?.trainingId || source.sourceId;
    const title = explicitTitle || selector?.title || trainingId;
    const day = this.toTrainingDay(explicitDay) ?? selector?.day;
    const startTime = explicitStart || '';
    const environment = this.toTrainingEnvironment(explicitEnvironment) ?? selector?.environment;
    const audience = this.toTrainingAudience(explicitAudience) ?? selector?.audience;

    const definition = day && startTime
      ? {
          trainingId,
          title,
          day,
          startTime,
          endTime: explicitEnd || undefined,
          location: explicitLocation || undefined,
          environment,
          audience,
        }
      : undefined;

    return { trainingId, definition };
  }

  private matchTrainingSelector(
    source: PublicTrainingSource,
    row: { trainingId: string; title: string; day: string; environment: string; audience: string },
  ) {
    if (row.trainingId) {
      return source.trainings.find(training => training.trainingId === row.trainingId);
    }

    const matches = source.trainings.filter(training => (
      (!training.title || this.normalizeText(training.title) === this.normalizeText(row.title))
      && (!training.day || training.day === row.day)
      && (!training.environment || training.environment === row.environment)
      && (!training.audience || training.audience === row.audience)
    ));

    if (matches.length === 1) {
      return matches[0];
    }

    if (!row.title && !row.day && source.trainings.length === 1) {
      return source.trainings[0];
    }

    return undefined;
  }

  private findSessionRow(sessionId: string): SessionRowReference {
    const row = this.getAllSessionRows().find(candidate => candidate.session.sessionId === sessionId);
    if (!row) {
      throw new Error(`Training session "${sessionId}" not found.`);
    }

    return row;
  }

  private getSchema(headers: unknown[], source: PublicTrainingSource, bounds: TableBounds): SheetSchema {
    const metadataColumnIndex = source.attendance.metadataColumn
      ? this.getRelativeColumnIndex(source.attendance.metadataColumn, bounds)
      : undefined;

    return {
      sessionId: this.findHeaderIndex(headers, ['SessionId', 'TerminId']),
      trainingId: this.findHeaderIndex(headers, ['TrainingId']),
      title: this.findHeaderIndex(headers, ['Title', 'Training', 'TrainingTitle', 'Bezeichnung']),
      day: this.findHeaderIndex(headers, ['Day', 'Wochentag']),
      sessionDate: this.findHeaderIndex(headers, ['SessionDate', 'Date', 'Datum']),
      startTime: this.findHeaderIndex(headers, ['StartTime', 'Start', 'Beginn']),
      endTime: this.findHeaderIndex(headers, ['EndTime', 'Ende']),
      location: this.findHeaderIndex(headers, ['Location', 'Ort']),
      environment: this.findHeaderIndex(headers, ['Environment', 'Umgebung']),
      audience: this.findHeaderIndex(headers, ['Audience', 'Typ']),
      status: this.findHeaderIndex(headers, ['Status']),
      metadata: metadataColumnIndex ?? this.findHeaderIndex(headers, ['AttendanceMetadata', 'Metadata', 'RSVPMetadata']),
      cancelledAt: this.findHeaderIndex(headers, ['CancelledAt', 'AbsageAm']),
      cancelledByMemberId: this.findHeaderIndex(headers, ['CancelledByMemberId', 'AbgesagtVon']),
      cancellationReason: this.findHeaderIndex(headers, ['CancellationReason', 'AbsageGrund', 'Reason']),
    };
  }

  private findHeaderIndex(headers: unknown[], candidates: string[]): number | undefined {
    const normalizedCandidates = new Set(candidates.map(candidate => this.normalizeText(candidate)));
    const index = headers.findIndex(header => normalizedCandidates.has(this.normalizeText(header)));
    return index >= 0 ? index : undefined;
  }

  private getAttendanceStartIndex(source: PublicTrainingSource, bounds: TableBounds): number {
    return this.getRelativeColumnIndex(source.attendance.startColumn, bounds);
  }

  private getRelativeColumnIndex(columnA1: string, bounds: TableBounds): number {
    const absoluteColumnIndex = this.columnToIndex(columnA1.replace(/[^A-Za-z]/g, ''));
    return absoluteColumnIndex - bounds.startColumn;
  }

  private findAttendanceColumnIndex(
    headers: unknown[],
    source: PublicTrainingSource,
    bounds: TableBounds,
    user: UserRecord,
    users: UserRecord[],
  ): number | null {
    const attendanceStartIndex = this.getAttendanceStartIndex(source, bounds);
    for (let index = attendanceStartIndex; index < headers.length; index += 1) {
      const headerUser = this.findUserForAttendanceHeader(headers[index], users);
      if (headerUser?.memberId === user.memberId) {
        return index;
      }
    }

    return null;
  }

  private findUserForAttendanceHeader(header: unknown, users: UserRecord[]): UserRecord | null {
    const rawHeader = String(header ?? '').trim();
    if (!rawHeader) {
      return null;
    }

    const normalizedHeader = this.normalizeText(rawHeader);
    const headerParts = rawHeader
      .split(/[|,;()\-]/)
      .map(part => this.normalizeText(part))
      .filter(Boolean);

    return users.find(user => (
      normalizedHeader === this.normalizeText(user.memberId)
      || normalizedHeader === this.normalizeText(user.name)
      || headerParts.includes(this.normalizeText(user.memberId))
      || headerParts.includes(this.normalizeText(user.name))
    )) ?? null;
  }

  private parseAttendanceCell(value: unknown): RsvpStatus | null {
    const normalized = this.normalizeText(value);
    if (!normalized) {
      return null;
    }

    if (['accepted', 'yes', 'ja', 'zugesagt', 'true', '1', 'x'].includes(normalized)) {
      return 'Accepted';
    }

    if (['declined', 'no', 'nein', 'abgesagt', 'false', '0'].includes(normalized)) {
      return 'Declined';
    }

    if (normalized === 'pending') {
      return 'Pending';
    }

    return null;
  }

  private formatAttendanceCell(status: RsvpStatus): string {
    if (status === 'Accepted') {
      return 'Accepted';
    }
    if (status === 'Declined') {
      return 'Declined';
    }
    return '';
  }

  private parseMetadataMap(value: unknown): Record<string, AttendanceSyncMetadata> {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, AttendanceSyncMetadata>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private parseStatus(statusValue: string, cancelledAtValue: string): TrainingSessionStatus {
    const normalizedStatus = this.normalizeText(statusValue);
    if (normalizedStatus === 'cancelled' || normalizedStatus === 'abgesagt' || cancelledAtValue) {
      return 'Cancelled';
    }

    if (normalizedStatus === 'completed' || normalizedStatus === 'abgeschlossen') {
      return 'Completed';
    }

    return 'Scheduled';
  }

  private toTrainingDay(value: string): TrainingDefinition['day'] | undefined {
    return (TRAINING_DAYS as readonly string[]).includes(value) ? value as TrainingDefinition['day'] : undefined;
  }

  private toTrainingEnvironment(value: string): TrainingEnvironment | undefined {
    return value === 'Indoor' || value === 'Outdoor' ? value : undefined;
  }

  private toTrainingAudience(value: string): TrainingAudience | undefined {
    return value === 'Mixed' || value === 'SingleGender' ? value : undefined;
  }

  private createSessionId(sourceId: string, trainingId: string, sessionDate: string, startTime: string): string {
    return [sourceId, trainingId, sessionDate, startTime].map(part => part.trim()).join('__');
  }

  private getTableBounds(rangeA1?: string): TableBounds {
    if (!rangeA1) {
      return { startRow: 1, startColumn: 0 };
    }

    const startCell = rangeA1.split(':')[0];
    const match = startCell.match(/^([A-Za-z]+)?(\d+)?$/);
    if (!match) {
      return { startRow: 1, startColumn: 0 };
    }

    const columnLabel = match[1] ?? 'A';
    const rowLabel = match[2] ?? '1';
    return {
      startRow: parseInt(rowLabel, 10),
      startColumn: this.columnToIndex(columnLabel),
    };
  }

  private columnToIndex(column: string): number {
    return column
      .toUpperCase()
      .split('')
      .reduce((total, character) => (total * 26) + character.charCodeAt(0) - 64, 0) - 1;
  }

  private getCellValue(row: unknown[], index?: number): string {
    if (index === undefined || index < 0 || index >= row.length) {
      return '';
    }

    const value = row[index];
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    return String(value ?? '').trim();
  }

  private normalizeText(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
}