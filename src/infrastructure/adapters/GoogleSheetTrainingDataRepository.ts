import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
  AttendanceSyncMetadata,
  PublicTrainingSource,
  ReminderOffset,
  RsvpStatus,
  TrainingCancellation,
  TrainingDefinition,
  TrainingEnvironment,
  TrainingSession,
  getReminderOffsetMinutes,
} from '../../domain/types';
import { MemberRowUserMatcher } from './MemberRowUserMatcher';
import { TrainingSessionDateParser } from './TrainingSessionDateParser';
import { ISheetGateway } from '../gateway/ISheetGateway';
import { getCellValue, normalizeHeader } from './SheetColumnMapper';
import {
  TableBounds,
  getTableBounds,
  getRelativeColumnIndex,
  getMemberStartRowIndex,
  getMemberRowsFirstNameIndex,
  getMemberRowsLastNameIndex,
  normalizeSheetText,
} from './SheetTableUtils';

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

interface SessionDispatchMetadata {
  cancellationNotificationSentAt?: string;
}

interface AttendanceMetadataEntry {
  rowIndex: number;
  metadata: AttendanceSyncMetadata;
}

interface SessionDispatchMetadataEntry {
  rowIndex: number;
  metadata: SessionDispatchMetadata;
}

interface ReminderDispatchMetadataEntry {
  rowIndex: number;
  sentAt: string;
}

interface RuntimeMetadataEntry {
  rowIndex: number;
  value: string;
}

interface ResolvedTrainingTemplate {
  trainingId: string;
  title: string;
  day: TrainingDefinition['day'];
  startTime: string;
  endTime?: string;
  location?: string;
  environment?: TrainingEnvironment;
}

interface SessionColumnCandidate {
  columnIndex: number;
  sessionDate: string;
  trainingTemplate: ResolvedTrainingTemplate;
}

interface TrainingDataRepositoryLogger {
  warn(operation: string, event: string, context?: Record<string, unknown>, message?: string): void;
}

const DEFAULT_MANUAL_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const ATTENDANCE_METADATA_SHEET_NAME = 'TeilnahmeMetadaten';
const ATTENDANCE_METADATA_HEADERS = ['SessionId', 'MitgliedId', 'Quelle', 'AktualisiertAm'];
const DISPATCH_METADATA_SHEET_NAME = 'VersandMetadaten';
const DISPATCH_METADATA_HEADERS = ['SessionId', 'AbsageBenachrichtigungGesendetAm'];
const REMINDER_DISPATCH_METADATA_SHEET_NAME = 'ErinnerungsVersandMetadaten';
const REMINDER_DISPATCH_METADATA_HEADERS = ['SessionId', 'OffsetMinuten', 'GesendetAm'];
const RUNTIME_METADATA_SHEET_NAME = 'LaufzeitMetadaten';
const RUNTIME_METADATA_HEADERS = ['Schluessel', 'Wert'];
const LAST_SUCCESSFUL_REMINDER_DISPATCH_KEY = 'runReminderDispatch:lastSuccessfulRunAt';

export class GoogleSheetTrainingDataRepository implements ITrainingDataRepository {
  private sessionReferencesCache: SessionReference[] | null = null;
  private readonly sourceTableCache = new Map<string, unknown[][]>();
  private attendanceMetadataCache: Map<string, AttendanceMetadataEntry> | null = null;
  private sessionDispatchMetadataCache: Map<string, SessionDispatchMetadataEntry> | null = null;
  private reminderDispatchMetadataCache: Map<string, ReminderDispatchMetadataEntry> | null = null;
  private runtimeMetadataCache: Map<string, RuntimeMetadataEntry> | null = null;
  private readonly sessionDateParser: TrainingSessionDateParser;
  private readonly memberRowUserMatcher: MemberRowUserMatcher;

  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
    private readonly userRepository: IUserRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    private readonly logger?: TrainingDataRepositoryLogger,
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

  getCancellationNotificationSentAt(sessionId: string): string | null {
    const reference = this.findSessionReferenceOrThrow(sessionId);
    return this.getSessionDispatchMetadata(reference.session.sessionId).cancellationNotificationSentAt ?? null;
  }

  getReminderNotificationSentAt(sessionId: string, offset: ReminderOffset): string | null {
    const reference = this.findSessionReferenceOrThrow(sessionId);
    return this.getReminderDispatchMetadata(reference.session.sessionId, offset) ?? null;
  }

