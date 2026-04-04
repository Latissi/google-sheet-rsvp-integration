import {
  PublicTrainingSource,
  UserRecord,
  createPersonName,
  getRoleDefinition,
} from '../../../domain/types';
import { GoogleSheetPublicSourceRepository } from '../../../infrastructure/adapters/GoogleSheetPublicSourceRepository';
import { MockSheetGateway } from '../../mocks/MockSheetGateway';
import { TestConfigurationProvider } from '../../mocks/TestConfigurationProvider';

function createRepository(sources: PublicTrainingSource[], sheets: Record<string, unknown[][]>) {
  const gateway = new MockSheetGateway(sheets);
  const repository = new GoogleSheetPublicSourceRepository(
    gateway,
    new TestConfigurationProvider(sources),
  );
  return { gateway, repository };
}

const SOURCE_WITH_GENDER: PublicTrainingSource = {
  sourceId: 'club-rsvp',
  sheetName: 'RSVP Übersicht',
  tableRange: 'A1:E10',
  attendance: {
    dateHeaderRow: 1,
    firstMemberRow: 2,
    firstNameColumn: 'A',
    lastNameColumn: 'B',
    genderColumn: 'C',
    startColumn: 'D',
  },
  trainings: [{
    trainingId: 'wed-mixed',
    day: 'Mittwoch',
    title: 'Mittwoch Training',
    startTime: '18:00',
  }],
};

describe('GoogleSheetPublicSourceRepository', () => {
  it('reports a matched status when full name and gender match', () => {
    const { repository } = createRepository([SOURCE_WITH_GENDER], {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-11T00:00:00.000Z')],
        ['Alice', 'Example', 'w', 'x'],
        ['Bob', 'Example', 'm', ''],
      ],
    });

    expect(repository.getPublicSourceRegistrationMatches({
      firstName: 'Alice',
      lastName: 'Example',
      gender: 'w',
    })).toEqual([{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      status: 'matched',
      matchedRowNumber: 2,
    }]);
  });

  it('ignores first-name-only rows and reports not-found', () => {
    const { repository } = createRepository([SOURCE_WITH_GENDER], {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-11T00:00:00.000Z')],
        ['Alice', '', 'w', 'x'],
      ],
    });

    expect(repository.getPublicSourceRegistrationMatches({
      firstName: 'Alice',
      lastName: 'Example',
      gender: 'w',
    })).toEqual([{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      status: 'not-found',
    }]);
  });

  it('reports matching names with different public-sheet gender as gender-mismatch', () => {
    const { repository } = createRepository([SOURCE_WITH_GENDER], {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-11T00:00:00.000Z')],
        ['Alice', 'Example', 'm', 'x'],
      ],
    });

    expect(repository.getPublicSourceRegistrationMatches({
      firstName: 'Alice',
      lastName: 'Example',
      gender: 'w',
    })).toEqual([{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      status: 'gender-mismatch',
    }]);
  });

  it('reports not-found when no row matches the name', () => {
    const { repository } = createRepository([SOURCE_WITH_GENDER], {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-11T00:00:00.000Z')],
        ['Bob', 'Example', 'm', 'x'],
      ],
    });

    expect(repository.getPublicSourceRegistrationMatches({
      firstName: 'Alice',
      lastName: 'Example',
      gender: 'w',
    })).toEqual([{
      sourceId: 'club-rsvp',
      sheetName: 'RSVP Übersicht',
      status: 'not-found',
    }]);
  });

  it('returns one result per source when multiple sources are configured', () => {
    const sources: PublicTrainingSource[] = [
      SOURCE_WITH_GENDER,
      {
        ...SOURCE_WITH_GENDER,
        sourceId: 'late-group',
        sheetName: 'Späte Gruppe',
        trainings: [{ trainingId: 'fri-group', day: 'Freitag', title: 'Freitag Training', startTime: '19:30' }],
      },
    ];

    const { repository } = createRepository(sources, {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-11T00:00:00.000Z')],
        ['Alice', 'Example', 'w', 'x'],
      ],
      'Späte Gruppe': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-14T00:00:00.000Z')],
        ['Bob', 'Other', 'm', ''],
      ],
    });

    const matches = repository.getPublicSourceRegistrationMatches({ firstName: 'Alice', lastName: 'Example', gender: 'w' });
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ sourceId: 'club-rsvp', status: 'matched' });
    expect(matches[1]).toMatchObject({ sourceId: 'late-group', status: 'not-found' });
  });

  it('writes a new member row into the first empty member slot of a public source', () => {
    const { gateway, repository } = createRepository([SOURCE_WITH_GENDER], {
      'RSVP Übersicht': [
        ['Vorname', 'Nachname', 'Geschlecht', new Date('2026-03-11T00:00:00.000Z')],
        ['Alice', 'Example', 'w', 'x'],
        ['', '', '', ''],
      ],
    });
    const user: UserRecord = {
      memberId: 'bob::example',
      name: 'Bob Example',
      email: 'bob@example.com',
      gender: 'm',
      role: 'Mitglied',
      roleDefinition: getRoleDefinition('Mitglied'),
      personName: createPersonName('Bob', 'Example'),
      subscriptions: [],
      subscribedTrainingIds: ['wed-mixed'],
      subscribedTrainings: [],
    };

    repository.appendMemberToPublicSource(SOURCE_WITH_GENDER, user);

    expect(gateway.getUpdatesCount()).toBe(1);
    expect(gateway.updatedRows[0]).toEqual({
      sheetName: 'RSVP Übersicht',
      rowIndex: 3,
      values: ['Bob', 'Example', 'm', ''],
    });
  });
});
