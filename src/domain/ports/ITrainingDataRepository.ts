import { IAttendanceRepository } from './IAttendanceRepository';
import { INotificationStateRepository } from './INotificationStateRepository';
import { ITrainingDefinitionRepository } from './ITrainingDefinitionRepository';

/**
 * Composite port that implements all training-data sub-ports.
 * Prefer injecting the narrowest sub-port your service needs instead.
 */
export interface ITrainingDataRepository
  extends ITrainingDefinitionRepository,
    IAttendanceRepository,
    INotificationStateRepository {}
