import { UserRecord } from '../types';

export interface IUserRepository {
  getAllUsers(): UserRecord[];
  getUserByMemberId(id: string): UserRecord | null;
  getUserByEmail(email: string): UserRecord | null;
  getUserByName(name: string): UserRecord | null;
  upsertUser(user: UserRecord): void;
}
