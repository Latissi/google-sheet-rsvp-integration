import { IUserRepository } from '../../domain/ports/IUserRepository';
import { UserRecord } from '../../domain/types';
import { ConfigurationAdapter } from './ConfigurationAdapter';

export class PrivateSheetUserRepository implements IUserRepository {
  constructor(private readonly adapter: ConfigurationAdapter) {}

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