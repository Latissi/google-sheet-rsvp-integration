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
      ['ERINNERUNGS_OFFSETS', JSON.stringify([48, 24])],
    ],
    Trainingsquellen: [
      ['QuellenId', 'TabellenName', 'TabellenBereich', 'DatumsKopfZeile', 'MitgliederStartZeile', 'VornameSpalte', 'NachnameSpalte', 'StartSpalte'],
      ['club-rsvp', 'RSVP Übersicht', 'A1:F50', '1', '2', 'A', 'B', 'C'],
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
          sheetName: 'RSVP Übersicht',
          tableRange: 'A1:F50',
          attendance: {
            dateHeaderRow: 1,
            firstMemberRow: 2,
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

    it('normalizes Date-backed training definition times to HH:MM', () => {
      const dateValueGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [
          ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Endzeit', 'Ort', 'Umgebung', 'Typ'],
          ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', new Date(1899, 11, 30, 19, 0, 39), new Date(1899, 11, 30, 21, 5, 0), 'Sporthalle', 'Indoor', 'Mixed'],
        ],
        Mitglieder: initialData.Mitglieder,
      }, {
        Trainingsdefinitionen: [
          ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Endzeit', 'Ort', 'Umgebung', 'Typ'],
          ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', '19:00', '21:05', 'Sporthalle', 'Indoor', 'Mixed'],
        ],
      });
      const dateValueAdapter = new ConfigurationAdapter(dateValueGateway);

      expect(dateValueAdapter.getPublicTrainingSources()).toEqual([
        {
          sourceId: 'club-rsvp',
          sheetName: 'RSVP Übersicht',
          tableRange: 'A1:F50',
          attendance: {
            dateHeaderRow: 1,
            firstMemberRow: 2,
            firstNameColumn: 'A',
            lastNameColumn: 'B',
            startColumn: 'C',
          },
          trainings: [
            {
              trainingId: 'wed-mixed',
              title: 'Mittwoch Training',
              day: 'Mittwoch',
              startTime: '19:00',
              endTime: '21:05',
              location: 'Sporthalle',
              environment: 'Indoor',
              audience: 'Mixed',
            },
          ],
        },
      ]);
    });

    it('normalizes Date-like training definition strings to HH:MM', () => {
      const globalScope = globalThis as unknown as {
        Session?: { getScriptTimeZone(): string };
        Utilities?: { formatDate(date: Date, timeZone: string, pattern: string): string };
      };
      const originalSession = globalScope.Session;
      const originalUtilities = globalScope.Utilities;

      globalScope.Session = {
        getScriptTimeZone() {
          return 'Europe/Berlin';
        },
      };
      globalScope.Utilities = {
        formatDate(date: Date, timeZone: string, pattern: string) {
          expect(pattern).toBe('HH:mm');

          const parts = new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }).formatToParts(date);

          const hours = parts.find(part => part.type === 'hour')?.value;
          const minutes = parts.find(part => part.type === 'minute')?.value;

          return `${hours}:${minutes}`;
        },
      };

      const stringifiedDateGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [
          ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Endzeit', 'Ort', 'Umgebung', 'Typ'],
          ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', 'Sat Dec 30 1899 19:00:39 GMT+0100 (Central European Standard Time)', 'Sat Dec 30 1899 21:05:00 GMT+0100 (Central European Standard Time)', 'Sporthalle', 'Indoor', 'Mixed'],
        ],
        Mitglieder: initialData.Mitglieder,
      });
      const stringifiedDateAdapter = new ConfigurationAdapter(stringifiedDateGateway);

      try {
        expect(stringifiedDateAdapter.getPublicTrainingSources()[0].trainings).toEqual([
          {
            trainingId: 'wed-mixed',
            title: 'Mittwoch Training',
            day: 'Mittwoch',
            startTime: '19:00',
            endTime: '21:05',
            location: 'Sporthalle',
            environment: 'Indoor',
            audience: 'Mixed',
          },
        ]);
      } finally {
        if (originalSession === undefined) {
          delete globalScope.Session;
        } else {
          globalScope.Session = originalSession;
        }

        if (originalUtilities === undefined) {
          delete globalScope.Utilities;
        } else {
          globalScope.Utilities = originalUtilities;
        }
      }
    });

    it('returns a reminder policy from ERINNERUNGS_OFFSETS', () => {
      expect(adapter.getReminderPolicy()).toEqual({
        offsets: [
          { hours: 48, minutes: 0 },
          { hours: 24, minutes: 0 },
        ],
        channels: ['email'],
      });
    });

    it('rejects sources without training definitions', () => {
      const invalidGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit']],
        Mitglieder: initialData.Mitglieder,
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow(
        'Public training source "club-rsvp" requires at least one training definition row.',
      );
    });

    it('requires date header and first member rows in Trainingsquellen', () => {
      const invalidGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: [
          ['QuellenId', 'TabellenName', 'TabellenBereich', 'VornameSpalte', 'NachnameSpalte', 'StartSpalte'],
          ['club-rsvp', 'RSVP Übersicht', 'A1:F50', 'A', 'B', 'C'],
        ],
        Trainingsdefinitionen: initialData.Trainingsdefinitionen,
        Mitglieder: initialData.Mitglieder,
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow('Missing required user sheet column: DatumsKopfZeile');
    });

    it('requires Wochentag for every training definition', () => {
      const invalidGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [
          ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Typ'],
          ['club-rsvp', 'wed-mixed', 'Mittwoch Training', '', '18:00', 'Mixed'],
        ],
        Mitglieder: initialData.Mitglieder,
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow(
        'Training selector "wed-mixed" in source "club-rsvp" has an invalid day value.',
      );
    });

    it('rejects duplicate weekdays inside one source', () => {
      const invalidGateway = new MockSheetGateway({
        Konfiguration: initialData.Konfiguration,
        Trainingsquellen: initialData.Trainingsquellen,
        Trainingsdefinitionen: [
          ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit'],
          ['club-rsvp', 'wed-early', 'Mittwoch Training 1', 'Mittwoch', '18:00'],
          ['club-rsvp', 'wed-late', 'Mittwoch Training 2', 'Mittwoch', '20:00'],
        ],
        Mitglieder: initialData.Mitglieder,
      });
      const invalidAdapter = new ConfigurationAdapter(invalidGateway);

      expect(() => invalidAdapter.getPublicTrainingSources()).toThrow(
        'Duplicate training definition for sourceId "club-rsvp" and day "Mittwoch".',
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
