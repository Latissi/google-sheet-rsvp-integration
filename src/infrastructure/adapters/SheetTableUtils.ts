import { PublicTrainingSource } from '../../domain/types';

export interface TableBounds {
  startRow: number;
  startColumn: number;
}

export function columnToIndex(column: string): number {
  return column
    .toUpperCase()
    .split('')
    .reduce((total, character) => (total * 26) + character.charCodeAt(0) - 64, 0) - 1;
}

export function getTableBounds(rangeA1?: string): TableBounds {
  if (!rangeA1) {
    return { startRow: 1, startColumn: 0 };
  }

  const startCell = rangeA1.split(':')[0];
  const match = startCell.match(/^([A-Za-z]+)?(\d+)?$/);
  if (!match) {
    return { startRow: 1, startColumn: 0 };
  }

  const columnLabel = match[1] ?? 'A';
  const rowLabel = match[2] ?? '1';
  return {
    startRow: parseInt(rowLabel, 10),
    startColumn: columnToIndex(columnLabel),
  };
}

export function getRelativeColumnIndex(columnA1: string, bounds: TableBounds): number {
  const absoluteColumnIndex = columnToIndex(columnA1.replace(/[^A-Za-z]/g, ''));
  return absoluteColumnIndex - bounds.startColumn;
}

export function getMemberStartRowIndex(source: PublicTrainingSource, bounds: TableBounds, tableHeight: number): number {
  const relativeIndex = source.attendance.firstMemberRow - bounds.startRow;
  if (!Number.isInteger(relativeIndex) || relativeIndex < 0) {
    throw new Error(`Public training source "${source.sourceId}" defines firstMemberRow outside of tableRange.`);
  }
  return Math.min(relativeIndex, tableHeight);
}

export function getMemberRowsFirstNameIndex(source: PublicTrainingSource, bounds: TableBounds): number {
  return getRelativeColumnIndex(source.attendance.firstNameColumn, bounds);
}

export function getMemberRowsLastNameIndex(source: PublicTrainingSource, bounds: TableBounds): number {
  return getRelativeColumnIndex(source.attendance.lastNameColumn, bounds);
}

import { normalizeSheetString } from './sheetUtils';

export function normalizeSheetText(value: unknown): string {
  return normalizeSheetString(value);
}
