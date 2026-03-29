import { RegisterMemberService } from '../../application/registration/RegisterMemberService';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { UserRecord, createCompositeMemberId, createPersonName, getRoleDefinition } from '../../domain/types';

class InMemoryUserRepository implements IUserRepository {
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

describe('RegisterMemberService', () => {
  it('creates a user record without subscriptions', () => {
    const repository = new InMemoryUserRepository();
    const service = new RegisterMemberService(repository);

    const result = service.execute({
      email: 'alice@example.com',
      role: 'Mitglied',
      firstName: 'Alice',
      lastName: 'Example',
      gender: 'w',
    });

    expect(result.created).toBe(true);
    expect(result.user).toEqual({
      memberId: 'alice::example',
      name: 'Alice Example',
      email: 'alice@example.com',
      gender: 'w',
      role: 'Mitglied',
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Alice', 'Example'),
      subscriptions: [],
      subscribedTrainingIds: [],
      subscribedTrainings: [],
    });
  });

  it('updates an existing user', () => {
    const existingUser: UserRecord = {
      memberId: createCompositeMemberId('New', 'Coach'),
      name: 'Old Name',
      email: 'old@example.com',
      role: 'Mitglied',
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Old', 'Name'),
      subscriptions: [],
      subscribedTrainingIds: [],
      subscribedTrainings: [],
    };
    const repository = new InMemoryUserRepository([existingUser]);
    const service = new RegisterMemberService(repository);

    const result = service.execute({
      email: 'new@example.com',
      role: 'Trainer',
      firstName: 'New',
      lastName: 'Coach',
      gender: 'm',
    });

    expect(result.created).toBe(false);
    expect(repository.getUserByMemberId('new::coach')?.role).toBe('Trainer');
    expect(repository.getUserByMemberId('new::coach')?.gender).toBe('m');
    expect(repository.getUserByMemberId('new::coach')?.subscribedTrainingIds).toEqual([]);
  });

  it('preserves an existing trainer role and subscriptions when re-registering through the public flow', () => {
    const existingUser: UserRecord = {
      memberId: 'coach::member',
      name: 'Coach Member',
      email: 'coach@example.com',
      role: 'Trainer',
      roleDefinition: getRoleDefinition('Trainer'),
      personName: createPersonName('Coach', 'Member'),
      subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
      subscribedTrainingIds: ['wed-mixed'],
      subscribedTrainings: ['Mittwoch'],
    };
    const repository = new InMemoryUserRepository([existingUser]);
    const service = new RegisterMemberService(repository);

    const result = service.execute({
      memberId: 'coach::member',
      email: 'coach@example.com',
      role: 'Mitglied',
      firstName: 'Coach',
      lastName: 'Renamed',
      gender: 'm',
    });

    expect(result.created).toBe(false);
    expect(result.user.memberId).toBe('coach::member');
    expect(result.user.role).toBe('Trainer');
    expect(result.user.subscribedTrainingIds).toEqual(['wed-mixed']);
  });
});