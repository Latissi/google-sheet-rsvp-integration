import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
  AttendanceSyncMetadata,
  PublicTrainingSource,
  RsvpStatus,
  TrainingCancellation,
  TrainingAudience,
  TrainingDefinition,
  TrainingEnvironment,
  TrainingSession,
} from '../../domain/types';
import { MemberRowUserMatcher } from './MemberRowUserMatcher';
import { TrainingSessionDateParser } from './TrainingSessionDateParser';
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

interface ResolvedTrainingTemplate {
  trainingId: string;
  title: string;
  day: TrainingDefinition['day'];
  startTime: string;
  endTime?: string;
  location?: string;
  environment?: TrainingEnvironment;
  audience?: TrainingAudience;
  description?: string;
}

const DEFAULT_MANUAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export class GoogleSheetTrainingDataRepository implements ITrainingDataRepository {
  private sessionReferencesCache: SessionReference[] | null = null;
  private readonly sourceTableCache = new Map<string, unknown[][]>();
  private readonly sessionDateParser: TrainingSessionDateParser;
  private readonly memberRowUserMatcher: MemberRowUserMatcher;

  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
    private readonly userRepository: IUserRepository,
    private readonly nowProvider: () => Date = () => new Date(),
  ) {
    this.sessionDateParser = new TrainingSessionDateParser(nowProvider);
    this.memberRowUserMatcher = new MemberRowUserMatcher();
  }

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
      reference.source.attendance.dateHeaderRow,
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

    this.invalidateSourceCache(reference.source);
  }

  private getAllSessionReferences(): SessionReference[] {
    if (!this.sessionReferencesCache) {
      this.sessionReferencesCache = this.configurationProvider
        .getPublicTrainingSources()
        .flatMap(source => this.readMemberRowsSource(source));
    }

    return this.sessionReferencesCache;
  }

  private readMemberRowsSource(source: PublicTrainingSource): SessionColumnReference[] {
    const bounds = this.getTableBounds(source.tableRange);
    const rawTable = this.getSourceTable(source);
    if (rawTable.length === 0) {
      return [];
    }

    const headerRowIndex = this.getDateHeaderRowIndex(source, bounds, rawTable.length);
    const headers = rawTable[headerRowIndex] ?? [];
    const attendanceStartIndex = this.getAttendanceStartIndex(source, bounds);
    const sessions: SessionColumnReference[] = [];
    let previousSessionDate: string | null = null;

    for (let columnIndex = attendanceStartIndex; columnIndex < headers.length; columnIndex += 1) {
      const sessionDate = this.sessionDateParser.parseHeader(headers[columnIndex], previousSessionDate);
      if (!sessionDate) {
        continue;
      }
      previousSessionDate = sessionDate;

      const trainingTemplate = this.resolveTrainingTemplate(source, sessionDate);

      const cancellation = this.getCancellationForMemberRowsSession(source, bounds, columnIndex);

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
        trainingDefinition: {
          trainingId: trainingTemplate.trainingId,
          title: trainingTemplate.title,
          day: trainingTemplate.day,
          startTime: trainingTemplate.startTime,
          endTime: trainingTemplate.endTime,
          location: trainingTemplate.location,
          environment: trainingTemplate.environment,
          audience: trainingTemplate.audience,
          description: trainingTemplate.description,
        },
      });
    }

    return sessions;
  }

  private getAttendanceForMemberRowsSession(reference: SessionColumnReference): AttendanceRecord[] {
    const rawTable = this.getSourceTable(reference.source);
    const users = this.userRepository.getAllUsers();
    const memberStartRowIndex = this.getMemberStartRowIndex(reference.source, reference.bounds, rawTable.length);
    const firstNameIndex = this.getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = this.getMemberRowsLastNameIndex(reference.source, reference.bounds);
    const columnIndex = reference.columnIndex;

    return rawTable
      .slice(memberStartRowIndex)
      .map((rowValues, rowOffset) => {
        if (!rowValues || rowValues.every(cell => String(cell ?? '').trim() === '')) {
          return null;
        }

        const user = this.memberRowUserMatcher.findUser(
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
          reference.source.attendance.firstMemberRow + rowOffset,
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

    const rawTable = this.getSourceTable(reference.source);
    const memberStartRowIndex = this.getMemberStartRowIndex(reference.source, reference.bounds, rawTable.length);
    const firstNameIndex = this.getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = this.getMemberRowsLastNameIndex(reference.source, reference.bounds);

    let absoluteRowIndex: number | null = null;
    for (let rowOffset = memberStartRowIndex; rowOffset < rawTable.length; rowOffset += 1) {
      const rowValues = rawTable[rowOffset];
      if (!rowValues) {
        continue;
      }

      const rowUser = this.memberRowUserMatcher.findUser(rowValues[firstNameIndex], rowValues[lastNameIndex], [user]);
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

    this.invalidateSourceCache(reference.source);
  }

  private resolveTrainingTemplate(source: PublicTrainingSource, sessionDate: string): ResolvedTrainingTemplate {
    const sessionDay = this.sessionDateParser.deriveTrainingDay(sessionDate);
    if (!sessionDay) {
      throw new Error(`Public training source "${source.sourceId}" has an unparseable session date "${sessionDate}".`);
    }

    const matches = source.trainings.filter(training => training.day === sessionDay);
    if (matches.length === 0) {
      throw new Error(`Public training source "${source.sourceId}" has no training definition for weekday "${sessionDay}".`);
    }

    if (matches.length > 1) {
      throw new Error(`Public training source "${source.sourceId}" has multiple training definitions for weekday "${sessionDay}".`);
    }

    const training = matches[0];
    return {
      trainingId: training.trainingId,
      title: training.title?.trim() || training.trainingId,
      day: training.day,
      startTime: training.startTime,
      endTime: training.endTime,
      location: training.location,
      environment: training.environment,
      audience: training.audience,
      description: training.description,
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

  private getSourceTable(source: PublicTrainingSource): unknown[][] {
    const cacheKey = this.getSourceTableCacheKey(source);
    const cached = this.sourceTableCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const rawTable = this.gateway.getSheetValues(source.sheetName, {
      spreadsheetId: this.getPublicSpreadsheetId(),
      rangeA1: source.tableRange,
    });
    this.sourceTableCache.set(cacheKey, rawTable);
    return rawTable;
  }

  private getSourceTableCacheKey(source: PublicTrainingSource): string {
    return `${source.sheetName}::${source.tableRange ?? ''}`;
  }

  private invalidateSourceCache(source: PublicTrainingSource): void {
    this.sessionReferencesCache = null;
    this.sourceTableCache.delete(this.getSourceTableCacheKey(source));
  }

  private getDateHeaderRowIndex(source: PublicTrainingSource, bounds: TableBounds, tableHeight: number): number {
    const relativeIndex = source.attendance.dateHeaderRow - bounds.startRow;
    if (!Number.isInteger(relativeIndex) || relativeIndex < 0 || relativeIndex >= tableHeight) {
      throw new Error(`Public training source "${source.sourceId}" defines dateHeaderRow outside of tableRange.`);
    }
    return relativeIndex;
  }

  private getMemberStartRowIndex(source: PublicTrainingSource, bounds: TableBounds, tableHeight: number): number {
    const relativeIndex = source.attendance.firstMemberRow - bounds.startRow;
    if (!Number.isInteger(relativeIndex) || relativeIndex < 0) {
      throw new Error(`Public training source "${source.sourceId}" defines firstMemberRow outside of tableRange.`);
    }
    return Math.min(relativeIndex, tableHeight);
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
      source.attendance.dateHeaderRow,
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
