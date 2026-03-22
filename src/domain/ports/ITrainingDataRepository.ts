import {
  AttendanceRecord,
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
  saveAttendance(record: AttendanceRecord): void;
  markCancellationNotificationSent(cancellation: TrainingCancellation, notifiedAt: string): void;
}
