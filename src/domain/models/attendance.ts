export type RsvpStatus = 'Pending' | 'Accepted' | 'Declined';
export type AttendanceSource = 'manual' | 'email-rsvp' | 'sheet-sync' | 'system';

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
