import { ConfigurationAdapter } from '../../../infrastructure/adapters/ConfigurationAdapter';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import {
  createCompositeMemberId,
  createPersonName,
  getRoleDefinition,
  Role,
  TrainingDay,
  UserRecord,
} from '../../../domain/types';

describe('ConfigurationAdapter', () => {

  const initialData = {
    'Konfiguration': [
      ['Schlüssel', 'Wert'], // Header
      ['PUBLIC_SHEET_ID', 'test_sheet_id_123'],
      ['PUBLIC_TRAINING_SOURCES', JSON.stringify([
        {
          sourceId: 'outdoor-main',
          sheetName: 'Outdoor Trainings',
          attendance: {
            startColumn: 'G',
            metadataColumn: 'B',
          },
          trainings: [
            {
              trainingId: 'wed-mixed',
              day: 'Mittwoch',
              environment: 'Outdoor',
              audience: 'Mixed',
              title: 'Outdoor Mittwoch',
            },
            {
              trainingId: 'thu-single',
              day: 'Donnerstag',
              environment: 'Outdoor',
              audience: 'SingleGender',
              title: 'Outdoor Donnerstag',
            },
          ],
        },
      ])],
      ['REMINDER_OFFSETS', JSON.stringify([
        { hours: 48, minutes: 0 },
        { hours: 2, minutes: 30 },
      ])],
      ['WEBAPP_URL', 'https://script.google.com/macros/s/test/exec']
    ],
    'Benutzer': [
      ['FirstName', 'LastName', 'Email', 'Gender', 'Role', 'SubscribedTrainings', 'SubscribedTrainingIds'],
      ['Alice', 'Example', 'alice@test.com', 'w', 'Mitglied', 'Montag, Mittwoch', 'mon-evening, wed-mixed'],
      ['Bob', 'Example', '', 'm', 'Mitglied', 'Montag', 'mon-evening'],
      ['Charlie', 'Coach', 'charlie@test.com', 'm', 'Trainer', 'Montag, Freitag', 'mon-evening, fri-outdoor']
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

    it('returns configured public training sources', () => {
      expect(adapter.getPublicTrainingSources()).toEqual([
        {
          sourceId: 'outdoor-main',
          spreadsheetId: 'test_sheet_id_123',
          sheetName: 'Outdoor Trainings',
          attendance: {
            startColumn: 'G',
            metadataColumn: 'B',
          },
          trainings: [
            {
              trainingId: 'wed-mixed',
              day: 'Mittwoch',
              environment: 'Outdoor',
              audience: 'Mixed',
              title: 'Outdoor Mittwoch',
            },
            {
              trainingId: 'thu-single',
              day: 'Donnerstag',
              environment: 'Outdoor',
              audience: 'SingleGender',
              title: 'Outdoor Donnerstag',
            },
          ],
        },
      ]);
    });

    it('parses member-row public training sources', () => {
      const memberRowsGateway = new MockSheetGateway({
        'Konfiguration': [
          ['Schlüssel', 'Wert'],
          ['PUBLIC_SHEET_ID', 'test_sheet_id_123'],
          ['PUBLIC_TRAINING_SOURCES', JSON.stringify([
            {
              sourceId: 'club-rsvp',
              sheetName: 'RSVP Übersicht',
              tableRange: 'A1:F50',
              attendance: {
                layout: 'member-rows',
                firstNameColumn: 'A',
                lastNameColumn: 'B',
                startColumn: 'C',
              },
              trainings: [
                {
                  trainingId: 'wed-mixed',
                  title: 'Mittwoch Training',
                  day: 'Mittwoch',
                  startTime: '18:00',
                  location: 'Sporthalle',
                },
              ],
            },
          ])],
          ['WEBAPP_URL', 'https://script.google.com/macros/s/test/exec'],
        ],
        'Benutzer': [],
      });
      const memberRowsAdapter = new ConfigurationAdapter(memberRowsGateway);

      expect(memberRowsAdapter.getPublicTrainingSources()).toEqual([
        {
          sourceId: 'club-rsvp',
          spreadsheetId: 'test_sheet_id_123',
          sheetName: 'RSVP Übersicht',
          tableRange: 'A1:F50',
          attendance: {
            layout: 'member-rows',
            firstNameColumn: 'A',
            lastNameColumn: 'B',
            startColumn: 'C',
          },
          trainings: [
            {
              trainingId: 'wed-mixed',
              title: 'Mittwoch Training',
              day: 'Mittwoch',
              startTime: '18:00',
              location: 'Sporthalle',
            },
          ],
        },
      ]);
    });

    it('returns a reminder policy', () => {
      expect(adapter.getReminderPolicy()).toEqual({
        offsets: [
          { hours: 48, minutes: 0 },
          { hours: 2, minutes: 30 },
        ],
        channels: ['email'],
      });
    });

    it('falls back to the legacy single-sheet and day-based reminder configuration', () => {
      const legacyGateway = new MockSheetGateway({
        'Konfiguration': [
          ['Schlüssel', 'Wert'],
          ['PUBLIC_SHEET_ID', 'legacy_sheet'],
          ['TRAINING_SHEET_NAME', 'Trainingsplan 2026'],
          ['ATTENDANCE_START_COL', 'H'],
          ['REMINDER_DAYS_BEFORE', '3'],
          ['WEBAPP_URL', 'https://script.google.com/macros/s/test/exec'],
        ],
        'Benutzer': [],
      });
      const legacyAdapter = new ConfigurationAdapter(legacyGateway);

      expect(legacyAdapter.getPublicTrainingSources()).toEqual([
        {
          sourceId: 'default',
          spreadsheetId: 'legacy_sheet',
          sheetName: 'Trainingsplan 2026',
          attendance: {
            startColumn: 'H',
          },
          trainings: [],
        },
      ]);
      expect(legacyAdapter.getReminderPolicy()).toEqual({
        offsets: [{ hours: 72, minutes: 0 }],
        channels: ['email'],
      });
    });

    it('rejects invalid reminder minute values', () => {
      const duplicateGateway = new MockSheetGateway({
        'Konfiguration': [
          ['Schlüssel', 'Wert'],
          ['PUBLIC_SHEET_ID', 'test_sheet_id_123'],
          ['REMINDER_OFFSETS', JSON.stringify([
            { hours: 1, minutes: 30 },
            { hours: 0, minutes: 90 },
          ])],
          ['WEBAPP_URL', 'https://script.google.com/macros/s/test/exec'],
        ],
        'Benutzer': [],
      });
      const duplicateAdapter = new ConfigurationAdapter(duplicateGateway);

      expect(() => duplicateAdapter.getReminderPolicy()).toThrow('Reminder offset at index 1 has an invalid minutes value.');
    });

    it('throws error for missing configuration key', () => {
      // Create empty config
      const emptyGateway = new MockSheetGateway({ 'Konfiguration': [], 'Benutzer': [] });
      const emptyAdapter = new ConfigurationAdapter(emptyGateway);
      expect(() => emptyAdapter.getPublicSheetId()).toThrow('Missing required configuration key: "PUBLIC_SHEET_ID"');
    });

    it('rejects invalid training selector metadata', () => {
      const invalidGateway = new MockSheetGateway({
        'Konfiguration': [
          ['Schlüssel', 'Wert'],
          ['PUBLIC_SHEET_ID', 'test_sheet_id_123'],
          ['PUBLIC_TRAINING_SOURCES', JSON.stringify([
            {
              sourceId: 'broken-source',
              sheetName: 'Outdoor Trainings',
              attendance: { startColumn: 'G' },
              trainings: [{ trainingId: 'wed-mixed', audience: 'Everyone' }],
            },
          ])],
          ['WEBAPP_URL', 'https://script.google.com/macros/s/test/exec'],
        ],
        'Benutzer': [],
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow(
        'Training selector "wed-mixed" in source "broken-source" has an invalid audience value.',
      );
    });
  });

  describe('User reading & writing', () => {
    it('gets all users, skipping header and empty emails', () => {
      const users = adapter.getAllUsers();
      // Should find M001 and T001, skipping M002 due to missing email
      expect(users.length).toBe(2);
      expect(users[0].memberId).toBe('alice::example');
      expect(users[0].name).toBe('Alice Example');
      expect(users[0].gender).toBe('w');
      expect(users[0].personName).toEqual(createPersonName('Alice', 'Example'));
      expect(users[0].subscribedTrainings).toEqual(['Montag', 'Mittwoch']);
      expect(users[0].subscribedTrainingIds).toEqual(['mon-evening', 'wed-mixed']);
      expect(users[0].subscriptions).toEqual([
        { trainingId: 'mon-evening', notificationChannel: 'email' },
        { trainingId: 'wed-mixed', notificationChannel: 'email' },
      ]);
      expect(users[0].roleDefinition).toEqual(getRoleDefinition('Mitglied'));
      expect(users[1].memberId).toBe('charlie::coach');
      expect(users[1].gender).toBe('m');
      expect(users[1].role).toBe('Trainer');
      expect(users[1].roleDefinition.capabilities.canRsvpToTraining).toBe(true);
      expect(users[1].roleDefinition.capabilities.canCancelTraining).toBe(true);
      expect(users[1].roleDefinition.capabilities.receivesParticipationReportEmail).toBe(true);
    });

    it('supports the legacy Name-based user sheet schema', () => {
      const legacyGateway = new MockSheetGateway({
        'Konfiguration': initialData.Konfiguration,
        'Benutzer': [
          ['Name', 'Email', 'Role', 'SubscribedTrainings'],
          ['Dana Legacy', 'dana@test.com', 'Mitglied', 'Mittwoch'],
        ],
      });

      const legacyAdapter = new ConfigurationAdapter(legacyGateway);
      expect(legacyAdapter.getAllUsers()).toEqual([
        {
          memberId: 'dana::legacy',
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

    it('supports the documented Mitglieder user sheet tab name', () => {
      const documentedGateway = new MockSheetGateway({
        'Konfiguration': initialData.Konfiguration,
        'Mitglieder': [
          ['FirstName', 'LastName', 'Email', 'Geschlecht', 'Role', 'SubscribedTrainingIds'],
          ['Dana', 'Dokumentiert', 'dana@test.com', 'w', 'member', 'wed-mixed'],
        ],
      });

      const documentedAdapter = new ConfigurationAdapter(documentedGateway);
      expect(documentedAdapter.getAllUsers()).toEqual([
        {
          memberId: 'dana::dokumentiert',
          name: 'Dana Dokumentiert',
          email: 'dana@test.com',
          gender: 'w',
          role: 'Mitglied',
          roleDefinition: getRoleDefinition('Mitglied'),
          personName: createPersonName('Dana', 'Dokumentiert'),
          subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
          subscribedTrainingIds: ['wed-mixed'],
          subscribedTrainings: [],
        },
      ]);
    });

    it('removes symbols from stored first and last names', () => {
      const symbolGateway = new MockSheetGateway({
        'Konfiguration': initialData.Konfiguration,
        'Mitglieder': [
          ['FirstName', 'LastName', 'Email', 'Geschlecht', 'Role', 'SubscribedTrainingIds'],
          ['Carla 🌞', 'Sommer✨', 'carla@test.com', 'w', 'Mitglied', 'wed-mixed'],
        ],
      });

      const symbolAdapter = new ConfigurationAdapter(symbolGateway);
      expect(symbolAdapter.getAllUsers()).toEqual([
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
        memberId: 'dave::newbie',
        name: 'Dave Newbie',
        email: 'dave@test.com',
        gender: 'm',
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
      expect(Array.from(appends.values)).toEqual(['Dave', 'Newbie', 'dave@test.com', 'm', 'Mitglied', 'Mittwoch', 'wed-beginners']);
      
      // Cache should be invalidated and return new user
      const foundDave = adapter.getUserByMemberId('dave::newbie');
      expect(foundDave).toBeDefined();
    });

    it('upsertUser updates existing row based on the composite member key', () => {
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
        subscribedTrainings: ['Montag' as TrainingDay, 'Mittwoch' as TrainingDay]
      };

      adapter.upsertUser(updatedCharlie);

      expect(gateway.getUpdatesCount()).toBe(1);
      const updates = gateway.updatedRows[0];
      expect(updates.sheetName).toBe('Benutzer');
      // Charlie was at row 3 (which is index 3 if we consider 1-based Header=1, Alice=2, Bob=3, Charlie=4 in initial data array)
      expect(updates.rowIndex).toBe(4); 
      expect(Array.from(updates.values)).toEqual(['Charlie', 'Coach', 'charlie2@test.com', 'm', 'Trainer', 'Montag, Mittwoch', 'mon-evening, wed-performance']);
      
      const foundCharlie = adapter.getUserByMemberId('charlie::coach');
      expect(foundCharlie?.name).toBe('Charlie Coach');
    });
  });

});
