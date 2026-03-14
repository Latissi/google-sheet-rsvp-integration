import { AttendanceRecord, TrainingCancellation } from './attendance';
import { TrainingDefinition, TrainingSession } from './training';
import { UserRecord } from './user';

export interface TrainingReminderNotification {
  recipient: UserRecord;
  session: TrainingSession;
  training?: TrainingDefinition;
  webAppUrl: string;
}

export interface TrainingCancellationNotification {
  recipient: UserRecord;
  cancellation: TrainingCancellation;
  session: TrainingSession;
  training?: TrainingDefinition;
}

export interface TrainerParticipationReportNotification {
  recipient: UserRecord;
  session: TrainingSession;
  training?: TrainingDefinition;
  attendance: AttendanceRecord[];
}