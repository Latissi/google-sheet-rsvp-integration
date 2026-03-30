import { IApplicationService } from '../IApplicationService';
import { IPublicSourceRepository } from '../../domain/ports/IPublicSourceRepository';
import {
  Gender,
  PublicSourceRegistrationMatch,
} from '../../domain/types';

export interface PreviewPublicSourceRegistrationMatchesRequest {
  firstName: string;
  lastName: string;
  gender?: Gender;
}

export interface PreviewPublicSourceRegistrationMatchesResult {
  matches: PublicSourceRegistrationMatch[];
}

export interface IPreviewPublicSourceRegistrationMatchesService extends IApplicationService<
  PreviewPublicSourceRegistrationMatchesRequest,
  PreviewPublicSourceRegistrationMatchesResult
> {}

export class PreviewPublicSourceRegistrationMatchesService implements IPreviewPublicSourceRegistrationMatchesService {
  constructor(private readonly publicSourceRepository: IPublicSourceRepository) {}

  execute(request: PreviewPublicSourceRegistrationMatchesRequest): PreviewPublicSourceRegistrationMatchesResult {
    const firstName = request.firstName.trim();
    const lastName = request.lastName.trim();

    if (!firstName || !lastName) {
      throw new Error('Both firstName and lastName are required for registration source preview.');
    }

    return {
      matches: this.publicSourceRepository.getPublicSourceRegistrationMatches({
        firstName,
        lastName,
        gender: request.gender,
      }),
    };
  }
}