import { IUserRepository } from '../../domain/ports/IUserRepository';
import { UserRecord } from '../../domain/types';

export class InMemoryUserRepository implements IUserRepository {
  constructor(private users: UserRecord[] = []) {}

  getAllUsers(): UserRecord[] {
    return [...this.users];
  }

  getUserByMemberId(id: string): UserRecord | null {
    return this.users.find(user => user.memberId === id) ?? null;
  }

  getUserByEmail(email: string): UserRecord | null {
    return this.users.find(user => user.email === email) ?? null;
  }

  getUserByName(name: string): UserRecord | null {
    return this.users.find(user => user.name === name) ?? null;
  }

  upsertUser(user: UserRecord): void {
    const index = this.users.findIndex(existing => existing.memberId === user.memberId);
    if (index >= 0) {
      this.users[index] = user;
      return;
    }
    this.users.push(user);
  }
}
