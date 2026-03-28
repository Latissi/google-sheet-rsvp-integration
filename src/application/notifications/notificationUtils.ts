import { getReminderOffsetMinutes, ReminderOffset, TrainingDefinition, TrainingSession } from '../../domain/types';

export function indexTrainingDefinitions(definitions: TrainingDefinition[]): Map<string, TrainingDefinition> {
  return new Map(definitions.map(definition => [definition.trainingId, definition]));
}

export function getSessionStartDate(session: TrainingSession): Date {
  return new Date(`${session.sessionDate}T${session.startTime}:00`);
}

export function getReminderTriggerTime(session: TrainingSession, offset: ReminderOffset): number {
  const sessionStart = getSessionStartDate(session).getTime();
  const offsetMinutes = getReminderOffsetMinutes(offset);
  return sessionStart - (offsetMinutes * 60 * 1000);
}

export function getReminderWindowStart(
  dispatchAt: Date,
  previousDispatchAt: Date | null,
  fallbackWindowMinutes: number,
): Date {
  if (previousDispatchAt && previousDispatchAt.getTime() < dispatchAt.getTime()) {
    return previousDispatchAt;
  }

  return new Date(dispatchAt.getTime() - (fallbackWindowMinutes * 60 * 1000));
}

export function getDueReminderOffset(
  session: TrainingSession,
  reminderOffsets: ReminderOffset[],
  previousDispatchAt: Date,
  dispatchAt: Date,
): ReminderOffset | null {
  const dueOffsets = reminderOffsets
    .filter(offset => {
      const triggerTime = getReminderTriggerTime(session, offset);
      return triggerTime > previousDispatchAt.getTime() && triggerTime <= dispatchAt.getTime();
    })
    .sort((left, right) => getReminderTriggerTime(session, right) - getReminderTriggerTime(session, left));

  return dueOffsets[0] ?? null;
}

export function assertValidDate(value: Date, label: string): void {
  if (Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }
}