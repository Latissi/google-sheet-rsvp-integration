import { IApplicationService } from '../IApplicationService';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { TrainingCancellation } from '../../domain/types';

export interface CancelTrainingRequest {
  sessionId: string;
  cancelledByMemberId: string;
  cancelledAt: string;
  reason?: string;
}

export interface CancelTrainingResult {
  cancellation: TrainingCancellation;
}

export interface ICancelTrainingService extends IApplicationService<CancelTrainingRequest, CancelTrainingResult> {}

export class CancelTrainingService implements ICancelTrainingService {
  constructor(
    private readonly trainingDataRepository: ITrainingDataRepository,
    private readonly userRepository: IUserRepository,
  ) {}

  execute(request: CancelTrainingRequest): CancelTrainingResult {
    this.assertValidTimestamp(request.cancelledAt, 'cancelledAt');

    const trainer = this.userRepository.getUserByMemberId(request.cancelledByMemberId);
    if (!trainer) {
      throw new Error(`User with memberId "${request.cancelledByMemberId}" not found.`);
    }
    if (!trainer.roleDefinition.capabilities.canCancelTraining) {
      throw new Error(`User with memberId "${request.cancelledByMemberId}" is not allowed to cancel training.`);
    }

    const cancellation: TrainingCancellation = {
      sessionId: request.sessionId,
      cancelledByMemberId: request.cancelledByMemberId,
      cancelledAt: request.cancelledAt,
      reason: request.reason,
    };

    this.trainingDataRepository.cancelTrainingSession(cancellation);
    return { cancellation };
  }

  private assertValidTimestamp(value: string, label: string): void {
    if (Number.isNaN(new Date(value).getTime())) {
      throw new Error(`${label} must be a valid ISO timestamp.`);
    }
  }
}