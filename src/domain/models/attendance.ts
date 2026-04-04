export type RsvpStatus = 'Pending' | 'Accepted' | 'Declined';
export type AttendanceSource = 'manual' | 'email-rsvp' | 'sheet-sync' | 'system';

/** Priority order for attendance sources; higher value wins when timestamps are equal. */
export const ATTENDANCE_SOURCE_PRIORITY: Record<AttendanceSource, number> = {
  manual: 4,
  'email-rsvp': 3,
  'sheet-sync': 2,
  system: 1,
};

export interface AttendanceSyncMetadata {
  source: AttendanceSource;
  updatedAt: string;
}

export interface AttendanceRecord {
  memberId: string;
  sessionId: string;
  rsvpStatus: RsvpStatus;
  metadata: AttendanceSyncMetadata;
}

export interface TrainingCancellation {
  sessionId: string;
  cancelledByMemberId: string;
  cancelledAt: string;
  reason?: string;
}
