export type RsvpStatus = 'Pending' | 'Accepted' | 'Tentative' | 'Declined';

export interface AttendanceRecord {
  memberId: string;
  sessionId: string;
  rsvpStatus: RsvpStatus;
}

export interface TrainingCancellation {
  sessionId: string;
  cancelledByMemberId: string;
  cancelledAt: string;
  reason?: string;
}
