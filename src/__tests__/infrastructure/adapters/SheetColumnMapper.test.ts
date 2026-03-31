import {
  getColumnIndex,
  getRequiredColumnIndex,
  getCellValue,
  normalizeHeader,
  parseDelimitedList,
} from '../../../infrastructure/adapters/SheetColumnMapper';

describe('SheetColumnMapper', () => {
  describe('getColumnIndex', () => {
    it('returns the index when the column header is present', () => {
      expect(getColumnIndex(['Vorname', 'Nachname', 'EMail'], ['EMail'])).toBe(2);
    });

    it('returns undefined when the column header is absent', () => {
      expect(getColumnIndex(['Vorname', 'Nachname', 'EMail'], ['AbonnierteTrainings'])).toBeUndefined();
    });

    it('returns undefined for an empty headers array', () => {
      expect(getColumnIndex([], ['Vorname'])).toBeUndefined();
    });

    it('matches headers case-insensitively and ignores non-alphanumeric characters', () => {
      expect(getColumnIndex(['E-Mail'], ['EMail'])).toBe(0);
      expect(getColumnIndex(['VORNAME'], ['Vorname'])).toBe(0);
    });
  });

  describe('getRequiredColumnIndex', () => {
    it('returns the index when the column is present', () => {
      expect(getRequiredColumnIndex(['Vorname', 'EMail'], ['EMail'])).toBe(1);
    });

    it('throws when the required column is absent', () => {
      expect(() => getRequiredColumnIndex(['Vorname', 'Nachname'], ['EMail'])).toThrow(
        'Missing required user sheet column: EMail',
      );
    });
  });

  describe('getCellValue', () => {
    it('returns the trimmed string value at the given index', () => {
      expect(getCellValue(['a', ' b ', 'c'], 1)).toBe('b');
    });

    it('returns empty string for out-of-bounds index', () => {
      expect(getCellValue(['a', 'b'], 5)).toBe('');
    });

    it('returns empty string for negative index', () => {
      expect(getCellValue(['a', 'b'], -1)).toBe('');
    });

    it('returns empty string for undefined index', () => {
      expect(getCellValue(['a', 'b'], undefined)).toBe('');
    });
  });

  describe('normalizeHeader', () => {
    it('lowercases, trims, and strips non-alphanumeric characters', () => {
      expect(normalizeHeader(' E-Mail ')).toBe('email');
      expect(normalizeHeader('AbonnierteTrainingsIds')).toBe('abonniertetrainingsids');
    });
  });

  describe('parseDelimitedList', () => {
    it('splits on commas and trims entries', () => {
      expect(parseDelimitedList('wed-mixed, fri-outdoor')).toEqual(['wed-mixed', 'fri-outdoor']);
    });

    it('filters out empty entries', () => {
      expect(parseDelimitedList('wed-mixed,,fri-outdoor')).toEqual(['wed-mixed', 'fri-outdoor']);
    });

    it('returns empty array for empty string', () => {
      expect(parseDelimitedList('')).toEqual([]);
    });
  });
});
