export type Role = 'Mitglied' | 'Trainer';
export type TrainingDay = 'Montag' | 'Dienstag' | 'Mittwoch' | 'Donnerstag' | 'Freitag' | 'Samstag' | 'Sonntag';

export interface UserRecord {
  memberId: string;
  name: string;
  email: string;
  role: Role;
  subscribedTrainings: TrainingDay[];
}

export interface AttendanceConfig {
  startColumn: string;
}
