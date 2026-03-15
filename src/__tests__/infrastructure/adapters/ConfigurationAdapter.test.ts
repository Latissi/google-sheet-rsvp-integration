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
    Konfiguration: [
      ['Schlüssel', 'Wert'],
      ['OEFFENTLICHES_SHEET_ID', 'test_sheet_id_123'],
      ['WEBAPP_ADRESSE', 'https://script.google.com/macros/s/test/exec'],
      ['ERINNERUNGS_OFFSETS', JSON.stringify([
        { hours: 48, minutes: 0 },
        { hours: 2, minutes: 30 },
      ])],
    ],
    Trainingsquellen: [
      ['QuellenId', 'TabellenName', 'TabellenBereich', 'Layout', 'VornameSpalte', 'NachnameSpalte', 'StartSpalte'],
      ['club-rsvp', 'RSVP Übersicht', 'A1:F50', 'member-rows', 'A', 'B', 'C'],
    ],
    Trainingsdefinitionen: [
      ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Ort', 'Umgebung', 'Typ'],
      ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', '18:00', 'Sporthalle', 'Indoor', 'Mixed'],
    ],
    Mitglieder: [
      ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainings', 'AbonnierteTrainingsIds'],
      ['Alice', 'Example', 'alice@test.com', 'w', 'Mitglied', 'Montag, Mittwoch', 'mon-evening, wed-mixed'],
      ['Bob', 'Example', '', 'm', 'Mitglied', 'Montag', 'mon-evening'],
      ['Charlie', 'Coach', 'charlie@test.com', 'm', 'Trainer', 'Montag, Freitag', 'mon-evening, fri-outdoor'],
    ],
  };

  let gateway: MockSheetGateway;
  let adapter: ConfigurationAdapter;

  beforeEach(() => {
    gateway = new MockSheetGateway(JSON.parse(JSON.stringify(initialData)));
    adapter = new ConfigurationAdapter(gateway);
  });

  describe('Configuration reading', () => {
    it('returns public sheet ID from Konfiguration tab', () => {
      expect(adapter.getPublicSheetId()).toBe('test_sheet_id_123');
    });

    it('returns configured public training sources from structured tabs', () => {
      expect(adapter.getPublicTrainingSources()).toEqual([
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
              environment: 'Indoor',
              audience: 'Mixed',
            },
          ],
        },
      ]);
    });

    it('returns a reminder policy from ERINNERUNGS_OFFSETS', () => {
      expect(adapter.getReminderPolicy()).toEqual({
        offsets: [
          { hours: 48, minutes: 0 },
          { hours: 2, minutes: 30 },
        ],
        channels: ['email'],
      });
    });

    it('rejects member-row sources without training definitions', () => {
      const invalidGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit']],
        Mitglieder: initialData.Mitglieder,
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow(
        'Public training source "club-rsvp" uses member-rows layout and requires at least one training definition row.',
      );
    });

    it('throws error for missing configuration key', () => {
      const emptyGateway = new MockSheetGateway({
        Konfiguration: [['Schlüssel', 'Wert']],
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: initialData.Trainingsdefinitionen,
        Mitglieder: initialData.Mitglieder,
      });
      const emptyAdapter = new ConfigurationAdapter(emptyGateway);

      expect(() => emptyAdapter.getPublicSheetId()).toThrow('Missing required configuration key: "OEFFENTLICHES_SHEET_ID"');
    });

    it('rejects invalid training selector metadata', () => {
      const invalidGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [
          ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Typ'],
          ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', '18:00', 'Everyone'],
        ],
        Mitglieder: initialData.Mitglieder,
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow(
        'Training selector "wed-mixed" in source "club-rsvp" has an invalid audience value.',
      );
    });
  });

  describe('User reading and writing', () => {
    it('gets all users, skipping rows without email', () => {
      const users = adapter.getAllUsers();

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
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: initialData.Trainingsdefinitionen,
        Mitglieder: [
          ['Vorname', 'Nachname', 'EMail', 'Geschlecht', 'Rolle', 'AbonnierteTrainingsIds'],
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

      adapter.upsertUser(newUser);

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

      adapter.upsertUser(updatedCharlie);

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
});