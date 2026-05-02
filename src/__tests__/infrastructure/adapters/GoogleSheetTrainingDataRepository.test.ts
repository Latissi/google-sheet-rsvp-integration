import {
  PublicTrainingSource,
  createCompositeMemberId,
} from '../../../domain/types';
import { createUser } from '../../mocks/testUserFactory';
import { GoogleSheetTrainingDataRepository } from '../../../infrastructure/adapters/GoogleSheetTrainingDataRepository';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import { TestConfigurationProvider } from '../../mocks/TestConfigurationProvider';
import { InMemoryUserRepository } from '../../mocks/InMemoryUserRepository';

interface TestLogger {
  warn: jest.Mock<void, [string, string, Record<string, unknown> | undefined, string | undefined]>;
}

const ATTENDANCE_METADATA_SHEET_NAME = 'TeilnahmeMetadaten';
const DISPATCH_METADATA_SHEET_NAME = 'VersandMetadaten';
const DISPATCH_METADATA_HEADERS = ['SessionId', 'AbsageBenachrichtigungGesendetAm'];
const REMINDER_DISPATCH_METADATA_SHEET_NAME = 'ErinnerungsVersandMetadaten';
const REMINDER_DISPATCH_METADATA_HEADERS = ['SessionId', 'OffsetMinuten', 'GesendetAm'];
const RUNTIME_METADATA_SHEET_NAME = 'LaufzeitMetadaten';
const RUNTIME_METADATA_HEADERS = ['Schluessel', 'Wert'];

