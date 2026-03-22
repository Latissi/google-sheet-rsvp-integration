import { PrivateSheetUserRepository } from '../../../infrastructure/adapters/PrivateSheetUserRepository';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import {
  createCompositeMemberId,
  createPersonName,
  getRoleDefinition,
  Role,
  TrainingDay,
  UserRecord,
} from '../../../domain/types';

describe('PrivateSheetUserRepository', () => {
  const mitgliederSheet = [
    ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainings', 'AbonnierteTrainingsIds'],
    ['Alice', 'Example', 'alice@test.com', 'w', 'Mitglied', 'Montag, Mittwoch', 'mon-evening, wed-mixed'],
    ['Bob', 'Example', '', 'm', 'Mitglied', 'Montag', 'mon-evening'],
    ['Charlie', 'Coach', 'charlie@test.com', 'm', 'Trainer', 'Montag, Freitag', 'mon-evening, fri-outdoor'],
  ];

  let gateway: MockSheetGateway;
  let repo: PrivateSheetUserRepository;

  beforeEach(() => {
    gateway = new MockSheetGateway({ Mitglieder: JSON.parse(JSON.stringify(mitgliederSheet)) });
    repo = new PrivateSheetUserRepository(gateway);
  });

  it('gets all users, skipping rows without email', () => {
    const users = repo.getAllUsers();

    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({
      memberId: 'alice::example',
      name: 'Alice Example',
      email: 'alice@test.com',
      gender: 'w',
      role: 'Mitglied',
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Alice', 'Example'),
      subscriptions: [
        { trainingId: 'mon-evening', notificationChannel: 'email' },
        { trainingId: 'wed-mixed', notificationChannel: 'email' },
      ],
      subscribedTrainingIds: ['mon-evening', 'wed-mixed'],
      subscribedTrainings: ['Montag', 'Mittwoch'],
    });
    expect(users[1].memberId).toBe('charlie::coach');
    expect(users[1].role).toBe('Trainer');
  });

  it('removes symbols from stored first and last names', () => {
    const symbolGateway = new MockSheetGateway({
      Mitglieder: [
        ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainingsIds'],
        ['Carla 🌞', 'Sommer✨', 'carla@test.com', 'w', 'Mitglied', 'wed-mixed'],
      ],
    });
    const symbolRepo = new PrivateSheetUserRepository(symbolGateway);

    expect(symbolRepo.getAllUsers()).toEqual([
      {
        memberId: 'carla::sommer',
        name: 'Carla Sommer',
        email: 'carla@test.com',
        gender: 'w',
        role: 'Mitglied',
        roleDefinition: getRoleDefinition('Mitglied'),
        personName: createPersonName('Carla', 'Sommer'),
        subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
        subscribedTrainingIds: ['wed-mixed'],
        subscribedTrainings: [],
      },
    ]);
  });

  it('upsertUser appends a new row in Mitglieder', () => {
    const newUser: UserRecord = {
      memberId: 'dave::newbie',
      name: 'Dave Newbie',
      email: 'dave@test.com',
      gender: 'm',
      role: 'Mitglied' as Role,
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Dave', 'Newbie'),
      subscriptions: [{ trainingId: 'wed-beginners', notificationChannel: 'email' }],
      subscribedTrainingIds: ['wed-beginners'],
      subscribedTrainings: ['Mittwoch' as TrainingDay],
    };

    repo.upsertUser(newUser);

    expect(gateway.getAppendsCount()).toBe(1);
    expect(gateway.appendedRows[0].sheetName).toBe('Mitglieder');
    expect(Array.from(gateway.appendedRows[0].values)).toEqual([
      'Dave',
      'Newbie',
      'dave@test.com',
      'm',
      'Mitglied',
      'Mittwoch',
      'wed-beginners',
    ]);
  });

  it('upsertUser updates an existing row by composite member key', () => {
    const updatedCharlie: UserRecord = {
      memberId: createCompositeMemberId('Charlie', 'Coach'),
      name: 'Charlie Coach',
      email: 'charlie2@test.com',
      gender: 'm',
      role: 'Trainer' as Role,
      roleDefinition: getRoleDefinition('Trainer'),
      personName: createPersonName('Charlie', 'Coach'),
      subscriptions: [
        { trainingId: 'mon-evening', notificationChannel: 'email' },
        { trainingId: 'wed-performance', notificationChannel: 'email' },
      ],
      subscribedTrainingIds: ['mon-evening', 'wed-performance'],
      subscribedTrainings: ['Montag' as TrainingDay, 'Mittwoch' as TrainingDay],
    };

    repo.upsertUser(updatedCharlie);

    expect(gateway.getUpdatesCount()).toBe(1);
    expect(gateway.updatedRows[0].sheetName).toBe('Mitglieder');
    expect(gateway.updatedRows[0].rowIndex).toBe(4);
    expect(Array.from(gateway.updatedRows[0].values)).toEqual([
      'Charlie',
      'Coach',
      'charlie2@test.com',
      'm',
      'Trainer',
      'Montag, Mittwoch',
      'mon-evening, wed-performance',
    ]);
  });
});
