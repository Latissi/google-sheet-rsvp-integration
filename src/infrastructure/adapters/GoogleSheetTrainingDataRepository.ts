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

interface SessionReferenceBase {
  source: PublicTrainingSource;
  session: TrainingSession;
  trainingDefinition?: TrainingDefinition;
}

interface SessionColumnReference extends SessionReferenceBase {
  kind: 'member-rows';
  columnIndex: number;
  bounds: TableBounds;
}

type SessionReference = SessionColumnReference;

interface CancellationNoteData {
  cancelledAt: string;
  cancelledByMemberId: string;
  reason?: string;
}

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

  private getPublicSpreadsheetId(): string {
    return this.configurationProvider.getPublicSheetId();
  }

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
    return this.getAttendanceForMemberRowsSession(reference);
  }

  saveAttendance(record: AttendanceRecord): void {
    const reference = this.findSessionReferenceOrThrow(record.sessionId);
    this.saveAttendanceForMemberRowsSession(reference, record);
  }

  cancelTrainingSession(cancellation: TrainingCancellation): void {
    const reference = this.findSessionReferenceOrThrow(cancellation.sessionId);

    this.gateway.setCellNote(
      reference.source.sheetName,
      reference.bounds.startRow,
      reference.bounds.startColumn + reference.columnIndex + 1,
      JSON.stringify({
        cancelledAt: cancellation.cancelledAt,
        cancelledByMemberId: cancellation.cancelledByMemberId,
        reason: cancellation.reason,
      }),
      {
        spreadsheetId: this.getPublicSpreadsheetId(),
      },
    );
  }

  private getAllSessionReferences(): SessionReference[] {
    return this.configurationProvider.getPublicTrainingSources().flatMap(source => this.readMemberRowsSource(source));
  }

  private readMemberRowsSource(source: PublicTrainingSource): SessionColumnReference[] {
    const bounds = this.getTableBounds(source.tableRange);
    const rawTable = this.gateway.getSheetValues(source.sheetName, {
      spreadsheetId: this.getPublicSpreadsheetId(),
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

      const cancellation = this.getCancellationForMemberRowsSession(source, bounds, columnIndex);

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
          status: cancellation ? 'Cancelled' : 'Scheduled',
        },
        trainingDefinition,
      });
    }

    return sessions;
  }

  private getAttendanceForMemberRowsSession(reference: SessionColumnReference): AttendanceRecord[] {
    const rawTable = this.gateway.getSheetValues(reference.source.sheetName, {
      spreadsheetId: this.getPublicSpreadsheetId(),
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

  private saveAttendanceForMemberRowsSession(reference: SessionColumnReference, record: AttendanceRecord): void {
    const user = this.userRepository.getUserByMemberId(record.memberId);
    if (!user) {
      throw new Error(`User with memberId "${record.memberId}" not found.`);
    }

    const rawTable = this.gateway.getSheetValues(reference.source.sheetName, {
      spreadsheetId: this.getPublicSpreadsheetId(),
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
      this.formatAttendanceCell(record.rsvpStatus),
      { spreadsheetId: this.getPublicSpreadsheetId() },
    );
    this.gateway.setCellNote(
      reference.source.sheetName,
      absoluteRowIndex,
      absoluteColumnIndex,
      JSON.stringify(record.metadata),
      { spreadsheetId: this.getPublicSpreadsheetId() },
    );
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

  private getAttendanceStartIndex(source: PublicTrainingSource, bounds: TableBounds): number {
    return this.getRelativeColumnIndex(source.attendance.startColumn, bounds);
  }

  private getMemberRowsFirstNameIndex(source: PublicTrainingSource, bounds: TableBounds): number {
    return this.getRelativeColumnIndex(source.attendance.firstNameColumn, bounds);
  }

  private getMemberRowsLastNameIndex(source: PublicTrainingSource, bounds: TableBounds): number {
    return this.getRelativeColumnIndex(source.attendance.lastNameColumn, bounds);
  }

  private getRelativeColumnIndex(columnA1: string, bounds: TableBounds): number {
    const absoluteColumnIndex = this.columnToIndex(columnA1.replace(/[^A-Za-z]/g, ''));
    return absoluteColumnIndex - bounds.startColumn;
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

  private formatAttendanceCell(status: RsvpStatus): string {
    if (status === 'Accepted') {
      return 'x';
    }
    if (status === 'Declined') {
      return '-';
    }
    return '';
  }

  private getCancellationForMemberRowsSession(
    source: PublicTrainingSource,
    bounds: TableBounds,
    columnIndex: number,
  ): CancellationNoteData | null {
    const note = this.gateway.getCellNote(
      source.sheetName,
      bounds.startRow,
      bounds.startColumn + columnIndex + 1,
      { spreadsheetId: this.getPublicSpreadsheetId() },
    );

    if (!note.trim()) {
      return null;
    }

    try {
      const parsed = JSON.parse(note) as Partial<CancellationNoteData>;
      if (parsed.cancelledAt && parsed.cancelledByMemberId) {
        return {
          cancelledAt: parsed.cancelledAt,
          cancelledByMemberId: parsed.cancelledByMemberId,
          reason: parsed.reason,
        };
      }
    } catch {
      return null;
    }

    return null;
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
      spreadsheetId: this.getPublicSpreadsheetId(),
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

  private deriveTrainingDay(sessionDate: string): TrainingDefinition['day'] | undefined {
    const date = new Date(`${sessionDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    const weekday = WEEKDAYS_FROM_SUNDAY[date.getUTCDay()];
    return (TRAINING_DAYS as readonly string[]).includes(weekday) ? weekday as TrainingDefinition['day'] : undefined;
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
