import {
  getIsoWeekKey,
  RUNTIME_LOG_SHEET_NAME,
  sanitizeLogContext,
  sanitizeLogMessage,
  WeeklySheetRuntimeLogger,
} from '../../runtime/logging';

interface FakeSheetRecord {
  rows: string[][];
}

function createFakeAppsScriptEnvironment() {
  const properties = new Map<string, string>();
  const sheets = new Map<string, FakeSheetRecord>();

  const getOrCreateSheet = (name: string): FakeSheetRecord => {
    const existing = sheets.get(name);
    if (existing) {
      return existing;
    }

    const created = { rows: [] };
    sheets.set(name, created);
    return created;
  };

  const spreadsheet = {
    getSheetByName(name: string) {
      const sheetRecord = sheets.get(name);
      if (!sheetRecord) {
        return null;
      }

      return createSheetApi(sheetRecord);
    },
    insertSheet(name: string) {
      return createSheetApi(getOrCreateSheet(name));
    },
  };

  function createSheetApi(sheetRecord: FakeSheetRecord) {
    return {
      getLastRow() {
        return sheetRecord.rows.length;
      },
      clearContents() {
        sheetRecord.rows = [];
      },
      getRange(row: number, column: number, numRows: number, numColumns: number) {
        return {
          setValues(values: string[][]) {
            for (let rowOffset = 0; rowOffset < numRows; rowOffset += 1) {
              const targetRowIndex = row - 1 + rowOffset;
              const existingRow = sheetRecord.rows[targetRowIndex] ?? [];
              const nextRow = [...existingRow];
              for (let columnOffset = 0; columnOffset < numColumns; columnOffset += 1) {
                nextRow[column - 1 + columnOffset] = values[rowOffset][columnOffset];
              }
              sheetRecord.rows[targetRowIndex] = nextRow;
            }
          },
        };
      },
      appendRow(values: string[]) {
        sheetRecord.rows.push(values);
      },
    };
  }

  (globalThis as unknown as { SpreadsheetApp: unknown }).SpreadsheetApp = {
    getActiveSpreadsheet() {
      return spreadsheet;
    },
  };

  (globalThis as unknown as { PropertiesService: unknown }).PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(key: string) {
          return properties.get(key) ?? null;
        },
        setProperty(key: string, value: string) {
          properties.set(key, value);
        },
      };
    },
  };

  return {
    properties,
    sheets,
  };
}

describe('runtime logging helpers', () => {
  afterEach(() => {
    delete (globalThis as unknown as { SpreadsheetApp?: unknown }).SpreadsheetApp;
    delete (globalThis as unknown as { PropertiesService?: unknown }).PropertiesService;
  });

  it('sanitizes sensitive message fragments', () => {
    expect(sanitizeLogMessage('Missing required ScriptProperty: WEBAPPURL for admin@example.com at https://example.test')).toBe(
      'Missing required ScriptProperty: WEBAPPURL for [redacted-email] at [redacted-url]',
    );
  });

  it('removes sensitive context keys', () => {
    expect(sanitizeLogContext({
      memberId: 'ada::lovelace',
      sessionId: 'session-1',
      email: 'user@example.com',
      fullName: 'Ada Lovelace',
      gender: 'w',
      sentCount: 3,
    })).toEqual({
      sessionId: 'session-1',
      sentCount: 3,
    });
  });

  it('returns ISO week keys', () => {
    expect(getIsoWeekKey(new Date('2026-03-14T12:00:00.000Z'))).toBe('2026-KW11');
  });

  it('overwrites the private log sheet when a new week starts', () => {
    const fakeEnvironment = createFakeAppsScriptEnvironment();
    let currentDate = new Date('2026-03-09T10:00:00.000Z');
    const logger = new WeeklySheetRuntimeLogger(() => currentDate);

    logger.info('runReminderDispatch', 'start', { dispatchAt: currentDate.toISOString() });
    const firstWeekRows = fakeEnvironment.sheets.get(RUNTIME_LOG_SHEET_NAME)?.rows ?? [];
    expect(firstWeekRows).toHaveLength(2);
    expect(firstWeekRows[0][0]).toBe('Zeitstempel');
    expect(firstWeekRows[1][3]).toBe('runReminderDispatch');

    currentDate = new Date('2026-03-16T10:00:00.000Z');
    logger.info('runReminderDispatch', 'start', { dispatchAt: currentDate.toISOString() });

    const secondWeekRows = fakeEnvironment.sheets.get(RUNTIME_LOG_SHEET_NAME)?.rows ?? [];
    expect(secondWeekRows).toHaveLength(2);
    expect(secondWeekRows[1][1]).toBe('2026-KW12');
    expect(fakeEnvironment.properties.get('RUNTIME_LOG_ACTIVE_WEEK')).toBe('2026-KW12');
  });
});