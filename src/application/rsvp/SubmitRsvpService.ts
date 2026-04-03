import { IApplicationService } from '../IApplicationService';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { AttendanceRecord, AttendanceSource, RsvpStatus } from '../../domain/types';
import { ISyncAttendanceService } from './SyncAttendanceService';
import { assertValidIsoTimestamp } from '../notifications/notificationUtils';

export interface SubmitRsvpRequest {
  memberId: string;
  sessionId: string;
  rsvpStatus: Exclude<RsvpStatus, 'Pending'>;
  respondedAt: string;
  source?: AttendanceSource;
}

export interface SubmitRsvpResult {
  attendance: AttendanceRecord;
}

export interface ISubmitRsvpService extends IApplicationService<SubmitRsvpRequest, SubmitRsvpResult> {}

export class SubmitRsvpService implements ISubmitRsvpService {
  constructor(
    private readonly trainingDataRepository: ITrainingDataRepository,
    private readonly userRepository: IUserRepository,
    private readonly syncAttendanceService: ISyncAttendanceService,
  ) {}

  execute(request: SubmitRsvpRequest): SubmitRsvpResult {
    assertValidIsoTimestamp(request.respondedAt, 'respondedAt');

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
      metadata: {
        source: request.source ?? 'email-rsvp',
        updatedAt: request.respondedAt,
      },
    };

    this.syncAttendanceService.execute({ record: attendance });

    return { attendance };
  }
}