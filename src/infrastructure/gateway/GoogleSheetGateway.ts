import { ISheetGateway } from './ISheetGateway';

export class GoogleSheetGateway implements ISheetGateway {
  private spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet;

  constructor() {
    this.spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!this.spreadsheet) {
      throw new Error('GoogleSheetGateway must be executed in a container-bound script context.');
    }
  }

  getSheetValues(sheetName: string): unknown[][] {
    const sheet = this.spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet with name "${sheetName}" not found.`);
    }
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) return [];
    return sheet.getRange(1, 1, lastRow, lastCol).getValues();
  }

  setRowValues(sheetName: string, rowIndex: number, values: unknown[]): void {
    const sheet = this.spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet with name "${sheetName}" not found.`);
    }
    sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  }

  appendRow(sheetName: string, values: unknown[]): void {
    const sheet = this.spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet with name "${sheetName}" not found.`);
    }
    sheet.appendRow(values);
  }
}
