export type RuntimeLogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface RuntimeLogContext {
  [key: string]: unknown;
}

export const RUNTIME_LOG_SHEET_NAME = 'Systemprotokoll';

const LOG_WEEK_PROPERTY_KEY = 'RUNTIME_LOG_ACTIVE_WEEK';
const MAX_LOG_MESSAGE_LENGTH = 220;
const SENSITIVE_KEY_PATTERN = /(memberid|email|mail|name|firstname|lastname|fullname|gender|url|sheetid|spreadsheetid|webapp|trainer_email|private_sheets_id)/i;
const LOG_HEADERS = ['Zeitstempel', 'Woche', 'Level', 'Operation', 'Ereignis', 'Nachricht', 'Kontext'];

export function getIsoWeekKey(date: Date): string {
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);

  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-KW${String(weekNumber).padStart(2, '0')}`;
}

export function sanitizeLogMessage(message: string): string {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/"[^"]{2,}"/g, '"[redacted]"')
    .replace(/'[^']{2,}'/g, "'[redacted]'")
    .slice(0, MAX_LOG_MESSAGE_LENGTH);
}

export function sanitizeLogContext(context: RuntimeLogContext = {}): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};

  Object.entries(context).forEach(([key, value]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      return;
    }

    const sanitizedValue = sanitizeLogValue(value);
    if (sanitizedValue !== undefined) {
      sanitized[key] = sanitizedValue;
    }
  });

  return sanitized;
}

function sanitizeLogValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string') {
    return sanitizeLogMessage(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const primitiveItems = value
      .map(item => sanitizeLogValue(item))
      .filter((item): item is string | number | boolean => item !== undefined);
    return primitiveItems.length > 0 ? primitiveItems.join(',') : undefined;
  }

  return undefined;
}

export class WeeklySheetRuntimeLogger {
  constructor(
    private readonly nowProvider: () => Date = () => new Date(),
    private readonly sheetName: string = RUNTIME_LOG_SHEET_NAME,
    private readonly weekPropertyKey: string = LOG_WEEK_PROPERTY_KEY,
  ) {}

  info(operation: string, event: string, context?: RuntimeLogContext, message: string = ''): void {
    this.write('INFO', operation, event, message, context);
  }

  warn(operation: string, event: string, context?: RuntimeLogContext, message: string = ''): void {
    this.write('WARN', operation, event, message, context);
  }

  error(operation: string, event: string, error: unknown, context?: RuntimeLogContext): void {
    const message = error instanceof Error ? error.message : String(error);
    this.write('ERROR', operation, event, message, context);
  }

  private write(
    level: RuntimeLogLevel,
    operation: string,
    event: string,
    message: string,
    context?: RuntimeLogContext,
  ): void {
    const timestamp = this.nowProvider().toISOString();
    const weekKey = getIsoWeekKey(new Date(timestamp));
    const safeMessage = sanitizeLogMessage(message);
    const safeContext = sanitizeLogContext(context);
    const serializedContext = JSON.stringify(safeContext);

    this.writeConsole(level, operation, event, safeMessage, serializedContext);
    this.writeSheetRow([timestamp, weekKey, level, operation, event, safeMessage, serializedContext], weekKey);
  }

  private writeConsole(
    level: RuntimeLogLevel,
    operation: string,
    event: string,
    message: string,
    serializedContext: string,
  ): void {
    const text = `[${level}][${operation}] ${event}${message ? `: ${message}` : ''}`;

    if (level === 'ERROR') {
      console.error(text, serializedContext);
      return;
    }

    if (level === 'WARN') {
      console.warn(text, serializedContext);
      return;
    }

    console.log(text, serializedContext);
  }

  private writeSheetRow(values: string[], weekKey: string): void {
    if (typeof SpreadsheetApp === 'undefined' || typeof PropertiesService === 'undefined') {
      return;
    }

    try {
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      if (!spreadsheet) {
        return;
      }

      const properties = PropertiesService.getScriptProperties();
      let sheet = spreadsheet.getSheetByName(this.sheetName);
      if (!sheet) {
        sheet = spreadsheet.insertSheet(this.sheetName);
      }

      const activeWeek = properties.getProperty(this.weekPropertyKey);
      if (activeWeek !== weekKey || sheet.getLastRow() === 0) {
        sheet.clearContents();
        sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]);
        properties.setProperty(this.weekPropertyKey, weekKey);
      }

      sheet.appendRow(values);
    } catch (error) {
      const fallbackMessage = error instanceof Error ? error.message : String(error);
      console.error('[ERROR][runtime-logger] sheet-write-failed', sanitizeLogMessage(fallbackMessage));
    }
  }
}

const runtimeLogger = new WeeklySheetRuntimeLogger();

export function getRuntimeLogger(): WeeklySheetRuntimeLogger {
  return runtimeLogger;
}