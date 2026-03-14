import { IApplicationService } from '../IApplicationService';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  Gender,
  createCompositeMemberIdFromPersonName,
  createPersonName,
  createPersonNameFromFullName,
  getRoleDefinition,
  NotificationChannel,
  parseGender,
  parseRole,
  TRAINING_DAYS,
  TrainingDay,
  UserRecord,
} from '../../domain/types';

export interface RegisterMemberRequest {
  memberId?: string;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  gender?: Gender | string;
  subscribedTrainingIds?: string[];
  subscribedTrainings?: TrainingDay[];
  notificationChannel?: NotificationChannel;
}

export interface RegisterMemberResult {
  user: UserRecord;
  created: boolean;
}

export interface IRegisterMemberService extends IApplicationService<RegisterMemberRequest, RegisterMemberResult> {}

export class RegisterMemberService implements IRegisterMemberService {
  constructor(private readonly userRepository: IUserRepository) {}

  execute(request: RegisterMemberRequest): RegisterMemberResult {
    const email = request.email.trim();
    if (!email) {
      throw new Error('email is required.');
    }

    const personName = request.firstName || request.lastName
      ? createPersonName(request.firstName ?? '', request.lastName ?? '')
      : createPersonNameFromFullName(request.fullName ?? '');

    if (!personName.fullName) {
      throw new Error('A member name is required.');
    }
    if (!personName.firstName || !personName.lastName) {
      throw new Error('Both firstName and lastName are required for the composite member key.');
    }

    const memberId = createCompositeMemberIdFromPersonName(personName);
    const role = parseRole(request.role);
    const gender = request.gender === undefined ? undefined : parseGender(String(request.gender));
    const subscribedTrainings = this.normalizeTrainingDays(request.subscribedTrainings ?? []);
    const subscribedTrainingIds = this.normalizeStringList(
      request.subscribedTrainingIds && request.subscribedTrainingIds.length > 0
        ? request.subscribedTrainingIds
        : subscribedTrainings,
    );
    const notificationChannel = request.notificationChannel ?? 'email';

    const user: UserRecord = {
      memberId,
      name: personName.fullName,
      email,
      gender,
      role,
      roleDefinition: getRoleDefinition(role),
      personName,
      subscriptions: subscribedTrainingIds.map(trainingId => ({
        trainingId,
        notificationChannel,
      })),
      subscribedTrainingIds,
      subscribedTrainings,
    };

    const existingUser = this.userRepository.getUserByMemberId(memberId);
    this.userRepository.upsertUser(user);

    return {
      user,
      created: existingUser === null,
    };
  }

  private normalizeStringList(values: string[]): string[] {
    return Array.from(new Set(values.map(value => String(value).trim()).filter(Boolean)));
  }

  private normalizeTrainingDays(values: TrainingDay[]): TrainingDay[] {
    const validDays = new Set<string>(TRAINING_DAYS);
    return this.normalizeStringList(values).filter((value): value is TrainingDay => validDays.has(value));
  }
}