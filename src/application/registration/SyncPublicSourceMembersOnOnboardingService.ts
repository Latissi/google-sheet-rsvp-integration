import { IApplicationService } from '../IApplicationService';
import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { IPublicSourceRepository } from '../../domain/ports/IPublicSourceRepository';
import { UserRecord } from '../../domain/types';

export interface SyncPublicSourceMembersOnOnboardingRequest {
  user: UserRecord;
  selectedTrainingIds: string[];
}

export interface SyncPublicSourceMembersOnOnboardingResult {
  appendedSourceIds: string[];
  skippedSourceIds: string[];
}

export interface ISyncPublicSourceMembersOnOnboardingService extends IApplicationService<
  SyncPublicSourceMembersOnOnboardingRequest,
  SyncPublicSourceMembersOnOnboardingResult
> {}

export class SyncPublicSourceMembersOnOnboardingService implements ISyncPublicSourceMembersOnOnboardingService {
  constructor(
    private readonly configurationProvider: IConfigurationProvider,
    private readonly publicSourceRepository: IPublicSourceRepository,
  ) {}

  execute(request: SyncPublicSourceMembersOnOnboardingRequest): SyncPublicSourceMembersOnOnboardingResult {
    const selectedTrainingIds = new Set(
      request.selectedTrainingIds
        .map(trainingId => trainingId.trim())
        .filter(Boolean),
    );
    if (selectedTrainingIds.size === 0) {
      return { appendedSourceIds: [], skippedSourceIds: [] };
    }

    const relevantSources = this.configurationProvider
      .getPublicTrainingSources()
      .filter(source => source.trainings.some(training => selectedTrainingIds.has(training.trainingId)));
    if (relevantSources.length === 0) {
      return { appendedSourceIds: [], skippedSourceIds: [] };
    }

    const matchesBySourceId = new Map(
      this.publicSourceRepository
        .getPublicSourceRegistrationMatches({
          firstName: request.user.personName.firstName,
          lastName: request.user.personName.lastName,
          gender: request.user.gender,
        })
        .map(match => [match.sourceId, match.status]),
    );
    const appendedSourceIds: string[] = [];
    const skippedSourceIds: string[] = [];

    for (const source of relevantSources) {
      if (matchesBySourceId.get(source.sourceId) === 'not-found') {
        this.publicSourceRepository.appendMemberToPublicSource(source, request.user);
        appendedSourceIds.push(source.sourceId);
        continue;
      }

      skippedSourceIds.push(source.sourceId);
    }

    return { appendedSourceIds, skippedSourceIds };
  }
}