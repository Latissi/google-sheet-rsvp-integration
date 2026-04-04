import { IPublicSourceRepository } from '../../domain/ports/IPublicSourceRepository';
import { PublicSourceRegistrationMatch, PublicTrainingSource, RegistrationMatchCriteria, UserRecord } from '../../domain/types';
import { PreviewPublicSourceRegistrationMatchesService } from '../../application/registration/PreviewPublicSourceRegistrationMatchesService';

class StubPublicSourceRepository implements IPublicSourceRepository {
  private readonly matchResults: PublicSourceRegistrationMatch[];

  constructor(matchResults: PublicSourceRegistrationMatch[] = []) {
    this.matchResults = matchResults;
  }

  getPublicSourceRegistrationMatches(_criteria: RegistrationMatchCriteria): PublicSourceRegistrationMatch[] {
    return this.matchResults;
  }

  appendMemberToPublicSource(_source: PublicTrainingSource, _user: UserRecord): void {
    // not needed for these tests
  }
}

describe('PreviewPublicSourceRegistrationMatchesService', () => {
  describe('validation', () => {
    it('throws if firstName is empty', () => {
      const service = new PreviewPublicSourceRegistrationMatchesService(new StubPublicSourceRepository());
      expect(() => service.execute({ firstName: '', lastName: 'Example' }))
        .toThrow('Both firstName and lastName are required');
    });

    it('throws if lastName is empty', () => {
      const service = new PreviewPublicSourceRegistrationMatchesService(new StubPublicSourceRepository());
      expect(() => service.execute({ firstName: 'Alice', lastName: '' }))
        .toThrow('Both firstName and lastName are required');
    });

    it('throws if firstName is whitespace only', () => {
      const service = new PreviewPublicSourceRegistrationMatchesService(new StubPublicSourceRepository());
      expect(() => service.execute({ firstName: '   ', lastName: 'Example' }))
        .toThrow('Both firstName and lastName are required');
    });
  });

  describe('delegation', () => {
    it('returns matches from the repository', () => {
      const match: PublicSourceRegistrationMatch = {
        sourceId: 's1',
        sheetName: 'Sheet1',
        status: 'matched',
        matchedRowNumber: 2,
      };
      const service = new PreviewPublicSourceRegistrationMatchesService(new StubPublicSourceRepository([match]));
      const result = service.execute({ firstName: 'Alice', lastName: 'Example' });
      expect(result.matches).toEqual([match]);
    });

    it('returns empty array when repository finds no matches', () => {
      const service = new PreviewPublicSourceRegistrationMatchesService(new StubPublicSourceRepository([]));
      const result = service.execute({ firstName: 'Alice', lastName: 'Example' });
      expect(result.matches).toEqual([]);
    });

    it('trims whitespace from firstName and lastName before delegating', () => {
      let capturedCriteria: RegistrationMatchCriteria | undefined;
      const repo: IPublicSourceRepository = {
        getPublicSourceRegistrationMatches(criteria) {
          capturedCriteria = criteria;
          return [];
        },
        appendMemberToPublicSource() {},
      };
      const service = new PreviewPublicSourceRegistrationMatchesService(repo);
      service.execute({ firstName: '  Alice  ', lastName: '  Example  ' });
      expect(capturedCriteria?.firstName).toBe('Alice');
      expect(capturedCriteria?.lastName).toBe('Example');
    });
  });
});
