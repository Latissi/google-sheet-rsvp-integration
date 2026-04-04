import { UpdateSubscriptionPreferencesService } from '../../application/preferences/UpdateSubscriptionPreferencesService';
import { UserRecord, createPersonName, getRoleDefinition } from '../../domain/types';
import { InMemoryUserRepository } from '../mocks/InMemoryUserRepository';

class StaticTrainingDefinitionLookup {
  constructor(private readonly trainingIds: string[]) {}

  getTrainingDefinitions() {
    return this.trainingIds.map(trainingId => ({ trainingId }));
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
    const service = new UpdateSubscriptionPreferencesService(repository, new StaticTrainingDefinitionLookup(['wed-mixed', 'fri-outdoor']));

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
    const service = new UpdateSubscriptionPreferencesService(repository, new StaticTrainingDefinitionLookup(['wed-mixed', 'mon-evening']));

    const result = service.execute({
      memberId: 'alice::example',
      subscribedTrainingIds: ['wed-mixed'],
    });

    expect(result.user.subscribedTrainings).toEqual(['Montag']);
  });

  it('rejects unknown training ids', () => {
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
    const service = new UpdateSubscriptionPreferencesService(repository, new StaticTrainingDefinitionLookup(['wed-mixed']));

    expect(() => service.execute({
      memberId: 'alice::example',
      subscribedTrainingIds: ['unknown-training'],
    })).toThrow('Unknown training ids: unknown-training');
  });

  it('rejects stale member ids even when the email matches another user', () => {
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
    const service = new UpdateSubscriptionPreferencesService(repository, new StaticTrainingDefinitionLookup(['wed-mixed']));

    expect(() => service.execute({
      memberId: 'stale::memberid',
      subscribedTrainingIds: ['wed-mixed'],
    })).toThrow('User with memberId "stale::memberid" not found.');
  });
});