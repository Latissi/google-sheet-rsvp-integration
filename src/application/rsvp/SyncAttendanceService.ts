import { IApplicationService } from '../IApplicationService';
import { IAttendanceRepository } from '../../domain/ports/IAttendanceRepository';
import { AttendanceRecord } from '../../domain/types';

export interface SyncAttendanceRequest {
  record: AttendanceRecord;
}

export interface SyncAttendanceResult {
  applied: true;
  reason: 'saved';
}

export interface ISyncAttendanceService extends IApplicationService<SyncAttendanceRequest, SyncAttendanceResult> {}

export class SyncAttendanceService implements ISyncAttendanceService {
  constructor(private readonly trainingDataRepository: IAttendanceRepository) {}

  execute(request: SyncAttendanceRequest): SyncAttendanceResult {
    this.trainingDataRepository.saveAttendance(request.record);
    return { applied: true, reason: 'saved' };
  }
}