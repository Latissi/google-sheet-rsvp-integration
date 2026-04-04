import { AttendanceRecord } from '../types';

export interface IAttendanceRepository {
  getAttendanceForSession(sessionId: string): AttendanceRecord[];
  saveAttendance(record: AttendanceRecord): void;
}
