import { PrivateSheetConfigurationProvider } from '../../../infrastructure/adapters/PrivateSheetConfigurationProvider';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';

describe('PrivateSheetConfigurationProvider', () => {
  const initialData = {
    Konfiguration: [
      ['Schlüssel', 'Wert'],
      ['OEFFENTLICHES_SHEET_ID', 'test_sheet_id_123'],
      ['WEBAPP_ADRESSE', 'https://script.google.com/macros/s/test/exec'],
      ['ERINNERUNGS_OFFSETS', JSON.stringify([48, 24])],
    ],
    Trainingsquellen: [
      ['QuellenId', 'TabellenName', 'TabellenBereich', 'DatumsKopfZeile', 'InfoZeile', 'MitgliederStartZeile', 'VornameSpalte', 'NachnameSpalte', 'GeschlechtSpalte', 'StartSpalte'],
      ['club-rsvp', 'RSVP Übersicht', 'A1:F50', '2', '1', '3', 'A', 'B', 'C', 'D'],
    ],
    Trainingsdefinitionen: [
      ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Ort', 'Umgebung'],
      ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', '18:00', 'Sporthalle', 'Indoor'],
    ],
  };

  let gateway: MockSheetGateway;
  let provider: PrivateSheetConfigurationProvider;

  beforeEach(() => {
    gateway = new MockSheetGateway(JSON.parse(JSON.stringify(initialData)));
    provider = new PrivateSheetConfigurationProvider(gateway);
  });

  it('returns public sheet ID from Konfiguration tab', () => {
    expect(provider.getPublicSheetId()).toBe('test_sheet_id_123');
  });

  it('returns configured public training sources from structured tabs', () => {
    expect(provider.getPublicTrainingSources()).toEqual([
      {
        sourceId: 'club-rsvp',
        sheetName: 'RSVP Übersicht',
        tableRange: 'A1:F50',
        attendance: {
          dateHeaderRow: 2,
          infoRow: 1,
          firstMemberRow: 3,
          firstNameColumn: 'A',
          lastNameColumn: 'B',
          genderColumn: 'C',
          startColumn: 'D',
        },
        trainings: [
          {
            trainingId: 'wed-mixed',
            title: 'Mittwoch Training',
            day: 'Mittwoch',
            startTime: '18:00',
            endTime: undefined,
            location: 'Sporthalle',
            environment: 'Indoor',
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
        ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Endzeit', 'Ort', 'Umgebung'],
        ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', new Date(1899, 11, 30, 19, 0, 39), new Date(1899, 11, 30, 21, 5, 0), 'Sporthalle', 'Indoor'],
      ],
    }, {
      Trainingsdefinitionen: [
        ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Endzeit', 'Ort', 'Umgebung'],
        ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', '19:00', '21:05', 'Sporthalle', 'Indoor'],
      ],
    });
    const dateValueProvider = new PrivateSheetConfigurationProvider(dateValueGateway);

    expect(dateValueProvider.getPublicTrainingSources()).toEqual([
      {
        sourceId: 'club-rsvp',
        sheetName: 'RSVP Übersicht',
        tableRange: 'A1:F50',
        attendance: {
          dateHeaderRow: 2,
          infoRow: 1,
          firstMemberRow: 3,
          firstNameColumn: 'A',
          lastNameColumn: 'B',
          genderColumn: 'C',
          startColumn: 'D',
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
        ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit', 'Endzeit', 'Ort', 'Umgebung'],
        ['club-rsvp', 'wed-mixed', 'Mittwoch Training', 'Mittwoch', 'Sat Dec 30 1899 19:00:39 GMT+0100 (Central European Standard Time)', 'Sat Dec 30 1899 21:05:00 GMT+0100 (Central European Standard Time)', 'Sporthalle', 'Indoor'],
      ],
    });
    const stringifiedDateProvider = new PrivateSheetConfigurationProvider(stringifiedDateGateway);

    try {
      expect(stringifiedDateProvider.getPublicTrainingSources()[0].trainings).toEqual([
        {
          trainingId: 'wed-mixed',
          title: 'Mittwoch Training',
          day: 'Mittwoch',
          startTime: '19:00',
          endTime: '21:05',
          location: 'Sporthalle',
          environment: 'Indoor',
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
    expect(provider.getReminderPolicy()).toEqual({
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
    });
    const invalidProvider = new PrivateSheetConfigurationProvider(invalidGateway);

    expect(() => invalidProvider.getPublicTrainingSources()).toThrow(
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
    });
    const invalidProvider = new PrivateSheetConfigurationProvider(invalidGateway);

    expect(() => invalidProvider.getPublicTrainingSources()).toThrow('Missing required user sheet column: DatumsKopfZeile');
  });

  it('requires Wochentag for every training definition', () => {
    const invalidGateway = new MockSheetGateway({
      Konfiguration: initialData.Konfiguration,
      Trainingsquellen: initialData.Trainingsquellen,
      Trainingsdefinitionen: [
        ['QuellenId', 'TrainingsId', 'Titel', 'Wochentag', 'Startzeit'],
        ['club-rsvp', 'wed-mixed', 'Mittwoch Training', '', '18:00'],
      ],
    });
    const invalidProvider = new PrivateSheetConfigurationProvider(invalidGateway);

    expect(() => invalidProvider.getPublicTrainingSources()).toThrow(
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
    });
    const invalidProvider = new PrivateSheetConfigurationProvider(invalidGateway);

    expect(() => invalidProvider.getPublicTrainingSources()).toThrow(
      'Duplicate training definition for sourceId "club-rsvp" and day "Mittwoch".',
    );
  });
});
