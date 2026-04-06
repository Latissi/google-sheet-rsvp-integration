import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import {
  AttendanceConfig,
  PublicTrainingSource,
  ReminderOffset,
  ReminderPolicy,
  TRAINING_DAYS,
  TrainingDay,
  TrainingEnvironment,
  getReminderOffsetMinutes,
} from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';
import { getCellValue, getColumnIndex, getRequiredColumnIndex } from './SheetColumnMapper';
import { isEmptyRow } from './sheetUtils';

interface PublicTrainingSourceSheetSchema {
  sourceId: number;
  sheetName: number;
  tableRange?: number;
  dateHeaderRow: number;
  infoRow?: number;
  firstMemberRow: number;
  firstNameColumn?: number;
  lastNameColumn?: number;
  genderColumn?: number;
  startColumn: number;
}

interface TrainingDefinitionSheetSchema {
  sourceId: number;
  trainingId: number;
  title?: number;
  day?: number;
  startTime?: number;
  endTime?: number;
  location?: number;
  environment?: number;
}

export class PrivateSheetConfigurationProvider implements IConfigurationProvider {
  private configCache: Map<string, string> | null = null;
  private publicTrainingSourcesCache: PublicTrainingSource[] | null = null;

  private readonly CONFIG_SHEET = 'Konfiguration';
  private readonly PUBLIC_TRAINING_SOURCE_SHEET = 'Trainingsquellen';
  private readonly TRAINING_DEFINITION_SHEET = 'Trainingsdefinitionen';

  constructor(private readonly gateway: ISheetGateway) {}

  private getOptionalConfigValue(key: string): string | null {
    if (!this.configCache) {
      this.configCache = new Map();
      const rows = this.gateway.getSheetValues(this.CONFIG_SHEET);
      for (const row of rows) {
        if (row && row.length >= 2 && row[0]) {
          this.configCache.set(String(row[0]).trim(), String(row[1]).trim());
        }
      }
    }

    const value = this.configCache.get(key);
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return value;
  }

  private getConfigValue(key: string): string {
    const value = this.getOptionalConfigValue(key);
    if (value === null) {
      throw new Error(`Missing required configuration key: "${key}"`);
    }

    return value;
  }

  getPublicSheetId(): string {
    return this.getConfigValue('OEFFENTLICHES_SHEET_ID');
  }

  private parseReminderOffset(value: unknown, index: number): ReminderOffset {
    const hours = Number(value);

    if (!Number.isInteger(hours) || hours < 0) {
      throw new Error(`Reminder offset at index ${index} must be a non-negative integer hour value.`);
    }

    return { hours, minutes: 0 };
  }

  private normalizeReminderOffsets(offsets: ReminderOffset[]): ReminderOffset[] {
    const totals = new Set<number>();
    const normalized = [...offsets].sort((left, right) => {
      return getReminderOffsetMinutes(right) - getReminderOffsetMinutes(left);
    });

    for (const offset of normalized) {
      const totalMinutes = getReminderOffsetMinutes(offset);
      if (totals.has(totalMinutes)) {
        throw new Error(`Duplicate reminder offset configured for ${totalMinutes} minutes before training.`);
      }
      totals.add(totalMinutes);
    }

    return normalized;
  }

  private parseReminderOffsetsConfig(key: string): ReminderOffset[] {
    const value = this.getConfigValue(key);
    const offsets = value.split(';').map(part => part.trim());

    if (offsets.some(offset => offset === '')) {
      throw new Error(`Configuration key "${key}" must contain semicolon-separated non-negative integer hour values.`);
    }

    try {
      return offsets.map((offset, index) => this.parseReminderOffset(offset, index));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Configuration key "${key}" must contain semicolon-separated non-negative integer hour values. ${message}`);
    }
  }

  private isTrainingDay(value: unknown): value is TrainingDay {
    return typeof value === 'string' && new Set<string>(TRAINING_DAYS).has(value);
  }

  private isTrainingEnvironment(value: unknown): value is TrainingEnvironment {
    return value === 'Indoor' || value === 'Outdoor';
  }

  private parseAttendanceConfig(value: unknown, sourceId: string): AttendanceConfig {
    if (!value || typeof value !== 'object') {
      throw new Error(`Public training source "${sourceId}" must define an attendance object.`);
    }

    const candidate = value as Record<string, unknown>;
    if (!candidate.startColumn || typeof candidate.startColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" must define attendance.startColumn.`);
    }

