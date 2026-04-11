import {
  ISheetGateway,
  SheetAccessOptions,
  SheetWriteOptions,
} from '../../infrastructure/gateway/ISheetGateway';

export class MockSheetGateway implements ISheetGateway {
  private inMemorySheets: Map<string, unknown[][]>;
  private displaySheets: Map<string, string[][]>;
  private readCounts: Map<string, number> = new Map();
  public appendedRows: Array<{ sheetName: string, values: unknown[] }> = [];
  public updatedRows: Array<{ sheetName: string, rowIndex: number, values: unknown[] }> = [];
  public updatedCells: Array<{ sheetName: string, rowIndex: number, columnIndex: number, value: unknown }> = [];
  public updatedNotes: Array<{ sheetName: string, rowIndex: number, columnIndex: number, note: string }> = [];
  public backgroundUpdates: Array<{ sheetName: string, columnIndex: number, startRow: number, numRows: number, color: string }> = [];

  constructor(
    initialData: { [sheetName: string]: unknown[][] } = {},
    displayData: { [sheetName: string]: string[][] } = {},
  ) {
    this.inMemorySheets = new Map(Object.entries(initialData));
    this.displaySheets = new Map(Object.entries(displayData));
  }

  getSheetValues(sheetName: string, options?: SheetAccessOptions): unknown[][] {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);
    const readKey = this.getReadKey(sheetName, options?.rangeA1);
    this.readCounts.set(readKey, (this.readCounts.get(readKey) ?? 0) + 1);
    if (options?.rangeA1) {
      return this.getRangeValues(data, options.rangeA1);
    }
    return data;
  }

  getSheetDisplayValues(sheetName: string, options?: SheetAccessOptions): string[][] {
    const displayData = this.displaySheets.get(sheetName)
      ?? this.getSheetValues(sheetName, options).map(row => row.map(value => String(value ?? '').trim()));
    const readKey = this.getReadKey(`${sheetName}::display`, options?.rangeA1);
    this.readCounts.set(readKey, (this.readCounts.get(readKey) ?? 0) + 1);

    if (options?.rangeA1) {
      return this.getRangeValues(displayData, options.rangeA1);
    }

    return displayData;
  }

  setRowValues(sheetName: string, rowIndex: number, values: unknown[], _options?: SheetWriteOptions): void {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);
    
    // rowIndex is 1-based
    const arrIndex = rowIndex - 1;
    if (arrIndex < 0 || arrIndex >= data.length) {
       throw new Error(`Row index out of bounds: ${rowIndex}`);
    }
    
    data[arrIndex] = values;
    this.updatedRows.push({ sheetName, rowIndex, values });
  }

  appendRow(sheetName: string, values: unknown[], _options?: SheetWriteOptions): void {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);
    
    data.push(values);
    this.appendedRows.push({ sheetName, values });
  }

  ensureSheetHeaders(sheetName: string, headers: string[], _options?: SheetWriteOptions): void {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) {
      this.inMemorySheets.set(sheetName, [headers]);
      return;
    }

    if (data.length === 0) {
      data.push(headers);
      return;
    }

    const firstRow = data[0] ?? [];
    const matchesExpectedHeaders = headers.every((header, index) => String(firstRow[index] ?? '').trim() === header);
    if (!matchesExpectedHeaders) {
      throw new Error(`Sheet "${sheetName}" does not match the expected header schema.`);
    }
  }

  setCellValue(sheetName: string, rowIndex: number, columnIndex: number, value: unknown, _options?: SheetWriteOptions): void {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);

    const row = data[rowIndex - 1];
    if (!row) {
      throw new Error(`Row index out of bounds: ${rowIndex}`);
    }

    row[columnIndex - 1] = value;
    this.updatedCells.push({ sheetName, rowIndex, columnIndex, value });
  }

  setCellNote(sheetName: string, rowIndex: number, columnIndex: number, note: string, _options?: SheetWriteOptions): void {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);

    const row = data[rowIndex - 1];
    if (!row) {
      throw new Error(`Row index out of bounds: ${rowIndex}`);
    }

    if (columnIndex <= 0 || columnIndex > row.length) {
      throw new Error(`Column index out of bounds: ${columnIndex}`);
    }

    this.updatedNotes.push({ sheetName, rowIndex, columnIndex, note });
  }

  setColumnBackground(sheetName: string, columnIndex: number, startRow: number, numRows: number, color: string, _options?: SheetWriteOptions): void {
    this.backgroundUpdates.push({ sheetName, columnIndex, startRow, numRows, color });
  }

  getUpdatesCount(): number {
    return this.updatedRows.length;
  }

  getAppendsCount(): number {
    return this.appendedRows.length;
  }

  getReadCount(sheetName: string, rangeA1?: string): number {
    return this.readCounts.get(this.getReadKey(sheetName, rangeA1)) ?? 0;
  }

  private getRangeValues<T>(data: T[][], rangeA1: string): T[][] {
    const [startCell, endCell = startCell] = rangeA1.split(':');
    const start = this.parseCellReference(startCell);
    const end = this.parseCellReference(endCell);

    const startRow = start.row ?? 1;
    const endRow = end.row ?? data.length;
    const startColumn = start.column ?? 0;
    const endColumn = end.column ?? Math.max(...data.map(row => row.length), 0) - 1;

    return data
      .slice(startRow - 1, endRow)
      .map(row => row.slice(startColumn, endColumn + 1));
  }

  private parseCellReference(reference: string): { row?: number; column?: number } {
    const match = reference.trim().match(/^([A-Za-z]+)?(\d+)?$/);
    if (!match) {
      throw new Error(`Unsupported A1 reference: ${reference}`);
    }

    const [, columnLabel, rowLabel] = match;
    return {
      column: columnLabel ? this.columnToIndex(columnLabel) : undefined,
      row: rowLabel ? parseInt(rowLabel, 10) : undefined,
    };
  }

  private columnToIndex(column: string): number {
    return column
      .toUpperCase()
      .split('')
      .reduce((total, character) => (total * 26) + character.charCodeAt(0) - 64, 0) - 1;
  }

  private getReadKey(sheetName: string, rangeA1?: string): string {
    return `${sheetName}::${rangeA1 ?? ''}`;
  }
}
