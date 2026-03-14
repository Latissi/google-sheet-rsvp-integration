import { IApplicationService } from '../IApplicationService';
import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import { AttendanceRecord, AttendanceSource } from '../../domain/types';

export interface SyncAttendanceRequest {
  record: AttendanceRecord;
}

export interface SyncAttendanceResult {
  applied: boolean;
  reason: 'saved' | 'older-update' | 'same-record' | 'lower-priority';
  existingRecord?: AttendanceRecord;
}

export interface ISyncAttendanceService extends IApplicationService<SyncAttendanceRequest, SyncAttendanceResult> {}

const SOURCE_PRIORITY: Record<AttendanceSource, number> = {
  manual: 4,
  'email-rsvp': 3,
  'sheet-sync': 2,
  system: 1,
};

export class SyncAttendanceService implements ISyncAttendanceService {
  constructor(private readonly trainingDataRepository: ITrainingDataRepository) {}

  execute(request: SyncAttendanceRequest): SyncAttendanceResult {
    this.assertValidTimestamp(request.record.metadata.updatedAt, 'record.metadata.updatedAt');

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
      && SOURCE_PRIORITY[request.record.metadata.source] <= SOURCE_PRIORITY[existingRecord.metadata.source]
    ) {
      return { applied: false, reason: 'lower-priority', existingRecord };
    }

    this.trainingDataRepository.saveAttendance(request.record);
    return { applied: true, reason: 'saved', existingRecord };
  }

  private assertValidTimestamp(value: string, label: string): void {
    if (Number.isNaN(new Date(value).getTime())) {
      throw new Error(`${label} must be a valid ISO timestamp.`);
    }
  }
}