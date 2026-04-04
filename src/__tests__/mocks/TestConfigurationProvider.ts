import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { PublicTrainingSource, ReminderPolicy } from '../../domain/types';

export class TestConfigurationProvider implements IConfigurationProvider {
  constructor(
    private readonly sources: PublicTrainingSource[] = [],
    private readonly reminderPolicy: ReminderPolicy = { offsets: [], channels: ['email'] },
    private readonly publicSheetId: string = 'public-sheet',
    private readonly webAppUrl: string = 'https://example.test/webapp',
  ) {}

  getPublicSheetId(): string {
    return this.publicSheetId;
  }

  getPublicTrainingSources(): PublicTrainingSource[] {
    return this.sources;
  }

  getReminderPolicy(): ReminderPolicy {
    return this.reminderPolicy;
  }

  getWebAppUrl(): string {
    return this.webAppUrl;
  }
}
