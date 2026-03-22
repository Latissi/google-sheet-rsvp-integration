import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  Gender,
  UserRecord,
  TRAINING_DAYS,
  TrainingDay,
  createCompositeMemberIdFromPersonName,
  createPersonName,
  getRoleDefinition,
  parseGender,
  parseRole,
} from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';
import { getCellValue, getColumnIndex, getRequiredColumnIndex, parseDelimitedList } from './SheetColumnMapper';

interface UserSheetSchema {
  firstName: number;
  lastName: number;
  email: number;
  gender?: number;
  role: number;
  subscribedTrainings?: number;
  subscribedTrainingIds?: number;
}

export class PrivateSheetUserRepository implements IUserRepository {
  private usersCache: UserRecord[] | null = null;
  private userSheetNameCache: string | null = null;

  private readonly USER_SHEET = 'Mitglieder';

  constructor(private readonly gateway: ISheetGateway) {}

  private getUserSheetSchema(rawData: unknown[][]): UserSheetSchema {
    const headers = rawData[0] ?? [];
    return {
      firstName: getRequiredColumnIndex(headers, ['Vorname']),
      lastName: getRequiredColumnIndex(headers, ['Nachname']),
      email: getRequiredColumnIndex(headers, ['EMail']),
      gender: getColumnIndex(headers, ['Geschlecht']),
      role: getRequiredColumnIndex(headers, ['Rolle']),
      subscribedTrainings: getColumnIndex(headers, ['AbonnierteTrainings']),
      subscribedTrainingIds: getColumnIndex(headers, ['AbonnierteTrainingsIds']),
    };
  }

  private getUserSheetName(): string {
    if (this.userSheetNameCache) {
      return this.userSheetNameCache;
    }

    this.gateway.getSheetValues(this.USER_SHEET);
    this.userSheetNameCache = this.USER_SHEET;
    return this.USER_SHEET;
  }

  private getGender(row: unknown[], schema: UserSheetSchema): Gender | undefined {
    const rawGender = getCellValue(row, schema.gender);
    if (!rawGender) {
      return undefined;
    }

    return parseGender(rawGender);
  }

  private getRowMemberId(row: unknown[], schema: UserSheetSchema): string {
    const firstName = getCellValue(row, schema.firstName);
    const lastName = getCellValue(row, schema.lastName);
    const personName = createPersonName(firstName, lastName);
    return createCompositeMemberIdFromPersonName(personName);
  }

  private parseTrainingDays(value: string): TrainingDay[] {
    const validTrainingDays = new Set<string>(TRAINING_DAYS);
    return parseDelimitedList(value).filter((item): item is TrainingDay => validTrainingDays.has(item));
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
    row[schema.firstName] = user.personName.firstName;
    row[schema.lastName] = user.personName.lastName;
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

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const firstName = getCellValue(row, schema.firstName);
      const lastName = getCellValue(row, schema.lastName);
      const personName = createPersonName(firstName, lastName);
      if (!personName.firstName || !personName.lastName) {
        throw new Error(`User row ${i + 1} must define both firstName and lastName for the composite member key.`);
      }
      const memberId = createCompositeMemberIdFromPersonName(personName);
      const name = personName.fullName;
      const email = getCellValue(row, schema.email);
      const gender = this.getGender(row, schema);
      const role = parseRole(getCellValue(row, schema.role));
      const subRaw = getCellValue(row, schema.subscribedTrainings);
      const subscribedTrainingIdsRaw = getCellValue(row, schema.subscribedTrainingIds);

      if (!memberId || !email) {
        console.warn(`User with memberId "${memberId}" has no email.`);
        continue;
      }

      const subscribedTrainings = this.parseTrainingDays(subRaw);
      const subscribedTrainingIds = parseDelimitedList(subscribedTrainingIdsRaw);
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
        subscribedTrainings,
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
      for (let i = 1; i < rawData.length; i++) {
        if (rawData[i] && rawData[i].length > 0 && this.getRowMemberId(rawData[i], schema) === user.memberId) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex !== -1) {
      this.gateway.setRowValues(userSheetName, foundIndex + 1, rowData);
    } else {
      this.gateway.appendRow(userSheetName, rowData);
    }

    this.usersCache = null;
  }
}