import { SubmitRsvpService } from '../../application/rsvp/SubmitRsvpService';
import { SyncAttendanceService } from '../../application/rsvp/SyncAttendanceService';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
  ReminderOffset,
  TrainingDefinition,
  TrainingSession,
  UserRecord,
  createPersonName,
  getRoleDefinition,
  getReminderOffsetMinutes,
} from '../../domain/types';

class InMemoryUserRepository implements IUserRepository {
  constructor(private readonly users: UserRecord[]) {}

  getAllUsers(): UserRecord[] { return [...this.users]; }
  getUserByMemberId(id: string): UserRecord | null { return this.users.find(user => user.memberId === id) ?? null; }
  getUserByEmail(email: string): UserRecord | null { return this.users.find(user => user.email === email) ?? null; }
  getUserByName(name: string): UserRecord | null { return this.users.find(user => user.name === name) ?? null; }
  upsertUser(user: UserRecord): void {
    const index = this.users.findIndex(existing => existing.memberId === user.memberId);
    if (index >= 0) {
      this.users[index] = user;
    }
  }
}

class InMemoryTrainingRepository implements ITrainingDataRepository {
  public attendance: AttendanceRecord[] = [];
  public cancellationNotificationSentAt = new Map<string, string>();
  public reminderNotificationSentAt = new Map<string, string>();
  public lastSuccessfulReminderDispatchAt: string | null = null;

  constructor(
    private readonly definitions: TrainingDefinition[],
    private readonly sessions: TrainingSession[],
  ) {}

  getTrainingDefinitions(): TrainingDefinition[] { return [...this.definitions]; }
  getUpcomingTrainingSessions(): TrainingSession[] { return [...this.sessions]; }
  getTrainingSessionById(sessionId: string): TrainingSession | null {
    return this.sessions.find(session => session.sessionId === sessionId) ?? null;
  }
  getAttendanceForSession(sessionId: string): AttendanceRecord[] { return this.attendance.filter(record => record.sessionId === sessionId); }
  getCancellationNotificationSentAt(sessionId: string): string | null {
    return this.cancellationNotificationSentAt.get(sessionId) ?? null;
  }
  getReminderNotificationSentAt(sessionId: string, offset: ReminderOffset): string | null {
    return this.reminderNotificationSentAt.get(`${sessionId}::${getReminderOffsetMinutes(offset)}`) ?? null;
  }
  getLastSuccessfulReminderDispatchAt(): string | null {
    return this.lastSuccessfulReminderDispatchAt;
  }
  cancelTrainingSession(): void {
    throw new Error('Not needed in this test.');
  }
  saveAttendance(record: AttendanceRecord): void {
    const index = this.attendance.findIndex(existing => existing.sessionId === record.sessionId && existing.memberId === record.memberId);
    if (index >= 0) {
      this.attendance[index] = record;
      return;
    }
    this.attendance.push(record);
  }
  markCancellationNotificationSent(cancellation: { sessionId: string }, notifiedAt: string): void {
    this.cancellationNotificationSentAt.set(cancellation.sessionId, notifiedAt);
  }
  markReminderNotificationSent(sessionId: string, offset: ReminderOffset, notifiedAt: string): void {
    this.reminderNotificationSentAt.set(`${sessionId}::${getReminderOffsetMinutes(offset)}`, notifiedAt);
  }
  markLastSuccessfulReminderDispatchAt(completedAt: string): void {
    this.lastSuccessfulReminderDispatchAt = completedAt;
  }
}

function createUser(memberId: string, role: 'Mitglied' | 'Trainer'): UserRecord {
  return {
    memberId,
    name: `${memberId} User`,
    email: `${memberId.toLowerCase()}@example.com`,
    role,
    roleDefinition: getRoleDefinition(role),
    personName: createPersonName(memberId, 'User'),
    subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
    subscribedTrainingIds: ['wed-mixed'],
    subscribedTrainings: ['Mittwoch'],
  };
}

describe('RSVP application services', () => {
  const definitions: TrainingDefinition[] = [{
    trainingId: 'wed-mixed',
    title: 'Outdoor Mittwoch',
    day: 'Mittwoch',
    startTime: '18:00',
    environment: 'Outdoor',
  }];
  const sessions: TrainingSession[] = [{
    sessionId: 'session-1',
    trainingId: 'wed-mixed',
    sessionDate: '2026-03-11',
    startTime: '18:00',
    status: 'Scheduled',
  }];

  it('stores an RSVP from an eligible user', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([createUser('M001', 'Mitglied')]);
    const service = new SubmitRsvpService(trainingRepository, userRepository, new SyncAttendanceService(trainingRepository));

    const result = service.execute({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
      respondedAt: '2026-03-09T10:00:00.000Z',
    });

    expect(result.attendance.metadata.source).toBe('email-rsvp');
    expect(trainingRepository.getAttendanceForSession('session-1')).toHaveLength(1);
  });

  it('does not overwrite a newer manual attendance update', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    trainingRepository.attendance.push({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
      metadata: {
        source: 'manual',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
    });
    const service = new SyncAttendanceService(trainingRepository);

    const result = service.execute({
      record: {
        memberId: 'M001',
        sessionId: 'session-1',
        rsvpStatus: 'Declined',
        metadata: {
          source: 'email-rsvp',
          updatedAt: '2026-03-09T09:00:00.000Z',
        },
      },
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('older-update');
    expect(trainingRepository.getAttendanceForSession('session-1')[0].rsvpStatus).toBe('Accepted');
  });

  it('rejects RSVP for cancelled sessions', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const cancelledSessions: TrainingSession[] = [{
      ...sessions[0],
      status: 'Cancelled',
      additionalInfo: 'Halle gesperrt',
    }];
    const cancelledRepository = new InMemoryTrainingRepository(definitions, cancelledSessions);
    const userRepository = new InMemoryUserRepository([createUser('M001', 'Mitglied')]);
    const service = new SubmitRsvpService(cancelledRepository, userRepository, new SyncAttendanceService(cancelledRepository));

    expect(() => service.execute({
      sessionId: 'session-1',
      memberId: 'M001',
      rsvpStatus: 'Accepted',
      respondedAt: '2026-03-09T10:00:00.000Z',
    })).toThrow('Training session "session-1" is cancelled.');
  });
});