  getLastSuccessfulReminderDispatchAt(): string | null {
    return this.getRuntimeMetadataValue(LAST_SUCCESSFUL_REMINDER_DISPATCH_KEY);
  }

  cancelTrainingSession(cancellation: TrainingCancellation): void {
    const reference = this.findSessionReferenceOrThrow(cancellation.sessionId);
    const infoRow = reference.source.attendance.infoRow;

    if (infoRow === undefined) {
      throw new Error(`Training session "${cancellation.sessionId}" cannot be cancelled because the source has no infoRow configured.`);
    }

    const nextAdditionalInfo = this.createCancellationAdditionalInfo(reference, cancellation.reason);
    this.gateway.setCellValue(
      reference.source.sheetName,
      infoRow,
      reference.bounds.startColumn + reference.columnIndex + 1,
      nextAdditionalInfo,
      {
        spreadsheetId: this.getPublicSpreadsheetId(),
      },
    );

    this.invalidateSourceCache(reference.source);
  }

  saveAttendance(record: AttendanceRecord): void {
    const reference = this.findSessionReferenceOrThrow(record.sessionId);
    this.saveAttendanceForMemberRowsSession(reference, record);
  }

  markCancellationNotificationSent(cancellation: TrainingCancellation, notifiedAt: string): void {
    const reference = this.findSessionReferenceOrThrow(cancellation.sessionId);
    this.upsertSessionDispatchMetadata(reference.session.sessionId, {
      ...this.getSessionDispatchMetadata(reference.session.sessionId),
      cancellationNotificationSentAt: notifiedAt,
    });
  }

  markReminderNotificationSent(sessionId: string, offset: ReminderOffset, notifiedAt: string): void {
    const reference = this.findSessionReferenceOrThrow(sessionId);
    this.upsertReminderDispatchMetadata(reference.session.sessionId, offset, notifiedAt);
  }

