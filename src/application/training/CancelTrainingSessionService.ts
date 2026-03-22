import { IApplicationService } from '../IApplicationService';
import { ISendCancellationNotificationService } from '../notifications/SendCancellationNotificationService';
import { assertValidDate } from '../notifications/notificationUtils';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { TrainingCancellation } from '../../domain/types';

export interface CancelTrainingSessionRequest {
  memberId: string;
  sessionId: string;
  cancelledAt: string;
  reason?: string;
}

export interface CancelTrainingSessionResult {
  sentCount: number;
  alreadyCancelled: boolean;
}

export interface ICancelTrainingSessionService extends IApplicationService<CancelTrainingSessionRequest, CancelTrainingSessionResult> {}

export class CancelTrainingSessionService implements ICancelTrainingSessionService {
  constructor(
    private readonly trainingDataRepository: ITrainingDataRepository,
    private readonly userRepository: IUserRepository,
    private readonly sendCancellationNotificationService: ISendCancellationNotificationService,
  ) {}

  execute(request: CancelTrainingSessionRequest): CancelTrainingSessionResult {
    const cancelledAt = new Date(request.cancelledAt);
    assertValidDate(cancelledAt, 'cancelledAt');

    const trainer = this.userRepository.getUserByMemberId(request.memberId);
    if (!trainer) {
      throw new Error(`User with memberId "${request.memberId}" not found.`);
    }

    if (!trainer.roleDefinition.capabilities.canCancelTraining) {
      throw new Error(`User "${request.memberId}" is not allowed to cancel trainings.`);
    }

    const session = this.trainingDataRepository.getTrainingSessionById(request.sessionId);
    if (!session) {
      throw new Error(`Training session "${request.sessionId}" not found.`);
    }

    if (session.status === 'Cancelled') {
      return {
        sentCount: 0,
        alreadyCancelled: true,
      };
    }

    const cancellation: TrainingCancellation = {
      sessionId: request.sessionId,
      cancelledByMemberId: trainer.memberId,
      cancelledAt: cancelledAt.toISOString(),
      reason: request.reason?.trim() || undefined,
    };

    this.trainingDataRepository.cancelTrainingSession(cancellation);
    const notificationResult = this.sendCancellationNotificationService.execute({ cancellation });

    return {
      sentCount: notificationResult.sentCount,
      alreadyCancelled: false,
    };
  }
}