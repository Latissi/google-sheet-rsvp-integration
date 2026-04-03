export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getColumnIndex(headers: unknown[], candidates: string[]): number | undefined {
  const normalizedCandidates = new Set(candidates.map(candidate => normalizeHeader(candidate)));
  const index = headers.findIndex(header => normalizedCandidates.has(normalizeHeader(header)));
  return index === -1 ? undefined : index;
}

export function getRequiredColumnIndex(headers: unknown[], candidates: string[]): number {
  const index = getColumnIndex(headers, candidates);
  if (index === undefined) {
    throw new Error(`Missing required user sheet column: ${candidates[0]}`);
  }
  return index;
}

export function getCellValue(row: unknown[], index?: number): string {
  if (index === undefined || index < 0 || index >= row.length) {
    return '';
  }
  const value = row[index];
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value ?? '').trim();
}

export function parseDelimitedList(value: string): string[] {
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}
