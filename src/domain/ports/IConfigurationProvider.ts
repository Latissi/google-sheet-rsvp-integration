import { AttendanceConfig, ReminderPolicy } from '../types';

export interface IConfigurationProvider {
  getPublicSheetId(): string;
  getTrainingSheetName(): string;
  getAttendanceConfig(): AttendanceConfig;
  getReminderDaysBeforeTraining(): number;
  getReminderPolicy(): ReminderPolicy;
  getWebAppUrl(): string;
}
