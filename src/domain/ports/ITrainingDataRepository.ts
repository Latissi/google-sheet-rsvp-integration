import {
  AttendanceRecord,
  ReminderOffset,
  TrainingCancellation,
  TrainingDefinition,
  TrainingSession,
} from '../types';

export interface ITrainingDataRepository {
  getTrainingDefinitions(): TrainingDefinition[];
  getUpcomingTrainingSessions(): TrainingSession[];
  getTrainingSessionById(sessionId: string): TrainingSession | null;
  getAttendanceForSession(sessionId: string): AttendanceRecord[];
  getCancellationNotificationSentAt(sessionId: string): string | null;
  getReminderNotificationSentAt(sessionId: string, offset: ReminderOffset): string | null;
  getLastSuccessfulReminderDispatchAt(): string | null;
  cancelTrainingSession(cancellation: TrainingCancellation): void;
  saveAttendance(record: AttendanceRecord): void;
  markCancellationNotificationSent(cancellation: TrainingCancellation, notifiedAt: string): void;
  markReminderNotificationSent(sessionId: string, offset: ReminderOffset, notifiedAt: string): void;
  markLastSuccessfulReminderDispatchAt(completedAt: string): void;
}
