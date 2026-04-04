import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { PublicTrainingSource } from '../../domain/types';
import { ISheetGateway } from '../gateway/ISheetGateway';

/**
 * Read-through cache for public training source sheet data.
 *
 * Shared between `GoogleSheetTrainingDataRepository` and
 * `GoogleSheetPublicSourceRepository` so that both repositories read each
 * source table only once per Apps Script execution, and an invalidation in
 * one repository is visible to the other.
 */
export class SourceTableCache {
  private readonly cache = new Map<string, unknown[][]>();

  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
  ) {}

  get(source: PublicTrainingSource): unknown[][] {
    const key = this.cacheKey(source);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const table = this.gateway.getSheetValues(source.sheetName, {
      spreadsheetId: this.configurationProvider.getPublicSheetId(),
      rangeA1: source.tableRange,
    });
    this.cache.set(key, table);
    return table;
  }

  invalidate(source: PublicTrainingSource): void {
    this.cache.delete(this.cacheKey(source));
  }

  clear(): void {
    this.cache.clear();
  }

  private cacheKey(source: PublicTrainingSource): string {
    return `${source.sheetName}::${source.tableRange ?? ''}`;
  }
}
