import { ConfigurationAdapter } from '../../../infrastructure/adapters/ConfigurationAdapter';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import { UserRecord, Role, TrainingDay } from '../../../domain/types';

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
      ['MemberID', 'Name', 'Email', 'Role', 'SubscribedTrainings'], // Header
      ['M001', 'Alice', 'alice@test.com', 'Mitglied', 'Montag, Mittwoch'],
      ['M002', 'Bob', '', 'Mitglied', 'Montag'], // no email
      ['T001', 'Charlie', 'charlie@test.com', 'Trainer', 'Montag, Freitag']
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
      expect(users[0].subscribedTrainings).toEqual(['Montag', 'Mittwoch']);
      expect(users[1].memberId).toBe('T001');
      expect(users[1].role).toBe('Trainer');
    });

    it('returns null for unknown email', () => {
      expect(adapter.getUserByEmail('unknown@test.com')).toBeNull();
    });

    it('returns user by email', () => {
      const user = adapter.getUserByEmail('alice@test.com');
      expect(user).toBeDefined();
      expect(user?.name).toBe('Alice');
    });

    it('upsertUser appends a new row if user not found', () => {
      const newUser: UserRecord = {
        memberId: 'M003',
        name: 'Dave',
        email: 'dave@test.com',
        role: 'Mitglied' as Role,
        subscribedTrainings: ['Mittwoch' as TrainingDay]
      };

      adapter.upsertUser(newUser);

      expect(gateway.getAppendsCount()).toBe(1);
      const appends = gateway.appendedRows[0];
      expect(appends.sheetName).toBe('Benutzer');
      expect(appends.values).toEqual(['M003', 'Dave', 'dave@test.com', 'Mitglied', 'Mittwoch']);
      
      // Cache should be invalidated and return new user
      const foundDave = adapter.getUserByMemberId('M003');
      expect(foundDave).toBeDefined();
    });

    it('upsertUser updates existing row based on memberId', () => {
      const updatedCharlie: UserRecord = {
        memberId: 'T001',
        name: 'Charlie2',
        email: 'charlie2@test.com',
        role: 'Trainer' as Role,
        subscribedTrainings: ['Montag' as TrainingDay, 'Mittwoch' as TrainingDay]
      };

      adapter.upsertUser(updatedCharlie);

      expect(gateway.getUpdatesCount()).toBe(1);
      const updates = gateway.updatedRows[0];
      expect(updates.sheetName).toBe('Benutzer');
      // Charlie was at row 3 (which is index 3 if we consider 1-based Header=1, Alice=2, Bob=3, Charlie=4 in initial data array)
      expect(updates.rowIndex).toBe(4); 
      expect(updates.values).toEqual(['T001', 'Charlie2', 'charlie2@test.com', 'Trainer', 'Montag,Mittwoch']);
      
      const foundCharlie = adapter.getUserByMemberId('T001');
      expect(foundCharlie?.name).toBe('Charlie2');
    });
  });

});