  markLastSuccessfulReminderDispatchAt(completedAt: string): void {
    this.upsertRuntimeMetadata(LAST_SUCCESSFUL_REMINDER_DISPATCH_KEY, completedAt);
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
    const bounds = getTableBounds(source.tableRange);
    const rawTable = this.getSourceTable(source);
    if (rawTable.length === 0) {
      return [];
    }

    const headerRowIndex = this.getDateHeaderRowIndex(source, bounds, rawTable.length);
    const headers = rawTable[headerRowIndex] ?? [];
    const attendanceStartIndex = this.getAttendanceStartIndex(source, bounds);
    const sessions: SessionColumnReference[] = [];
    const candidates: SessionColumnCandidate[] = [];
    let previousSessionDate: string | null = null;

    for (let columnIndex = attendanceStartIndex; columnIndex < headers.length; columnIndex += 1) {
      const sessionDate = this.sessionDateParser.parseHeader(headers[columnIndex], previousSessionDate);
      if (!sessionDate) {
        continue;
      }
      previousSessionDate = sessionDate;

      const trainingTemplate = this.resolveTrainingTemplate(source, sessionDate);
      if (!trainingTemplate) {
        continue;
      }

      candidates.push({
        columnIndex,
        sessionDate,
        trainingTemplate,
      });
    }

    this.assertConfiguredTrainingsExistInPublicSheet(source, candidates);

    for (const { columnIndex, sessionDate, trainingTemplate } of candidates) {
      const additionalInfo = this.getAdditionalInfoForMemberRowsSession(source, bounds, rawTable, columnIndex);
      const isCancelled = this.isCancelledByAdditionalInfo(additionalInfo);

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
          additionalInfo: additionalInfo || undefined,
          status: isCancelled ? 'Cancelled' : 'Scheduled',
        },
        trainingDefinition: {
          trainingId: trainingTemplate.trainingId,
          title: trainingTemplate.title,
          day: trainingTemplate.day,
          startTime: trainingTemplate.startTime,
          endTime: trainingTemplate.endTime,
          location: trainingTemplate.location,
          environment: trainingTemplate.environment,
        },
      });
    }

    return sessions;
  }

  private getAttendanceForMemberRowsSession(reference: SessionColumnReference): AttendanceRecord[] {
    const rawTable = this.getSourceTable(reference.source);
    const users = this.userRepository.getAllUsers();
    const memberStartRowIndex = getMemberStartRowIndex(reference.source, reference.bounds, rawTable.length);
    const firstNameIndex = getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = getMemberRowsLastNameIndex(reference.source, reference.bounds);
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
          reference.session.sessionId,
          user.memberId,
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
    const memberStartRowIndex = getMemberStartRowIndex(reference.source, reference.bounds, rawTable.length);
    const firstNameIndex = getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = getMemberRowsLastNameIndex(reference.source, reference.bounds);

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
    this.upsertAttendanceMetadata(record);

    this.invalidateSourceCache(reference.source);
  }

  private resolveTrainingTemplate(source: PublicTrainingSource, sessionDate: string): ResolvedTrainingTemplate | null {
    const sessionDay = this.sessionDateParser.deriveTrainingDay(sessionDate);
    if (!sessionDay) {
      throw new Error(`Public training source "${source.sourceId}" has an unparseable session date "${sessionDate}".`);
    }

    const matches = source.trainings.filter(training => training.day === sessionDay);
    if (matches.length === 0) {
      this.logger?.warn(
        'training-data-repository',
        'skipped-unconfigured-weekday',
        {
          sourceId: source.sourceId,
          sessionDate,
          weekday: sessionDay,
        },
        `Public training source ${source.sourceId} has no training definition for weekday ${sessionDay}. Skipping session date ${sessionDate}.`,
      );
      return null;
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
    };
  }

  private assertConfiguredTrainingsExistInPublicSheet(
    source: PublicTrainingSource,
    candidates: SessionColumnCandidate[],
  ): void {
    const discoveredTrainingIds = new Set(candidates.map(candidate => candidate.trainingTemplate.trainingId));
    const missingTrainingIds = source.trainings
      .map(training => training.trainingId)
      .filter(trainingId => !discoveredTrainingIds.has(trainingId));

    if (missingTrainingIds.length === 0) {
      return;
    }

    throw new Error(
      `Public training source "${source.sourceId}" is missing sessions in the public sheet for configured training definitions: ${missingTrainingIds.join(', ')}.`,
    );
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
    return getRelativeColumnIndex(source.attendance.startColumn, bounds);
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



  private parseAttendanceCell(value: unknown): RsvpStatus | null {
    const normalized = normalizeSheetText(value);
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

  private getAdditionalInfoForMemberRowsSession(
    source: PublicTrainingSource,
    bounds: TableBounds,
    rawTable: unknown[][],
    columnIndex: number,
  ): string {
    if (source.attendance.infoRow === undefined) {
      return '';
    }

    const infoRowIndex = source.attendance.infoRow - bounds.startRow;
    if (!Number.isInteger(infoRowIndex) || infoRowIndex < 0 || infoRowIndex >= rawTable.length) {
      throw new Error(`Public training source "${source.sourceId}" defines infoRow outside of tableRange.`);
    }

    return getCellValue(rawTable[infoRowIndex] ?? [], columnIndex);
  }

  private isCancelledByAdditionalInfo(additionalInfo: string): boolean {
    const normalized = additionalInfo.trim().toLowerCase();
    return normalized.includes('entfällt') || normalized.includes('gesperrt');
  }

  private createCancellationAdditionalInfo(reference: SessionColumnReference, reason?: string): string {
    const rawTable = this.getSourceTable(reference.source);
    const existingAdditionalInfo = this.getAdditionalInfoForMemberRowsSession(
      reference.source,
      reference.bounds,
      rawTable,
      reference.columnIndex,
    );
    const cancellationPrefix = reason?.trim()
      ? `Training entfällt: ${reason.trim()}`
      : 'Training entfällt';

    if (!existingAdditionalInfo) {
      return cancellationPrefix;
    }

    if (this.isCancelledByAdditionalInfo(existingAdditionalInfo)) {
      return existingAdditionalInfo;
    }

    return `${cancellationPrefix} | ${existingAdditionalInfo}`;
  }

  private getSessionDispatchMetadata(sessionId: string): SessionDispatchMetadata {
    return this.getSessionDispatchMetadataCache().get(sessionId)?.metadata ?? {};
  }

  private getReminderDispatchMetadata(sessionId: string, offset: ReminderOffset): string | null {
    return this.getReminderDispatchMetadataCache().get(this.createReminderDispatchMetadataKey(sessionId, offset))?.sentAt ?? null;
  }

  private getRuntimeMetadataValue(key: string): string | null {
    return this.getRuntimeMetadataCache().get(key)?.value ?? null;
  }

  private getCellMetadata(sessionId: string, memberId: string): AttendanceSyncMetadata {
    return this.getAttendanceMetadataCache().get(this.createAttendanceMetadataKey(sessionId, memberId))?.metadata
      ?? this.getDefaultManualMetadata();
  }

  private getAttendanceMetadataCache(): Map<string, AttendanceMetadataEntry> {
    if (!this.attendanceMetadataCache) {
      this.attendanceMetadataCache = this.loadAttendanceMetadataCache();
    }

    return this.attendanceMetadataCache;
  }

  private getSessionDispatchMetadataCache(): Map<string, SessionDispatchMetadataEntry> {
    if (!this.sessionDispatchMetadataCache) {
      this.sessionDispatchMetadataCache = this.loadSessionDispatchMetadataCache();
    }

    return this.sessionDispatchMetadataCache;
  }

  private getReminderDispatchMetadataCache(): Map<string, ReminderDispatchMetadataEntry> {
    if (!this.reminderDispatchMetadataCache) {
      this.reminderDispatchMetadataCache = this.loadReminderDispatchMetadataCache();
    }

    return this.reminderDispatchMetadataCache;
  }

  private getRuntimeMetadataCache(): Map<string, RuntimeMetadataEntry> {
    if (!this.runtimeMetadataCache) {
      this.runtimeMetadataCache = this.loadRuntimeMetadataCache();
    }

    return this.runtimeMetadataCache;
  }

  private loadAttendanceMetadataCache(): Map<string, AttendanceMetadataEntry> {
    const rows = this.getPrivateSheetValuesOrEmpty(ATTENDANCE_METADATA_SHEET_NAME);
    const metadata = new Map<string, AttendanceMetadataEntry>();
    if (rows.length === 0) {
      return metadata;
    }

    const sessionIdIndex = this.getRequiredSheetColumnIndex(ATTENDANCE_METADATA_SHEET_NAME, rows[0] ?? [], 'SessionId');
    const memberIdIndex = this.getRequiredSheetColumnIndex(ATTENDANCE_METADATA_SHEET_NAME, rows[0] ?? [], 'MitgliedId');
    const sourceIndex = this.getRequiredSheetColumnIndex(ATTENDANCE_METADATA_SHEET_NAME, rows[0] ?? [], 'Quelle');
    const updatedAtIndex = this.getRequiredSheetColumnIndex(ATTENDANCE_METADATA_SHEET_NAME, rows[0] ?? [], 'AktualisiertAm');

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row || row.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const sessionId = getCellValue(row, sessionIdIndex);
      const memberId = getCellValue(row, memberIdIndex);
      const source = getCellValue(row, sourceIndex);
      const updatedAt = getCellValue(row, updatedAtIndex);
      if (!sessionId || !memberId || !source || !updatedAt) {
        throw new Error(`Sheet "${ATTENDANCE_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowIndex + 1}.`);
      }
      if (!this.isAttendanceSource(source)) {
        throw new Error(`Sheet "${ATTENDANCE_METADATA_SHEET_NAME}" contains an invalid attendance source at row ${rowIndex + 1}.`);
      }

      const key = this.createAttendanceMetadataKey(sessionId, memberId);
      if (metadata.has(key)) {
        throw new Error(`Sheet "${ATTENDANCE_METADATA_SHEET_NAME}" contains duplicate attendance metadata for sessionId "${sessionId}" and memberId "${memberId}".`);
      }

      metadata.set(key, {
        rowIndex: rowIndex + 1,
        metadata: {
          source,
          updatedAt,
        },
      });
    }

    return metadata;
  }

  private loadSessionDispatchMetadataCache(): Map<string, SessionDispatchMetadataEntry> {
    const rows = this.getPrivateSheetValuesOrEmpty(DISPATCH_METADATA_SHEET_NAME);
    const metadata = new Map<string, SessionDispatchMetadataEntry>();
    if (rows.length === 0) {
      return metadata;
    }

    const sessionIdIndex = this.getRequiredSheetColumnIndex(DISPATCH_METADATA_SHEET_NAME, rows[0] ?? [], 'SessionId');
    const sentAtIndex = this.getRequiredSheetColumnIndex(DISPATCH_METADATA_SHEET_NAME, rows[0] ?? [], 'AbsageBenachrichtigungGesendetAm');

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row || row.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const sessionId = getCellValue(row, sessionIdIndex);
      const cancellationNotificationSentAt = getCellValue(row, sentAtIndex);
      if (!sessionId || !cancellationNotificationSentAt) {
        throw new Error(`Sheet "${DISPATCH_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowIndex + 1}.`);
      }
      if (metadata.has(sessionId)) {
        throw new Error(`Sheet "${DISPATCH_METADATA_SHEET_NAME}" contains duplicate dispatch metadata for sessionId "${sessionId}".`);
      }

      metadata.set(sessionId, {
        rowIndex: rowIndex + 1,
        metadata: {
          cancellationNotificationSentAt,
        },
      });
    }

    return metadata;
  }

  private loadReminderDispatchMetadataCache(): Map<string, ReminderDispatchMetadataEntry> {
    const rows = this.getPrivateSheetValuesOrEmpty(REMINDER_DISPATCH_METADATA_SHEET_NAME);
    const metadata = new Map<string, ReminderDispatchMetadataEntry>();
    if (rows.length === 0) {
      return metadata;
    }

    const sessionIdIndex = this.getRequiredSheetColumnIndex(REMINDER_DISPATCH_METADATA_SHEET_NAME, rows[0] ?? [], 'SessionId');
    const offsetMinutesIndex = this.getRequiredSheetColumnIndex(REMINDER_DISPATCH_METADATA_SHEET_NAME, rows[0] ?? [], 'OffsetMinuten');
    const sentAtIndex = this.getRequiredSheetColumnIndex(REMINDER_DISPATCH_METADATA_SHEET_NAME, rows[0] ?? [], 'GesendetAm');

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row || row.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const sessionId = getCellValue(row, sessionIdIndex);
      const offsetMinutes = getCellValue(row, offsetMinutesIndex);
      const sentAt = getCellValue(row, sentAtIndex);
      if (!sessionId || !offsetMinutes || !sentAt) {
        throw new Error(`Sheet "${REMINDER_DISPATCH_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowIndex + 1}.`);
      }

      const numericOffsetMinutes = Number(offsetMinutes);
      if (!Number.isInteger(numericOffsetMinutes) || numericOffsetMinutes < 0) {
        throw new Error(`Sheet "${REMINDER_DISPATCH_METADATA_SHEET_NAME}" contains an invalid reminder offset at row ${rowIndex + 1}.`);
      }

      const key = this.createReminderDispatchMetadataKeyFromMinutes(sessionId, numericOffsetMinutes);
      if (metadata.has(key)) {
        throw new Error(`Sheet "${REMINDER_DISPATCH_METADATA_SHEET_NAME}" contains duplicate reminder metadata for sessionId "${sessionId}" and offset ${numericOffsetMinutes}.`);
      }

      metadata.set(key, {
        rowIndex: rowIndex + 1,
        sentAt,
      });
    }

    return metadata;
  }

  private loadRuntimeMetadataCache(): Map<string, RuntimeMetadataEntry> {
    const rows = this.getPrivateSheetValuesOrEmpty(RUNTIME_METADATA_SHEET_NAME);
    const metadata = new Map<string, RuntimeMetadataEntry>();
    if (rows.length === 0) {
      return metadata;
    }

    const keyIndex = this.getRequiredSheetColumnIndex(RUNTIME_METADATA_SHEET_NAME, rows[0] ?? [], 'Schluessel');
    const valueIndex = this.getRequiredSheetColumnIndex(RUNTIME_METADATA_SHEET_NAME, rows[0] ?? [], 'Wert');

    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row || row.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const key = getCellValue(row, keyIndex);
      const value = getCellValue(row, valueIndex);
      if (!key || !value) {
        throw new Error(`Sheet "${RUNTIME_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowIndex + 1}.`);
      }
      if (metadata.has(key)) {
        throw new Error(`Sheet "${RUNTIME_METADATA_SHEET_NAME}" contains duplicate runtime metadata for key "${key}".`);
      }

      metadata.set(key, {
        rowIndex: rowIndex + 1,
        value,
      });
    }

    return metadata;
  }

  private upsertAttendanceMetadata(record: AttendanceRecord): void {
    this.gateway.ensureSheetHeaders(ATTENDANCE_METADATA_SHEET_NAME, ATTENDANCE_METADATA_HEADERS);

    const cache = this.getAttendanceMetadataCache();
    const key = this.createAttendanceMetadataKey(record.sessionId, record.memberId);
    const values = [record.sessionId, record.memberId, record.metadata.source, record.metadata.updatedAt];
    const existing = cache.get(key);
    if (existing) {
      this.gateway.setRowValues(ATTENDANCE_METADATA_SHEET_NAME, existing.rowIndex, values);
      existing.metadata = { ...record.metadata };
      return;
    }

    const rowIndex = this.getNextMetadataRowIndex(cache);
    this.gateway.appendRow(ATTENDANCE_METADATA_SHEET_NAME, values);
    cache.set(key, {
      rowIndex,
      metadata: { ...record.metadata },
    });
  }

  private upsertSessionDispatchMetadata(sessionId: string, metadata: SessionDispatchMetadata): void {
    if (!metadata.cancellationNotificationSentAt) {
      return;
    }

    this.gateway.ensureSheetHeaders(DISPATCH_METADATA_SHEET_NAME, DISPATCH_METADATA_HEADERS);

    const cache = this.getSessionDispatchMetadataCache();
    const values = [sessionId, metadata.cancellationNotificationSentAt];
    const existing = cache.get(sessionId);
    if (existing) {
      this.gateway.setRowValues(DISPATCH_METADATA_SHEET_NAME, existing.rowIndex, values);
      existing.metadata = { ...metadata };
      return;
    }

    const rowIndex = this.getNextMetadataRowIndex(cache);
    this.gateway.appendRow(DISPATCH_METADATA_SHEET_NAME, values);
    cache.set(sessionId, {
      rowIndex,
      metadata: { ...metadata },
    });
  }

  private upsertReminderDispatchMetadata(sessionId: string, offset: ReminderOffset, sentAt: string): void {
    this.gateway.ensureSheetHeaders(REMINDER_DISPATCH_METADATA_SHEET_NAME, REMINDER_DISPATCH_METADATA_HEADERS);

    const cache = this.getReminderDispatchMetadataCache();
    const offsetMinutes = getReminderOffsetMinutes(offset);
    const key = this.createReminderDispatchMetadataKeyFromMinutes(sessionId, offsetMinutes);
    const values = [sessionId, offsetMinutes, sentAt];
    const existing = cache.get(key);
    if (existing) {
      this.gateway.setRowValues(REMINDER_DISPATCH_METADATA_SHEET_NAME, existing.rowIndex, values);
      existing.sentAt = sentAt;
      return;
    }

    const rowIndex = this.getNextMetadataRowIndex(cache);
    this.gateway.appendRow(REMINDER_DISPATCH_METADATA_SHEET_NAME, values);
    cache.set(key, {
      rowIndex,
      sentAt,
    });
  }

  private upsertRuntimeMetadata(key: string, value: string): void {
    this.gateway.ensureSheetHeaders(RUNTIME_METADATA_SHEET_NAME, RUNTIME_METADATA_HEADERS);

    const cache = this.getRuntimeMetadataCache();
    const values = [key, value];
    const existing = cache.get(key);
    if (existing) {
      this.gateway.setRowValues(RUNTIME_METADATA_SHEET_NAME, existing.rowIndex, values);
      existing.value = value;
      return;
    }

    const rowIndex = this.getNextMetadataRowIndex(cache);
    this.gateway.appendRow(RUNTIME_METADATA_SHEET_NAME, values);
    cache.set(key, {
      rowIndex,
      value,
    });
  }

  private getPrivateSheetValuesOrEmpty(sheetName: string): unknown[][] {
    try {
      return this.gateway.getSheetValues(sheetName);
    } catch (error) {
      if (error instanceof Error && error.message === `Sheet with name "${sheetName}" not found.`) {
        return [];
      }
      throw error;
    }
  }

  private getRequiredSheetColumnIndex(sheetName: string, headers: unknown[], requiredHeader: string): number {
    const normalizedRequiredHeader = normalizeHeader(requiredHeader);
    const index = headers.findIndex(header => normalizeHeader(header) === normalizedRequiredHeader);
    if (index === -1) {
      throw new Error(`Sheet "${sheetName}" is missing required column "${requiredHeader}".`);
    }
    return index;
  }

  private getNextMetadataRowIndex<T extends { rowIndex: number }>(cache: Map<string, T>): number {
    return Array.from(cache.values()).reduce((maxRowIndex, entry) => Math.max(maxRowIndex, entry.rowIndex), 1) + 1;
  }

  private createAttendanceMetadataKey(sessionId: string, memberId: string): string {
    return `${sessionId}::${memberId}`;
  }

  private createReminderDispatchMetadataKey(sessionId: string, offset: ReminderOffset): string {
    return this.createReminderDispatchMetadataKeyFromMinutes(sessionId, getReminderOffsetMinutes(offset));
  }

  private createReminderDispatchMetadataKeyFromMinutes(sessionId: string, offsetMinutes: number): string {
    return `${sessionId}::${offsetMinutes}`;
  }

  private isAttendanceSource(value: string): value is AttendanceSyncMetadata['source'] {
    return ['manual', 'email-rsvp', 'sheet-sync', 'system'].includes(value);
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

}
