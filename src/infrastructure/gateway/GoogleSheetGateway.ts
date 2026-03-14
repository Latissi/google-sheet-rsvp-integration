import { ISheetGateway, SheetAccessOptions, SheetWriteOptions } from './ISheetGateway';

export class GoogleSheetGateway implements ISheetGateway {
  private getSpreadsheet(spreadsheetId?: string): GoogleAppsScript.Spreadsheet.Spreadsheet {
    if (spreadsheetId) {
      return SpreadsheetApp.openById(spreadsheetId);
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (!spreadsheet) {
      throw new Error('GoogleSheetGateway must be executed in a container-bound script context.');
    }

    return spreadsheet;
  }

  private getSheet(sheetName: string, options?: SheetWriteOptions): GoogleAppsScript.Spreadsheet.Sheet {
    const sheet = this.getSpreadsheet(options?.spreadsheetId).getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(`Sheet with name "${sheetName}" not found.`);
    }

    return sheet;
  }

  getSheetValues(sheetName: string, options?: SheetAccessOptions): unknown[][] {
    const sheet = this.getSheet(sheetName, options);
    if (options?.rangeA1) {
      return sheet.getRange(options.rangeA1).getValues();
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) return [];
    return sheet.getRange(1, 1, lastRow, lastCol).getValues();
  }

  setRowValues(sheetName: string, rowIndex: number, values: unknown[], options?: SheetWriteOptions): void {
    const sheet = this.getSheet(sheetName, options);
    sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  }

  appendRow(sheetName: string, values: unknown[], options?: SheetWriteOptions): void {
    const sheet = this.getSheet(sheetName, options);
    sheet.appendRow(values);
  }
}
