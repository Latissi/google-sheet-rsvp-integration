import { UpdateSubscriptionPreferencesService } from '../../application/preferences/UpdateSubscriptionPreferencesService';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { UserRecord, createPersonName, getRoleDefinition } from '../../domain/types';

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

describe('UpdateSubscriptionPreferencesService', () => {
  it('updates subscriptions for an existing user', () => {
    const repository = new InMemoryUserRepository([{
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
    }]);
    const service = new UpdateSubscriptionPreferencesService(repository);

    const result = service.execute({
      memberId: 'alice::example',
      subscribedTrainingIds: ['wed-mixed', 'wed-mixed', 'fri-outdoor'],
    });

    expect(result.user.subscriptions).toEqual([
      { trainingId: 'wed-mixed', notificationChannel: 'email' },
      { trainingId: 'fri-outdoor', notificationChannel: 'email' },
    ]);
    expect(result.user.subscribedTrainingIds).toEqual(['wed-mixed', 'fri-outdoor']);
  });

  it('preserves subscribed training labels when only ids are updated', () => {
    const repository = new InMemoryUserRepository([{
      memberId: 'alice::example',
      name: 'Alice Example',
      email: 'alice@example.com',
      gender: 'w',
      role: 'Mitglied',
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Alice', 'Example'),
      subscriptions: [{ trainingId: 'mon-evening', notificationChannel: 'email' }],
      subscribedTrainingIds: ['mon-evening'],
      subscribedTrainings: ['Montag'],
    }]);
    const service = new UpdateSubscriptionPreferencesService(repository);

    const result = service.execute({
      memberId: 'alice::example',
      subscribedTrainingIds: ['wed-mixed'],
    });

    expect(result.user.subscribedTrainings).toEqual(['Montag']);
  });
});