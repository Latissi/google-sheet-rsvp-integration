import { PrivateSheetUserRepository } from '../../../infrastructure/adapters/PrivateSheetUserRepository';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import { createCompositeMemberId, createPersonName, getRoleDefinition, Role, TrainingDay, UserRecord } from '../../../domain/types';

describe('PrivateSheetUserRepository', () => {
  const mitgliederSheet = [
    ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainings', 'AbonnierteTrainingsIds', 'MitgliedId'],
    ['Alice', 'Example', 'alice@test.com', 'w', 'Mitglied', 'Montag, Mittwoch', 'mon-evening, wed-mixed', 'alice::example'],
    ['Bob', 'Example', '', 'm', 'Mitglied', 'Montag', 'mon-evening', 'bob::example'],
    ['Charlie', 'Coach', 'charlie@test.com', 'm', 'Trainer', 'Montag, Freitag', 'mon-evening, fri-outdoor', 'charlie::coach'],
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
        ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainingsIds', 'MitgliedId'],
        ['Carla 🌞', 'Sommer✨', 'carla@test.com', 'w', 'Mitglied', 'wed-mixed', 'carla::sommer'],
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

  it('throws when a stored MitgliedId does not match the canonical first and last name', () => {
    const mismatchGateway = new MockSheetGateway({
      Mitglieder: [
        ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainingsIds', 'MitgliedId'],
        ['Alice', 'Example', 'alice@test.com', 'w', 'Mitglied', 'wed-mixed', 'alice::example::legacy'],
      ],
    });
    const mismatchRepo = new PrivateSheetUserRepository(mismatchGateway);

    expect(() => mismatchRepo.getAllUsers()).toThrow(
      'User row 2 has MitgliedId "alice::example::legacy" but expected "alice::example".',
    );
  });

  it('throws when duplicate MitgliedId rows exist in Mitglieder', () => {
    const duplicateGateway = new MockSheetGateway({
      Mitglieder: [
        ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainingsIds', 'MitgliedId'],
        ['Alice', 'Example', 'alice.one@test.com', 'w', 'Mitglied', 'wed-mixed', 'alice::example'],
        ['Alice', 'Example', 'alice.two@test.com', 'w', 'Mitglied', 'fri-group', 'alice::example'],
      ],
    });
    const duplicateRepo = new PrivateSheetUserRepository(duplicateGateway);

    expect(() => duplicateRepo.getAllUsers()).toThrow('Mitglieder contains duplicate MitgliedId "alice::example".');
  });

  it('throws when an existing row has no stored MitgliedId', () => {
    const noIdGateway = new MockSheetGateway({
      Mitglieder: [
        ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainingsIds', 'MitgliedId'],
        ['Alice', 'Example', 'alice.one@test.com', 'w', 'Mitglied', 'wed-mixed', ''],
      ],
    });
    const noIdRepo = new PrivateSheetUserRepository(noIdGateway);

    expect(() => noIdRepo.getAllUsers()).toThrow('User row 2 must define MitgliedId.');
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
      'dave::newbie',
    ]);
  });

  it('upsertUser writes all columns correctly when AbonnierteTrainings column is absent', () => {
    const minimalGateway = new MockSheetGateway({
      Mitglieder: [
        ['Vorname', 'Nachname', 'Geschlecht', 'EMail', 'Rolle', 'AbonnierteTrainingsIds', 'MitgliedId'],
      ],
    });
    const minimalRepo = new PrivateSheetUserRepository(minimalGateway);
    const user: UserRecord = {
      memberId: 'dave::newbie',
      name: 'Dave Newbie',
      email: 'dave@test.com',
      gender: 'm',
      role: 'Mitglied' as Role,
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Dave', 'Newbie'),
      subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
      subscribedTrainingIds: ['wed-mixed'],
      subscribedTrainings: ['Mittwoch' as TrainingDay],
    };

    minimalRepo.upsertUser(user);

    expect(minimalGateway.getAppendsCount()).toBe(1);
    expect(Array.from(minimalGateway.appendedRows[0].values)).toEqual([
      'Dave',
      'Newbie',
      'm',
      'dave@test.com',
      'Mitglied',
      'wed-mixed',
      'dave::newbie',
    ]);
  });

  it('upsertUser updates an existing row by memberId even when the email changes', () => {
    const updatedCharlie: UserRecord = {
      memberId: createCompositeMemberId('Charlie', 'Coach'),
      name: 'Charlie Coach',
      email: 'shared@test.com',
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
      'shared@test.com',
      'm',
      'Trainer',
      'Montag, Mittwoch',
      'mon-evening, wed-performance',
      'charlie::coach',
    ]);
  });

  it('upsertUser appends a new row when the email already exists on another member', () => {
    const duplicateEmailUser: UserRecord = {
      memberId: 'dora::duplicate',
      name: 'Dora Duplicate',
      email: 'alice@test.com',
      gender: 'w',
      role: 'Mitglied' as Role,
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Dora', 'Duplicate'),
      subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
      subscribedTrainingIds: ['wed-mixed'],
      subscribedTrainings: ['Mittwoch' as TrainingDay],
    };

    repo.upsertUser(duplicateEmailUser);

    expect(gateway.getUpdatesCount()).toBe(0);
    expect(gateway.getAppendsCount()).toBe(1);
    expect(Array.from(gateway.appendedRows[0].values)).toEqual([
      'Dora',
      'Duplicate',
      'alice@test.com',
      'w',
      'Mitglied',
      'Mittwoch',
      'wed-mixed',
      'dora::duplicate',
    ]);
  });
});
