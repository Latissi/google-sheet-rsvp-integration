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

  getSheetDisplayValues(sheetName: string, options?: SheetAccessOptions): string[][] {
    const sheet = this.getSheet(sheetName, options);
    if (options?.rangeA1) {
      return sheet.getRange(options.rangeA1).getDisplayValues();
    }

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) return [];
    return sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  }

  setRowValues(sheetName: string, rowIndex: number, values: unknown[], options?: SheetWriteOptions): void {
    const sheet = this.getSheet(sheetName, options);
    sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
    SpreadsheetApp.flush();
  }

  setCellValue(sheetName: string, rowIndex: number, columnIndex: number, value: unknown, options?: SheetWriteOptions): void {
    const sheet = this.getSheet(sheetName, options);
    sheet.getRange(rowIndex, columnIndex, 1, 1).setValue(value);
    SpreadsheetApp.flush();
  }

  setColumnBackground(sheetName: string, columnIndex: number, startRow: number, numRows: number, color: string, options?: SheetWriteOptions): void {
    const sheet = this.getSheet(sheetName, options);
    sheet.getRange(startRow, columnIndex, numRows, 1).setBackground(color);
    SpreadsheetApp.flush();
  }

  appendRow(sheetName: string, values: unknown[], options?: SheetWriteOptions): void {
    const sheet = this.getSheet(sheetName, options);
    sheet.appendRow(values);
    SpreadsheetApp.flush();
  }

  ensureSheetHeaders(sheetName: string, headers: string[], options?: SheetWriteOptions): void {
    const spreadsheet = this.getSpreadsheet(options?.spreadsheetId);
    let sheet = spreadsheet.getSheetByName(sheetName);

    if (!sheet) {
      sheet = spreadsheet.insertSheet(sheetName);
    }

    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow === 0 || lastColumn === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      return;
    }

    const existingHeaders = sheet.getRange(1, 1, 1, Math.max(lastColumn, headers.length)).getDisplayValues()[0] ?? [];
    const matchesExpectedHeaders = headers.every((header, index) => String(existingHeaders[index] ?? '').trim() === header);
    if (!matchesExpectedHeaders) {
      throw new Error(`Sheet "${sheetName}" does not match the expected header schema.`);
    }
  }
}
