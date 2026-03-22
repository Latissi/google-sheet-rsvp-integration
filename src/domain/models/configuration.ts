import {
  TrainingDay,
  TrainingEnvironment,
} from './training';
import { NotificationChannel } from './user';

export interface AttendanceConfig {
  startColumn: string;
  infoRow?: number;
  firstNameColumn: string;
  lastNameColumn: string;
  dateHeaderRow: number;
  firstMemberRow: number;
}

export interface ReminderOffset {
  hours: number;
  minutes: number;
}

export interface ReminderPolicy {
  offsets: ReminderOffset[];
  channels: NotificationChannel[];
}

export interface TrainingSourceMatch {
  trainingId: string;
  day: TrainingDay;
  environment?: TrainingEnvironment;
  title?: string;
  startTime: string;
  endTime?: string;
  location?: string;
}

export interface PublicTrainingSource {
  sourceId: string;
  sheetName: string;
  tableRange?: string;
  attendance: AttendanceConfig;
  trainings: TrainingSourceMatch[];
}
