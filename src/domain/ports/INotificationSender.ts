import { TrainingCancellationNotification, TrainingReminderNotification } from '../types';

export interface INotificationSender {
  sendTrainingReminder(notification: TrainingReminderNotification): void;
  sendTrainingCancellation(notification: TrainingCancellationNotification): void;
}