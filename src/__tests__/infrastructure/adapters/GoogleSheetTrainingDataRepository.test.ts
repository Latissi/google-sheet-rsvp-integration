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
    subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
    subscribedTrainingIds: ['wed-mixed'],
    subscribedTrainings: ['Mittwoch'],
  };
}

describe('GoogleSheetTrainingDataRepository', () => {
  const users = [
    createUser(createCompositeMemberId('Alice', 'Example'), 'Alice Example'),
    createUser(createCompositeMemberId('Bob', 'Example'), 'Bob Example'),
    createUser(createCompositeMemberId('Charlie', 'Coach'), 'Charlie Coach', 'Trainer'),
  ];

  const sources: PublicTrainingSource[] = [{
    sourceId: 'outdoor-main',
    spreadsheetId: 'public-sheet',
    sheetName: 'Outdoor Trainings',
    tableRange: 'A1:L10',
    attendance: {
      startColumn: 'G',
      metadataColumn: 'F',
    },
    trainings: [{
      trainingId: 'wed-mixed',
      day: 'Mittwoch',
      environment: 'Outdoor',
      audience: 'Mixed',
      title: 'Outdoor Mittwoch',
    }],
  }];

  function createRepository(sheetData?: unknown[][]) {
    const gateway = new MockSheetGateway({
      'Outdoor Trainings': sheetData ?? [
        ['SessionId', 'Date', 'StartTime', 'Location', 'Status', 'AttendanceMetadata', 'Alice Example', 'Bob Example', 'Charlie Coach', 'Notes'],
        ['session-1', '2026-03-11', '18:00', 'Sporthalle', 'Scheduled', '{"alice::example":{"source":"email-rsvp","updatedAt":"2026-03-09T10:00:00.000Z"}}', 'Accepted', '', 'Declined', ''],
        ['session-2', '2026-03-18', '18:00', 'Sporthalle', 'Scheduled', '', '', '', '', ''],
      ],
    });
    const repository = new GoogleSheetTrainingDataRepository(
      gateway,
      new TestConfigurationProvider(sources),
      new TestUserRepository(users),
    );

    return { gateway, repository };
  }

  it('parses training definitions and sessions from the public sheet', () => {
    const { repository } = createRepository();

    expect(repository.getTrainingDefinitions()).toEqual([
      {
        trainingId: 'wed-mixed',
        title: 'Outdoor Mittwoch',
        day: 'Mittwoch',
        startTime: '18:00',
        location: 'Sporthalle',
        environment: 'Outdoor',
        audience: 'Mixed',
      },
    ]);

    expect(repository.getUpcomingTrainingSessions()).toEqual([
      {
        sessionId: 'session-1',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-11',
        startTime: '18:00',
        location: 'Sporthalle',
        status: 'Scheduled',
      },
      {
        sessionId: 'session-2',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-18',
        startTime: '18:00',
        location: 'Sporthalle',
        status: 'Scheduled',
      },
    ]);
  });

  it('maps attendance columns by public names and reads metadata from the hidden metadata column', () => {
    const { repository } = createRepository();

    expect(repository.getAttendanceForSession('session-1')).toEqual([
      {
        memberId: 'alice::example',
        sessionId: 'session-1',
        rsvpStatus: 'Accepted',
        metadata: {
          source: 'email-rsvp',
          updatedAt: '2026-03-09T10:00:00.000Z',
        },
      },
      {
        memberId: 'charlie::coach',
        sessionId: 'session-1',
        rsvpStatus: 'Declined',
        metadata: {
          source: 'manual',
          updatedAt: '1970-01-01T00:00:00.000Z',
        },
      },
    ]);
  });

  it('matches public attendance headers even when they contain symbols or emoji', () => {
    const symbolUsers = [
      createUser(createCompositeMemberId('Carla', 'Sommer'), 'Carla Sommer'),
    ];
    const gateway = new MockSheetGateway({
      'Outdoor Trainings': [
        ['SessionId', 'Date', 'StartTime', 'Location', 'Status', 'AttendanceMetadata', 'Carla 🌞 Sommer✨'],
        ['session-1', '2026-03-11', '18:00', 'Sporthalle', 'Scheduled', '{"carla::sommer":{"source":"email-rsvp","updatedAt":"2026-03-09T10:00:00.000Z"}}', 'Accepted'],
      ],
    });
    const repository = new GoogleSheetTrainingDataRepository(
      gateway,
      new TestConfigurationProvider(sources),
      new TestUserRepository(symbolUsers),
    );

    expect(repository.getAttendanceForSession('session-1')).toEqual([
      {
        memberId: 'carla::sommer',
        sessionId: 'session-1',
        rsvpStatus: 'Accepted',
        metadata: {
          source: 'email-rsvp',
          updatedAt: '2026-03-09T10:00:00.000Z',
        },
      },
    ]);
  });

  it('saves RSVP state back into the attendance cell and metadata JSON', () => {
    const { gateway, repository } = createRepository();

    repository.saveAttendance({
      memberId: 'bob::example',
      sessionId: 'session-2',
      rsvpStatus: 'Accepted',
      metadata: {
        source: 'email-rsvp',
        updatedAt: '2026-03-10T09:00:00.000Z',
      },
    });

    expect(gateway.updatedRows).toHaveLength(1);
    expect(gateway.updatedRows[0].rowIndex).toBe(3);
    expect(gateway.updatedRows[0].values[7]).toBe('Accepted');
    expect(gateway.updatedRows[0].values[5]).toBe('{"bob::example":{"source":"email-rsvp","updatedAt":"2026-03-10T09:00:00.000Z"}}');
  });

  it('marks a session as cancelled in the public sheet', () => {
    const { gateway, repository } = createRepository([
      ['SessionId', 'Date', 'StartTime', 'Location', 'Status', 'AttendanceMetadata', 'Alice Example', 'Bob Example', 'Charlie Coach', 'CancelledAt', 'CancelledByMemberId', 'CancellationReason'],
      ['session-1', '2026-03-11', '18:00', 'Sporthalle', 'Scheduled', '', '', '', '', '', '', ''],
    ]);

    repository.cancelTrainingSession({
      sessionId: 'session-1',
      cancelledByMemberId: 'charlie::coach',
      cancelledAt: '2026-03-10T12:00:00.000Z',
      reason: 'Unwetter',
    });

    expect(gateway.updatedRows).toHaveLength(1);
    expect(gateway.updatedRows[0].values[4]).toBe('Cancelled');
    expect(gateway.updatedRows[0].values[9]).toBe('2026-03-10T12:00:00.000Z');
    expect(gateway.updatedRows[0].values[10]).toBe('charlie::coach');
    expect(gateway.updatedRows[0].values[11]).toBe('Unwetter');
  });

  it('parses member-row layouts with name columns on the left and date columns on the right', () => {
    const memberRowSources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      spreadsheetId: 'public-sheet',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:E10',
      attendance: {
        layout: 'member-rows',
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
    const gateway = new MockSheetGateway({
      'RSVP Übersicht': [
        ['FirstName', 'LastName', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z'), 'Notiz'],
        ['Alice', 'Example', 'x', '-', ''],
        ['Bob', 'Example', '', 'x', ''],
        ['Charlie', 'Coach', '-', '', ''],
      ],
    });
    gateway.setCellNote('RSVP Übersicht', 2, 3, '{"source":"email-rsvp","updatedAt":"2026-03-09T10:00:00.000Z"}');
    const repository = new GoogleSheetTrainingDataRepository(
      gateway,
      new TestConfigurationProvider(memberRowSources),
      new TestUserRepository(users),
    );

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

  it('saves RSVP state back into a member-row attendance cell using x and -', () => {
    const memberRowSources: PublicTrainingSource[] = [{
      sourceId: 'club-rsvp',
      spreadsheetId: 'public-sheet',
      sheetName: 'RSVP Übersicht',
      tableRange: 'A1:E10',
      attendance: {
        layout: 'member-rows',
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
    const gateway = new MockSheetGateway({
      'RSVP Übersicht': [
        ['FirstName', 'LastName', new Date('2026-03-11T00:00:00.000Z'), new Date('2026-03-18T00:00:00.000Z')],
        ['Alice', 'Example', '', ''],
        ['Bob', 'Example', '', ''],
      ],
    });
    const repository = new GoogleSheetTrainingDataRepository(
      gateway,
      new TestConfigurationProvider(memberRowSources),
      new TestUserRepository(users),
    );

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
});