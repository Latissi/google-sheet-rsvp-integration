import { SendCancellationNotificationService } from '../../application/notifications/SendCancellationNotificationService';
import { SendTrainerParticipationReportService } from '../../application/notifications/SendTrainerParticipationReportService';
import { SendTrainingReminderService } from '../../application/notifications/SendTrainingReminderService';
import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { INotificationSender } from '../../domain/ports/INotificationSender';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  AttendanceRecord,
  PublicTrainingSource,
  ReminderPolicy,
  TrainingCancellation,
  TrainingDefinition,
  TrainingSession,
  UserRecord,
  createPersonName,
  getRoleDefinition,
} from '../../domain/types';

class TestConfigurationProvider implements IConfigurationProvider {
  constructor(private readonly reminderPolicy: ReminderPolicy) {}

  getPublicSheetId(): string { return 'public-sheet'; }
  getPublicTrainingSources(): PublicTrainingSource[] { return []; }
  getReminderPolicy(): ReminderPolicy { return this.reminderPolicy; }
  getWebAppUrl(): string { return 'https://example.test/webapp'; }
}

class InMemoryUserRepository implements IUserRepository {
  constructor(private readonly users: UserRecord[]) {}

  getAllUsers(): UserRecord[] { return [...this.users]; }
  getUserByMemberId(id: string): UserRecord | null { return this.users.find(user => user.memberId === id) ?? null; }
  getUserByEmail(email: string): UserRecord | null { return this.users.find(user => user.email === email) ?? null; }
  getUserByName(name: string): UserRecord | null { return this.users.find(user => user.name === name) ?? null; }
  upsertUser(): void { throw new Error('Not needed in this test.'); }
}

class InMemoryTrainingRepository implements ITrainingDataRepository {
  constructor(
    private readonly definitions: TrainingDefinition[],
    private readonly sessions: TrainingSession[],
    private readonly attendance: AttendanceRecord[] = [],
  ) {}

  getTrainingDefinitions(): TrainingDefinition[] { return [...this.definitions]; }
  getUpcomingTrainingSessions(): TrainingSession[] { return [...this.sessions]; }
  getTrainingSessionById(sessionId: string): TrainingSession | null {
    return this.sessions.find(session => session.sessionId === sessionId) ?? null;
  }
  getAttendanceForSession(sessionId: string): AttendanceRecord[] { return this.attendance.filter(record => record.sessionId === sessionId); }
  saveAttendance(): void { throw new Error('Not needed in this test.'); }
  cancelTrainingSession(_cancellation: TrainingCancellation): void { throw new Error('Not needed in this test.'); }
}

class RecordingNotificationSender implements INotificationSender {
  public reminders: Array<{ recipientId: string; sessionId: string }> = [];
  public cancellations: Array<{ recipientId: string; sessionId: string }> = [];
  public reports: Array<{ recipientId: string; sessionId: string; attendanceCount: number }> = [];

  sendTrainingReminder(notification: { recipient: UserRecord; session: TrainingSession }): void {
    this.reminders.push({ recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }

  sendTrainingCancellation(notification: { recipient: UserRecord; session: TrainingSession }): void {
    this.cancellations.push({ recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }

  sendTrainerParticipationReport(notification: { recipient: UserRecord; session: TrainingSession; attendance: AttendanceRecord[] }): void {
    this.reports.push({
      recipientId: notification.recipient.memberId,
      sessionId: notification.session.sessionId,
      attendanceCount: notification.attendance.length,
    });
  }
}

function createUser(memberId: string, role: 'Mitglied' | 'Trainer', trainingIds: string[]): UserRecord {
  return {
    memberId,
    name: `${memberId} User`,
    email: `${memberId.toLowerCase()}@example.com`,
    role,
    roleDefinition: getRoleDefinition(role),
    personName: createPersonName(memberId, 'User'),
    subscriptions: trainingIds.map(trainingId => ({ trainingId, notificationChannel: 'email' })),
    subscribedTrainingIds: trainingIds,
    subscribedTrainings: ['Mittwoch'],
  };
}

describe('Notification application services', () => {
  const definitions: TrainingDefinition[] = [{
    trainingId: 'wed-mixed',
    title: 'Outdoor Mittwoch',
    day: 'Mittwoch',
    startTime: '18:00',
    environment: 'Outdoor',
    audience: 'Mixed',
  }];
  const sessions: TrainingSession[] = [{
    sessionId: 'session-1',
    trainingId: 'wed-mixed',
    sessionDate: '2026-03-11',
    startTime: '18:00',
    status: 'Scheduled',
  }];

  it('sends reminders only to subscribed users without RSVP', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions, [{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
      metadata: {
        source: 'email-rsvp',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
    }]);
    const userRepository = new InMemoryUserRepository([
      createUser('M001', 'Mitglied', ['wed-mixed']),
      createUser('M002', 'Mitglied', ['wed-mixed']),
      createUser('M003', 'Mitglied', ['fri-outdoor']),
    ]);
    const configProvider = new TestConfigurationProvider({
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    const sender = new RecordingNotificationSender();
    const service = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, sender);

    const result = service.execute({
      dispatchAt: '2026-03-09T18:00:00.000Z',
      toleranceMinutes: 1,
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.sentCount).toBe(1);
    expect(sender.reminders).toEqual([{ recipientId: 'M002', sessionId: 'session-1' }]);
  });

  it('sends cancellation notifications to subscribed users', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([
      createUser('M001', 'Mitglied', ['wed-mixed']),
      createUser('M002', 'Mitglied', ['fri-outdoor']),
      createUser('T001', 'Trainer', ['wed-mixed']),
    ]);
    const sender = new RecordingNotificationSender();
    const service = new SendCancellationNotificationService(trainingRepository, userRepository, sender);

    const result = service.execute({
      cancellation: {
        sessionId: 'session-1',
        cancelledByMemberId: 'T001',
        cancelledAt: '2026-03-09T10:00:00.000Z',
      },
    });

    expect(result.sentCount).toBe(2);
    expect(sender.cancellations).toEqual([
      { recipientId: 'M001', sessionId: 'session-1' },
      { recipientId: 'T001', sessionId: 'session-1' },
    ]);
  });

  it('sends trainer participation reports only to trainer recipients', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions, [
      {
        memberId: 'M001',
        sessionId: 'session-1',
        rsvpStatus: 'Accepted',
        metadata: { source: 'email-rsvp', updatedAt: '2026-03-09T10:00:00.000Z' },
      },
      {
        memberId: 'M002',
        sessionId: 'session-1',
        rsvpStatus: 'Declined',
        metadata: { source: 'email-rsvp', updatedAt: '2026-03-09T11:00:00.000Z' },
      },
    ]);
    const userRepository = new InMemoryUserRepository([
      createUser('M001', 'Mitglied', ['wed-mixed']),
      createUser('T001', 'Trainer', ['wed-mixed']),
      createUser('T002', 'Trainer', ['fri-outdoor']),
    ]);
    const sender = new RecordingNotificationSender();
    const service = new SendTrainerParticipationReportService(trainingRepository, userRepository, sender);

    const result = service.execute({ sessionId: 'session-1' });

    expect(result.trainerCount).toBe(1);
    expect(result.attendanceCount).toBe(2);
    expect(sender.reports).toEqual([
      { recipientId: 'T001', sessionId: 'session-1', attendanceCount: 2 },
    ]);
  });
});