import { IApplicationService } from '../IApplicationService';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { NotificationChannel, TrainingDay, TRAINING_DAYS, UserRecord } from '../../domain/types';

export interface UpdateSubscriptionPreferencesRequest {
  memberId: string;
  subscribedTrainingIds: string[];
  subscribedTrainings?: TrainingDay[];
  notificationChannel?: NotificationChannel;
}

export interface UpdateSubscriptionPreferencesResult {
  user: UserRecord;
}

export interface IUpdateSubscriptionPreferencesService extends IApplicationService<UpdateSubscriptionPreferencesRequest, UpdateSubscriptionPreferencesResult> {}

export class UpdateSubscriptionPreferencesService implements IUpdateSubscriptionPreferencesService {
  constructor(private readonly userRepository: IUserRepository) {}

  execute(request: UpdateSubscriptionPreferencesRequest): UpdateSubscriptionPreferencesResult {
    const memberId = request.memberId.trim();
    if (!memberId) {
      throw new Error('memberId is required.');
    }

    const existingUser = this.userRepository.getUserByMemberId(memberId);
    if (!existingUser) {
      throw new Error(`User with memberId "${memberId}" not found.`);
    }

    const notificationChannel = request.notificationChannel ?? existingUser.subscriptions[0]?.notificationChannel ?? 'email';
    const subscribedTrainingIds = this.normalizeStringList(request.subscribedTrainingIds);
    const subscribedTrainings = request.subscribedTrainings === undefined
      ? existingUser.subscribedTrainings
      : this.normalizeTrainingDays(request.subscribedTrainings);

    const updatedUser: UserRecord = {
      ...existingUser,
      subscriptions: subscribedTrainingIds.map(trainingId => ({
        trainingId,
        notificationChannel,
      })),
      subscribedTrainingIds,
      subscribedTrainings,
    };

    this.userRepository.upsertUser(updatedUser);
    return { user: updatedUser };
  }

  private normalizeStringList(values: string[]): string[] {
    return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)));
  }

  private normalizeTrainingDays(values: TrainingDay[]): TrainingDay[] {
    const validDays = new Set<string>(TRAINING_DAYS);
    return this.normalizeStringList(values).filter((value): value is TrainingDay => validDays.has(value));
  }
}