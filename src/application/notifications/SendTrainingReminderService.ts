import { IApplicationService } from '../IApplicationService';
import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { INotificationSender } from '../../domain/ports/INotificationSender';
import { ReminderOffset, TrainingCancellation, TrainingSession } from '../../domain/types';
import {
  indexTrainingDefinitions,
  getDueReminderOffset,
  getReminderWindowStart,
  assertValidDate,
  getSessionStartDate,
} from './notificationUtils';

export interface SendTrainingReminderRequest {
  dispatchAt: string;
  fallbackWindowMinutes?: number;
  sessionIds?: string[];
}

export interface SendTrainingReminderResult {
  sessionsProcessed: number;
  sentCount: number;
}

export interface ISendTrainingReminderService extends IApplicationService<SendTrainingReminderRequest, SendTrainingReminderResult> {}

interface DueReminderSession {
  session: TrainingSession;
  offset: ReminderOffset;
}

export class SendTrainingReminderService implements ISendTrainingReminderService {
  constructor(
    private readonly trainingDataRepository: ITrainingDataRepository,
    private readonly userRepository: IUserRepository,
    private readonly configurationProvider: IConfigurationProvider,
    private readonly notificationSender: INotificationSender,
  ) {}

  execute(request: SendTrainingReminderRequest): SendTrainingReminderResult {
    const dispatchAt = new Date(request.dispatchAt);
    assertValidDate(dispatchAt, 'dispatchAt');

    const reminderPolicy = this.configurationProvider.getReminderPolicy();
    const requestedSessionIds = new Set(request.sessionIds ?? []);
    const candidateSessions = this.trainingDataRepository.getUpcomingTrainingSessions()
      .filter(session => requestedSessionIds.size === 0 || requestedSessionIds.has(session.sessionId));

    if (reminderPolicy.offsets.length === 0 && candidateSessions.every(session => session.status !== 'Cancelled')) {
      return { sessionsProcessed: 0, sentCount: 0 };
    }

    const previousDispatchAtValue = this.trainingDataRepository.getLastSuccessfulReminderDispatchAt();
    const previousDispatchAt = previousDispatchAtValue ? new Date(previousDispatchAtValue) : null;
    if (previousDispatchAt) {
      assertValidDate(previousDispatchAt, 'lastSuccessfulReminderDispatchAt');
    }

    const reminderWindowStart = getReminderWindowStart(
      dispatchAt,
      previousDispatchAt,
      request.fallbackWindowMinutes ?? 15,
    );
    const reminderSessions: DueReminderSession[] = candidateSessions
      .filter(session => session.status === 'Scheduled')
      .map(session => ({
        session,
        offset: getDueReminderOffset(session, reminderPolicy.offsets, reminderWindowStart, dispatchAt),
      }))
      .filter((entry): entry is DueReminderSession => entry.offset !== null)
      .filter(entry => this.trainingDataRepository.getReminderNotificationSentAt(entry.session.sessionId, entry.offset) === null);
    const cancellationSessions = candidateSessions
      .filter(session => session.status === 'Cancelled')
      .filter(session => getSessionStartDate(session).getTime() >= dispatchAt.getTime())
      .filter(session => this.trainingDataRepository.getCancellationNotificationSentAt(session.sessionId) === null);
    const trainingDefinitions = indexTrainingDefinitions(this.trainingDataRepository.getTrainingDefinitions());
    const users = this.userRepository.getAllUsers();
    const webAppUrl = this.configurationProvider.getWebAppUrl();

    let sentCount = 0;
    for (const session of cancellationSessions) {
      const recipients = users.filter(user => user.subscribedTrainingIds.includes(session.trainingId));
      const cancellation: TrainingCancellation = {
        sessionId: session.sessionId,
        cancelledByMemberId: 'system',
        cancelledAt: dispatchAt.toISOString(),
        reason: session.additionalInfo,
      };

      for (const user of recipients) {
        this.notificationSender.sendTrainingCancellation({
          recipient: user,
          cancellation,
          session,
          training: trainingDefinitions.get(session.trainingId),
        });
        sentCount += 1;
      }

      this.trainingDataRepository.markCancellationNotificationSent(cancellation, dispatchAt.toISOString());
    }

    for (const reminderSession of reminderSessions) {
      const { session, offset } = reminderSession;
      const existingAttendance = new Set(
        this.trainingDataRepository.getAttendanceForSession(session.sessionId).map(record => record.memberId),
      );
      const subscribedUsers = users.filter(user => (
        user.subscribedTrainingIds.includes(session.trainingId)
        && !existingAttendance.has(user.memberId)
      ));

      for (const user of subscribedUsers) {
        this.notificationSender.sendTrainingReminder({
          recipient: user,
          session,
          training: trainingDefinitions.get(session.trainingId),
          webAppUrl,
        });
        sentCount += 1;
      }

      this.trainingDataRepository.markReminderNotificationSent(session.sessionId, offset, dispatchAt.toISOString());
    }

    return {
      sessionsProcessed: reminderSessions.length + cancellationSessions.length,
      sentCount,
    };
  }
}