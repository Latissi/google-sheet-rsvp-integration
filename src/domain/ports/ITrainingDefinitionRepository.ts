import { TrainingDefinition, TrainingSession, TrainingCancellation } from '../types';

export interface ITrainingDefinitionRepository {
  getTrainingDefinitions(): TrainingDefinition[];
  getUpcomingTrainingSessions(): TrainingSession[];
  getTrainingSessionById(sessionId: string): TrainingSession | null;
  cancelTrainingSession(cancellation: TrainingCancellation): void;
  paintCancelledSessionColumn(sessionId: string): void;
}
