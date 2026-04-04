import { ReminderOffset, TrainingSession } from '../../domain/types';
import {
  indexTrainingDefinitions,
  getSessionStartDate,
  getReminderTriggerTime,
  getReminderWindowStart,
  getDueReminderOffset,
} from '../../application/notifications/notificationUtils';

const SESSION: TrainingSession = {
  sessionId: 'wed-mixed-2026-03-11',
  trainingId: 'wed-mixed',
  sessionDate: '2026-03-11',
  startTime: '18:00',
  status: 'Scheduled',
};

const ONE_HOUR_BEFORE: ReminderOffset = { hours: 1, minutes: 0 };
const TWO_HOURS_BEFORE: ReminderOffset = { hours: 2, minutes: 0 };

describe('notificationUtils', () => {
  describe('indexTrainingDefinitions', () => {
    it('builds a map keyed by trainingId', () => {
      const definitions = [
        { trainingId: 'wed', day: 'Mittwoch' as const, title: 'Wed', startTime: '18:00', location: 'Hall' },
        { trainingId: 'fri', day: 'Freitag' as const, title: 'Fri', startTime: '17:00', location: 'Hall' },
      ];
      const index = indexTrainingDefinitions(definitions);
      expect(index.get('wed')?.title).toBe('Wed');
      expect(index.get('fri')?.title).toBe('Fri');
      expect(index.size).toBe(2);
    });

    it('returns an empty map for empty input', () => {
      expect(indexTrainingDefinitions([])).toEqual(new Map());
    });
  });

  describe('getSessionStartDate', () => {
    it('combines sessionDate and startTime into a Date', () => {
      const date = getSessionStartDate(SESSION);
      expect(date.toISOString()).toBe('2026-03-11T18:00:00.000Z');
    });
  });

  describe('getReminderTriggerTime', () => {
    it('returns session start minus the offset in milliseconds', () => {
      const sessionStart = getSessionStartDate(SESSION).getTime();
      const triggerTime = getReminderTriggerTime(SESSION, ONE_HOUR_BEFORE);
      expect(triggerTime).toBe(sessionStart - 60 * 60 * 1000);
    });

    it('handles zero-offset offsets (triggers exactly at session start)', () => {
      const sessionStart = getSessionStartDate(SESSION).getTime();
      const triggerTime = getReminderTriggerTime(SESSION, { hours: 0, minutes: 0 });
      expect(triggerTime).toBe(sessionStart);
    });
  });

  describe('getReminderWindowStart', () => {
    const dispatchAt = new Date('2026-03-11T17:00:00.000Z');

    it('uses previousDispatchAt when it is before dispatchAt', () => {
      const prev = new Date('2026-03-11T16:00:00.000Z');
      expect(getReminderWindowStart(dispatchAt, prev, 60)).toEqual(prev);
    });

    it('uses fallback window when previousDispatchAt is null', () => {
      const result = getReminderWindowStart(dispatchAt, null, 60);
      expect(result.toISOString()).toBe('2026-03-11T16:00:00.000Z');
    });

    it('uses fallback window when previousDispatchAt equals dispatchAt', () => {
      const result = getReminderWindowStart(dispatchAt, dispatchAt, 30);
      expect(result.toISOString()).toBe('2026-03-11T16:30:00.000Z');
    });
  });

  describe('getDueReminderOffset', () => {
    const sessionStart = getSessionStartDate(SESSION).getTime(); // 2026-03-11T18:00:00Z

    it('returns the offset whose trigger time falls in the dispatch window', () => {
      // window: 16:30 → 17:30; ONE_HOUR_BEFORE triggers at 17:00 → inside window
      const prevDispatch = new Date(sessionStart - 90 * 60 * 1000); // 16:30
      const dispatch = new Date(sessionStart - 30 * 60 * 1000);     // 17:30
      const result = getDueReminderOffset(SESSION, [ONE_HOUR_BEFORE, TWO_HOURS_BEFORE], prevDispatch, dispatch);
      expect(result).toEqual(ONE_HOUR_BEFORE);
    });

    it('returns null when no offset falls in the window', () => {
      // window: 16:00 → 16:30; neither 1h nor 2h before 18:00 falls inside
      const prevDispatch = new Date(sessionStart - 120 * 60 * 1000); // 16:00
      const dispatch = new Date(sessionStart - 90 * 60 * 1000);      // 16:30
      const result = getDueReminderOffset(SESSION, [ONE_HOUR_BEFORE], prevDispatch, dispatch);
      expect(result).toBeNull();
    });

    it('returns the latest-triggering offset when multiple offsets are due', () => {
      // window covers both 1h and 2h before: prevDispatch at 15:30, dispatch at 17:30
      const prevDispatch = new Date(sessionStart - 150 * 60 * 1000); // 15:30
      const dispatch = new Date(sessionStart - 30 * 60 * 1000);      // 17:30
      // ONE_HOUR_BEFORE triggers at 17:00, TWO_HOURS_BEFORE at 16:00 — latest is 17:00
      const result = getDueReminderOffset(SESSION, [ONE_HOUR_BEFORE, TWO_HOURS_BEFORE], prevDispatch, dispatch);
      expect(result).toEqual(ONE_HOUR_BEFORE);
    });
  });
});
