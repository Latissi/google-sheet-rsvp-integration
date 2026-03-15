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
  role: string;
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

    const memberId = createCompositeMemberIdFromPersonName(personName);
    const role = parseRole(request.role);
    const gender = request.gender === undefined ? undefined : parseGender(String(request.gender));

    const user: UserRecord = {
      memberId,
      name: personName.fullName,
      email,
      gender,
      role,
      roleDefinition: getRoleDefinition(role),
      personName,
      subscriptions: [],
      subscribedTrainingIds: [],
      subscribedTrainings: [],
    };

    const existingUser = this.userRepository.getUserByMemberId(memberId);
    this.userRepository.upsertUser(user);

    return {
      user,
      created: existingUser === null,
    };
  }
}