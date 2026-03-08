import { NotificationChannel } from './user';

export interface AttendanceConfig {
  startColumn: string;
  metadataColumn?: string;
}

export interface ReminderPolicy {
  daysBeforeTraining: number;
  channels: NotificationChannel[];
}