    const dateHeaderRow = Number(candidate.dateHeaderRow);
    if (!Number.isInteger(dateHeaderRow) || dateHeaderRow < 1) {
      throw new Error(`Public training source "${sourceId}" must define attendance.dateHeaderRow as a positive row number.`);
    }

    const infoRowValue = candidate.infoRow;
    const infoRow = infoRowValue === undefined || infoRowValue === null || infoRowValue === ''
      ? undefined
      : Number(infoRowValue);
    if (infoRow !== undefined && (!Number.isInteger(infoRow) || infoRow < 1)) {
      throw new Error(`Public training source "${sourceId}" must define attendance.infoRow as a positive row number.`);
    }

    const firstMemberRow = Number(candidate.firstMemberRow);
    if (!Number.isInteger(firstMemberRow) || firstMemberRow < 1) {
      throw new Error(`Public training source "${sourceId}" must define attendance.firstMemberRow as a positive row number.`);
    }

    if (firstMemberRow <= dateHeaderRow) {
      throw new Error(`Public training source "${sourceId}" must define attendance.firstMemberRow after attendance.dateHeaderRow.`);
    }

    if (infoRow !== undefined && infoRow >= firstMemberRow) {
      throw new Error(`Public training source "${sourceId}" must define attendance.infoRow before attendance.firstMemberRow.`);
    }

    if (typeof candidate.firstNameColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" has an invalid attendance.firstNameColumn value.`);
    }

    if (typeof candidate.lastNameColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" has an invalid attendance.lastNameColumn value.`);
    }

    if (!candidate.firstNameColumn || !candidate.lastNameColumn) {
      throw new Error(`Public training source "${sourceId}" must define attendance.firstNameColumn and attendance.lastNameColumn.`);
    }

