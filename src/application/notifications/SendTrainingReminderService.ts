import { IApplicationService } from '../IApplicationService';
import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { INotificationSender } from '../../domain/ports/INotificationSender';
import { indexTrainingDefinitions, isReminderDue, assertValidDate } from './notificationUtils';

export interface SendTrainingReminderRequest {
  dispatchAt: string;
  toleranceMinutes?: number;
  sessionIds?: string[];
}

export interface SendTrainingReminderResult {
  sessionsProcessed: number;
  sentCount: number;
}

export interface ISendTrainingReminderService extends IApplicationService<SendTrainingReminderRequest, SendTrainingReminderResult> {}

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
    if (reminderPolicy.offsets.length === 0) {
      return { sessionsProcessed: 0, sentCount: 0 };
    }

    const toleranceMinutes = request.toleranceMinutes ?? 5;
    const requestedSessionIds = new Set(request.sessionIds ?? []);
    const sessions = this.trainingDataRepository.getUpcomingTrainingSessions()
      .filter(session => requestedSessionIds.size === 0 || requestedSessionIds.has(session.sessionId))
      .filter(session => isReminderDue(session, reminderPolicy.offsets, dispatchAt, toleranceMinutes));
    const trainingDefinitions = indexTrainingDefinitions(this.trainingDataRepository.getTrainingDefinitions());
    const users = this.userRepository.getAllUsers();
    const webAppUrl = this.configurationProvider.getWebAppUrl();

    let sentCount = 0;
    for (const session of sessions) {
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
    }

    return {
      sessionsProcessed: sessions.length,
      sentCount,
    };
  }
}