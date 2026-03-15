export interface SheetAccessOptions {
  spreadsheetId?: string;
  rangeA1?: string;
}

export interface SheetWriteOptions {
  spreadsheetId?: string;
}

export interface ISheetGateway {
  getSheetValues(sheetName: string, options?: SheetAccessOptions): unknown[][];
  setRowValues(sheetName: string, rowIndex: number, values: unknown[], options?: SheetWriteOptions): void;
  appendRow(sheetName: string, values: unknown[], options?: SheetWriteOptions): void;
  getCellNote(sheetName: string, rowIndex: number, columnIndex: number, options?: SheetAccessOptions): string;
  setCellNote(sheetName: string, rowIndex: number, columnIndex: number, note: string, options?: SheetWriteOptions): void;
  setCellValue(sheetName: string, rowIndex: number, columnIndex: number, value: unknown, options?: SheetWriteOptions): void;
}