    return {
      startColumn: candidate.startColumn,
      infoRow,
      firstNameColumn: candidate.firstNameColumn,
      lastNameColumn: candidate.lastNameColumn,
      genderColumn: typeof candidate.genderColumn === 'string' && candidate.genderColumn ? candidate.genderColumn : undefined,
      dateHeaderRow,
      firstMemberRow,
    };
  }

  private parseTrainingSelector(value: unknown, sourceId: string, trainingLabel: string) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Training selector ${trainingLabel} in source "${sourceId}" must be an object.`);
    }

    const selector = value as Record<string, unknown>;
    const trainingId = String(selector.trainingId ?? '').trim();
    if (!trainingId) {
      throw new Error(`Training selector ${trainingLabel} in source "${sourceId}" is missing trainingId.`);
    }

    if (!this.isTrainingDay(selector.day)) {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid day value.`);
    }

    if (selector.environment !== undefined && !this.isTrainingEnvironment(selector.environment)) {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid environment value.`);
    }

    if (selector.title !== undefined && typeof selector.title !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid title value.`);
    }

    const startTime = this.normalizeTrainingTimeValue(selector.startTime, sourceId, trainingId, 'startTime', true);
    const endTime = this.normalizeTrainingTimeValue(selector.endTime, sourceId, trainingId, 'endTime', false);

    if (!startTime) {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid startTime value.`);
    }

    if (selector.location !== undefined && typeof selector.location !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid location value.`);
    }

    return {
      trainingId,
      day: selector.day,
      environment: selector.environment as TrainingEnvironment | undefined,
      title: selector.title as string | undefined,
      startTime,
      endTime,
      location: selector.location as string | undefined,
    };
  }

  private normalizeTrainingTimeValue(
    value: unknown,
    sourceId: string,
    trainingId: string,
    fieldName: 'startTime' | 'endTime',
    required: boolean,
  ): string | undefined {
    if (value === undefined || value === null || String(value).trim() === '') {
      if (required) {
        throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid ${fieldName} value.`);
      }

      return undefined;
    }

    if (value instanceof Date) {
      return this.formatTrainingTime(value);
    }

    if (typeof value !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid ${fieldName} value.`);
    }

    const trimmed = value.trim();
    const canonicalTime = this.extractCanonicalTime(trimmed);
    if (canonicalTime) {
      return canonicalTime;
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return this.formatTrainingTime(parsed);
    }

    throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid ${fieldName} value.`);
  }

  private extractCanonicalTime(value: string): string | null {
    const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) {
      return null;
    }

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    if (hours > 23 || minutes > 59) {
      return null;
    }

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  private formatTrainingTime(value: Date): string {
    if (typeof Utilities !== 'undefined' && typeof Session !== 'undefined') {
      return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
    }

    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }

  private getPublicTrainingSourceSheetSchema(headers: unknown[]): PublicTrainingSourceSheetSchema {
    return {
      sourceId: getRequiredColumnIndex(headers, ['QuellenId']),
      sheetName: getRequiredColumnIndex(headers, ['TabellenName']),
      tableRange: getColumnIndex(headers, ['TabellenBereich']),
      dateHeaderRow: getRequiredColumnIndex(headers, ['DatumsKopfZeile']),
      infoRow: getColumnIndex(headers, ['InfoZeile']),
      firstMemberRow: getRequiredColumnIndex(headers, ['MitgliederStartZeile']),
      firstNameColumn: getRequiredColumnIndex(headers, ['VornameSpalte']),
      lastNameColumn: getRequiredColumnIndex(headers, ['NachnameSpalte']),
      genderColumn: getColumnIndex(headers, ['GeschlechtSpalte']),
      startColumn: getRequiredColumnIndex(headers, ['StartSpalte']),
    };
  }

  private getTrainingDefinitionSheetSchema(headers: unknown[]): TrainingDefinitionSheetSchema {
    return {
      sourceId: getRequiredColumnIndex(headers, ['QuellenId']),
      trainingId: getRequiredColumnIndex(headers, ['TrainingsId']),
      title: getColumnIndex(headers, ['Titel']),
      day: getColumnIndex(headers, ['Wochentag']),
      startTime: getRequiredColumnIndex(headers, ['Startzeit']),
      endTime: getColumnIndex(headers, ['Endzeit']),
      location: getColumnIndex(headers, ['Ort']),
      environment: getColumnIndex(headers, ['Umgebung']),
    };
  }

  private parseStructuredPublicTrainingSources(): PublicTrainingSource[] {
    const sourceSheet = {
      sheetName: this.PUBLIC_TRAINING_SOURCE_SHEET,
      rows: this.gateway.getSheetValues(this.PUBLIC_TRAINING_SOURCE_SHEET),
    };

    if (sourceSheet.rows.length === 0) {
      throw new Error(`Public training source sheet "${sourceSheet.sheetName}" must contain a header row.`);
    }

    const sourceSchema = this.getPublicTrainingSourceSheetSchema(sourceSheet.rows[0] ?? []);
    const definitionSheet = {
      sheetName: this.TRAINING_DEFINITION_SHEET,
      rows: this.gateway.getSheetValues(this.TRAINING_DEFINITION_SHEET),
      displayRows: this.gateway.getSheetDisplayValues(this.TRAINING_DEFINITION_SHEET),
    };
    const definitionsBySource = new Map<string, ReturnType<PrivateSheetConfigurationProvider['parseTrainingSelector']>[]>();

    if (definitionSheet.rows.length === 0) {
      throw new Error(`Training definition sheet "${definitionSheet.sheetName}" must contain a header row.`);
    }

    const definitionSchema = this.getTrainingDefinitionSheetSchema(definitionSheet.rows[0] ?? []);
    for (let rowIndex = 1; rowIndex < definitionSheet.rows.length; rowIndex += 1) {
      const row = definitionSheet.rows[rowIndex];
      const displayRow = definitionSheet.displayRows[rowIndex] ?? [];
      if (isEmptyRow(row)) {
        continue;
      }

      const sourceId = getCellValue(row, definitionSchema.sourceId);
      if (!sourceId) {
        throw new Error(`Training definition row ${rowIndex + 1} must define sourceId.`);
      }

      const training = this.parseTrainingSelector({
        trainingId: getCellValue(row, definitionSchema.trainingId),
        title: getCellValue(displayRow, definitionSchema.title) || undefined,
        day: getCellValue(displayRow, definitionSchema.day) || undefined,
        startTime: getCellValue(displayRow, definitionSchema.startTime) || undefined,
        endTime: getCellValue(displayRow, definitionSchema.endTime) || undefined,
        location: getCellValue(displayRow, definitionSchema.location) || undefined,
        environment: getCellValue(displayRow, definitionSchema.environment) || undefined,
      }, sourceId, `row ${rowIndex + 1}`);

      const definitions = definitionsBySource.get(sourceId) ?? [];
      if (definitions.some(existing => existing.trainingId === training.trainingId)) {
        throw new Error(`Duplicate training definition for sourceId "${sourceId}" and trainingId "${training.trainingId}".`);
      }
      if (definitions.some(existing => existing.day === training.day)) {
        throw new Error(`Duplicate training definition for sourceId "${sourceId}" and day "${training.day}".`);
      }
      definitions.push(training);
      definitionsBySource.set(sourceId, definitions);
    }

    const sources: PublicTrainingSource[] = [];
    const seenSourceIds = new Set<string>();

    for (let rowIndex = 1; rowIndex < sourceSheet.rows.length; rowIndex += 1) {
      const row = sourceSheet.rows[rowIndex];
      if (isEmptyRow(row)) {
        continue;
      }

      const sourceId = getCellValue(row, sourceSchema.sourceId);
      const sheetName = getCellValue(row, sourceSchema.sheetName);
      if (!sourceId) {
        throw new Error(`Public training source row ${rowIndex + 1} must define sourceId.`);
      }
      if (!sheetName) {
        throw new Error(`Public training source row ${rowIndex + 1} must define sheetName.`);
      }
      if (seenSourceIds.has(sourceId)) {
        throw new Error(`Duplicate public training source configured for sourceId "${sourceId}".`);
      }
      seenSourceIds.add(sourceId);

      const attendance = this.parseAttendanceConfig({
        dateHeaderRow: getCellValue(row, sourceSchema.dateHeaderRow),
        infoRow: getCellValue(row, sourceSchema.infoRow) || undefined,
        firstMemberRow: getCellValue(row, sourceSchema.firstMemberRow),
        firstNameColumn: getCellValue(row, sourceSchema.firstNameColumn) || undefined,
        lastNameColumn: getCellValue(row, sourceSchema.lastNameColumn) || undefined,
        genderColumn: getCellValue(row, sourceSchema.genderColumn) || undefined,
        startColumn: getCellValue(row, sourceSchema.startColumn),
      }, sourceId);
      const trainings = definitionsBySource.get(sourceId) ?? [];

      if (trainings.length === 0) {
        throw new Error(`Public training source "${sourceId}" requires at least one training definition row.`);
      }

      sources.push({
        sourceId,
        sheetName,
        tableRange: getCellValue(row, sourceSchema.tableRange) || undefined,
        attendance,
        trainings,
      });
    }

    if (sources.length === 0) {
      throw new Error(`Public training source sheet "${sourceSheet.sheetName}" must contain at least one data row.`);
    }

    return sources;
  }

  getPublicTrainingSources(): PublicTrainingSource[] {
    if (!this.publicTrainingSourcesCache) {
      this.publicTrainingSourcesCache = this.parseStructuredPublicTrainingSources();
    }
    return this.publicTrainingSourcesCache;
  }

  getReminderPolicy(): ReminderPolicy {
    const offsets = this.normalizeReminderOffsets(
      this.parseReminderOffsetsConfig('ERINNERUNGS_STUNDEN'),
    );

    return {
      offsets,
      channels: ['email'],
    };
  }

  getWebAppUrl(): string {
    return this.getConfigValue('WEBAPP_ADRESSE');
  }
}