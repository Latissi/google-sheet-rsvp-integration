import { PublicTrainingSource, ReminderPolicy } from '../types';

export interface IConfigurationProvider {
  getPublicSheetId(): string;
  getPublicTrainingSources(): PublicTrainingSource[];
  getReminderPolicy(): ReminderPolicy;
  getWebAppUrl(): string;
}
