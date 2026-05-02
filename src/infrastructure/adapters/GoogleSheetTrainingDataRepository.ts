import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { SaveRsvpCommentRequest } from '../../domain/ports/IRsvpCommentRepository';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
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
import { isEmptyRow } from './sheetUtils';
import { getCellValue } from './SheetColumnMapper';
import { SheetMetadataStore } from './SheetMetadataStore';
import { SourceTableCache } from './SourceTableCache';
import {
  TableBounds,
  getTableBounds,
  getRelativeColumnIndex,
  getMemberStartRowIndex,
  getMemberRowsFirstNameIndex,
  getMemberRowsLastNameIndex,
  normalizeSheetText,
  getTableEndRow,
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

interface MemberRowsAttendanceCellReference {
  rowIndex: number;
  columnIndex: number;
}

type SessionReference = SessionColumnReference;

interface SessionDispatchMetadata {
  cancellationNotificationSentAt: string;
}

interface ReminderMetadata {
  sessionId: string;
  offsetMinutes: number;
  sentAt: string;
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

type ResolveTrainingTemplateResult =
  | {
    kind: 'resolved';
    trainingTemplate: ResolvedTrainingTemplate;
  }
  | {
    kind: 'missing-weekday';
    weekday: TrainingDefinition['day'];
  };

interface SessionColumnCandidate {
  columnIndex: number;
  sessionDate: string;
  trainingTemplate: ResolvedTrainingTemplate;
}

interface UnconfiguredWeekdayWarningSummary {
  weekday: TrainingDefinition['day'];
  count: number;
  firstSessionDate: string;
  lastSessionDate: string;
}

interface TrainingDataRepositoryLogger {
  warn(operation: string, event: string, context?: Record<string, unknown>, message?: string): void;
}

const DISPATCH_METADATA_SHEET_NAME = 'VersandMetadaten';
const DISPATCH_METADATA_HEADERS = ['SessionId', 'AbsageBenachrichtigungGesendetAm'];
const REMINDER_DISPATCH_METADATA_SHEET_NAME = 'ErinnerungsVersandMetadaten';
const REMINDER_DISPATCH_METADATA_HEADERS = ['SessionId', 'OffsetMinuten', 'GesendetAm'];
const RUNTIME_METADATA_SHEET_NAME = 'LaufzeitMetadaten';
const RUNTIME_METADATA_HEADERS = ['Schluessel', 'Wert'];
const LAST_SUCCESSFUL_REMINDER_DISPATCH_KEY = 'runReminderDispatch:lastSuccessfulRunAt';
const CANCELLATION_COLUMN_COLOR = '#f4cccc';

export class GoogleSheetTrainingDataRepository implements ITrainingDataRepository {
  private sessionReferencesCache: SessionReference[] | null = null;
  private readonly sourceTableCache: SourceTableCache;
  private readonly sessionDispatchMetadataStore: SheetMetadataStore<SessionDispatchMetadata>;
  private readonly reminderDispatchMetadataStore: SheetMetadataStore<ReminderMetadata>;
  private readonly runtimeMetadataStore: SheetMetadataStore<string>;
  private readonly sessionDateParser: TrainingSessionDateParser;
  private readonly memberRowUserMatcher: MemberRowUserMatcher;

  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
    private readonly userRepository: IUserRepository,
    private readonly nowProvider: () => Date = () => new Date(),
    private readonly logger?: TrainingDataRepositoryLogger,
    sourceTableCache?: SourceTableCache,
  ) {
    this.sessionDateParser = new TrainingSessionDateParser(nowProvider);
    this.memberRowUserMatcher = new MemberRowUserMatcher();
    this.sourceTableCache = sourceTableCache ?? new SourceTableCache(gateway, configurationProvider);

    this.sessionDispatchMetadataStore = new SheetMetadataStore<SessionDispatchMetadata>(
      gateway,
      DISPATCH_METADATA_SHEET_NAME,
      DISPATCH_METADATA_HEADERS,
      (cols, rowNum) => {
        if (!cols['SessionId'] || !cols['AbsageBenachrichtigungGesendetAm']) {
          throw new Error(`Sheet "${DISPATCH_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowNum}.`);
        }
        return cols['SessionId']!;
      },
      (cols) => ({ cancellationNotificationSentAt: cols['AbsageBenachrichtigungGesendetAm']! }),
      (key, meta) => [key, meta.cancellationNotificationSentAt],
    );

    this.reminderDispatchMetadataStore = new SheetMetadataStore<ReminderMetadata>(
      gateway,
      REMINDER_DISPATCH_METADATA_SHEET_NAME,
      REMINDER_DISPATCH_METADATA_HEADERS,
      (cols, rowNum) => {
        if (!cols['SessionId'] || !cols['OffsetMinuten'] || !cols['GesendetAm']) {
          throw new Error(`Sheet "${REMINDER_DISPATCH_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowNum}.`);
        }
        const offsetMinutes = Number(cols['OffsetMinuten']);
        if (!Number.isInteger(offsetMinutes) || offsetMinutes < 0) {
          throw new Error(`Sheet "${REMINDER_DISPATCH_METADATA_SHEET_NAME}" contains an invalid reminder offset at row ${rowNum}.`);
        }
        if (cols['SessionId']!.includes('::')) {
          throw new Error(`Sheet "${REMINDER_DISPATCH_METADATA_SHEET_NAME}" row ${rowNum}: SessionId must not contain "::"`);
        }
        return `${cols['SessionId']}::${offsetMinutes}`;
      },
      (cols) => ({
        sessionId: cols['SessionId']!,
        offsetMinutes: Number(cols['OffsetMinuten']),
        sentAt: cols['GesendetAm']!,
      }),
      (_key, meta) => [meta.sessionId, meta.offsetMinutes, meta.sentAt],
    );

    this.runtimeMetadataStore = new SheetMetadataStore<string>(
      gateway,
      RUNTIME_METADATA_SHEET_NAME,
      RUNTIME_METADATA_HEADERS,
      (cols, rowNum) => {
        if (!cols['Schluessel'] || !cols['Wert']) {
          throw new Error(`Sheet "${RUNTIME_METADATA_SHEET_NAME}" contains an incomplete metadata row at ${rowNum}.`);
        }
        return cols['Schluessel']!;
      },
      (cols) => cols['Wert']!,
      (key, value) => [key, value],
    );
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
    return this.sessionDispatchMetadataStore.get(reference.session.sessionId)?.cancellationNotificationSentAt ?? null;
  }

  getReminderNotificationSentAt(sessionId: string, offset: ReminderOffset): string | null {
    const reference = this.findSessionReferenceOrThrow(sessionId);
    const key = this.createReminderDispatchMetadataKey(reference.session.sessionId, offset);
    return this.reminderDispatchMetadataStore.get(key)?.sentAt ?? null;
  }

  getLastSuccessfulReminderDispatchAt(): string | null {
    return this.runtimeMetadataStore.get(LAST_SUCCESSFUL_REMINDER_DISPATCH_KEY) ?? null;
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

    this.doPaintCancelledSessionColumn(reference);
    this.invalidateSourceCache(reference.source);
  }

  paintCancelledSessionColumn(sessionId: string): void {
    const reference = this.findSessionReferenceOrThrow(sessionId);
    this.doPaintCancelledSessionColumn(reference);
  }

  saveAttendance(record: AttendanceRecord): void {
    const reference = this.findSessionReferenceOrThrow(record.sessionId);
    this.saveAttendanceForMemberRowsSession(reference, record);
  }

  saveRsvpComment(request: SaveRsvpCommentRequest): void {
    const reference = this.findSessionReferenceOrThrow(request.sessionId);
    const cellReference = this.resolveMemberRowsAttendanceCell(reference, request.memberId);

    this.gateway.setCellNote(
      reference.source.sheetName,
      cellReference.rowIndex,
      cellReference.columnIndex,
      request.comment,
      { spreadsheetId: this.getPublicSpreadsheetId() },
    );
  }

  markCancellationNotificationSent(cancellation: TrainingCancellation, notifiedAt: string): void {
    const reference = this.findSessionReferenceOrThrow(cancellation.sessionId);
    this.sessionDispatchMetadataStore.upsert(
      reference.session.sessionId,
      { cancellationNotificationSentAt: notifiedAt },
    );
  }

  markReminderNotificationSent(sessionId: string, offset: ReminderOffset, notifiedAt: string): void {
    const reference = this.findSessionReferenceOrThrow(sessionId);
    const offsetMinutes = getReminderOffsetMinutes(offset);
    const key = this.createReminderDispatchMetadataKeyFromMinutes(reference.session.sessionId, offsetMinutes);
    this.reminderDispatchMetadataStore.upsert(key, {
      sessionId: reference.session.sessionId,
      offsetMinutes,
      sentAt: notifiedAt,
    });
  }

  markLastSuccessfulReminderDispatchAt(completedAt: string): void {
    this.runtimeMetadataStore.upsert(LAST_SUCCESSFUL_REMINDER_DISPATCH_KEY, completedAt);
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
    const unconfiguredWeekdayWarnings = new Map<TrainingDefinition['day'], UnconfiguredWeekdayWarningSummary>();
    let previousSessionDate: string | null = null;

    for (let columnIndex = attendanceStartIndex; columnIndex < headers.length; columnIndex += 1) {
      const sessionDate = this.sessionDateParser.parseHeader(headers[columnIndex], previousSessionDate);
      if (!sessionDate) {
        continue;
      }
      previousSessionDate = sessionDate;

      const trainingTemplate = this.resolveTrainingTemplate(source, sessionDate);
      if (trainingTemplate.kind === 'missing-weekday') {
        this.recordUnconfiguredWeekdayWarning(unconfiguredWeekdayWarnings, trainingTemplate.weekday, sessionDate);
        continue;
      }

      candidates.push({
        columnIndex,
        sessionDate,
        trainingTemplate: trainingTemplate.trainingTemplate,
      });
    }

    this.emitUnconfiguredWeekdayWarnings(source, unconfiguredWeekdayWarnings);
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

        return {
          memberId: user.memberId,
          sessionId: reference.session.sessionId,
          rsvpStatus,
        } satisfies AttendanceRecord;
      })
      .filter((record): record is AttendanceRecord => record !== null);
  }

  private saveAttendanceForMemberRowsSession(reference: SessionColumnReference, record: AttendanceRecord): void {
    const cellReference = this.resolveMemberRowsAttendanceCell(reference, record.memberId);
    this.gateway.setCellValue(
      reference.source.sheetName,
      cellReference.rowIndex,
      cellReference.columnIndex,
      this.formatAttendanceCell(record.rsvpStatus),
      { spreadsheetId: this.getPublicSpreadsheetId() },
    );

    this.invalidateSourceCache(reference.source);
  }

  private resolveMemberRowsAttendanceCell(
    reference: SessionColumnReference,
    memberId: string,
  ): MemberRowsAttendanceCellReference {
    const user = this.userRepository.getUserByMemberId(memberId);
    if (!user) {
      throw new Error(`User with memberId "${memberId}" not found.`);
    }

    const rawTable = this.getSourceTable(reference.source);
    const memberStartRowIndex = getMemberStartRowIndex(reference.source, reference.bounds, rawTable.length);
    const firstNameIndex = getMemberRowsFirstNameIndex(reference.source, reference.bounds);
    const lastNameIndex = getMemberRowsLastNameIndex(reference.source, reference.bounds);

    for (let rowOffset = memberStartRowIndex; rowOffset < rawTable.length; rowOffset += 1) {
      const rowValues = rawTable[rowOffset];
      if (!rowValues) {
        continue;
      }

      const rowUser = this.memberRowUserMatcher.findUser(rowValues[firstNameIndex], rowValues[lastNameIndex], [user]);
      if (rowUser?.memberId === user.memberId) {
        return {
          rowIndex: reference.bounds.startRow + rowOffset,
          columnIndex: reference.bounds.startColumn + reference.columnIndex + 1,
        };
      }
    }

    throw new Error(`No attendance row found for memberId "${memberId}" in session "${reference.session.sessionId}".`);
  }

  private resolveTrainingTemplate(source: PublicTrainingSource, sessionDate: string): ResolveTrainingTemplateResult {
    const sessionDay = this.sessionDateParser.deriveTrainingDay(sessionDate);
    if (!sessionDay) {
      throw new Error(`Public training source "${source.sourceId}" has an unparseable session date "${sessionDate}".`);
    }

    const matches = source.trainings.filter(training => training.day === sessionDay);
    if (matches.length === 0) {
      return {
        kind: 'missing-weekday',
        weekday: sessionDay,
      };
    }

    if (matches.length > 1) {
      throw new Error(`Public training source "${source.sourceId}" has multiple training definitions for weekday "${sessionDay}".`);
    }

    const training = matches[0];
    return {
      kind: 'resolved',
      trainingTemplate: {
        trainingId: training.trainingId,
        title: training.title?.trim() || training.trainingId,
        day: training.day,
        startTime: training.startTime,
        endTime: training.endTime,
        location: training.location,
        environment: training.environment,
      },
    };
  }

  private recordUnconfiguredWeekdayWarning(
    warnings: Map<TrainingDefinition['day'], UnconfiguredWeekdayWarningSummary>,
    weekday: TrainingDefinition['day'],
    sessionDate: string,
  ): void {
    if (this.isPastSessionDate(sessionDate)) {
      return;
    }

    const existing = warnings.get(weekday);
    if (!existing) {
      warnings.set(weekday, {
        weekday,
        count: 1,
        firstSessionDate: sessionDate,
        lastSessionDate: sessionDate,
      });
      return;
    }

    existing.count += 1;
    existing.firstSessionDate = sessionDate < existing.firstSessionDate ? sessionDate : existing.firstSessionDate;
    existing.lastSessionDate = sessionDate > existing.lastSessionDate ? sessionDate : existing.lastSessionDate;
  }

  private emitUnconfiguredWeekdayWarnings(
    source: PublicTrainingSource,
    warnings: Map<TrainingDefinition['day'], UnconfiguredWeekdayWarningSummary>,
  ): void {
    warnings.forEach((warning) => {
      this.logger?.warn(
        'training-data-repository',
        'skipped-unconfigured-weekday',
        {
          sourceId: source.sourceId,
          weekday: warning.weekday,
          count: warning.count,
          firstSessionDate: warning.firstSessionDate,
          lastSessionDate: warning.lastSessionDate,
        },
        this.buildUnconfiguredWeekdayWarningMessage(source.sourceId, warning),
      );
    });
  }

  private buildUnconfiguredWeekdayWarningMessage(
    sourceId: string,
    warning: UnconfiguredWeekdayWarningSummary,
  ): string {
    if (warning.count === 1) {
      return `Public training source ${sourceId} has no training definition for weekday ${warning.weekday}. Skipping session date ${warning.firstSessionDate}.`;
    }

    return `Public training source ${sourceId} has no training definition for weekday ${warning.weekday}. Skipping ${warning.count} session dates from ${warning.firstSessionDate} to ${warning.lastSessionDate}.`;
  }

  private isPastSessionDate(sessionDate: string): boolean {
    return sessionDate < this.getCurrentUtcDateString();
  }

  private getCurrentUtcDateString(): string {
    const now = this.nowProvider();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString().slice(0, 10);
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
    return this.sourceTableCache.get(source);
  }

  private invalidateSourceCache(source: PublicTrainingSource): void {
    this.sessionReferencesCache = null;
    this.sourceTableCache.invalidate(source);
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

    if (/^\(\s*x\s*\)$/i.test(raw)) {
      return 'Tentative';
    }

    if (['accepted', 'yes', 'ja', 'zugesagt', 'true', '1', 'x'].includes(normalized)) {
      return 'Accepted';
    }

    if (['tentative', 'unsure', 'uncertain', 'unsicher', 'vielleicht'].includes(normalized)) {
      return 'Tentative';
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
    if (status === 'Tentative') {
      return '(x)';
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

  private doPaintCancelledSessionColumn(reference: SessionColumnReference): void {
    const { source, bounds, columnIndex } = reference;
    const { dateHeaderRow, infoRow } = source.attendance;
    const startRow = infoRow !== undefined ? Math.min(infoRow, dateHeaderRow) : dateHeaderRow;
    const endRow = getTableEndRow(source.tableRange) ?? startRow + 199;
    const absoluteColumnIndex = bounds.startColumn + columnIndex + 1;
    this.gateway.setColumnBackground(
      source.sheetName,
      absoluteColumnIndex,
      startRow,
      endRow - startRow + 1,
      CANCELLATION_COLUMN_COLOR,
      { spreadsheetId: this.getPublicSpreadsheetId() },
    );
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

  private createReminderDispatchMetadataKey(sessionId: string, offset: ReminderOffset): string {
    return this.createReminderDispatchMetadataKeyFromMinutes(sessionId, getReminderOffsetMinutes(offset));
  }

  private createReminderDispatchMetadataKeyFromMinutes(sessionId: string, offsetMinutes: number): string {
    return `${sessionId}::${offsetMinutes}`;
  }

  private createSessionId(sourceId: string, trainingId: string, sessionDate: string, startTime: string): string {
    const parts = [sourceId, trainingId, sessionDate, startTime];
    if (parts.some(part => part.includes('__'))) {
      throw new Error(
        `Session ID parts must not contain "__". Got: ${parts.join(', ')}`,
      );
    }
    return parts.map(part => part.trim()).join('__');
  }

}

