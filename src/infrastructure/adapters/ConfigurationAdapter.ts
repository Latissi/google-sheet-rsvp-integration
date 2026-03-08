import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceConfig,
  createPersonName,
  createPersonNameFromFullName,
  getRoleDefinition,
  parseRole,
  ReminderPolicy,
  TRAINING_DAYS,
  TrainingDay,
  UserRecord,
} from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';

interface UserSheetSchema {
  memberId: number;
  name?: number;
  firstName?: number;
  lastName?: number;
  email: number;
  role: number;
  subscribedTrainings?: number;
  subscribedTrainingIds?: number;
}

export class ConfigurationAdapter implements IConfigurationProvider, IUserRepository {
  private gateway: ISheetGateway;
  
  private configCache: Map<string, string> | null = null;
  private usersCache: UserRecord[] | null = null;
  
  private readonly CONFIG_SHEET = 'Konfiguration';
  private readonly USER_SHEET = 'Benutzer';

  constructor(gateway: ISheetGateway) {
    this.gateway = gateway;
  }

  private getConfigValue(key: string): string {
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
      throw new Error(`Missing required configuration key: "${key}"`);
    }

    return value;
  }

  getPublicSheetId(): string {
    return this.getConfigValue('PUBLIC_SHEET_ID');
  }

  getTrainingSheetName(): string {
    return this.getConfigValue('TRAINING_SHEET_NAME');
  }

  getAttendanceConfig(): AttendanceConfig {
    return {
      startColumn: this.getConfigValue('ATTENDANCE_START_COL'),
    };
  }

  getReminderDaysBeforeTraining(): number {
    const val = this.getConfigValue('REMINDER_DAYS_BEFORE');
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) {
      throw new Error(`REMINDER_DAYS_BEFORE is not a valid number: "${val}"`);
    }
    return parsed;
  }

  getReminderPolicy(): ReminderPolicy {
    return {
      daysBeforeTraining: this.getReminderDaysBeforeTraining(),
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
    return {
      memberId: this.getRequiredColumnIndex(headers, ['MemberID', 'MemberId']),
      name: this.getColumnIndex(headers, ['Name', 'FullName']),
      firstName: this.getColumnIndex(headers, ['FirstName', 'GivenName']),
      lastName: this.getColumnIndex(headers, ['LastName', 'FamilyName', 'Surname']),
      email: this.getRequiredColumnIndex(headers, ['Email', 'Mail']),
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

  private parseTrainingDays(value: string): TrainingDay[] {
    const validTrainingDays = new Set<string>(TRAINING_DAYS);
    return this.parseDelimitedList(value).filter((item): item is TrainingDay => validTrainingDays.has(item));
  }

  private getPersonName(user: UserRecord) {
    return user.personName ?? createPersonNameFromFullName(user.name);
  }

  private buildUserRow(user: UserRecord, schema: UserSheetSchema, currentWidth: number): unknown[] {
    const highestIndex = Math.max(
      currentWidth - 1,
      schema.memberId,
      schema.email,
      schema.role,
      schema.name ?? -1,
      schema.firstName ?? -1,
      schema.lastName ?? -1,
      schema.subscribedTrainings ?? -1,
      schema.subscribedTrainingIds ?? -1,
    );
    const row = new Array(Math.max(highestIndex + 1, 0)).fill('');
    const personName = this.getPersonName(user);

    row[schema.memberId] = user.memberId;
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
    const rawData = this.gateway.getSheetValues(this.USER_SHEET);
    if (!rawData || rawData.length === 0) return [];

    const schema = this.getUserSheetSchema(rawData);
    
    const users: UserRecord[] = [];
    
    // Skip header row
    for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length === 0) continue;
        
        const memberId = this.getCellValue(row, schema.memberId);
        const firstName = this.getCellValue(row, schema.firstName);
        const lastName = this.getCellValue(row, schema.lastName);
        const legacyName = this.getCellValue(row, schema.name);
        const personName = firstName || lastName
          ? createPersonName(firstName, lastName)
          : createPersonNameFromFullName(legacyName);
        const name = personName.fullName || legacyName;
        const email = this.getCellValue(row, schema.email);
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
      const rawData = this.gateway.getSheetValues(this.USER_SHEET);
      const schema = this.getUserSheetSchema(rawData);
      const rowData = this.buildUserRow(user, schema, rawData[0]?.length ?? 0);

      let foundIndex = -1;
      if (rawData && rawData.length > 0) {
          // Find row by memberId, skipping header (index 0)
          for(let i=1; i<rawData.length; i++) {
          if (rawData[i] && rawData[i].length > 0 && this.getCellValue(rawData[i], schema.memberId) === user.memberId) {
                  foundIndex = i;
                  break;
              }
          }
      }

      if (foundIndex !== -1) {
          // Row indices are 1-based in Google Sheets
          this.gateway.setRowValues(this.USER_SHEET, foundIndex + 1, rowData);
      } else {
          this.gateway.appendRow(this.USER_SHEET, rowData);
      }

      // invalidate cache
      this.usersCache = null;
  }

}