describe('GoogleSheetTrainingDataRepository', () => {
  const fixedNow = () => new Date('2026-03-15T00:00:00.000Z');
  const users = [
    createUser({ memberId: createCompositeMemberId('Alice', 'Example'), name: 'Alice Example' }),
    createUser({ memberId: createCompositeMemberId('Bob', 'Example'), name: 'Bob Example' }),
    createUser({ memberId: createCompositeMemberId('Charlie', 'Coach'), name: 'Charlie Coach', role: 'Trainer' }),
    createUser({ memberId: createCompositeMemberId('Anna', 'Ananas'), name: 'Anna Ananas' }),
  ];

  function createRepository(
    sources: PublicTrainingSource[],
    sheets: Record<string, unknown[][]>,
    logger?: TestLogger,
  ) {
    const gateway = new MockSheetGateway(sheets);
    const repository = new GoogleSheetTrainingDataRepository(
      gateway,
      new TestConfigurationProvider(sources),
      new InMemoryUserRepository(users),
      fixedNow,
      logger,
    );

    return { gateway, repository };
  }

  afterEach(() => {
    delete (globalThis as unknown as { Utilities?: unknown }).Utilities;
    delete (globalThis as unknown as { Session?: unknown }).Session;
  });

  it('parses simple member-row sheets with explicit dateHeaderRow and firstMemberRow', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:E10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
        location: 'Sporthalle',
      }],
    }];
    const { repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z'), 'Notiz'],
        ['Alice', 'Example', 'x', '-', ''],
        ['Bob', 'Example', '', 'x', ''],
        ['Charlie', 'Coach', '-', '', ''],
      ],
    });

    expect(repository.getTrainingDefinitions()).toEqual([
      {
        trainingId: 'wed-mixed',
        title: 'Mittwoch Training',
        day: 'Mittwoch',
        startTime: '18:00',
        location: 'Sporthalle',
      },
    ]);

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-11',
        startTime: '18:00',
        location: 'Sporthalle',
        status: 'Scheduled',
      },
      {
        sessionId: 'club-rsvp__wed-mixed__2026-03-18__18:00',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-18',
        startTime: '18:00',
        location: 'Sporthalle',
        status: 'Scheduled',
      },
    ]);
  });

  it('uses the Apps Script timezone for sheet date header cells', () => {
    (globalThis as unknown as {
      Session: { getScriptTimeZone(): string };
      Utilities: { formatDate(date: Date, timeZone: string, pattern: string): string };
    }).Session = {
      getScriptTimeZone() {
        return 'Europe/Berlin';
      },
    };

    (globalThis as unknown as {
      Utilities: { formatDate(date: Date, timeZone: string, pattern: string): string };
    }).Utilities = {
      formatDate(date: Date, timeZone: string, pattern: string) {
        expect(pattern).toBe('yyyy-MM-dd');
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(date);

        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        const day = parts.find(part => part.type === 'day')?.value;

        return `${year}-${month}-${day}`;
      },
    };

    const sources: PublicTrainingSource[] = [{
      sourceId: 'std-outdoor',
      sheetName: 'Training Mi',
      tableRange: 'A1:G20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 4,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'E',
      },
      trainings: [{
        trainingId: 'outdoor-wed',
        day: 'Mittwoch',
        title: 'Outdoor Mittwoch',
        startTime: '19:00',
      }],
    }];

    const { repository } = createRepository(sources, {
      'Training Mi': [
        ['', '', '', '', '', '', ''],
        ['', '', '', '', new Date('2026-03-03T23:00:00.000Z'), new Date('2026-03-10T23:00:00.000Z'), new Date('2026-03-17T23:00:00.000Z')],
        ['Zusagen', '', '', '', 22, 5, 5],
        ['Anna', 'Ananas', 'w', '', 'x', '-', ''],
      ],
    });

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'std-outdoor__outdoor-wed__2026-03-04__19:00',
        trainingId: 'outdoor-wed',
        sessionDate: '2026-03-04',
        startTime: '19:00',
        status: 'Scheduled',
      },
      {
        sessionId: 'std-outdoor__outdoor-wed__2026-03-11__19:00',
        trainingId: 'outdoor-wed',
        sessionDate: '2026-03-11',
        startTime: '19:00',
        status: 'Scheduled',
      },
      {
        sessionId: 'std-outdoor__outdoor-wed__2026-03-18__19:00',
        trainingId: 'outdoor-wed',
        sessionDate: '2026-03-18',
        startTime: '19:00',
        status: 'Scheduled',
      },
    ]);
  });

  it('reads attendance from simple member rows', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z')],
        ['Alice', 'Example', 'x', '-'],
        ['Charlie', 'Coach', '-', ''],
      ],
    });

    expect(repository.getAttendanceForSession('club-rsvp__wed-mixed__2026-03-11__18:00')).toEqual([
      {
        memberId: 'alice::example',
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        rsvpStatus: 'Accepted',
      },
      {
        memberId: 'charlie::coach',
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        rsvpStatus: 'Declined',
      },
    ]);
  });

  it('ignores duplicate attendance metadata rows', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z')],
        ['Alice', 'Example', 'x'],
      ],
      [ATTENDANCE_METADATA_SHEET_NAME]: [
        ['SessionId', 'MitgliedId', 'Quelle', 'AktualisiertAm'],
        ['club-rsvp__wed-mixed__2026-03-11__18:00', 'alice::example', 'email-rsvp', '2026-03-09T10:00:00.000Z'],
        ['club-rsvp__wed-mixed__2026-03-11__18:00', 'alice::example', 'email-rsvp', '2026-03-09T10:01:00.000Z'],
      ],
    });

    expect(repository.getAttendanceForSession('club-rsvp__wed-mixed__2026-03-11__18:00')).toEqual([
      {
        memberId: 'alice::example',
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        rsvpStatus: 'Accepted',
      },
    ]);
  });

  it('parses tentative public-sheet markers as tentative attendance', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z')],
        ['Bob', 'Example', '(x)'],
      ],
    });

    expect(repository.getAttendanceForSession('club-rsvp__wed-mixed__2026-03-11__18:00')).toEqual([
      {
        memberId: 'bob::example',
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        rsvpStatus: 'Tentative',
      },
    ]);
  });

  it('reuses the loaded public sheet within one repository instance', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z')],
        ['Alice', 'Example', 'x', '-'],
        ['Bob', 'Example', '', 'x'],
      ],
    });

    repository.getUpcomingTrainingSessions();
    repository.getUpcomingTrainingSessions();
    repository.getAttendanceForSession('club-rsvp__wed-mixed__2026-03-11__18:00');

    expect(gateway.getReadCount('RSVP Übersicht', 'A1:D10')).toBe(1);
  });

  it('parses the first public-sheet variant with a separate date header row and summary rows', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'single-gender',
      sheetName: 'Single Gender',
      tableRange: 'A1:G20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 6,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'E',
      },
      trainings: [{
        trainingId: 'wed-single',
        day: 'Mittwoch',
        title: 'Single Gender Mittwoch',
        startTime: '19:00',
      }],
    }];
    const { repository } = createRepository(sources, {
      'Single Gender': [
        ['', '', '', '', 'Single Gender', '', 'Single Gender'],
        ['', '', '', '', 'Mi. 4. 3.', 'Mi. 11. 3.', 'Mi. 18. 3.'],
        ['Zusagen', '', '', '', 22, 5, 5],
        ['FMPs', '', '', '', 10, 4, 3],
        ['(x) und ?', '', '', 'Akkreditierung', 0, 0, 0],
        ['Anna', 'Ananas', 'w', '', 'x', 'x', '-'],
      ],
    });

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'single-gender__wed-single__2026-03-04__19:00',
        trainingId: 'wed-single',
        sessionDate: '2026-03-04',
        startTime: '19:00',
        status: 'Scheduled',
      },
      {
        sessionId: 'single-gender__wed-single__2026-03-11__19:00',
        trainingId: 'wed-single',
        sessionDate: '2026-03-11',
        startTime: '19:00',
        status: 'Scheduled',
      },
      {
        sessionId: 'single-gender__wed-single__2026-03-18__19:00',
        trainingId: 'wed-single',
        sessionDate: '2026-03-18',
        startTime: '19:00',
        status: 'Scheduled',
      },
    ]);

    expect(repository.getAttendanceForSession('single-gender__wed-single__2026-03-18__19:00')).toEqual([
      {
        memberId: 'anna::ananas',
        sessionId: 'single-gender__wed-single__2026-03-18__19:00',
        rsvpStatus: 'Declined',
      },
    ]);
  });

  it('parses the second public-sheet variant with multiple weekdays in one source', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'mixed-weekdays',
      sheetName: 'Mixed Weekdays',
      tableRange: 'A1:G20',
      attendance: {
        dateHeaderRow: 2,
        infoRow: 1,
        firstMemberRow: 7,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'D',
      },
      trainings: [
        {
          trainingId: 'wed-mixed',
          day: 'Mittwoch',
          title: 'Mittwoch Training',
          startTime: '20:15',
        },
        {
          trainingId: 'mon-late',
          day: 'Montag',
          title: 'Montag Training',
          startTime: '20:15',
        },
        {
          trainingId: 'sat-midday',
          day: 'Samstag',
          title: 'Samstag Training',
          startTime: '11:45',
        },
      ],
    }];
    const { repository } = createRepository(sources, {
      'Mixed Weekdays': [
        ['Zeile nicht entfernen!', '', '', '', '', 'Halle gesperrt', ''],
        ['Mo 20:15-21:45', 'Sa 11:45-13:00', '', 'Mi. 12. 3', 'Halle gesperrt', 'Mo. 17. 3', 'Sa. 22. 3'],
        ['Zusagen', '', '', 5, 'Uni zu', 13, 17],
        ['MMPs', '', '', 2, 'Uni zu', 6, 8],
        ['FMPs', '', '', 3, 'Uni zu', 7, 9],
        ['(x) und ?', '', '', 1, 'Uni zu', 3, 4],
        ['Anna', 'Ananas', 'w', 'x', '', '-', 'x'],
      ],
    });

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'mixed-weekdays__wed-mixed__2025-03-12__20:15',
        trainingId: 'wed-mixed',
        sessionDate: '2025-03-12',
        startTime: '20:15',
        status: 'Scheduled',
      },
      {
        sessionId: 'mixed-weekdays__mon-late__2025-03-17__20:15',
        trainingId: 'mon-late',
        sessionDate: '2025-03-17',
        startTime: '20:15',
        additionalInfo: 'Halle gesperrt',
        status: 'Cancelled',
      },
      {
        sessionId: 'mixed-weekdays__sat-midday__2025-03-22__11:45',
        trainingId: 'sat-midday',
        sessionDate: '2025-03-22',
        startTime: '11:45',
        status: 'Scheduled',
      },
    ]);

    expect(repository.getAttendanceForSession('mixed-weekdays__mon-late__2025-03-17__20:15')).toEqual([
      {
        memberId: 'anna::ananas',
        sessionId: 'mixed-weekdays__mon-late__2025-03-17__20:15',
        rsvpStatus: 'Declined',
      },
    ]);
  });

  it('warns and skips public-sheet weekdays that are not configured privately', () => {
    const logger: TestLogger = {
      warn: jest.fn(),
    };

    const sources: PublicTrainingSource[] = [{
      sourceId: 'std-outdoor',
      sheetName: 'Outdoor Sessions',
      tableRange: 'A1:F20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 4,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'D',
      },
      trainings: [{
        trainingId: 'wed-outdoor',
        day: 'Mittwoch',
        title: 'Outdoor Mittwoch',
        startTime: '18:30',
      }],
    }];

    const { repository } = createRepository(sources, {
      'Outdoor Sessions': [
        ['', '', '', '', '', ''],
        ['', '', '', 'Mi. 18. 3.', 'Di. 24. 3.', 'Mi. 25. 3.'],
        ['Zusagen', '', '', 4, 0, 7],
        ['Anna', 'Ananas', 'w', 'x', '', '-'],
      ],
    }, logger);

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'std-outdoor__wed-outdoor__2026-03-18__18:30',
        trainingId: 'wed-outdoor',
        sessionDate: '2026-03-18',
        startTime: '18:30',
        status: 'Scheduled',
      },
      {
        sessionId: 'std-outdoor__wed-outdoor__2026-03-25__18:30',
        trainingId: 'wed-outdoor',
        sessionDate: '2026-03-25',
        startTime: '18:30',
        status: 'Scheduled',
      },
    ]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'training-data-repository',
      'skipped-unconfigured-weekday',
      {
        sourceId: 'std-outdoor',
        weekday: 'Dienstag',
        count: 1,
        firstSessionDate: '2026-03-24',
        lastSessionDate: '2026-03-24',
      },
      'Public training source std-outdoor has no training definition for weekday Dienstag. Skipping session date 2026-03-24.',
    );
  });

  it('skips past unconfigured weekdays without logging a warning', () => {
    const logger: TestLogger = {
      warn: jest.fn(),
    };

    const sources: PublicTrainingSource[] = [{
      sourceId: 'std-outdoor',
      sheetName: 'Outdoor Sessions',
      tableRange: 'A1:F20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 4,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'D',
      },
      trainings: [{
        trainingId: 'wed-outdoor',
        day: 'Mittwoch',
        title: 'Outdoor Mittwoch',
        startTime: '18:30',
      }],
    }];

    const { repository } = createRepository(sources, {
      'Outdoor Sessions': [
        ['', '', '', '', '', ''],
        ['', '', '', '2025-03-11', '2026-03-18', '2026-03-25'],
        ['Zusagen', '', '', 0, 4, 7],
        ['Anna', 'Ananas', 'w', '', 'x', '-'],
      ],
    }, logger);

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'std-outdoor__wed-outdoor__2026-03-18__18:30',
        trainingId: 'wed-outdoor',
        sessionDate: '2026-03-18',
        startTime: '18:30',
        status: 'Scheduled',
      },
      {
        sessionId: 'std-outdoor__wed-outdoor__2026-03-25__18:30',
        trainingId: 'wed-outdoor',
        sessionDate: '2026-03-25',
        startTime: '18:30',
        status: 'Scheduled',
      },
    ]);

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('warns once for current and future unconfigured weekdays', () => {
    const logger: TestLogger = {
      warn: jest.fn(),
    };

    const sources: PublicTrainingSource[] = [{
      sourceId: 'std-outdoor',
      sheetName: 'Outdoor Sessions',
      tableRange: 'A1:H20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 4,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'D',
      },
      trainings: [{
        trainingId: 'wed-outdoor',
        day: 'Mittwoch',
        title: 'Outdoor Mittwoch',
        startTime: '18:30',
      }],
    }];

    const { repository } = createRepository(sources, {
      'Outdoor Sessions': [
        ['', '', '', '', '', '', '', ''],
        ['', '', '', '2025-03-11', '2026-03-17', '2026-03-18', '2026-03-24', '2026-03-25'],
        ['Zusagen', '', '', 0, 0, 4, 0, 7],
        ['Anna', 'Ananas', 'w', '', '', 'x', '', '-'],
      ],
    }, logger);

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'std-outdoor__wed-outdoor__2026-03-18__18:30',
        trainingId: 'wed-outdoor',
        sessionDate: '2026-03-18',
        startTime: '18:30',
        status: 'Scheduled',
      },
      {
        sessionId: 'std-outdoor__wed-outdoor__2026-03-25__18:30',
        trainingId: 'wed-outdoor',
        sessionDate: '2026-03-25',
        startTime: '18:30',
        status: 'Scheduled',
      },
    ]);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'training-data-repository',
      'skipped-unconfigured-weekday',
      {
        sourceId: 'std-outdoor',
        weekday: 'Dienstag',
        count: 2,
        firstSessionDate: '2026-03-17',
        lastSessionDate: '2026-03-24',
      },
      'Public training source std-outdoor has no training definition for weekday Dienstag. Skipping 2 session dates from 2026-03-17 to 2026-03-24.',
    );
  });

  it('fails when a private training definition has no matching public-sheet session', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'std-outdoor',
      sheetName: 'Outdoor Sessions',
      tableRange: 'A1:E20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 4,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'D',
      },
      trainings: [
        {
          trainingId: 'wed-outdoor',
          day: 'Mittwoch',
          title: 'Outdoor Mittwoch',
          startTime: '18:30',
        },
        {
          trainingId: 'sat-outdoor',
          day: 'Samstag',
          title: 'Outdoor Samstag',
          startTime: '10:00',
        },
      ],
    }];

    const { repository } = createRepository(sources, {
      'Outdoor Sessions': [
        ['', '', '', '', ''],
        ['', '', '', 'Mi. 18. 3.', 'Mi. 25. 3.'],
        ['Zusagen', '', '', 4, 7],
        ['Anna', 'Ananas', 'w', 'x', '-'],
      ],
    });

    expect(() => repository.getUpcomingTrainingSessions()).toThrow(
      'Public training source "std-outdoor" is missing sessions in the public sheet for configured training definitions: sat-outdoor.',
    );
  });

  it('saves RSVP state back into the configured member rows', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z')],
        ['Alice', 'Example', '', ''],
        ['Bob', 'Example', '', ''],
      ],
    });

    repository.saveAttendance({
      memberId: 'bob::example',
      sessionId: 'club-rsvp__wed-mixed__2026-03-18__18:00',
      rsvpStatus: 'Declined',
    });

    expect(gateway.updatedCells).toContainEqual({
      sheetName: 'RSVP Übersicht',
      rowIndex: 3,
      columnIndex: 4,
      value: '-',
    });
    expect(gateway.appendedRows).toEqual([]);
  });

  it('stores an RSVP comment as a note on the same attendance cell', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z')],
        ['Alice', 'Example', '', ''],
        ['Bob', 'Example', '', '-'],
      ],
    });

    repository.saveRsvpComment({
      memberId: 'bob::example',
      sessionId: 'club-rsvp__wed-mixed__2026-03-18__18:00',
      comment: 'Bin etwas später da.',
    });

    expect(gateway.updatedNotes).toContainEqual({
      sheetName: 'RSVP Übersicht',
      rowIndex: 3,
      columnIndex: 4,
      note: 'Bin etwas später da.',
    });
    expect(gateway.updatedCells).toEqual([]);
  });

  it('tracks one-time cancellation notification state in the date header note', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'single-gender',
      sheetName: 'Single Gender',
      tableRange: 'A1:G20',
      attendance: {
        dateHeaderRow: 2,
        infoRow: 1,
        firstMemberRow: 6,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'E',
      },
      trainings: [{
        trainingId: 'wed-single',
        day: 'Mittwoch',
        title: 'Single Gender Mittwoch',
        startTime: '19:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'Single Gender': [
        ['', '', '', '', 'Single Gender', 'Halle gesperrt', 'Single Gender'],
        ['', '', '', '', 'Mi. 4. 3.', 'Mi. 11. 3.', 'Mi. 18. 3.'],
        ['Zusagen', '', '', '', 22, 5, 5],
        ['FMPs', '', '', '', 10, 4, 3],
        ['(x) und ?', '', '', 'Akkreditierung', 0, 0, 0],
        ['Anna', 'Ananas', 'w', '', 'x', 'x', '-'],
      ],
    });

    expect(repository.getTrainingSessionById('single-gender__wed-single__2026-03-11__19:00')).toEqual({
      sessionId: 'single-gender__wed-single__2026-03-11__19:00',
      trainingId: 'wed-single',
      sessionDate: '2026-03-11',
      startTime: '19:00',
      additionalInfo: 'Halle gesperrt',
      status: 'Cancelled',
    });

    repository.markCancellationNotificationSent({
      sessionId: 'single-gender__wed-single__2026-03-11__19:00',
      cancelledByMemberId: 'system',
      cancelledAt: '2026-03-10T12:00:00.000Z',
      reason: 'Halle gesperrt',
    }, '2026-03-10T12:30:00.000Z');

    expect(gateway.getSheetValues(DISPATCH_METADATA_SHEET_NAME)).toEqual([
      DISPATCH_METADATA_HEADERS,
      ['single-gender__wed-single__2026-03-11__19:00', '2026-03-10T12:30:00.000Z'],
    ]);
    expect(repository.getCancellationNotificationSentAt('single-gender__wed-single__2026-03-11__19:00')).toBe('2026-03-10T12:30:00.000Z');
  });

  it('writes reminder dispatch metadata per session and offset', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:F20',
      attendance: {
        dateHeaderRow: 2,
        firstMemberRow: 6,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'E',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['', '', '', '', 'Info', ''],
        ['', '', '', '', 'Mi. 11. 3.', 'Mi. 18. 3.'],
        ['Zusagen', '', '', '', 22, 5],
        ['FMPs', '', '', '', 10, 4],
        ['(x) und ?', '', '', '', 0, 0],
        ['Alice', 'Example', 'w', '', 'x', ''],
      ],
    });

    repository.markReminderNotificationSent('club-rsvp__wed-mixed__2026-03-18__18:00', { hours: 48, minutes: 0 }, '2026-03-16T18:05:00.000Z');

    expect(gateway.getSheetValues(REMINDER_DISPATCH_METADATA_SHEET_NAME)).toEqual([
      REMINDER_DISPATCH_METADATA_HEADERS,
      ['club-rsvp__wed-mixed__2026-03-18__18:00', 2880, '2026-03-16T18:05:00.000Z'],
    ]);
    expect(repository.getReminderNotificationSentAt('club-rsvp__wed-mixed__2026-03-18__18:00', { hours: 48, minutes: 0 })).toBe('2026-03-16T18:05:00.000Z');
  });

  it('writes and reads the last successful reminder dispatch watermark', () => {
    const { gateway, repository } = createRepository([], {});

    repository.markLastSuccessfulReminderDispatchAt('2026-03-16T18:15:00.000Z');

    expect(gateway.getSheetValues(RUNTIME_METADATA_SHEET_NAME)).toEqual([
      RUNTIME_METADATA_HEADERS,
      ['runReminderDispatch:lastSuccessfulRunAt', '2026-03-16T18:15:00.000Z'],
    ]);
    expect(repository.getLastSuccessfulReminderDispatchAt()).toBe('2026-03-16T18:15:00.000Z');
  });

  it('writes an explicit cancellation marker into the configured info row', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:G20',
      attendance: {
        dateHeaderRow: 2,
        infoRow: 1,
        firstMemberRow: 6,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'E',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['', '', '', '', 'Info', '', ''],
        ['', '', '', '', 'Mi. 11. 3.', 'Mi. 18. 3.', 'Mi. 25. 3.'],
        ['Zusagen', '', '', '', 22, 5, 5],
        ['FMPs', '', '', '', 10, 4, 3],
        ['(x) und ?', '', '', 'Akkreditierung', 0, 0, 0],
        ['Anna', 'Ananas', 'w', '', 'x', 'x', '-'],
      ],
    });

    repository.cancelTrainingSession({
      sessionId: 'club-rsvp__wed-mixed__2026-03-18__18:00',
      cancelledByMemberId: 'trainer::one',
      cancelledAt: '2026-03-10T12:00:00.000Z',
      reason: 'Trainer verhindert',
    });

    expect(gateway.updatedCells).toContainEqual({
      sheetName: 'RSVP Übersicht',
      rowIndex: 1,
      columnIndex: 6,
      value: 'Training entfällt: Trainer verhindert',
    });
    expect(repository.getTrainingSessionById('club-rsvp__wed-mixed__2026-03-18__18:00')?.status).toBe('Cancelled');
  });

  it('writes tentative attendance as a tentative public-sheet marker', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        dateHeaderRow: 1,
        firstMemberRow: 2,
        firstNameColumn: 'A',
        lastNameColumn: 'B',
        startColumn: 'C',
      },
      trainings: [{
        trainingId: 'wed-mixed',
        day: 'Mittwoch',
        title: 'Mittwoch Training',
        startTime: '18:00',
      }],
    }];
    const { gateway, repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z')],
        ['Alice', 'Example', '', ''],
        ['Bob', 'Example', '', ''],
      ],
    });

    repository.saveAttendance({
      memberId: 'bob::example',
      sessionId: 'club-rsvp__wed-mixed__2026-03-18__18:00',
      rsvpStatus: 'Tentative',
    });

    expect(gateway.updatedCells).toContainEqual({
      sheetName: 'RSVP Übersicht',
      rowIndex: 3,
      columnIndex: 4,
      value: '(x)',
    });
  });
});
