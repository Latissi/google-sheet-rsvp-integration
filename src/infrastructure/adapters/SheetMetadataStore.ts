import { ISheetGateway } from '../gateway/ISheetGateway';
import { isEmptyRow } from './sheetUtils';

/**
 * Generic read-through cache for a private metadata sheet.
 *
 * Each sheet row is parsed into a `TMetadata` value via `keyExtractor` and
 * `metadataExtractor`. Both functions receive a `Record<string, string>` that
 * maps each header column name to the trimmed cell value for that row.
 *
 * Usage:
 *   const store = new SheetMetadataStore<MyMeta>(gateway, 'MySheet', ['ColA', 'ColB'], ...)
 *   store.get(key)               // read (lazy-loads on first access)
 *   store.upsert(key, metadata)  // write (ensureHeaders + append/update row)
 */
export class SheetMetadataStore<TMetadata> {
  private cache: Map<string, { rowIndex: number; metadata: TMetadata }> | null = null;

  constructor(
    private readonly gateway: ISheetGateway,
    private readonly sheetName: string,
    private readonly headers: string[],
    /**
     * Extracts the cache key for this row. May throw to reject invalid rows.
     * @param columns  Map of header → cell string value for this row
     * @param rowNumber  1-based sheet row number (for error messages)
     */
    private readonly keyExtractor: (columns: Record<string, string>, rowNumber: number) => string,
    /**
     * Extracts the typed metadata value for this row. May throw to reject invalid rows.
     */
    private readonly metadataExtractor: (columns: Record<string, string>, rowNumber: number) => TMetadata,
    /**
     * Serialises key + metadata back to an ordered row of cell values for writing.
     */
    private readonly toRowValues: (key: string, metadata: TMetadata) => unknown[],
  ) {}

  /** Returns the cached metadata for `key`, or `undefined` if not present. */
  get(key: string): TMetadata | undefined {
    return this.ensureLoaded().get(key)?.metadata;
  }

  /** Writes (insert or update) an entry and keeps the in-memory cache in sync. */
  upsert(key: string, metadata: TMetadata): void {
    this.gateway.ensureSheetHeaders(this.sheetName, this.headers);
    const store = this.ensureLoaded();
    const values = this.toRowValues(key, metadata);
    const existing = store.get(key);
    if (existing) {
      this.gateway.setRowValues(this.sheetName, existing.rowIndex, values);
      existing.metadata = metadata;
      return;
    }
    const nextRow = Array.from(store.values()).reduce((max, e) => Math.max(max, e.rowIndex), 1) + 1;
    this.gateway.appendRow(this.sheetName, values);
    store.set(key, { rowIndex: nextRow, metadata });
  }

  private ensureLoaded(): Map<string, { rowIndex: number; metadata: TMetadata }> {
    if (!this.cache) {
      this.cache = this.load();
    }
    return this.cache;
  }

  private load(): Map<string, { rowIndex: number; metadata: TMetadata }> {
    let rows: unknown[][];
    try {
      rows = this.gateway.getSheetValues(this.sheetName);
    } catch (error) {
      if (error instanceof Error && error.message === `Sheet with name "${this.sheetName}" not found.`) {
        return new Map();
      }
      throw error;
    }

    if (rows.length === 0) {
      return new Map();
    }

    const headerRow = rows[0] ?? [];
    const store = new Map<string, { rowIndex: number; metadata: TMetadata }>();

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (isEmptyRow(row)) {
        continue;
      }

      const columns: Record<string, string> = {};
      for (let c = 0; c < headerRow.length; c++) {
        const header = String(headerRow[c] ?? '').trim();
        if (header) {
          columns[header] = String((row ?? [])[c] ?? '').trim();
        }
      }

      const rowNumber = i + 1;
      const key = this.keyExtractor(columns, rowNumber);

      if (store.has(key)) {
        throw new Error(`Sheet "${this.sheetName}" contains duplicate metadata for key "${key}" at row ${rowNumber}.`);
      }

      const metadata = this.metadataExtractor(columns, rowNumber);
      store.set(key, { rowIndex: rowNumber, metadata });
    }

    return store;
  }
}
