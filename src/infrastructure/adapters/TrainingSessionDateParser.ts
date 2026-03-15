import { TRAINING_DAYS, TrainingDefinition } from '../../domain/types';

const WEEKDAYS_FROM_SUNDAY: Array<'Sonntag' | 'Montag' | 'Dienstag' | 'Mittwoch' | 'Donnerstag' | 'Freitag' | 'Samstag'> = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
];

const GERMAN_WEEKDAY_MAP: Record<string, TrainingDefinition['day']> = {
  mo: 'Montag',
  di: 'Dienstag',
  mi: 'Mittwoch',
  do: 'Donnerstag',
  fr: 'Freitag',
  sa: 'Samstag',
  so: 'Sonntag',
};

export class TrainingSessionDateParser {
  constructor(private readonly nowProvider: () => Date = () => new Date()) {}

  parseHeader(value: unknown, previousSessionDate: string | null): string | null {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }

    const raw = String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!raw) {
      return null;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      return raw;
    }

    const germanShortDate = this.parseGermanShortDateHeader(raw, previousSessionDate);
    if (germanShortDate) {
      return germanShortDate;
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  deriveTrainingDay(sessionDate: string): TrainingDefinition['day'] | undefined {
    const date = new Date(`${sessionDate}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    const weekday = WEEKDAYS_FROM_SUNDAY[date.getUTCDay()];
    return (TRAINING_DAYS as readonly string[]).includes(weekday) ? weekday as TrainingDefinition['day'] : undefined;
  }

  private parseGermanShortDateHeader(raw: string, previousSessionDate: string | null): string | null {
    const match = raw.match(/^(Mo|Di|Mi|Do|Fr|Sa|So)\.?\s+(\d{1,2})\.\s*(\d{1,2})\.?$/i);
    if (!match) {
      return null;
    }

    const weekday = GERMAN_WEEKDAY_MAP[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const month = parseInt(match[3], 10);
    if (!weekday || !Number.isInteger(day) || !Number.isInteger(month)) {
      return null;
    }

    const candidates = this.getGermanShortDateCandidates(day, month, weekday, previousSessionDate);
    if (candidates.length === 0) {
      return null;
    }

    return candidates[0].toISOString().slice(0, 10);
  }

  private getGermanShortDateCandidates(
    day: number,
    month: number,
    expectedWeekday: TrainingDefinition['day'],
    previousSessionDate: string | null,
  ): Date[] {
    const referenceDate = previousSessionDate
      ? new Date(`${previousSessionDate}T00:00:00.000Z`)
      : this.getCurrentUtcDate();
    const years = previousSessionDate
      ? [referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1, referenceDate.getUTCFullYear() + 2]
      : [referenceDate.getUTCFullYear() - 1, referenceDate.getUTCFullYear(), referenceDate.getUTCFullYear() + 1];

    const candidates = years
      .map(year => this.createUtcDate(year, month, day))
      .filter((candidate): candidate is Date => candidate !== null)
      .filter(candidate => this.deriveTrainingDay(candidate.toISOString().slice(0, 10)) === expectedWeekday);

    if (previousSessionDate) {
      return candidates
        .filter(candidate => candidate.getTime() > referenceDate.getTime())
        .sort((left, right) => left.getTime() - right.getTime());
    }

    return candidates.sort((left, right) => {
      const leftDistance = Math.abs(left.getTime() - referenceDate.getTime());
      const rightDistance = Math.abs(right.getTime() - referenceDate.getTime());
      return leftDistance - rightDistance;
    });
  }

  private createUtcDate(year: number, month: number, day: number): Date | null {
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
      Number.isNaN(candidate.getTime())
      || candidate.getUTCFullYear() !== year
      || candidate.getUTCMonth() !== month - 1
      || candidate.getUTCDate() !== day
    ) {
      return null;
    }

    return candidate;
  }

  private getCurrentUtcDate(): Date {
    const now = this.nowProvider();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}