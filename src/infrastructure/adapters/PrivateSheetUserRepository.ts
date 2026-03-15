import { IUserRepository } from '../../domain/ports/IUserRepository';
import { UserRecord } from '../../domain/types';
import { ConfigurationAdapter } from './ConfigurationAdapter';

export interface PrivateSheetUserStore {
  getAllUsers(): UserRecord[];
  getUserByMemberId(id: string): UserRecord | null;
  getUserByEmail(email: string): UserRecord | null;
  getUserByName(name: string): UserRecord | null;
  upsertUser(user: UserRecord): void;
}

export class PrivateSheetUserRepository implements IUserRepository {
  constructor(private readonly adapter: PrivateSheetUserStore) {}

  getAllUsers(): UserRecord[] {
    return this.adapter.getAllUsers();
  }

  getUserByMemberId(id: string): UserRecord | null {
    return this.adapter.getUserByMemberId(id);
  }

  getUserByEmail(email: string): UserRecord | null {
    return this.adapter.getUserByEmail(email);
  }

  getUserByName(name: string): UserRecord | null {
    return this.adapter.getUserByName(name);
  }

  upsertUser(user: UserRecord): void {
    this.adapter.upsertUser(user);
  }
}