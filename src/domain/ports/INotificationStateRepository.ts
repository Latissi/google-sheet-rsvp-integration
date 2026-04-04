import { ReminderOffset, TrainingCancellation } from '../types';

export interface INotificationStateRepository {
  getCancellationNotificationSentAt(sessionId: string): string | null;
  getReminderNotificationSentAt(sessionId: string, offset: ReminderOffset): string | null;
  getLastSuccessfulReminderDispatchAt(): string | null;
  markCancellationNotificationSent(cancellation: TrainingCancellation, notifiedAt: string): void;
  markReminderNotificationSent(sessionId: string, offset: ReminderOffset, notifiedAt: string): void;
  markLastSuccessfulReminderDispatchAt(completedAt: string): void;
}
