import { UserRecord, createPersonName, getRoleDefinition } from '../../domain/types';

type Role = 'Mitglied' | 'Trainer';

interface UserFactoryOptions {
  memberId: string;
  role?: Role;
  email?: string;
  name?: string;
  trainingIds?: string[];
}

/**
 * Creates a UserRecord with sensible defaults for use in tests.
 * Provide only the fields relevant to the test being written.
 */
export function createUser(options: UserFactoryOptions): UserRecord {
  const role: Role = options.role ?? 'Mitglied';
  const email = options.email ?? `${options.memberId.toLowerCase().replace(/::/g, '.')}@example.com`;
  const name = options.name ?? `${options.memberId} User`;
  const trainingIds = options.trainingIds ?? [];
  const nameParts = name.split(' ');
  const personName = createPersonName(nameParts[0] ?? options.memberId, nameParts.slice(1).join(' ') || 'User');

  return {
    memberId: options.memberId,
    name,
    email,
    role,
    roleDefinition: getRoleDefinition(role),
    personName,
    subscriptions: trainingIds.map(trainingId => ({ trainingId, notificationChannel: 'email' })),
    subscribedTrainingIds: trainingIds,
    subscribedTrainings: [],
  };
}
