import { IApplicationService } from '../IApplicationService';
import { IAttendanceRepository } from '../../domain/ports/IAttendanceRepository';
import { AttendanceRecord, ATTENDANCE_SOURCE_PRIORITY } from '../../domain/types';
import { assertValidIsoTimestamp } from '../../domain/validation';

export interface SyncAttendanceRequest {
  record: AttendanceRecord;
}

export interface SyncAttendanceResult {
  applied: boolean;
  reason: 'saved' | 'older-update' | 'same-record' | 'lower-priority';
  existingRecord?: AttendanceRecord;
}

export interface ISyncAttendanceService extends IApplicationService<SyncAttendanceRequest, SyncAttendanceResult> {}

export class SyncAttendanceService implements ISyncAttendanceService {
  constructor(private readonly trainingDataRepository: IAttendanceRepository) {}

  execute(request: SyncAttendanceRequest): SyncAttendanceResult {
    assertValidIsoTimestamp(request.record.metadata.updatedAt, 'record.metadata.updatedAt');

    const existingRecord = this.trainingDataRepository
      .getAttendanceForSession(request.record.sessionId)
      .find(record => record.memberId === request.record.memberId);

    if (!existingRecord) {
      this.trainingDataRepository.saveAttendance(request.record);
      return { applied: true, reason: 'saved' };
    }

    const incomingTime = new Date(request.record.metadata.updatedAt).getTime();
    const existingTime = new Date(existingRecord.metadata.updatedAt).getTime();

    if (
      request.record.rsvpStatus === existingRecord.rsvpStatus
      && request.record.metadata.source === existingRecord.metadata.source
      && incomingTime === existingTime
    ) {
      return { applied: false, reason: 'same-record', existingRecord };
    }

    if (incomingTime < existingTime) {
      return { applied: false, reason: 'older-update', existingRecord };
    }

    if (
      incomingTime === existingTime
      && ATTENDANCE_SOURCE_PRIORITY[request.record.metadata.source] <= ATTENDANCE_SOURCE_PRIORITY[existingRecord.metadata.source]
    ) {
      return { applied: false, reason: 'lower-priority', existingRecord };
    }

    this.trainingDataRepository.saveAttendance(request.record);
    return { applied: true, reason: 'saved', existingRecord };
  }
}