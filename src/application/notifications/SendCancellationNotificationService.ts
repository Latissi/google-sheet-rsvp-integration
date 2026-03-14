import { IApplicationService } from '../IApplicationService';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { INotificationSender } from '../../domain/ports/INotificationSender';
import { TrainingCancellation } from '../../domain/types';
import { indexTrainingDefinitions } from './notificationUtils';

export interface SendCancellationNotificationRequest {
  cancellation: TrainingCancellation;
}

export interface SendCancellationNotificationResult {
  sentCount: number;
}

export interface ISendCancellationNotificationService extends IApplicationService<SendCancellationNotificationRequest, SendCancellationNotificationResult> {}

export class SendCancellationNotificationService implements ISendCancellationNotificationService {
  constructor(
    private readonly trainingDataRepository: ITrainingDataRepository,
    private readonly userRepository: IUserRepository,
    private readonly notificationSender: INotificationSender,
  ) {}

  execute(request: SendCancellationNotificationRequest): SendCancellationNotificationResult {
    const session = this.trainingDataRepository.getTrainingSessionById(request.cancellation.sessionId);

    if (!session) {
      throw new Error(`Training session "${request.cancellation.sessionId}" not found.`);
    }

    const trainingDefinitions = indexTrainingDefinitions(this.trainingDataRepository.getTrainingDefinitions());
    const recipients = this.userRepository
      .getAllUsers()
      .filter(user => user.subscribedTrainingIds.includes(session.trainingId));

    for (const recipient of recipients) {
      this.notificationSender.sendTrainingCancellation({
        recipient,
        cancellation: request.cancellation,
        session,
        training: trainingDefinitions.get(session.trainingId),
      });
    }

    return {
      sentCount: recipients.length,
    };
  }
}