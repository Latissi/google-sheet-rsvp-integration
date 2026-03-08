import { ISheetGateway } from '../../infrastructure/gateway/ISheetGateway';

export class MockSheetGateway implements ISheetGateway {
  private inMemorySheets: Map<string, unknown[][]>;
  public appendedRows: Array<{ sheetName: string, values: unknown[] }> = [];
  public updatedRows: Array<{ sheetName: string, rowIndex: number, values: unknown[] }> = [];

  constructor(initialData: { [sheetName: string]: unknown[][] } = {}) {
    this.inMemorySheets = new Map(Object.entries(initialData));
  }

  getSheetValues(sheetName: string): unknown[][] {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);
    return data;
  }

  setRowValues(sheetName: string, rowIndex: number, values: unknown[]): void {
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

  appendRow(sheetName: string, values: unknown[]): void {
    const data = this.inMemorySheets.get(sheetName);
    if (!data) throw new Error(`Sheet with name "${sheetName}" not found.`);
    
    data.push(values);
    this.appendedRows.push({ sheetName, values });
  }

  getUpdatesCount(): number {
    return this.updatedRows.length;
  }

  getAppendsCount(): number {
    return this.appendedRows.length;
  }
}
