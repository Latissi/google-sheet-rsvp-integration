import { Role, RoleDefinition } from './role';
import { TrainingDay } from './training';

export type NotificationChannel = 'email';

export interface PersonName {
  firstName: string;
  lastName: string;
  fullName: string;
}

export interface TrainingSubscription {
  trainingId: string;
  notificationChannel: NotificationChannel;
}

export interface UserProfile {
  memberId: string;
  name: string;
  email: string;
  role: Role;
  roleDefinition: RoleDefinition;
  personName: PersonName;
  subscriptions: TrainingSubscription[];
  subscribedTrainingIds: string[];
  subscribedTrainings: TrainingDay[];
}

export type UserRecord = UserProfile;

export function createPersonName(firstName: string, lastName: string = ''): PersonName {
  const normalizedFirstName = firstName.trim();
  const normalizedLastName = lastName.trim();
  const fullName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ').trim();

  return {
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    fullName,
  };
}

export function createPersonNameFromFullName(fullName: string): PersonName {
  const normalizedFullName = fullName.trim();
  if (!normalizedFullName) {
    return createPersonName('', '');
  }

  const parts = normalizedFullName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return createPersonName(parts[0], '');
  }

  const lastName = parts.pop() ?? '';
  return createPersonName(parts.join(' '), lastName);
}
