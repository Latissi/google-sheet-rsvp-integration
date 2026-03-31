import { PublicSourceRegistrationMatch, PublicTrainingSource, RegistrationMatchCriteria, UserRecord } from '../types';

export interface IPublicSourceRepository {
  getPublicSourceRegistrationMatches(criteria: RegistrationMatchCriteria): PublicSourceRegistrationMatch[];
  appendMemberToPublicSource(source: PublicTrainingSource, user: UserRecord): void;
}
