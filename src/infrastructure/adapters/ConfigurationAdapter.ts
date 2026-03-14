import {
  AttendanceConfig,
  Gender,
  createCompositeMemberIdFromPersonName,
  createPersonName,
  createPersonNameFromFullName,
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
  memberId?: number;
  name?: number;
  firstName?: number;
  lastName?: number;
  email: number;
  gender?: number;
  role: number;
  subscribedTrainings?: number;
  subscribedTrainingIds?: number;
}

export class ConfigurationAdapter {
  private gateway: ISheetGateway;
  
  private configCache: Map<string, string> | null = null;
  private usersCache: UserRecord[] | null = null;
  private userSheetNameCache: string | null = null;
  
  private readonly CONFIG_SHEET = 'Konfiguration';
  private readonly USER_SHEETS = ['Benutzer', 'Mitglieder'];

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
    return this.getConfigValue('PUBLIC_SHEET_ID');
  }

  private getLegacyAttendanceConfig(): AttendanceConfig {
    return {
      startColumn: this.getConfigValue('ATTENDANCE_START_COL'),
    };
  }

  private parseInteger(value: string, key: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new Error(`${key} is not a valid number: "${value}"`);
    }

    return parsed;
  }

  private parseReminderOffset(value: unknown, index: number): ReminderOffset {
    if (!value || typeof value !== 'object') {
      throw new Error(`Reminder offset at index ${index} must be an object.`);
    }

    const candidate = value as Partial<ReminderOffset>;
    const hours = Number(candidate.hours);
    const minutes = Number(candidate.minutes);

    if (!Number.isInteger(hours) || hours < 0) {
      throw new Error(`Reminder offset at index ${index} has an invalid hours value.`);
    }

    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 59) {
      throw new Error(`Reminder offset at index ${index} has an invalid minutes value.`);
    }

    return { hours, minutes };
  }

  private getLegacyReminderOffsets(): ReminderOffset[] {
    const legacyValue = this.getOptionalConfigValue('REMINDER_DAYS_BEFORE');
    if (!legacyValue) {
      return [];
    }

    return [{
      hours: this.parseInteger(legacyValue, 'REMINDER_DAYS_BEFORE') * 24,
      minutes: 0,
    }];
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

    return {
      startColumn: candidate.startColumn,
      metadataColumn: candidate.metadataColumn,
    };
  }

  private parsePublicTrainingSources(value: unknown): PublicTrainingSource[] {
    if (!Array.isArray(value)) {
      throw new Error('PUBLIC_TRAINING_SOURCES must be a JSON array.');
    }

    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error(`Public training source at index ${index} must be an object.`);
      }

      const candidate = entry as Partial<PublicTrainingSource>;
      const sourceId = String(candidate.sourceId ?? '').trim();
      const sheetName = String(candidate.sheetName ?? '').trim();
      const spreadsheetId = String(candidate.spreadsheetId ?? this.getPublicSheetId()).trim();
      if (!sourceId) {
        throw new Error(`Public training source at index ${index} is missing sourceId.`);
      }
      if (!sheetName) {
        throw new Error(`Public training source "${sourceId}" is missing sheetName.`);
      }
      if (!spreadsheetId) {
        throw new Error(`Public training source "${sourceId}" is missing spreadsheetId.`);
      }

      const rawTrainings = candidate.trainings ?? [];
      if (!Array.isArray(rawTrainings)) {
        throw new Error(`Public training source "${sourceId}" must define trainings as an array.`);
      }

      return {
        sourceId,
        spreadsheetId,
        sheetName,
        tableRange: candidate.tableRange ? String(candidate.tableRange).trim() : undefined,
        attendance: this.parseAttendanceConfig(candidate.attendance, sourceId),
        trainings: rawTrainings.map((training, trainingIndex) => {
          if (!training || typeof training !== 'object') {
            throw new Error(`Training selector ${trainingIndex} in source "${sourceId}" must be an object.`);
          }

          const selector = training as unknown as Record<string, unknown>;
          const trainingId = String(selector.trainingId ?? '').trim();
          if (!trainingId) {
            throw new Error(`Training selector ${trainingIndex} in source "${sourceId}" is missing trainingId.`);
          }

          if (selector.day !== undefined && !this.isTrainingDay(selector.day)) {
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

          return {
            trainingId,
            day: selector.day,
            audience: selector.audience,
            environment: selector.environment,
            title: selector.title as string | undefined,
          };
        }),
      };
    });
  }

  getPublicTrainingSources(): PublicTrainingSource[] {
    const configuredSources = this.getOptionalConfigValue('PUBLIC_TRAINING_SOURCES');
    if (configuredSources) {
      return this.parsePublicTrainingSources(this.parseJsonConfig<unknown>('PUBLIC_TRAINING_SOURCES'));
    }

    return [{
      sourceId: 'default',
      spreadsheetId: this.getPublicSheetId(),
      sheetName: this.getConfigValue('TRAINING_SHEET_NAME'),
      attendance: this.getLegacyAttendanceConfig(),
      trainings: [],
    }];
  }

  getReminderPolicy(): ReminderPolicy {
    const configuredOffsets = this.getOptionalConfigValue('REMINDER_OFFSETS');
    const offsets = configuredOffsets
      ? this.normalizeReminderOffsets(
        (this.parseJsonConfig<unknown>('REMINDER_OFFSETS') as unknown[]).map((offset, index) => this.parseReminderOffset(offset, index)),
      )
      : this.normalizeReminderOffsets(this.getLegacyReminderOffsets());

    return {
      offsets,
      channels: ['email'],
    };
  }

  getWebAppUrl(): string {
    return this.getConfigValue('WEBAPP_URL');
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
    const firstName = this.getColumnIndex(headers, ['FirstName', 'GivenName']);
    const lastName = this.getColumnIndex(headers, ['LastName', 'FamilyName', 'Surname']);
    const name = this.getColumnIndex(headers, ['Name', 'FullName']);

    if ((firstName === undefined || lastName === undefined) && name === undefined) {
      throw new Error('User sheet must define either FirstName + LastName columns or a Name column.');
    }

    return {
      memberId: this.getColumnIndex(headers, ['MemberID', 'MemberId', 'MemberKey', 'CompositeMemberId']),
      name,
      firstName,
      lastName,
      email: this.getRequiredColumnIndex(headers, ['Email', 'Mail']),
      gender: this.getColumnIndex(headers, ['Gender', 'Geschlecht']),
      role: this.getRequiredColumnIndex(headers, ['Role']),
      subscribedTrainings: this.getColumnIndex(headers, ['SubscribedTrainings', 'TrainingDays']),
      subscribedTrainingIds: this.getColumnIndex(headers, ['SubscribedTrainingIds', 'TrainingIds']),
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

    for (const sheetName of this.USER_SHEETS) {
      try {
        this.gateway.getSheetValues(sheetName);
        this.userSheetNameCache = sheetName;
        return sheetName;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Sheet with name')) {
          throw error;
        }
      }
    }

    throw new Error(`Missing required user sheet. Expected one of: ${this.USER_SHEETS.join(', ')}`);
  }

  private parseTrainingDays(value: string): TrainingDay[] {
    const validTrainingDays = new Set<string>(TRAINING_DAYS);
    return this.parseDelimitedList(value).filter((item): item is TrainingDay => validTrainingDays.has(item));
  }

  private getPersonName(user: UserRecord) {
    return user.personName ?? createPersonNameFromFullName(user.name);
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
    const legacyName = this.getCellValue(row, schema.name);
    const personName = firstName || lastName
      ? createPersonName(firstName, lastName)
      : createPersonNameFromFullName(legacyName);

    return createCompositeMemberIdFromPersonName(personName);
  }

  private buildUserRow(user: UserRecord, schema: UserSheetSchema, currentWidth: number): unknown[] {
    const highestIndex = Math.max(
      currentWidth - 1,
      schema.memberId ?? -1,
      schema.email,
      schema.gender ?? -1,
      schema.role,
      schema.name ?? -1,
      schema.firstName ?? -1,
      schema.lastName ?? -1,
      schema.subscribedTrainings ?? -1,
      schema.subscribedTrainingIds ?? -1,
    );
    const row = new Array(Math.max(highestIndex + 1, 0)).fill('');
    const personName = this.getPersonName(user);
    const compositeMemberId = createCompositeMemberIdFromPersonName(personName);

    if (schema.memberId !== undefined) {
      row[schema.memberId] = compositeMemberId;
    }
    if (schema.name !== undefined) {
      row[schema.name] = user.name;
    }
    if (schema.firstName !== undefined) {
      row[schema.firstName] = personName.firstName;
    }
    if (schema.lastName !== undefined) {
      row[schema.lastName] = personName.lastName;
    }
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
        const legacyName = this.getCellValue(row, schema.name);
        const personName = firstName || lastName
          ? createPersonName(firstName, lastName)
          : createPersonNameFromFullName(legacyName);
        if (!personName.firstName || !personName.lastName) {
            throw new Error(`User row ${i + 1} must define both firstName and lastName for the composite member key.`);
        }
        const memberId = createCompositeMemberIdFromPersonName(personName);
        const name = personName.fullName || legacyName;
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
