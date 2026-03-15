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

interface SessionReferenceBase {
  source: PublicTrainingSource;
  session: TrainingSession;
  trainingDefinition?: TrainingDefinition;
}

interface SessionRowReference extends SessionReferenceBase {
  kind: 'session-rows';
  rowIndex: number;
  rowValues: unknown[];
  headers: unknown[];
  schema: SheetSchema;
  bounds: TableBounds;
}

interface SessionColumnReference extends SessionReferenceBase {
  kind: 'member-rows';
  columnIndex: number;
  bounds: TableBounds;
}

type SessionReference = SessionRowReference | SessionColumnReference;

const DEFAULT_MANUAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const WEEKDAYS_FROM_SUNDAY: Array<'Sonntag' | 'Montag' | 'Dienstag' | 'Mittwoch' | 'Donnerstag' | 'Freitag' | 'Samstag'> = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];

export class GoogleSheetTrainingDataRepository implements ITrainingDataRepository {
  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
    private readonly userRepository: IUserRepository,
  ) {}

  getTrainingDefinitions(): TrainingDefinition[] {
    const definitions = new Map<string, TrainingDefinition>();

    for (const reference of this.getAllSessionReferences()) {
      if (reference.trainingDefinition) {
        definitions.set(reference.trainingDefinition.trainingId, reference.trainingDefinition);
      }
    }

    return Array.from(definitions.values());
  }

  getUpcomingTrainingSessions(): TrainingSession[] {
    return this.getAllSessionReferences().map(reference => reference.session);
  }

  getTrainingSessionById(sessionId: string): TrainingSession | null {
    return this.findSessionReference(sessionId)?.session ?? null;
  }

  getAttendanceForSession(sessionId: string): AttendanceRecord[] {
    const reference = this.findSessionReferenceOrThrow(sessionId);

    if (reference.kind === 'member-rows') {
      return this.getAttendanceForMemberRowsSession(reference);
    }

    return this.getAttendanceForSessionRowSession(reference);
  }

  saveAttendance(record: AttendanceRecord): void {
    const reference = this.findSessionReferenceOrThrow(record.sessionId);

    if (reference.kind === 'member-rows') {
      this.saveAttendanceForMemberRowsSession(reference, record);
      return;
    }

    this.saveAttendanceForSessionRowSession(reference, record);
  }

  cancelTrainingSession(cancellation: TrainingCancellation): void {
    const reference = this.findSessionReferenceOrThrow(cancellation.sessionId);
    if (reference.kind === 'member-rows') {
      throw new Error('Training cancellation is not supported for member-rows public sheet layouts.');
    }

    const updatedRow = [...reference.rowValues];

    if (reference.schema.status !== undefined) {
      updatedRow[reference.schema.status] = 'Cancelled';
    }
    if (reference.schema.cancelledAt !== undefined) {
      updatedRow[reference.schema.cancelledAt] = cancellation.cancelledAt;
    }
    if (reference.schema.cancelledByMemberId !== undefined) {
      updatedRow[reference.schema.cancelledByMemberId] = cancellation.cancelledByMemberId;
    }
    if (reference.schema.cancellationReason !== undefined) {
      updatedRow[reference.schema.cancellationReason] = cancellation.reason ?? '';
    }

    this.gateway.setRowValues(reference.source.sheetName, reference.rowIndex, updatedRow, {
      spreadsheetId: reference.source.spreadsheetId,
    });
  }

  private getAllSessionReferences(): SessionReference[] {
    return this.configurationProvider.getPublicTrainingSources().flatMap(source => this.readSource(source));
  }

  private readSource(source: PublicTrainingSource): SessionReference[] {
    if (source.attendance.layout === 'member-rows') {
      return this.readMemberRowsSource(source);
    }

    return this.readSessionRowsSource(source);
  }

  private readSessionRowsSource(source: PublicTrainingSource): SessionRowReference[] {
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

      rows.push({
        kind: 'session-rows',
        source,
        rowIndex: bounds.startRow + rowOffset,
        rowValues,
        headers,
        schema,
        bounds,
        session: {
          sessionId,
          trainingId: sessionContext.trainingId,
          sessionDate,
          startTime,
          endTime: this.getCellValue(rowValues, schema.endTime) || sessionContext.definition?.endTime,
          location: this.getCellValue(rowValues, schema.location) || sessionContext.definition?.location,
          status,
        },
        trainingDefinition: sessionContext.definition,
      });
    }

    return rows;
  }

  private readMemberRowsSource(source: PublicTrainingSource): SessionColumnReference[] {
    const bounds = this.getTableBounds(source.tableRange);
    const rawTable = this.gateway.getSheetValues(source.sheetName, {
      spreadsheetId: source.spreadsheetId,
      rangeA1: source.tableRange,
    });
    if (rawTable.length === 0) {
      return [];
    }

    const headers = rawTable[0] ?? [];
    const attendanceStartIndex = this.getAttendanceStartIndex(source, bounds);
    const trainingTemplate = this.getMemberRowsTrainingTemplate(source);
    const sessions: SessionColumnReference[] = [];

    for (let columnIndex = attendanceStartIndex; columnIndex < headers.length; columnIndex += 1) {
      const sessionDate = this.parseSessionDateHeader(headers[columnIndex]);
      if (!sessionDate) {
        continue;
      }

      const day = trainingTemplate.day ?? this.deriveTrainingDay(sessionDate);
      const trainingDefinition = day
        ? {
            trainingId: trainingTemplate.trainingId,
            title: trainingTemplate.title,
            day,
            startTime: trainingTemplate.startTime,
            endTime: trainingTemplate.endTime,
            location: trainingTemplate.location,
            environment: trainingTemplate.environment,
            audience: trainingTemplate.audience,
            description: trainingTemplate.description,
          }
        : undefined;

      sessions.push({
        kind: 'member-rows',
        source,
        columnIndex,
        bounds,
        session: {
          sessionId: this.createSessionId(source.sourceId, trainingTemplate.trainingId, sessionDate, trainingTemplate.startTime),
          trainingId: trainingTemplate.trainingId,
          sessionDate,
          startTime: trainingTemplate.startTime,
          endTime: trainingTemplate.endTime,
          location: trainingTemplate.location,
          status: 'Scheduled',
        },
        trainingDefinition,
      });
    }

    return sessions;
  }

  private getAttendanceForSessionRowSession(reference: SessionRowReference): AttendanceRecord[] {
    const metadataMap = this.parseMetadataMap(reference.rowValues[reference.schema.metadata ?? -1]);
    const users = this.userRepository.getAllUsers();

    return reference.headers
      .slice(this.getAttendanceStartIndex(reference.source, reference.bounds))
      .map((header, headerOffset) => {
        const columnIndex = this.getAttendanceStartIndex(reference.source, reference.bounds) + headerOffset;
        const user = this.findUserForAttendanceHeader(header, users);
        if (!user) {
          return null;
        }

        const rsvpStatus = this.parseAttendanceCell(reference.rowValues[columnIndex]);
        if (!rsvpStatus) {
          return null;
        }

        const metadata = metadataMap[user.memberId] ?? this.getDefaultManualMetadata();

        return {
          memberId: user.memberId,
          sessionId: reference.session.sessionId,
          rsvpStatus,
          metadata,
        } satisfies AttendanceRecord;
      })
      .filter((record): record is AttendanceRecord => record !== null);
  }

  private getAttendanceForMemberRowsSession(reference: SessionColumnReference): AttendanceRecord[] {
    const rawTable = this.gateway.getSheetValues(reference.source.sheetName, {
      spreadsheetId: reference.source.spreadsheetId,
      rangeA1: reference.source.tableRange,
    });
    const users = this.userRepository.getAllUsers();
    const firstNameIndex = this.getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = this.getMemberRowsLastNameIndex(reference.source, reference.bounds);
    const columnIndex = reference.columnIndex;

    return rawTable
      .slice(1)
      .map((rowValues, rowOffset) => {
        if (!rowValues || rowValues.every(cell => String(cell ?? '').trim() === '')) {
          return null;
        }

        const user = this.findUserForMemberRow(
          rowValues[firstNameIndex],
          rowValues[lastNameIndex],
          users,
        );
        if (!user) {
          return null;
        }

        const rsvpStatus = this.parseAttendanceCell(rowValues[columnIndex]);
        if (!rsvpStatus) {
          return null;
        }

        const metadata = this.getCellMetadata(
          reference.source,
          reference.bounds.startRow + rowOffset + 1,
          reference.bounds.startColumn + columnIndex + 1,
        );

        return {
          memberId: user.memberId,
          sessionId: reference.session.sessionId,
          rsvpStatus,
          metadata,
        } satisfies AttendanceRecord;
      })
      .filter((record): record is AttendanceRecord => record !== null);
  }

  private saveAttendanceForSessionRowSession(reference: SessionRowReference, record: AttendanceRecord): void {
    const users = this.userRepository.getAllUsers();
    const user = this.userRepository.getUserByMemberId(record.memberId);
    if (!user) {
      throw new Error(`User with memberId "${record.memberId}" not found.`);
    }

    const attendanceColumn = this.findAttendanceColumnIndex(reference.headers, reference.source, reference.bounds, user, users);
    if (attendanceColumn === null) {
      throw new Error(`No attendance column found for memberId "${record.memberId}" in session "${record.sessionId}".`);
    }

    const updatedRow = [...reference.rowValues];
    updatedRow[attendanceColumn] = this.formatAttendanceCell(record.rsvpStatus, 'session-rows');

    const metadataIndex = reference.schema.metadata;
    if (metadataIndex !== undefined) {
      const metadataMap = this.parseMetadataMap(updatedRow[metadataIndex]);
      metadataMap[record.memberId] = record.metadata;
      updatedRow[metadataIndex] = JSON.stringify(metadataMap);
    }

    this.gateway.setRowValues(reference.source.sheetName, reference.rowIndex, updatedRow, {
      spreadsheetId: reference.source.spreadsheetId,
    });
  }

  private saveAttendanceForMemberRowsSession(reference: SessionColumnReference, record: AttendanceRecord): void {
    const user = this.userRepository.getUserByMemberId(record.memberId);
    if (!user) {
      throw new Error(`User with memberId "${record.memberId}" not found.`);
    }

    const rawTable = this.gateway.getSheetValues(reference.source.sheetName, {
      spreadsheetId: reference.source.spreadsheetId,
      rangeA1: reference.source.tableRange,
    });
    const firstNameIndex = this.getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = this.getMemberRowsLastNameIndex(reference.source, reference.bounds);

    let absoluteRowIndex: number | null = null;
    for (let rowOffset = 1; rowOffset < rawTable.length; rowOffset += 1) {
      const rowValues = rawTable[rowOffset];
      if (!rowValues) {
        continue;
      }

      const rowUser = this.findUserForMemberRow(rowValues[firstNameIndex], rowValues[lastNameIndex], [user]);
      if (rowUser?.memberId === user.memberId) {
        absoluteRowIndex = reference.bounds.startRow + rowOffset;
        break;
      }
    }

    if (absoluteRowIndex === null) {
      throw new Error(`No attendance row found for memberId "${record.memberId}" in session "${record.sessionId}".`);
    }

    const absoluteColumnIndex = reference.bounds.startColumn + reference.columnIndex + 1;
    this.gateway.setCellValue(
      reference.source.sheetName,
      absoluteRowIndex,
      absoluteColumnIndex,
      this.formatAttendanceCell(record.rsvpStatus, 'member-rows'),
      { spreadsheetId: reference.source.spreadsheetId },
    );
    this.gateway.setCellNote(
      reference.source.sheetName,
      absoluteRowIndex,
      absoluteColumnIndex,
      JSON.stringify(record.metadata),
      { spreadsheetId: reference.source.spreadsheetId },
    );
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
    const startTime = explicitStart || selector?.startTime || '';
    const environment = this.toTrainingEnvironment(explicitEnvironment) ?? selector?.environment;
    const audience = this.toTrainingAudience(explicitAudience) ?? selector?.audience;

    const definition = day && startTime
      ? {
          trainingId,
          title,
          day,
          startTime,
          endTime: explicitEnd || selector?.endTime || undefined,
          location: explicitLocation || selector?.location || undefined,
          environment,
          audience,
          description: selector?.description,
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

  private getMemberRowsTrainingTemplate(source: PublicTrainingSource) {
    if (source.trainings.length > 1) {
      throw new Error(`Public training source "${source.sourceId}" uses member-rows layout and must define at most one training selector.`);
    }

    const selector = source.trainings[0];
    const trainingId = selector?.trainingId || source.sourceId;
    const startTime = selector?.startTime || '';
    if (!startTime) {
      throw new Error(`Public training source "${source.sourceId}" uses member-rows layout and must define trainings[0].startTime.`);
    }

    return {
      trainingId,
      title: selector?.title || trainingId,
      day: selector?.day,
      startTime,
      endTime: selector?.endTime,
      location: selector?.location,
      environment: selector?.environment,
      audience: selector?.audience,
      description: selector?.description,
    };
  }

  private findSessionReference(sessionId: string): SessionReference | null {
    return this.getAllSessionReferences().find(candidate => candidate.session.sessionId === sessionId) ?? null;
  }

  private findSessionReferenceOrThrow(sessionId: string): SessionReference {
    const reference = this.findSessionReference(sessionId);
    if (!reference) {
      throw new Error(`Training session "${sessionId}" not found.`);
    }

    return reference;
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

  private getMemberRowsFirstNameIndex(source: PublicTrainingSource, bounds: TableBounds): number {
    return this.getRelativeColumnIndex(source.attendance.firstNameColumn ?? 'A', bounds);
  }

  private getMemberRowsLastNameIndex(source: PublicTrainingSource, bounds: TableBounds): number {
    return this.getRelativeColumnIndex(source.attendance.lastNameColumn ?? 'B', bounds);
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

  private findUserForMemberRow(firstName: unknown, lastName: unknown, users: UserRecord[]): UserRecord | null {
    const normalizedFirstName = this.normalizeText(firstName);
    const normalizedLastName = this.normalizeText(lastName);
    const normalizedName = this.normalizeText(`${String(firstName ?? '').trim()} ${String(lastName ?? '').trim()}`);
    const normalizedMemberId = this.normalizeText(`${String(firstName ?? '').trim()}::${String(lastName ?? '').trim()}`);

    if (!normalizedFirstName && !normalizedLastName) {
      return null;
    }

    return users.find(user => (
      normalizedName === this.normalizeText(user.name)
      || normalizedMemberId === this.normalizeText(user.memberId)
      || (
        normalizedFirstName === this.normalizeText(user.personName?.firstName ?? '')
        && normalizedLastName === this.normalizeText(user.personName?.lastName ?? '')
      )
    )) ?? null;
  }

  private parseAttendanceCell(value: unknown): RsvpStatus | null {
    const normalized = this.normalizeText(value);
    const raw = String(value ?? '').trim();
    if (!normalized && raw !== '-') {
      return null;
    }

    if (['accepted', 'yes', 'ja', 'zugesagt', 'true', '1', 'x'].includes(normalized)) {
      return 'Accepted';
    }

    if (raw === '-' || ['declined', 'no', 'nein', 'abgesagt', 'false', '0'].includes(normalized)) {
      return 'Declined';
    }

    if (normalized === 'pending') {
      return 'Pending';
    }

    return null;
  }

  private formatAttendanceCell(status: RsvpStatus, layout: 'session-rows' | 'member-rows'): string {
    if (layout === 'member-rows') {
      if (status === 'Accepted') {
        return 'x';
      }
      if (status === 'Declined') {
        return '-';
      }
      return '';
    }

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

  private getCellMetadata(source: PublicTrainingSource, rowIndex: number, columnIndex: number): AttendanceSyncMetadata {
    const note = this.gateway.getCellNote(source.sheetName, rowIndex, columnIndex, {
      spreadsheetId: source.spreadsheetId,
    });
    if (!note.trim()) {
      return this.getDefaultManualMetadata();
    }

    try {
      const parsed = JSON.parse(note) as AttendanceSyncMetadata;
      if (parsed && typeof parsed === 'object' && parsed.source && parsed.updatedAt) {
        return parsed;
      }
    } catch {
      return this.getDefaultManualMetadata();
    }

    return this.getDefaultManualMetadata();
  }

  private getDefaultManualMetadata(): AttendanceSyncMetadata {
    return {
      source: 'manual',
      updatedAt: DEFAULT_MANUAL_TIMESTAMP,
    };
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

  private deriveTrainingDay(sessionDate: string): TrainingDefinition['day'] | undefined {
    const date = new Date(`${sessionDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    const weekday = WEEKDAYS_FROM_SUNDAY[date.getUTCDay()];
    return this.toTrainingDay(weekday);
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

  private parseSessionDateHeader(value: unknown): string | null {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
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
