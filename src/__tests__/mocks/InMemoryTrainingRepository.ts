import { ITrainingDataRepository } from '../../domain/ports/ITrainingDataRepository';
import {
  AttendanceRecord,
  getReminderOffsetMinutes,
  ReminderOffset,
  TrainingCancellation,
  TrainingDefinition,
  TrainingSession,
} from '../../domain/types';

/**
 * In-memory implementation of ITrainingDataRepository for use in tests.
 *
 * Supports both notification-service tests (cancel sessions, track notification state)
 * and RSVP tests (mutable attendance array).
 *
 * Methods that are not relevant to a specific test use case throw "Not implemented"
 * by default; override by subclassing or by calling setters defined below.
 */
export class InMemoryTrainingRepository implements ITrainingDataRepository {
  public attendance: AttendanceRecord[] = [];
  private readonly cancellationNotificationSentAt = new Map<string, string>();
  private readonly reminderNotificationSentAt = new Map<string, string>();
  private lastSuccessfulReminderDispatchAt: string | null = null;

  constructor(
    private readonly definitions: TrainingDefinition[] = [],
    private readonly sessions: TrainingSession[] = [],
    initialAttendance: AttendanceRecord[] = [],
  ) {
    this.attendance = [...initialAttendance];
  }

  // ── ITrainingDataRepository ─────────────────────────────────────────────────

  getTrainingDefinitions(): TrainingDefinition[] {
    return [...this.definitions];
  }

  getUpcomingTrainingSessions(): TrainingSession[] {
    return [...this.sessions];
  }

  getTrainingSessionById(sessionId: string): TrainingSession | null {
    return this.sessions.find(session => session.sessionId === sessionId) ?? null;
  }

  getAttendanceForSession(sessionId: string): AttendanceRecord[] {
    return this.attendance.filter(record => record.sessionId === sessionId);
  }

  saveAttendance(record: AttendanceRecord): void {
    const index = this.attendance.findIndex(
      existing => existing.sessionId === record.sessionId && existing.memberId === record.memberId,
    );
    if (index >= 0) {
      this.attendance[index] = record;
      return;
    }
    this.attendance.push(record);
  }

  cancelTrainingSession(cancellation: TrainingCancellation): void {
    const session = this.sessions.find(candidate => candidate.sessionId === cancellation.sessionId);
    if (!session) {
      throw new Error(`Training session "${cancellation.sessionId}" not found.`);
    }
    session.status = 'Cancelled';
    session.additionalInfo = cancellation.reason
      ? `Training entfällt: ${cancellation.reason}`
      : 'Training entfällt';
  }

  paintCancelledSessionColumn(_sessionId: string): void {
    // no-op in tests
  }

  getCancellationNotificationSentAt(sessionId: string): string | null {
    return this.cancellationNotificationSentAt.get(sessionId) ?? null;
  }

  getReminderNotificationSentAt(sessionId: string, offset: ReminderOffset): string | null {
    return this.reminderNotificationSentAt.get(`${sessionId}::${getReminderOffsetMinutes(offset)}`) ?? null;
  }

  getLastSuccessfulReminderDispatchAt(): string | null {
    return this.lastSuccessfulReminderDispatchAt;
  }

  markCancellationNotificationSent(cancellation: TrainingCancellation, notifiedAt: string): void {
    this.cancellationNotificationSentAt.set(cancellation.sessionId, notifiedAt);
  }

  markReminderNotificationSent(sessionId: string, offset: ReminderOffset, notifiedAt: string): void {
    this.reminderNotificationSentAt.set(`${sessionId}::${getReminderOffsetMinutes(offset)}`, notifiedAt);
  }

  markLastSuccessfulReminderDispatchAt(completedAt: string): void {
    this.lastSuccessfulReminderDispatchAt = completedAt;
  }
}
