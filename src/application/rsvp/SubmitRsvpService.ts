import { IApplicationService } from '../IApplicationService';
import { IUserRepository } from '../../domain/ports/IUserRepository';
import { AttendanceRecord, AttendanceSource, RsvpStatus } from '../../domain/types';
import { ISyncAttendanceService } from './SyncAttendanceService';

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
    private readonly userRepository: IUserRepository,
    private readonly syncAttendanceService: ISyncAttendanceService,
  ) {}

  execute(request: SubmitRsvpRequest): SubmitRsvpResult {
    this.assertValidTimestamp(request.respondedAt, 'respondedAt');

    const user = this.userRepository.getUserByMemberId(request.memberId);
    if (!user) {
      throw new Error(`User with memberId "${request.memberId}" not found.`);
    }
    if (!user.roleDefinition.capabilities.canRsvpToTraining) {
      throw new Error(`User with memberId "${request.memberId}" is not allowed to RSVP.`);
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

  private assertValidTimestamp(value: string, label: string): void {
    if (Number.isNaN(new Date(value).getTime())) {
      throw new Error(`${label} must be a valid ISO timestamp.`);
    }
  }
}