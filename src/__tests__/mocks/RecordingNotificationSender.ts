import { INotificationSender } from '../../domain/ports/INotificationSender';
import { TrainingCancellationNotification, TrainingReminderNotification } from '../../domain/types';

export class RecordingNotificationSender implements INotificationSender {
  public reminders: Array<{ recipientId: string; sessionId: string }> = [];
  public cancellations: Array<{ recipientId: string; sessionId: string }> = [];
  public events: Array<{ type: 'reminder' | 'cancellation'; recipientId: string; sessionId: string }> = [];

  sendTrainingReminder(notification: TrainingReminderNotification): void {
    this.reminders.push({ recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
    this.events.push({ type: 'reminder', recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }

  sendTrainingCancellation(notification: TrainingCancellationNotification): void {
    this.cancellations.push({ recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
    this.events.push({ type: 'cancellation', recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }
}
