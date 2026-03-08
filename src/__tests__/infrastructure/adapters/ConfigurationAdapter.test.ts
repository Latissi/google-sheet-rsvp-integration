import { ConfigurationAdapter } from '../../../infrastructure/adapters/ConfigurationAdapter';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import { createPersonName, getRoleDefinition, Role, TrainingDay, UserRecord } from '../../../domain/types';

describe('ConfigurationAdapter', () => {

  const initialData = {
    'Konfiguration': [
      ['Schlüssel', 'Wert'], // Header
      ['PUBLIC_SHEET_ID', 'test_sheet_id_123'],
      ['TRAINING_SHEET_NAME', 'Trainingsplan 2026'],
      ['ATTENDANCE_START_COL', 'G'],
      ['REMINDER_DAYS_BEFORE', '3'],
      ['WEBAPP_URL', 'https://script.google.com/macros/s/test/exec']
    ],
    'Benutzer': [
      ['MemberID', 'FirstName', 'LastName', 'Email', 'Role', 'SubscribedTrainings', 'SubscribedTrainingIds'], // Header
      ['M001', 'Alice', 'Example', 'alice@test.com', 'Mitglied', 'Montag, Mittwoch', 'mon-evening, wed-mixed'],
      ['M002', 'Bob', 'Example', '', 'Mitglied', 'Montag', 'mon-evening'], // no email
      ['T001', 'Charlie', 'Coach', 'charlie@test.com', 'Trainer', 'Montag, Freitag', 'mon-evening, fri-outdoor']
    ]
  };

  let gateway: MockSheetGateway;
  let adapter: ConfigurationAdapter;

  beforeEach(() => {
    // deep copy so mutations don't leak between tests
    const clonedData = JSON.parse(JSON.stringify(initialData));
    gateway = new MockSheetGateway(clonedData);
    adapter = new ConfigurationAdapter(gateway);
  });

  describe('Configuration reading', () => {
    it('returns public sheet ID from Konfiguration tab', () => {
      expect(adapter.getPublicSheetId()).toBe('test_sheet_id_123');
    });

    it('returns training sheet name', () => {
      expect(adapter.getTrainingSheetName()).toBe('Trainingsplan 2026');
    });

    it('parses reminder days into a number', () => {
      expect(adapter.getReminderDaysBeforeTraining()).toBe(3);
    });

    it('returns a reminder policy', () => {
      expect(adapter.getReminderPolicy()).toEqual({
        daysBeforeTraining: 3,
        channels: ['email'],
      });
    });

    it('throws error for missing configuration key', () => {
      // Create empty config
      const emptyGateway = new MockSheetGateway({ 'Konfiguration': [], 'Benutzer': [] });
      const emptyAdapter = new ConfigurationAdapter(emptyGateway);
      expect(() => emptyAdapter.getPublicSheetId()).toThrow('Missing required configuration key: "PUBLIC_SHEET_ID"');
    });
  });

  describe('User reading & writing', () => {
    it('gets all users, skipping header and empty emails', () => {
      const users = adapter.getAllUsers();
      // Should find M001 and T001, skipping M002 due to missing email
      expect(users.length).toBe(2);
      expect(users[0].memberId).toBe('M001');
      expect(users[0].name).toBe('Alice Example');
      expect(users[0].personName).toEqual(createPersonName('Alice', 'Example'));
      expect(users[0].subscribedTrainings).toEqual(['Montag', 'Mittwoch']);
      expect(users[0].subscribedTrainingIds).toEqual(['mon-evening', 'wed-mixed']);
      expect(users[0].subscriptions).toEqual([
        { trainingId: 'mon-evening', notificationChannel: 'email' },
        { trainingId: 'wed-mixed', notificationChannel: 'email' },
      ]);
      expect(users[0].roleDefinition).toEqual(getRoleDefinition('Mitglied'));
      expect(users[1].memberId).toBe('T001');
      expect(users[1].role).toBe('Trainer');
      expect(users[1].roleDefinition.capabilities.canRsvpToTraining).toBe(true);
      expect(users[1].roleDefinition.capabilities.canCancelTraining).toBe(true);
      expect(users[1].roleDefinition.capabilities.receivesParticipationReportEmail).toBe(true);
    });

    it('supports the legacy Name-based user sheet schema', () => {
      const legacyGateway = new MockSheetGateway({
        'Konfiguration': initialData.Konfiguration,
        'Benutzer': [
          ['MemberID', 'Name', 'Email', 'Role', 'SubscribedTrainings'],
          ['M004', 'Dana Legacy', 'dana@test.com', 'Mitglied', 'Mittwoch'],
        ],
      });

      const legacyAdapter = new ConfigurationAdapter(legacyGateway);
      expect(legacyAdapter.getAllUsers()).toEqual([
        {
          memberId: 'M004',
          name: 'Dana Legacy',
          email: 'dana@test.com',
          role: 'Mitglied',
          roleDefinition: getRoleDefinition('Mitglied'),
          personName: createPersonName('Dana', 'Legacy'),
          subscriptions: [{ trainingId: 'Mittwoch', notificationChannel: 'email' }],
          subscribedTrainingIds: ['Mittwoch'],
          subscribedTrainings: ['Mittwoch'],
        },
      ]);
    });

    it('returns null for unknown email', () => {
      expect(adapter.getUserByEmail('unknown@test.com')).toBeNull();
    });

    it('returns user by email', () => {
      const user = adapter.getUserByEmail('alice@test.com');
      expect(user).toBeDefined();
      expect(user?.name).toBe('Alice Example');
    });

    it('upsertUser appends a new row if user not found', () => {
      const newUser: UserRecord = {
        memberId: 'M003',
        name: 'Dave Newbie',
        email: 'dave@test.com',
        role: 'Mitglied' as Role,
        roleDefinition: getRoleDefinition('Mitglied'),
        personName: createPersonName('Dave', 'Newbie'),
        subscriptions: [{ trainingId: 'wed-beginners', notificationChannel: 'email' }],
        subscribedTrainingIds: ['wed-beginners'],
        subscribedTrainings: ['Mittwoch' as TrainingDay]
      };

      adapter.upsertUser(newUser);

      expect(gateway.getAppendsCount()).toBe(1);
      const appends = gateway.appendedRows[0];
      expect(appends.sheetName).toBe('Benutzer');
      expect(Array.from(appends.values)).toEqual(['M003', 'Dave', 'Newbie', 'dave@test.com', 'Mitglied', 'Mittwoch', 'wed-beginners']);
      
      // Cache should be invalidated and return new user
      const foundDave = adapter.getUserByMemberId('M003');
      expect(foundDave).toBeDefined();
    });

    it('upsertUser updates existing row based on memberId', () => {
      const updatedCharlie: UserRecord = {
        memberId: 'T001',
        name: 'Charlie2 Coach',
        email: 'charlie2@test.com',
        role: 'Trainer' as Role,
        roleDefinition: getRoleDefinition('Trainer'),
        personName: createPersonName('Charlie2', 'Coach'),
        subscriptions: [
          { trainingId: 'mon-evening', notificationChannel: 'email' },
          { trainingId: 'wed-performance', notificationChannel: 'email' },
        ],
        subscribedTrainingIds: ['mon-evening', 'wed-performance'],
        subscribedTrainings: ['Montag' as TrainingDay, 'Mittwoch' as TrainingDay]
      };

      adapter.upsertUser(updatedCharlie);

      expect(gateway.getUpdatesCount()).toBe(1);
      const updates = gateway.updatedRows[0];
      expect(updates.sheetName).toBe('Benutzer');
      // Charlie was at row 3 (which is index 3 if we consider 1-based Header=1, Alice=2, Bob=3, Charlie=4 in initial data array)
      expect(updates.rowIndex).toBe(4); 
      expect(Array.from(updates.values)).toEqual(['T001', 'Charlie2', 'Coach', 'charlie2@test.com', 'Trainer', 'Montag, Mittwoch', 'mon-evening, wed-performance']);
      
      const foundCharlie = adapter.getUserByMemberId('T001');
      expect(foundCharlie?.name).toBe('Charlie2 Coach');
    });
  });

});
