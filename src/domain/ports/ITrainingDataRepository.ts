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
  saveAttendance(record: AttendanceRecord): void;
  cancelTrainingSession(cancellation: TrainingCancellation): void;
}
