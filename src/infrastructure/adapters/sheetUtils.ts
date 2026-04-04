/**
 * Returns true when a sheet row is absent or contains only blank cells.
 * Use this instead of inlining `row.every(cell => ...)` in adapter row-loops.
 */
export function isEmptyRow(row: unknown[] | undefined): boolean {
  return !row || row.every(cell => String(cell ?? '').trim() === '');
}

/**
 * Normalizes a raw cell or header value to a lowercase alphanumeric string.
 * Used by SheetTableUtils.normalizeSheetText and SheetColumnMapper.normalizeHeader
 * so that both produce identical results from a single implementation.
 */
export function normalizeSheetString(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}
