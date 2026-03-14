import { MailMessage, MailNotificationSender, IMailTransport } from '../../../infrastructure/adapters/MailNotificationSender';
import { EnvironmentAwareNotificationSender } from '../../../infrastructure/adapters/EnvironmentAwareNotificationSender';
import {
  AttendanceRecord,
  TrainerParticipationReportNotification,
  TrainingCancellationNotification,
  TrainingDefinition,
  TrainingReminderNotification,
  TrainingSession,
  UserRecord,
  createPersonName,
  getRoleDefinition,
} from '../../../domain/types';

class RecordingMailTransport implements IMailTransport {
  public readonly sentMessages: MailMessage[] = [];

  sendEmail(message: MailMessage): void {
    this.sentMessages.push(message);
  }
}

function createUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    memberId: 'M001',
    name: 'Max Mustermann',
    email: 'max@example.com',
    role: 'Mitglied',
    roleDefinition: getRoleDefinition('Mitglied'),
    personName: createPersonName('Max', 'Mustermann'),
    subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
    subscribedTrainingIds: ['wed-mixed'],
    subscribedTrainings: ['Mittwoch'],
    ...overrides,
  };
}

function createSession(overrides: Partial<TrainingSession> = {}): TrainingSession {
  return {
    sessionId: 'session-1',
    trainingId: 'wed-mixed',
    sessionDate: '2026-03-11',
    startTime: '18:00',
    endTime: '19:30',
    location: 'Sporthalle',
    status: 'Scheduled',
    ...overrides,
  };
}

function createTraining(overrides: Partial<TrainingDefinition> = {}): TrainingDefinition {
  return {
    trainingId: 'wed-mixed',
    title: 'Outdoor Mittwoch',
    day: 'Mittwoch',
    startTime: '18:00',
    endTime: '19:30',
    location: 'Sporthalle',
    environment: 'Outdoor',
    audience: 'Mixed',
    ...overrides,
  };
}

describe('MailNotificationSender', () => {
  it('sends reminder emails to the actual recipient in prod', () => {
    const transport = new RecordingMailTransport();
    const sender = new MailNotificationSender({}, transport);
    const notification: TrainingReminderNotification = {
      recipient: createUser(),
      session: createSession(),
      training: createTraining(),
      webAppUrl: 'https://example.test/webapp',
    };

    sender.sendTrainingReminder(notification);

    expect(transport.sentMessages).toHaveLength(1);
    expect(transport.sentMessages[0].to).toBe('max@example.com');
    expect(transport.sentMessages[0].subject).toContain('Erinnerung');
    expect(transport.sentMessages[0].body).toContain('response=Accepted');
    expect(transport.sentMessages[0].body).toContain('response=Declined');
    expect(transport.sentMessages[0].body).toContain('Umgebung: Outdoor');
  });

  it('redirects all emails to the trainer address outside prod', () => {
    const transport = new RecordingMailTransport();
    const sender = new EnvironmentAwareNotificationSender(
      { ENV: 'dev', TRAINER_EMAIL: 'trainer@example.com' },
      new MailNotificationSender({}, transport),
    );
    const notification: TrainingCancellationNotification = {
      recipient: createUser(),
      session: createSession(),
      training: createTraining(),
      cancellation: {
        sessionId: 'session-1',
        cancelledByMemberId: 'T001',
        cancelledAt: '2026-03-09T08:00:00.000Z',
        reason: 'Unwetter',
      },
    };

    sender.sendTrainingCancellation(notification);

    expect(transport.sentMessages).toHaveLength(1);
    expect(transport.sentMessages[0].to).toBe('trainer@example.com');
    expect(transport.sentMessages[0].subject).toContain('Absage');
    expect(transport.sentMessages[0].body).toContain('Grund: Unwetter');
  });

  it('summarizes participation counts for trainer reports', () => {
    const transport = new RecordingMailTransport();
    const sender = new MailNotificationSender({}, transport);
    const attendance: AttendanceRecord[] = [
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
      {
        memberId: 'M003',
        sessionId: 'session-1',
        rsvpStatus: 'Accepted',
        metadata: { source: 'email-rsvp', updatedAt: '2026-03-09T12:00:00.000Z' },
      },
    ];
    const notification: TrainerParticipationReportNotification = {
      recipient: createUser({
        memberId: 'T001',
        email: 'trainer@example.com',
        role: 'Trainer',
        roleDefinition: getRoleDefinition('Trainer'),
      }),
      session: createSession(),
      training: createTraining(),
      attendance,
    };

    sender.sendTrainerParticipationReport(notification);

    expect(transport.sentMessages).toHaveLength(1);
    expect(transport.sentMessages[0].subject).toContain('Beteiligungsreport');
    expect(transport.sentMessages[0].body).toContain('Zusagen: 2');
    expect(transport.sentMessages[0].body).toContain('Absagen: 1');
    expect(transport.sentMessages[0].body).toContain('Rückmeldungen gesamt: 3');
  });
});