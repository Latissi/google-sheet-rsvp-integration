import { AttendanceConfig } from '../types';

export interface IConfigurationProvider {
  getPublicSheetId(): string;
  getTrainingSheetName(): string;
  getAttendanceConfig(): AttendanceConfig;
  getReminderDaysBeforeTraining(): number;
  getWebAppUrl(): string;
}
