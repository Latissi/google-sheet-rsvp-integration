import {
  ISheetGateway,
  SheetAccessOptions,
  SheetWriteOptions,
} from '../../infrastructure/gateway/ISheetGateway';

export class MockSheetGateway implements ISheetGateway {
  private inMemorySheets: Map<string, unknown[][]>;
  private notes: Map<string, string> = new Map();
  public appendedRows: Array<{ sheetName: string, values: unknown[] }> = [];
  public updatedRows: Array<{ sheetName: string, rowIndex: number, values: unknown[] }> = [];
  public updatedCells: Array<{ sheetName: string, rowIndex: number, columnIndex: number, value: unknown }> = [];

  constructor(initialData: { [sheetName: string]: unknown[][] } = {}) {
    this.inMemorySheets = new Map(Object.entries(initialData));
  }

  getSheetValues(sheetName: string, options?: SheetAccessOptions): unknown[][] {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);
    if (options?.rangeA1) {
      return this.getRangeValues(data, options.rangeA1);
    }
    return data;
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

  getCellNote(sheetName: string, rowIndex: number, columnIndex: number, _options?: SheetAccessOptions): string {
    return this.notes.get(this.getNoteKey(sheetName, rowIndex, columnIndex)) ?? '';
  }

  setCellNote(sheetName: string, rowIndex: number, columnIndex: number, note: string, _options?: SheetWriteOptions): void {
    this.notes.set(this.getNoteKey(sheetName, rowIndex, columnIndex), note);
  }

  getUpdatesCount(): number {
    return this.updatedRows.length;
  }

  getAppendsCount(): number {
    return this.appendedRows.length;
  }

  private getRangeValues(data: unknown[][], rangeA1: string): unknown[][] {
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

  private getNoteKey(sheetName: string, rowIndex: number, columnIndex: number): string {
    return `${sheetName}:${rowIndex}:${columnIndex}`;
  }
}
