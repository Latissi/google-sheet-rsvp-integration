export interface SheetAccessOptions {
  spreadsheetId?: string;
  rangeA1?: string;
}

export interface SheetWriteOptions {
  spreadsheetId?: string;
}

export interface ISheetGateway {
  getSheetValues(sheetName: string, options?: SheetAccessOptions): unknown[][];
  getSheetDisplayValues(sheetName: string, options?: SheetAccessOptions): string[][];
  setRowValues(sheetName: string, rowIndex: number, values: unknown[], options?: SheetWriteOptions): void;
  appendRow(sheetName: string, values: unknown[], options?: SheetWriteOptions): void;
  ensureSheetHeaders(sheetName: string, headers: string[], options?: SheetWriteOptions): void;
  setCellValue(sheetName: string, rowIndex: number, columnIndex: number, value: unknown, options?: SheetWriteOptions): void;
  setCellNote(sheetName: string, rowIndex: number, columnIndex: number, note: string, options?: SheetWriteOptions): void;
  setColumnBackground(sheetName: string, columnIndex: number, startRow: number, numRows: number, color: string, options?: SheetWriteOptions): void;
}
