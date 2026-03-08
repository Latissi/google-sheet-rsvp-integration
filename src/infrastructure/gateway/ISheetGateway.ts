export interface ISheetGateway {
  getSheetValues(sheetName: string): unknown[][];
  setRowValues(sheetName: string, rowIndex: number, values: unknown[]): void;
  appendRow(sheetName: string, values: unknown[]): void;
}
