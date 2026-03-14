export const TRAINING_DAYS = [
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;

export type TrainingDay = typeof TRAINING_DAYS[number];

export type TrainingEnvironment = 'Indoor' | 'Outdoor';
export type TrainingAudience = 'Mixed' | 'SingleGender';
export type TrainingSessionStatus = 'Scheduled' | 'Cancelled' | 'Completed';

export interface TrainingDefinition {
  trainingId: string;
  title: string;
  day: TrainingDay;
  startTime: string;
  endTime?: string;
  location?: string;
  environment?: TrainingEnvironment;
  audience?: TrainingAudience;
  description?: string;
}

export interface TrainingSession {
  sessionId: string;
  trainingId: string;
  sessionDate: string;
  startTime: string;
  endTime?: string;
  location?: string;
  status: TrainingSessionStatus;
}
