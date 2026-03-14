import { ReminderOffset, TrainingDefinition, TrainingSession } from '../../domain/types';

export function indexTrainingDefinitions(definitions: TrainingDefinition[]): Map<string, TrainingDefinition> {
  return new Map(definitions.map(definition => [definition.trainingId, definition]));
}

export function getSessionStartDate(session: TrainingSession): Date {
  return new Date(`${session.sessionDate}T${session.startTime}:00`);
}

export function isReminderDue(
  session: TrainingSession,
  reminderOffsets: ReminderOffset[],
  dispatchAt: Date,
  toleranceMinutes: number,
): boolean {
  const sessionStart = getSessionStartDate(session).getTime();
  return reminderOffsets.some(offset => {
    const offsetMinutes = offset.hours * 60 + offset.minutes;
    const triggerTime = sessionStart - (offsetMinutes * 60 * 1000);
    return Math.abs(triggerTime - dispatchAt.getTime()) <= toleranceMinutes * 60 * 1000;
  });
}

export function assertValidDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
}