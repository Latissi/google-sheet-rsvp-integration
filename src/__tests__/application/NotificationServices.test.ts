import { CancelTrainingSessionService } from '../../application/training/CancelTrainingSessionService';
import { SendCancellationNotificationService } from '../../application/notifications/SendCancellationNotificationService';
import { SendTrainingReminderService } from '../../application/notifications/SendTrainingReminderService';
import { TrainingDefinition, TrainingSession, UserRecord } from '../../domain/types';
import { InMemoryUserRepository } from '../mocks/InMemoryUserRepository';
import { InMemoryTrainingRepository } from '../mocks/InMemoryTrainingRepository';
import { RecordingNotificationSender } from '../mocks/RecordingNotificationSender';
import { TestConfigurationProvider } from '../mocks/TestConfigurationProvider';
import { createUser } from '../mocks/testUserFactory';


describe('Notification application services', () => {
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

  it('sends reminders only to subscribed users without RSVP', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions, [{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    }]);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M002', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M003', role: 'Mitglied', trainingIds: ['fri-outdoor'] }),
    ]);
    const configProvider = new TestConfigurationProvider([], {
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    const sender = new RecordingNotificationSender();
    const service = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, sender);

    const result = service.execute({
      dispatchAt: '2026-03-09T18:00:00.000Z',
    });

    expect(result.sessionsProcessed).toBe(1);
    expect(result.sentCount).toBe(1);
    expect(sender.reminders).toEqual([{ recipientId: 'M002', sessionId: 'session-1' }]);
  });

  it('sends reminders whose due time falls inside the elapsed interval since the last successful run', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    trainingRepository.markLastSuccessfulReminderDispatchAt('2026-03-09T17:59:00.000Z');
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
    ]);
    const configProvider = new TestConfigurationProvider([], {
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    const sender = new RecordingNotificationSender();
    const service = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, sender);

    const result = service.execute({
      dispatchAt: '2026-03-09T18:14:00.000Z',
    });

    expect(result).toEqual({
      sessionsProcessed: 1,
      sentCount: 1,
      errorCount: 0,
      pendingCancellations: [],
    });
    expect(sender.reminders).toEqual([{ recipientId: 'M001', sessionId: 'session-1' }]);
  });

  it('does not resend the same reminder offset on repeated runs', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
    ]);
    const configProvider = new TestConfigurationProvider([], {
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    const sender = new RecordingNotificationSender();
    const service = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, sender);

    const first = service.execute({
      dispatchAt: '2026-03-09T18:00:00.000Z',
    });
    const second = service.execute({
      dispatchAt: '2026-03-09T18:10:00.000Z',
      fallbackWindowMinutes: 15,
    });

    expect(first).toEqual({
      sessionsProcessed: 1,
      sentCount: 1,
      errorCount: 0,
      pendingCancellations: [],
    });
    expect(second).toEqual({
      sessionsProcessed: 0,
      sentCount: 0,
      errorCount: 0,
      pendingCancellations: [],
    });
    expect(sender.reminders).toEqual([{ recipientId: 'M001', sessionId: 'session-1' }]);
  });

  it('sends cancellation notifications to subscribed users', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M002', role: 'Mitglied', trainingIds: ['fri-outdoor'] }),
      createUser({ memberId: 'T001', role: 'Trainer', trainingIds: ['wed-mixed'] }),
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

    expect(service.execute({
      cancellation: {
        sessionId: 'session-1',
        cancelledByMemberId: 'T001',
        cancelledAt: '2026-03-09T10:00:00.000Z',
      },
    })).toEqual({ sentCount: 0 });
  });

  it('cancels a training immediately when triggered by a trainer', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, [{ ...sessions[0] }]);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'T001', role: 'Trainer', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
    ]);
    const sender = new RecordingNotificationSender();
    const notificationService = new SendCancellationNotificationService(trainingRepository, userRepository, sender);
    const service = new CancelTrainingSessionService(trainingRepository, userRepository, notificationService);

    const result = service.execute({
      memberId: 'T001',
      sessionId: 'session-1',
      cancelledAt: '2026-03-09T10:00:00.000Z',
    });

    expect(result).toEqual({
      sentCount: 2,
      alreadyCancelled: false,
    });
    expect(trainingRepository.getTrainingSessionById('session-1')?.status).toBe('Cancelled');
    expect(sender.cancellations).toEqual([
      { recipientId: 'T001', sessionId: 'session-1' },
      { recipientId: 'M001', sessionId: 'session-1' },
    ]);
  });

  it('returns pending cancellations instead of sending them inline', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, [{
      ...sessions[0],
      status: 'Cancelled',
      additionalInfo: 'Halle gesperrt',
    }]);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M002', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
    ]);
    const configProvider = new TestConfigurationProvider([], {
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    const sender = new RecordingNotificationSender();
    const reminderService = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, sender);
    const cancellationService = new SendCancellationNotificationService(trainingRepository, userRepository, sender);

    const firstResult = reminderService.execute({ dispatchAt: '2026-03-09T18:00:00.000Z' });
    expect(firstResult.sessionsProcessed).toBe(0);
    expect(firstResult.sentCount).toBe(0);
    expect(firstResult.pendingCancellations).toHaveLength(1);
    expect(sender.cancellations).toEqual([]);

    // Caller processes pending cancellations
    for (const cancellation of firstResult.pendingCancellations) {
      cancellationService.execute({ cancellation });
    }
    expect(sender.cancellations).toEqual([
      { recipientId: 'M001', sessionId: 'session-1' },
      { recipientId: 'M002', sessionId: 'session-1' },
    ]);

    // Second run: cancellation already sent, no pending
    const secondResult = reminderService.execute({ dispatchAt: '2026-03-09T18:05:00.000Z' });
    expect(secondResult.pendingCancellations).toHaveLength(0);
    expect(sender.cancellations).toHaveLength(2);
  });

  it('reminder service sends reminders inline; cancellations are returned as pending', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, [
      {
        sessionId: 'session-cancelled',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-11',
        startTime: '18:00',
        status: 'Cancelled',
        additionalInfo: 'Halle gesperrt',
      },
      {
        sessionId: 'session-scheduled',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-11',
        startTime: '18:00',
        status: 'Scheduled',
      },
    ]);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
    ]);
    const configProvider = new TestConfigurationProvider([], {
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    const sender = new RecordingNotificationSender();
    const reminderService = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, sender);
    const cancellationService = new SendCancellationNotificationService(trainingRepository, userRepository, sender);

    const result = reminderService.execute({ dispatchAt: '2026-03-09T18:00:00.000Z' });

    // Reminder service only sends the reminder; cancellation is pending
    expect(result.sessionsProcessed).toBe(1);
    expect(result.sentCount).toBe(1);
    expect(result.pendingCancellations).toHaveLength(1);
    expect(sender.reminders).toEqual([{ recipientId: 'M001', sessionId: 'session-scheduled' }]);
    expect(sender.cancellations).toEqual([]);

    // Dispatch runner processes pending cancellations after
    for (const cancellation of result.pendingCancellations) {
      cancellationService.execute({ cancellation });
    }
    expect(sender.events).toEqual([
      { type: 'reminder', recipientId: 'M001', sessionId: 'session-scheduled' },
      { type: 'cancellation', recipientId: 'M001', sessionId: 'session-cancelled' },
    ]);
  });

  it('isolates per-user send errors: continues remaining users and still marks the offset as sent', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([
      createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M002', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
      createUser({ memberId: 'M003', role: 'Mitglied', trainingIds: ['wed-mixed'] }),
    ]);
    const configProvider = new TestConfigurationProvider([], {
      offsets: [{ hours: 48, minutes: 0 }],
      channels: ['email'],
    });
    let callCount = 0;
    const failingOnSecondSender = {
      sendTrainingReminder: jest.fn().mockImplementation(() => {
        callCount += 1;
        if (callCount === 2) throw new Error('quota exhausted');
      }),
      sendTrainingCancellation: jest.fn(),
    };
    const service = new SendTrainingReminderService(trainingRepository, userRepository, configProvider, failingOnSecondSender);

    const result = service.execute({ dispatchAt: '2026-03-09T18:00:00.000Z' });

    // M001 and M003 succeed; M002 (2nd call) fails
    expect(result.sentCount).toBe(2);
    expect(result.errorCount).toBe(1);
    expect(result.sessionsProcessed).toBe(1);
    expect(failingOnSecondSender.sendTrainingReminder).toHaveBeenCalledTimes(3);

    // The offset is marked sent so the next trigger run does not retry any user
    expect(trainingRepository.getReminderNotificationSentAt('session-1', { hours: 48, minutes: 0 })).not.toBeNull();
  });
});