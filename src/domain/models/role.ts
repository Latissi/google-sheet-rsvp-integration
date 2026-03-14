export type Role = 'Mitglied' | 'Trainer';

export interface RoleCapabilities {
  canRsvpToTraining: boolean;
  canCancelTraining: boolean;
  receivesParticipationReportEmail: boolean;
  canViewMemberContactData: boolean;
}

export interface RoleDefinition {
  roleId: Role;
  displayName: string;
  capabilities: RoleCapabilities;
}

const MEMBER_ROLE: RoleDefinition = {
  roleId: 'Mitglied',
  displayName: 'Mitglied',
  capabilities: {
    canRsvpToTraining: true,
    canCancelTraining: false,
    receivesParticipationReportEmail: false,
    canViewMemberContactData: false,
  },
};

const TRAINER_ROLE: RoleDefinition = {
  roleId: 'Trainer',
  displayName: 'Trainer',
  capabilities: {
    canRsvpToTraining: true,
    canCancelTraining: true,
    receivesParticipationReportEmail: true,
    canViewMemberContactData: true,
  },
};

export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  Mitglied: MEMBER_ROLE,
  Trainer: TRAINER_ROLE,
};

export function isRole(value: string): value is Role {
  return value === 'Mitglied' || value === 'Trainer';
}

export function parseRole(value: string): Role {
  const normalizedValue = value.trim().toLowerCase();
  const mappedValue = normalizedValue === 'mitglied' || normalizedValue === 'member'
    ? 'Mitglied'
    : normalizedValue === 'trainer'
      ? 'Trainer'
      : value.trim();
  if (!isRole(mappedValue)) {
    throw new Error(`Unsupported role: "${value}"`);
  }

  return mappedValue;
}

export function getRoleDefinition(role: Role): RoleDefinition {
  return ROLE_DEFINITIONS[role];
}
