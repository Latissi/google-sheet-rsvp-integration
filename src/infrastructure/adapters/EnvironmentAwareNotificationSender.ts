import type { SystemConfig } from '../../config';
import { INotificationSender } from '../../domain/ports/INotificationSender';
import {
  TrainerParticipationReportNotification,
  TrainingCancellationNotification,
  TrainingReminderNotification,
} from '../../domain/types';

export type EnvironmentAwareNotificationSenderConfig = Pick<SystemConfig, 'ENV' | 'TRAINER_EMAIL'>;

export class EnvironmentAwareNotificationSender implements INotificationSender {
  constructor(
    private readonly config: EnvironmentAwareNotificationSenderConfig,
    private readonly sender: INotificationSender,
  ) {}

  sendTrainingReminder(notification: TrainingReminderNotification): void {
    this.sender.sendTrainingReminder(this.redirectNotification(notification));
  }

  sendTrainingCancellation(notification: TrainingCancellationNotification): void {
    this.sender.sendTrainingCancellation(this.redirectNotification(notification));
  }

  sendTrainerParticipationReport(notification: TrainerParticipationReportNotification): void {
    this.sender.sendTrainerParticipationReport(this.redirectNotification(notification));
  }

  private redirectNotification<T extends { recipient: { email: string } }>(notification: T): T {
    if (this.config.ENV.trim().toLowerCase() === 'prod') {
      return notification;
    }

    return {
      ...notification,
      recipient: {
        ...notification.recipient,
        email: this.config.TRAINER_EMAIL,
      },
    };
  }
}