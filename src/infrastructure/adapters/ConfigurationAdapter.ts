import {
  AttendanceConfig,
  Gender,
  createCompositeMemberIdFromPersonName,
  createPersonName,
  getRoleDefinition,
  parseGender,
  PublicTrainingSource,
  parseRole,
  ReminderPolicy,
  ReminderOffset,
  TRAINING_DAYS,
  TrainingAudience,
  TrainingDay,
  TrainingEnvironment,
  UserRecord,
} from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';

interface UserSheetSchema {
  firstName: number;
  lastName: number;
  email: number;
  gender?: number;
  role: number;
  subscribedTrainings?: number;
  subscribedTrainingIds?: number;
}

interface PublicTrainingSourceSheetSchema {
  sourceId: number;
  sheetName: number;
  tableRange?: number;
  layout?: number;
  dateHeaderRow: number;
  firstMemberRow: number;
  firstNameColumn?: number;
  lastNameColumn?: number;
  startColumn: number;
  metadataColumn?: number;
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
  audience?: number;
  description?: number;
}

export class ConfigurationAdapter {
  private gateway: ISheetGateway;
  
  private configCache: Map<string, string> | null = null;
  private usersCache: UserRecord[] | null = null;
  private userSheetNameCache: string | null = null;
  
  private readonly CONFIG_SHEET = 'Konfiguration';
  private readonly USER_SHEET = 'Mitglieder';
  private readonly PUBLIC_TRAINING_SOURCE_SHEET = 'Trainingsquellen';
  private readonly TRAINING_DEFINITION_SHEET = 'Trainingsdefinitionen';

  constructor(gateway: ISheetGateway) {
    this.gateway = gateway;
  }

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

  private parseInteger(value: string, key: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(`${key} is not a valid number: "${value}"`);
    }

