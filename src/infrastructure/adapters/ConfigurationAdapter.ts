import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { UserRecord, AttendanceConfig, Role, TrainingDay } from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';

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

  getWebAppUrl(): string {
    return this.getConfigValue('WEBAPP_URL');
  }

  private parseUsers(): UserRecord[] {
    const rawData = this.gateway.getSheetValues(this.USER_SHEET);
    if (!rawData || rawData.length === 0) return [];
    
    const users: UserRecord[] = [];
    
    // Skip header row
    for (let i = 1; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row || row.length < 5) continue;
        
        const memberId = String(row[0]).trim();
        const name = String(row[1]).trim();
        const email = String(row[2]).trim();
        const role = String(row[3]).trim() as Role;
        const subRaw = String(row[4]).trim();
        
        if (!email) {
            console.warn(`User with memberId "${memberId}" has no email.`);
            continue;
        }

        const subscribedTrainings = subRaw ? subRaw.split(',').map(s => s.trim() as TrainingDay) : [];

        users.push({
            memberId,
            name,
            email,
            role,
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
      // Data format: A: memberId, B: name, C: email, D: role, E: subscribedTrainings
      const rowData = [
          user.memberId,
          user.name,
          user.email,
          user.role,
          user.subscribedTrainings.join(',')
      ];

      let foundIndex = -1;
      if (rawData && rawData.length > 0) {
          // Find row by memberId, skipping header (index 0)
          for(let i=1; i<rawData.length; i++) {
              if (rawData[i] && rawData[i].length > 0 && String(rawData[i][0]).trim() === user.memberId) {
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
