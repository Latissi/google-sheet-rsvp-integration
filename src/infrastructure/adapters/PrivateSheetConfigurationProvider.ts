import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { PublicTrainingSource, ReminderPolicy } from '../../domain/types';
import { ConfigurationAdapter } from './ConfigurationAdapter';

export interface PrivateSheetConfigurationSource {
  getPublicSheetId(): string;
  getPublicTrainingSources(): PublicTrainingSource[];
  getReminderPolicy(): ReminderPolicy;
  getWebAppUrl(): string;
}

export class PrivateSheetConfigurationProvider implements IConfigurationProvider {
  constructor(private readonly adapter: PrivateSheetConfigurationSource) {}

  getPublicSheetId(): string {
    return this.adapter.getPublicSheetId();
  }

  getPublicTrainingSources(): PublicTrainingSource[] {
    return this.adapter.getPublicTrainingSources();
  }

  getReminderPolicy(): ReminderPolicy {
    return this.adapter.getReminderPolicy();
  }

  getWebAppUrl(): string {
    return this.adapter.getWebAppUrl();
  }
}