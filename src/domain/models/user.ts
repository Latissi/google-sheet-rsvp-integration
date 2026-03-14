import { Role, RoleDefinition } from './role';
import { TrainingDay } from './training';

export type NotificationChannel = 'email';
export type Gender = 'm' | 'w';

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
  gender?: Gender;
  role: Role;
  roleDefinition: RoleDefinition;
  personName: PersonName;
  subscriptions: TrainingSubscription[];
  subscribedTrainingIds: string[];
  subscribedTrainings: TrainingDay[];
}

export type UserRecord = UserProfile;

export function createCompositeMemberId(firstName: string, lastName: string): string {
  const normalizedFirstName = normalizeMemberIdPart(firstName);
  const normalizedLastName = normalizeMemberIdPart(lastName);

  if (!normalizedFirstName || !normalizedLastName) {
    return [normalizedFirstName, normalizedLastName].filter(Boolean).join('::');
  }

  return `${normalizedFirstName}::${normalizedLastName}`;
}

export function createCompositeMemberIdFromPersonName(personName: PersonName): string {
  return createCompositeMemberId(personName.firstName, personName.lastName);
}

export function parseGender(value: string): Gender {
  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === 'm' || normalizedValue === 'w') {
    return normalizedValue;
  }

  throw new Error(`Unsupported gender: "${value}"`);
}

export function createPersonName(firstName: string, lastName: string = ''): PersonName {
  const normalizedFirstName = sanitizePersonNamePart(firstName);
  const normalizedLastName = sanitizePersonNamePart(lastName);
  const fullName = [normalizedFirstName, normalizedLastName].filter(Boolean).join(' ').trim();

  return {
    firstName: normalizedFirstName,
    lastName: normalizedLastName,
    fullName,
  };
}

export function createPersonNameFromFullName(fullName: string): PersonName {
  const normalizedFullName = sanitizeFullName(fullName);
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

function normalizeMemberIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizePersonNamePart(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\p{S}\p{C}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeFullName(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\p{S}\p{C}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
