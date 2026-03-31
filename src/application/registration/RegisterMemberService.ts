import { IApplicationService } from '../IApplicationService';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import {
  Gender,
  createCompositeMemberIdFromPersonName,
  createPersonName,
  getRoleDefinition,
  parseGender,
  parseRole,
  UserRecord,
} from '../../domain/types';

export interface RegisterMemberRequest {
  memberId?: string;
  email: string;
  role?: string;
  firstName: string;
  lastName: string;
  gender?: Gender | string;
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

    const personName = createPersonName(request.firstName, request.lastName);
    if (!personName.firstName || !personName.lastName) {
      throw new Error('Both firstName and lastName are required for the composite member key.');
    }

    const canonicalMemberId = createCompositeMemberIdFromPersonName(personName);
    const requestedMemberId = request.memberId?.trim() || undefined;
    if (requestedMemberId && requestedMemberId !== canonicalMemberId) {
      throw new Error(`Provided memberId "${requestedMemberId}" does not match firstName and lastName.`);
    }

    const existingUser = this.userRepository.getUserByMemberId(canonicalMemberId);
    const requestedRole = parseRole((request.role ?? 'Mitglied').trim());
    const role = existingUser?.role ?? requestedRole;
    const gender = request.gender === undefined
      ? existingUser?.gender
      : parseGender(String(request.gender));

    const user: UserRecord = {
      memberId: canonicalMemberId,
      name: personName.fullName,
      email,
      gender,
      role,
      roleDefinition: getRoleDefinition(role),
      personName,
      subscriptions: existingUser?.subscriptions ?? [],
      subscribedTrainingIds: existingUser?.subscribedTrainingIds ?? [],
      subscribedTrainings: existingUser?.subscribedTrainings ?? [],
    };

    this.userRepository.upsertUser(user);

    return {
      user,
      created: existingUser === null,
    };
  }
}