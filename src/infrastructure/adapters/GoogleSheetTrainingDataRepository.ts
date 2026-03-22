import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
  AttendanceSyncMetadata,
  PublicTrainingSource,
  RsvpStatus,
  TrainingCancellation,
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

export class GoogleSheetTrainingDataRepository implements ITrainingDataRepository {
  private sessionReferencesCache: SessionReference[] | null = null;
  private readonly sourceTableCache = new Map<string, unknown[][]>();
  private attendanceMetadataCache: Map<string, AttendanceMetadataEntry> | null = null;
  private sessionDispatchMetadataCache: Map<string, SessionDispatchMetadataEntry> | null = null;
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

    return this.getCellValue(rawTable[infoRowIndex] ?? [], columnIndex);
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

      const sessionId = this.getCellValue(row, sessionIdIndex);
      const memberId = this.getCellValue(row, memberIdIndex);
      const source = this.getCellValue(row, sourceIndex);
      const updatedAt = this.getCellValue(row, updatedAtIndex);
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

      const sessionId = this.getCellValue(row, sessionIdIndex);
      const cancellationNotificationSentAt = this.getCellValue(row, sentAtIndex);
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
    const normalizedRequiredHeader = this.normalizeHeader(requiredHeader);
    const index = headers.findIndex(header => this.normalizeHeader(header) === normalizedRequiredHeader);
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

  private normalizeHeader(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }
}
