import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { PublicTrainingSource, ReminderPolicy } from '../../domain/types';
import { ConfigurationAdapter } from './ConfigurationAdapter';

export class PrivateSheetConfigurationProvider implements IConfigurationProvider {
  constructor(private readonly adapter: ConfigurationAdapter) {}

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