import { IApplicationService } from '../IApplicationService';
import { ITrainingDefinitionRepository } from '../../domain/ports/ITrainingDefinitionRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { AttendanceRecord, RsvpStatus } from '../../domain/types';
import { ISyncAttendanceService } from './SyncAttendanceService';

export interface SubmitRsvpRequest {
  memberId: string;
  sessionId: string;
  rsvpStatus: Exclude<RsvpStatus, 'Pending'>;
}

export interface SubmitRsvpResult {
  attendance: AttendanceRecord;
}

export interface ISubmitRsvpService extends IApplicationService<SubmitRsvpRequest, SubmitRsvpResult> {}

export class SubmitRsvpService implements ISubmitRsvpService {
  constructor(
    private readonly trainingDataRepository: ITrainingDefinitionRepository,
    private readonly userRepository: IUserRepository,
    private readonly syncAttendanceService: ISyncAttendanceService,
  ) {}

  execute(request: SubmitRsvpRequest): SubmitRsvpResult {
    const user = this.userRepository.getUserByMemberId(request.memberId);
    if (!user) {
      throw new Error(`User with memberId "${request.memberId}" not found.`);
    }
    if (!user.roleDefinition.capabilities.canRsvpToTraining) {
      throw new Error(`User with memberId "${request.memberId}" is not allowed to RSVP.`);
    }

    const session = this.trainingDataRepository.getTrainingSessionById(request.sessionId);
    if (!session) {
      throw new Error(`Training session "${request.sessionId}" not found.`);
    }
    if (session.status === 'Cancelled') {
      throw new Error(`Training session "${request.sessionId}" is cancelled.`);
    }

    const attendance: AttendanceRecord = {
      memberId: request.memberId,
      sessionId: request.sessionId,
      rsvpStatus: request.rsvpStatus,
    };

    this.syncAttendanceService.execute({ record: attendance });

    return { attendance };
  }
}