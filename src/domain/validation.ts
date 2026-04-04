/**
 * Throws if the Date value is invalid (NaN time).
 */
export function assertValidDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
}

/**
 * Throws if the ISO 8601 timestamp string cannot be parsed to a valid Date.
 */
export function assertValidIsoTimestamp(value: string, label: string): void {
  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
}
