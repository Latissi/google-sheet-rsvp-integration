import { PublicSourceRegistrationMatch, RegistrationMatchCriteria } from '../types';

export interface IPublicSourceRepository {
  getPublicSourceRegistrationMatches(criteria: RegistrationMatchCriteria): PublicSourceRegistrationMatch[];
}
