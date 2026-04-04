import {
  ISyncPublicSourceMembersOnOnboardingService,
  SyncPublicSourceMembersOnOnboardingService,
} from '../../application';
import { IPublicSourceRepository } from '../../domain/ports/IPublicSourceRepository';
import {
  PublicSourceRegistrationMatch,
  PublicTrainingSource,
  UserRecord,
  createPersonName,
  getRoleDefinition,
} from '../../domain/types';
import { TestConfigurationProvider } from '../mocks/TestConfigurationProvider';

class RecordingPublicSourceRepository implements IPublicSourceRepository {
  public appended: Array<{ source: PublicTrainingSource; user: UserRecord }> = [];

  constructor(private readonly matches: PublicSourceRegistrationMatch[]) {}

  getPublicSourceRegistrationMatches(): PublicSourceRegistrationMatch[] {
    return this.matches;
  }

  appendMemberToPublicSource(source: PublicTrainingSource, user: UserRecord): void {
    this.appended.push({ source, user });
  }
}

describe('SyncPublicSourceMembersOnOnboardingService', () => {
  const sources: PublicTrainingSource[] = [
    {
      sourceId: 'wed-source',
      sheetName: 'Mittwoch',
      tableRange: 'A1:D20',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        genderColumn: 'C',
        startColumn: 'D',
      },
      trainings: [{ trainingId: 'wed-mixed', day: 'Mittwoch', title: 'Mittwoch', startTime: '18:00' }],
    },
    {
      sourceId: 'fri-source',
      sheetName: 'Freitag',
      tableRange: 'A1:D20',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'D',
      },
      trainings: [{ trainingId: 'fri-group', day: 'Freitag', title: 'Freitag', startTime: '19:00' }],
    },
  ];

  const user: UserRecord = {
    memberId: 'ada::lovelace',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    gender: 'w',
    role: 'Mitglied',
    roleDefinition: getRoleDefinition('Mitglied'),
    personName: createPersonName('Ada', 'Lovelace'),
    subscriptions: [],
    subscribedTrainingIds: ['wed-mixed'],
    subscribedTrainings: [],
  };

  it('appends only selected sources that are currently not found', () => {
    const repository = new RecordingPublicSourceRepository([
      { sourceId: 'wed-source', sheetName: 'Mittwoch', status: 'not-found' },
      { sourceId: 'fri-source', sheetName: 'Freitag', status: 'not-found' },
    ]);
    const service: ISyncPublicSourceMembersOnOnboardingService = new SyncPublicSourceMembersOnOnboardingService(
      new TestConfigurationProvider(sources),
      repository,
    );

    const result = service.execute({ user, selectedTrainingIds: ['wed-mixed'] });

    expect(result).toEqual({ appendedSourceIds: ['wed-source'], skippedSourceIds: [] });
    expect(repository.appended).toHaveLength(1);
    expect(repository.appended[0].source.sourceId).toBe('wed-source');
  });

  it('skips sources with non-not-found match states', () => {
    const repository = new RecordingPublicSourceRepository([
      { sourceId: 'wed-source', sheetName: 'Mittwoch', status: 'matched' },
    ]);
    const service = new SyncPublicSourceMembersOnOnboardingService(
      new TestConfigurationProvider([sources[0]]),
      repository,
    );

    const result = service.execute({ user, selectedTrainingIds: ['wed-mixed'] });

    expect(result).toEqual({ appendedSourceIds: [], skippedSourceIds: ['wed-source'] });
    expect(repository.appended).toHaveLength(0);
  });
});