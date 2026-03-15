import { IConfigurationProvider } from '../../../domain/ports/IConfigurationProvider';
import { IUserRepository } from '../../../domain/ports/IUserRepository';
import {
  PublicTrainingSource,
  ReminderPolicy,
  UserRecord,
  createCompositeMemberId,
  createPersonName,
  getRoleDefinition,
} from '../../../domain/types';
import { GoogleSheetTrainingDataRepository } from '../../../infrastructure/adapters/GoogleSheetTrainingDataRepository';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';

class TestConfigurationProvider implements IConfigurationProvider {
  constructor(private readonly sources: PublicTrainingSource[]) {}

  getPublicSheetId(): string {
    return 'public-sheet';
  }

  getPublicTrainingSources(): PublicTrainingSource[] {
    return this.sources;
  }

  getReminderPolicy(): ReminderPolicy {
    return { offsets: [], channels: ['email'] };
  }

  getWebAppUrl(): string {
    return 'https://example.test/webapp';
  }
}

class TestUserRepository implements IUserRepository {
  constructor(private readonly users: UserRecord[]) {}

  getAllUsers(): UserRecord[] { return [...this.users]; }
  getUserByMemberId(id: string): UserRecord | null { return this.users.find(user => user.memberId === id) ?? null; }
  getUserByEmail(email: string): UserRecord | null { return this.users.find(user => user.email === email) ?? null; }
  getUserByName(name: string): UserRecord | null { return this.users.find(user => user.name === name) ?? null; }
  upsertUser(): void { throw new Error('Not needed in this test.'); }
}

function createUser(memberId: string, name: string, role: 'Mitglied' | 'Trainer' = 'Mitglied'): UserRecord {
  const [firstName, ...rest] = name.split(' ');
  return {
    memberId,
    name,
    email: `${memberId.toLowerCase()}@example.com`,
    role,
    roleDefinition: getRoleDefinition(role),
    personName: createPersonName(firstName ?? '', rest.join(' ')),
    subscriptions: [],
    subscribedTrainingIds: [],
    subscribedTrainings: [],
  };
}

describe('GoogleSheetTrainingDataRepository', () => {
  const fixedNow = () => new Date('2026-03-15T00:00:00.000Z');
  const users = [
    createUser(createCompositeMemberId('Alice', 'Example'), 'Alice Example'),
    createUser(createCompositeMemberId('Bob', 'Example'), 'Bob Example'),
    createUser(createCompositeMemberId('Charlie', 'Coach'), 'Charlie Coach', 'Trainer'),
    createUser(createCompositeMemberId('Anna', 'Ananas'), 'Anna Ananas'),
  ];

  function createRepository(sources: PublicTrainingSource[], sheets: Record<string, unknown[][]>) {
    const gateway = new MockSheetGateway(sheets);
    const repository = new GoogleSheetTrainingDataRepository(
      gateway,
      new TestConfigurationProvider(sources),
      new TestUserRepository(users),
      fixedNow,
    );

    return { gateway, repository };
  }

  it('parses simple member-row sheets with explicit dateHeaderRow and firstMemberRow', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:E10',
      attendance: {
        layout: 'member-rows',
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

  it('reads attendance and metadata from simple member rows', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        layout: 'member-rows',
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
    gateway.setCellNote('RSVP Übersicht', 2, 3, '{"source":"email-rsvp","updatedAt":"2026-03-09T10:00:00.000Z"}');

    expect(repository.getAttendanceForSession('club-rsvp__wed-mixed__2026-03-11__18:00')).toEqual([
      {
        memberId: 'alice::example',
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        rsvpStatus: 'Accepted',
        metadata: {
          source: 'email-rsvp',
          updatedAt: '2026-03-09T10:00:00.000Z',
        },
      },
      {
        memberId: 'charlie::coach',
        sessionId: 'club-rsvp__wed-mixed__2026-03-11__18:00',
        rsvpStatus: 'Declined',
        metadata: {
          source: 'manual',
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      },
    ]);
  });

  it('reuses the loaded public sheet within one repository instance', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        layout: 'member-rows',
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
        layout: 'member-rows',
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
        audience: 'SingleGender',
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
        metadata: {
          source: 'manual',
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      },
    ]);
  });

  it('parses the second public-sheet variant with multiple weekdays in one source', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'mixed-weekdays',
      sheetName: 'Mixed Weekdays',
      tableRange: 'A1:G20',
      attendance: {
        layout: 'member-rows',
        dateHeaderRow: 2,
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
        ['Zeile nicht entfernen!', '', '', '', 'Halle gesperrt', '', ''],
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
        status: 'Scheduled',
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
        metadata: {
          source: 'manual',
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      },
    ]);
  });

  it('saves RSVP state back into the configured member rows', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:D10',
      attendance: {
        layout: 'member-rows',
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
      metadata: {
        source: 'email-rsvp',
        updatedAt: '2026-03-10T09:00:00.000Z',
      },
    });

    expect(gateway.updatedCells).toContainEqual({
      sheetName: 'RSVP Übersicht',
      rowIndex: 3,
      columnIndex: 4,
      value: '-',
    });
    expect(gateway.getCellNote('RSVP Übersicht', 3, 4)).toBe('{"source":"email-rsvp","updatedAt":"2026-03-10T09:00:00.000Z"}');
  });

  it('marks a session as cancelled on the configured date header row', () => {
    const sources: PublicTrainingSource[] = [{
      sourceId: 'single-gender',
      sheetName: 'Single Gender',
      tableRange: 'A1:G20',
      attendance: {
        layout: 'member-rows',
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
    const { gateway, repository } = createRepository(sources, {
      'Single Gender': [
        ['', '', '', '', 'Single Gender', '', 'Single Gender'],
        ['', '', '', '', 'Mi. 4. 3.', 'Mi. 11. 3.', 'Mi. 18. 3.'],
        ['Zusagen', '', '', '', 22, 5, 5],
        ['FMPs', '', '', '', 10, 4, 3],
        ['(x) und ?', '', '', 'Akkreditierung', 0, 0, 0],
        ['Anna', 'Ananas', 'w', '', 'x', 'x', '-'],
      ],
    });

    repository.cancelTrainingSession({
      sessionId: 'single-gender__wed-single__2026-03-11__19:00',
      cancelledByMemberId: 'anna::ananas',
      cancelledAt: '2026-03-10T12:00:00.000Z',
      reason: 'Unwetter',
    });

    expect(gateway.getCellNote('Single Gender', 2, 6)).toBe('{"cancelledAt":"2026-03-10T12:00:00.000Z","cancelledByMemberId":"anna::ananas","reason":"Unwetter"}');
    expect(repository.getTrainingSessionById('single-gender__wed-single__2026-03-11__19:00')).toEqual({
      sessionId: 'single-gender__wed-single__2026-03-11__19:00',
      trainingId: 'wed-single',
      sessionDate: '2026-03-11',
      startTime: '19:00',
      status: 'Cancelled',
    });
  });
});
