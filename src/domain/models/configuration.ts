import {
  TrainingAudience,
  TrainingDay,
  TrainingEnvironment,
} from './training';
import { NotificationChannel } from './user';

export interface AttendanceConfig {
  startColumn: string;
  metadataColumn?: string;
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
  day?: TrainingDay;
  environment?: TrainingEnvironment;
  audience?: TrainingAudience;
  title?: string;
}

export interface PublicTrainingSource {
  sourceId: string;
  spreadsheetId?: string;
  sheetName: string;
  tableRange?: string;
  attendance: AttendanceConfig;
  trainings: TrainingSourceMatch[];
}
