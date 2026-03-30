import {
  TrainingDay,
  TrainingEnvironment,
} from './training';
import { Gender, NotificationChannel } from './user';

export interface AttendanceConfig {
  startColumn: string;
  infoRow?: number;
  firstNameColumn: string;
  lastNameColumn: string;
  genderColumn?: string;
  dateHeaderRow: number;
  firstMemberRow: number;
}

export type PublicSourceRegistrationMatchStatus = 'matched' | 'not-found' | 'ambiguous' | 'gender-mismatch';

export interface RegistrationMatchCriteria {
  firstName: string;
  lastName: string;
  gender?: Gender;
}

export interface PublicSourceRegistrationMatch {
  sourceId: string;
  sheetName: string;
  status: PublicSourceRegistrationMatchStatus;
  matchedRowNumber?: number;
}

export interface ReminderOffset {
  hours: number;
  minutes: number;
}

export function getReminderOffsetMinutes(offset: ReminderOffset): number {
  return offset.hours * 60 + offset.minutes;
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
