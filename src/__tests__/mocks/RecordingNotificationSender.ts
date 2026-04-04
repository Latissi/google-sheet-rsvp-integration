import { INotificationSender } from '../../domain/ports/INotificationSender';
import { TrainingCancellationNotification, TrainingReminderNotification, TrainerParticipationReportNotification } from '../../domain/types';

export class RecordingNotificationSender implements INotificationSender {
  public reminders: Array<{ recipientId: string; sessionId: string }> = [];
  public cancellations: Array<{ recipientId: string; sessionId: string }> = [];
  public reports: Array<{ recipientId: string; sessionId: string; attendanceCount: number }> = [];
  public events: Array<{ type: 'reminder' | 'cancellation' | 'report'; recipientId: string; sessionId: string }> = [];

  sendTrainingReminder(notification: TrainingReminderNotification): void {
    this.reminders.push({ recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
    this.events.push({ type: 'reminder', recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }

  sendTrainingCancellation(notification: TrainingCancellationNotification): void {
    this.cancellations.push({ recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
    this.events.push({ type: 'cancellation', recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }

  sendTrainerParticipationReport(notification: TrainerParticipationReportNotification): void {
    this.reports.push({
      recipientId: notification.recipient.memberId,
      sessionId: notification.session.sessionId,
      attendanceCount: notification.attendance.length,
    });
    this.events.push({ type: 'report', recipientId: notification.recipient.memberId, sessionId: notification.session.sessionId });
  }
}