    return parsed;
  }

  private parseReminderOffset(value: unknown, index: number): ReminderOffset {
    const hours = Number(value);

    if (!Number.isInteger(hours) || hours < 0) {
      throw new Error(`Reminder offset at index ${index} must be a non-negative integer hour value.`);
    }

    return { hours, minutes: 0 };
  }

  private normalizeReminderOffsets(offsets: ReminderOffset[]): ReminderOffset[] {
    if (offsets.length > 2) {
      throw new Error('A maximum of 2 reminder offsets is supported.');
    }

    const totals = new Set<number>();
    const normalized = [...offsets].sort((left, right) => {
      const leftTotal = left.hours * 60 + left.minutes;
      const rightTotal = right.hours * 60 + right.minutes;
      return rightTotal - leftTotal;
    });

    for (const offset of normalized) {
      const totalMinutes = offset.hours * 60 + offset.minutes;
      if (totals.has(totalMinutes)) {
        throw new Error(`Duplicate reminder offset configured for ${totalMinutes} minutes before training.`);
      }
      totals.add(totalMinutes);
    }

    return normalized;
  }

  private parseJsonConfig<T>(key: string): T {
    const value = this.getConfigValue(key);

    try {
      return JSON.parse(value) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Configuration key "${key}" must contain valid JSON. ${message}`);
    }
  }

  private isTrainingDay(value: unknown): value is TrainingDay {
    return typeof value === 'string' && new Set<string>(TRAINING_DAYS).has(value);
  }

  private isTrainingAudience(value: unknown): value is TrainingAudience {
    return value === 'Mixed' || value === 'SingleGender';
  }

  private isTrainingEnvironment(value: unknown): value is TrainingEnvironment {
    return value === 'Indoor' || value === 'Outdoor';
  }

  private isAttendanceLayout(value: unknown): value is AttendanceConfig['layout'] {
    return value === 'member-rows';
  }

  private parseAttendanceConfig(value: unknown, sourceId: string): AttendanceConfig {
    if (!value || typeof value !== 'object') {
      throw new Error(`Public training source "${sourceId}" must define an attendance object.`);
    }

    const candidate = value as Partial<AttendanceConfig>;
    if (!candidate.startColumn || typeof candidate.startColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" must define attendance.startColumn.`);
    }

    if (candidate.metadataColumn !== undefined && typeof candidate.metadataColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" has an invalid attendance.metadataColumn value.`);
    }

    const dateHeaderRow = Number(candidate.dateHeaderRow);
    if (!Number.isInteger(dateHeaderRow) || dateHeaderRow < 1) {
      throw new Error(`Public training source "${sourceId}" must define attendance.dateHeaderRow as a positive row number.`);
    }

    const firstMemberRow = Number(candidate.firstMemberRow);
    if (!Number.isInteger(firstMemberRow) || firstMemberRow < 1) {
      throw new Error(`Public training source "${sourceId}" must define attendance.firstMemberRow as a positive row number.`);
    }

    if (firstMemberRow <= dateHeaderRow) {
      throw new Error(`Public training source "${sourceId}" must define attendance.firstMemberRow after attendance.dateHeaderRow.`);
    }

    if (!this.isAttendanceLayout(candidate.layout)) {
      throw new Error(`Public training source "${sourceId}" has an invalid attendance.layout value.`);
    }

    if (typeof candidate.firstNameColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" has an invalid attendance.firstNameColumn value.`);
    }

    if (typeof candidate.lastNameColumn !== 'string') {
      throw new Error(`Public training source "${sourceId}" has an invalid attendance.lastNameColumn value.`);
    }

    if (!candidate.firstNameColumn || !candidate.lastNameColumn) {
      throw new Error(`Public training source "${sourceId}" must define attendance.firstNameColumn and attendance.lastNameColumn for member-rows layout.`);
    }

    return {
      startColumn: candidate.startColumn,
      metadataColumn: candidate.metadataColumn,
      layout: candidate.layout,
      firstNameColumn: candidate.firstNameColumn,
      lastNameColumn: candidate.lastNameColumn,
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

    if (selector.audience !== undefined && !this.isTrainingAudience(selector.audience)) {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid audience value.`);
    }

    if (selector.environment !== undefined && !this.isTrainingEnvironment(selector.environment)) {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid environment value.`);
    }

    if (selector.title !== undefined && typeof selector.title !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid title value.`);
    }

    if (typeof selector.startTime !== 'string' || !selector.startTime.trim()) {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid startTime value.`);
    }

    if (selector.endTime !== undefined && typeof selector.endTime !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid endTime value.`);
    }

    if (selector.location !== undefined && typeof selector.location !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid location value.`);
    }

    if (selector.description !== undefined && typeof selector.description !== 'string') {
      throw new Error(`Training selector "${trainingId}" in source "${sourceId}" has an invalid description value.`);
    }

    return {
      trainingId,
      day: selector.day,
      audience: selector.audience as TrainingAudience | undefined,
      environment: selector.environment as TrainingEnvironment | undefined,
      title: selector.title as string | undefined,
      startTime: selector.startTime,
      endTime: selector.endTime as string | undefined,
      location: selector.location as string | undefined,
      description: selector.description as string | undefined,
    };
  }

  private getRequiredSheetValues(sheetName: string): unknown[][] {
    return this.gateway.getSheetValues(sheetName);
  }

  private getPublicTrainingSourceSheetSchema(headers: unknown[]): PublicTrainingSourceSheetSchema {
    return {
      sourceId: this.getRequiredColumnIndex(headers, ['QuellenId']),
      sheetName: this.getRequiredColumnIndex(headers, ['TabellenName']),
      tableRange: this.getColumnIndex(headers, ['TabellenBereich']),
      layout: this.getRequiredColumnIndex(headers, ['Layout']),
      dateHeaderRow: this.getRequiredColumnIndex(headers, ['DatumsKopfZeile']),
      firstMemberRow: this.getRequiredColumnIndex(headers, ['MitgliederStartZeile']),
      firstNameColumn: this.getRequiredColumnIndex(headers, ['VornameSpalte']),
      lastNameColumn: this.getRequiredColumnIndex(headers, ['NachnameSpalte']),
      startColumn: this.getRequiredColumnIndex(headers, ['StartSpalte']),
      metadataColumn: this.getColumnIndex(headers, ['MetadatenSpalte']),
    };
  }

  private getTrainingDefinitionSheetSchema(headers: unknown[]): TrainingDefinitionSheetSchema {
    return {
      sourceId: this.getRequiredColumnIndex(headers, ['QuellenId']),
      trainingId: this.getRequiredColumnIndex(headers, ['TrainingsId']),
      title: this.getColumnIndex(headers, ['Titel']),
      day: this.getColumnIndex(headers, ['Wochentag']),
      startTime: this.getRequiredColumnIndex(headers, ['Startzeit']),
      endTime: this.getColumnIndex(headers, ['Endzeit']),
      location: this.getColumnIndex(headers, ['Ort']),
      environment: this.getColumnIndex(headers, ['Umgebung']),
      audience: this.getColumnIndex(headers, ['Typ']),
      description: this.getColumnIndex(headers, ['Beschreibung']),
    };
  }

  private parseStructuredPublicTrainingSources(): PublicTrainingSource[] {
    const sourceSheet = {
      sheetName: this.PUBLIC_TRAINING_SOURCE_SHEET,
      rows: this.getRequiredSheetValues(this.PUBLIC_TRAINING_SOURCE_SHEET),
    };

    if (sourceSheet.rows.length === 0) {
      throw new Error(`Public training source sheet "${sourceSheet.sheetName}" must contain a header row.`);
    }

    const sourceSchema = this.getPublicTrainingSourceSheetSchema(sourceSheet.rows[0] ?? []);
    const definitionSheet = {
      sheetName: this.TRAINING_DEFINITION_SHEET,
      rows: this.getRequiredSheetValues(this.TRAINING_DEFINITION_SHEET),
    };
    const definitionsBySource = new Map<string, ReturnType<ConfigurationAdapter['parseTrainingSelector']>[]>();

    if (definitionSheet.rows.length === 0) {
      throw new Error(`Training definition sheet "${definitionSheet.sheetName}" must contain a header row.`);
    }

    const definitionSchema = this.getTrainingDefinitionSheetSchema(definitionSheet.rows[0] ?? []);
    for (let rowIndex = 1; rowIndex < definitionSheet.rows.length; rowIndex += 1) {
      const row = definitionSheet.rows[rowIndex];
      if (!row || row.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const sourceId = this.getCellValue(row, definitionSchema.sourceId);
      if (!sourceId) {
        throw new Error(`Training definition row ${rowIndex + 1} must define sourceId.`);
      }

      const training = this.parseTrainingSelector({
        trainingId: this.getCellValue(row, definitionSchema.trainingId),
        title: this.getCellValue(row, definitionSchema.title) || undefined,
        day: this.getCellValue(row, definitionSchema.day) || undefined,
        startTime: this.getCellValue(row, definitionSchema.startTime) || undefined,
        endTime: this.getCellValue(row, definitionSchema.endTime) || undefined,
        location: this.getCellValue(row, definitionSchema.location) || undefined,
        environment: this.getCellValue(row, definitionSchema.environment) || undefined,
        audience: this.getCellValue(row, definitionSchema.audience) || undefined,
        description: this.getCellValue(row, definitionSchema.description) || undefined,
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
      if (!row || row.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const sourceId = this.getCellValue(row, sourceSchema.sourceId);
      const sheetName = this.getCellValue(row, sourceSchema.sheetName);
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
        layout: this.getCellValue(row, sourceSchema.layout) || undefined,
        dateHeaderRow: this.getCellValue(row, sourceSchema.dateHeaderRow),
        firstMemberRow: this.getCellValue(row, sourceSchema.firstMemberRow),
        firstNameColumn: this.getCellValue(row, sourceSchema.firstNameColumn) || undefined,
        lastNameColumn: this.getCellValue(row, sourceSchema.lastNameColumn) || undefined,
        startColumn: this.getCellValue(row, sourceSchema.startColumn),
        metadataColumn: this.getCellValue(row, sourceSchema.metadataColumn) || undefined,
      }, sourceId);
      const trainings = definitionsBySource.get(sourceId) ?? [];

      if (trainings.length === 0) {
        throw new Error(`Public training source "${sourceId}" uses member-rows layout and requires at least one training definition row.`);
      }

      sources.push({
        sourceId,
        sheetName,
        tableRange: this.getCellValue(row, sourceSchema.tableRange) || undefined,
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
    return this.parseStructuredPublicTrainingSources();
  }

  getReminderPolicy(): ReminderPolicy {
    const offsets = this.normalizeReminderOffsets(
      (this.parseJsonConfig<unknown>('ERINNERUNGS_OFFSETS') as unknown[]).map((offset, index) => this.parseReminderOffset(offset, index)),
    );

    return {
      offsets,
      channels: ['email'],
    };
  }

  getWebAppUrl(): string {
    return this.getConfigValue('WEBAPP_ADRESSE');
  }

  private normalizeHeader(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private getColumnIndex(headers: unknown[], candidates: string[]): number | undefined {
    const normalizedCandidates = new Set(candidates.map(candidate => this.normalizeHeader(candidate)));
    return headers.findIndex(header => normalizedCandidates.has(this.normalizeHeader(header)));
  }

  private getRequiredColumnIndex(headers: unknown[], candidates: string[]): number {
    const index = this.getColumnIndex(headers, candidates);
    if (index === -1 || index === undefined) {
      throw new Error(`Missing required user sheet column: ${candidates[0]}`);
    }
    return index;
  }

  private getUserSheetSchema(rawData: unknown[][]): UserSheetSchema {
    const headers = rawData[0] ?? [];
    const firstName = this.getRequiredColumnIndex(headers, ['Vorname']);
    const lastName = this.getRequiredColumnIndex(headers, ['Nachname']);

    return {
      firstName,
      lastName,
      email: this.getRequiredColumnIndex(headers, ['EMail']),
      gender: this.getColumnIndex(headers, ['Geschlecht']),
      role: this.getRequiredColumnIndex(headers, ['Rolle']),
      subscribedTrainings: this.getColumnIndex(headers, ['AbonnierteTrainings']),
      subscribedTrainingIds: this.getColumnIndex(headers, ['AbonnierteTrainingsIds']),
    };
  }

  private getCellValue(row: unknown[], index?: number): string {
    if (index === undefined || index < 0 || index >= row.length) {
      return '';
    }

    return String(row[index] ?? '').trim();
  }

  private parseDelimitedList(value: string): string[] {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  private getUserSheetName(): string {
    if (this.userSheetNameCache) {
      return this.userSheetNameCache;
    }

    this.gateway.getSheetValues(this.USER_SHEET);
    this.userSheetNameCache = this.USER_SHEET;
    return this.USER_SHEET;
  }

  private parseTrainingDays(value: string): TrainingDay[] {
    const validTrainingDays = new Set<string>(TRAINING_DAYS);
    return this.parseDelimitedList(value).filter((item): item is TrainingDay => validTrainingDays.has(item));
  }

  private getPersonName(user: UserRecord) {
    return user.personName;
  }

  private getGender(row: unknown[], schema: UserSheetSchema): Gender | undefined {
    const rawGender = this.getCellValue(row, schema.gender);
    if (!rawGender) {
      return undefined;
    }

    return parseGender(rawGender);
  }

  private getRowMemberId(row: unknown[], schema: UserSheetSchema): string {
    const firstName = this.getCellValue(row, schema.firstName);
    const lastName = this.getCellValue(row, schema.lastName);
    const personName = createPersonName(firstName, lastName);

    return createCompositeMemberIdFromPersonName(personName);
  }

  private buildUserRow(user: UserRecord, schema: UserSheetSchema, currentWidth: number): unknown[] {
    const highestIndex = Math.max(
      currentWidth - 1,
      schema.email,
      schema.gender ?? -1,
      schema.role,
      schema.firstName,
      schema.lastName,
      schema.subscribedTrainings ?? -1,
      schema.subscribedTrainingIds ?? -1,
    );
    const row = new Array(Math.max(highestIndex + 1, 0)).fill('');
    const personName = this.getPersonName(user);
    row[schema.firstName] = personName.firstName;
    row[schema.lastName] = personName.lastName;
    row[schema.email] = user.email;
    if (schema.gender !== undefined) {
      row[schema.gender] = user.gender ?? '';
    }
    row[schema.role] = user.role;

    if (schema.subscribedTrainings !== undefined) {
      row[schema.subscribedTrainings] = user.subscribedTrainings.join(', ');
    }
    if (schema.subscribedTrainingIds !== undefined) {
      row[schema.subscribedTrainingIds] = user.subscribedTrainingIds.join(', ');
    }

    return row;
  }

  private parseUsers(): UserRecord[] {
    const rawData = this.gateway.getSheetValues(this.getUserSheetName());
    if (!rawData || rawData.length === 0) return [];

    const schema = this.getUserSheetSchema(rawData);
    
    const users: UserRecord[] = [];
    
    // Skip header row
    for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;
        
        const firstName = this.getCellValue(row, schema.firstName);
        const lastName = this.getCellValue(row, schema.lastName);
        const personName = createPersonName(firstName, lastName);
        if (!personName.firstName || !personName.lastName) {
            throw new Error(`User row ${i + 1} must define both firstName and lastName for the composite member key.`);
        }
        const memberId = createCompositeMemberIdFromPersonName(personName);
        const name = personName.fullName;
        const email = this.getCellValue(row, schema.email);
        const gender = this.getGender(row, schema);
        const role = parseRole(this.getCellValue(row, schema.role));
        const subRaw = this.getCellValue(row, schema.subscribedTrainings);
        const subscribedTrainingIdsRaw = this.getCellValue(row, schema.subscribedTrainingIds);
        
        if (!memberId || !email) {
            console.warn(`User with memberId "${memberId}" has no email.`);
            continue;
        }

        const subscribedTrainings = this.parseTrainingDays(subRaw);
        const subscribedTrainingIds = this.parseDelimitedList(subscribedTrainingIdsRaw);
        const normalizedTrainingIds = subscribedTrainingIds.length > 0 ? subscribedTrainingIds : subscribedTrainings;

        users.push({
            memberId,
            name,
            email,
            gender,
            role,
            roleDefinition: getRoleDefinition(role),
            personName,
            subscriptions: normalizedTrainingIds.map(trainingId => ({
              trainingId,
              notificationChannel: 'email',
            })),
            subscribedTrainingIds: normalizedTrainingIds,
            subscribedTrainings
        });
    }
    
    return users;
  }

  getAllUsers(): UserRecord[] {
    if (!this.usersCache) {
      this.usersCache = this.parseUsers();
    }
    return this.usersCache;
  }

  getUserByMemberId(id: string): UserRecord | null {
    const users = this.getAllUsers();
    return users.find(u => u.memberId === id) || null;
  }

  getUserByEmail(email: string): UserRecord | null {
    const users = this.getAllUsers();
    return users.find(u => u.email === email) || null;
  }

  getUserByName(name: string): UserRecord | null {
    const users = this.getAllUsers();
    return users.find(u => u.name === name) || null;
  }

  upsertUser(user: UserRecord): void {
      const userSheetName = this.getUserSheetName();
      const rawData = this.gateway.getSheetValues(userSheetName);
      const schema = this.getUserSheetSchema(rawData);
      const rowData = this.buildUserRow(user, schema, rawData[0]?.length ?? 0);

      let foundIndex = -1;
      if (rawData && rawData.length > 0) {
          // Find row by composite member key, skipping header (index 0)
          for(let i=1; i<rawData.length; i++) {
          if (rawData[i] && rawData[i].length > 0 && this.getRowMemberId(rawData[i], schema) === user.memberId) {
                  foundIndex = i;
                  break;
              }
          }
      }

      if (foundIndex !== -1) {
          // Row indices are 1-based in Google Sheets
          this.gateway.setRowValues(userSheetName, foundIndex + 1, rowData);
      } else {
          this.gateway.appendRow(userSheetName, rowData);
      }

      // invalidate cache
      this.usersCache = null;
  }

}
