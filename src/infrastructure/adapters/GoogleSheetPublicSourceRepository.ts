import { IConfigurationProvider } from '../../domain/ports/IConfigurationProvider';
import { IPublicSourceRepository } from '../../domain/ports/IPublicSourceRepository';
import {
  Gender,
  PublicSourceRegistrationMatch,
  PublicTrainingSource,
  RegistrationMatchCriteria,
  UserRecord,
} from '../../domain/types';
import { MemberRowUserMatcher } from './MemberRowUserMatcher';
import { ISheetGateway } from '../gateway/ISheetGateway';
import {
  TableBounds,
  getTableBounds,
  getRelativeColumnIndex,
  getMemberStartRowIndex,
  getMemberRowsFirstNameIndex,
  getMemberRowsLastNameIndex,
  normalizeSheetText,
} from './SheetTableUtils';

export class GoogleSheetPublicSourceRepository implements IPublicSourceRepository {
  private readonly sourceTableCache = new Map<string, unknown[][]>();
  private readonly memberRowUserMatcher: MemberRowUserMatcher;

  constructor(
    private readonly gateway: ISheetGateway,
    private readonly configurationProvider: IConfigurationProvider,
  ) {
    this.memberRowUserMatcher = new MemberRowUserMatcher();
  }

  getPublicSourceRegistrationMatches(criteria: RegistrationMatchCriteria): PublicSourceRegistrationMatch[] {
    return this.configurationProvider
      .getPublicTrainingSources()
      .map(source => this.getPublicSourceRegistrationMatch(source, criteria));
  }

  appendMemberToPublicSource(source: PublicTrainingSource, user: UserRecord): void {
    const bounds = getTableBounds(source.tableRange);
    const rawTable = this.getSourceTable(source);
    const memberStartRowIndex = getMemberStartRowIndex(source, bounds, rawTable.length);
    const firstNameIndex = getMemberRowsFirstNameIndex(source, bounds);
    const lastNameIndex = getMemberRowsLastNameIndex(source, bounds);
    const genderIndex = this.getMemberRowsGenderIndex(source, bounds);
    const targetRowIndex = this.findFirstEmptyMemberRowIndex(rawTable, memberStartRowIndex);
    const rowWidth = Math.max(
      firstNameIndex + 1,
      lastNameIndex + 1,
      (genderIndex ?? -1) + 1,
      ...rawTable.map(row => row.length),
    );
    const rowValues = new Array(Math.max(rowWidth, 0)).fill('');

    rowValues[firstNameIndex] = user.personName.firstName;
    rowValues[lastNameIndex] = user.personName.lastName;
    if (genderIndex !== null) {
      rowValues[genderIndex] = user.gender ?? '';
    }

    const writeOptions = { spreadsheetId: this.configurationProvider.getPublicSheetId() };
    if (targetRowIndex !== null) {
      this.gateway.setRowValues(source.sheetName, bounds.startRow + targetRowIndex, rowValues, writeOptions);
    } else {
      this.gateway.appendRow(source.sheetName, rowValues, writeOptions);
    }

    this.invalidateSourceCache(source);
  }

  private getPublicSourceRegistrationMatch(
    source: PublicTrainingSource,
    criteria: RegistrationMatchCriteria,
  ): PublicSourceRegistrationMatch {
    const bounds = getTableBounds(source.tableRange);
    const rawTable = this.getSourceTable(source);
    const memberStartRowIndex = getMemberStartRowIndex(source, bounds, rawTable.length);
    const firstNameIndex = getMemberRowsFirstNameIndex(source, bounds);
    const lastNameIndex = getMemberRowsLastNameIndex(source, bounds);
    const genderIndex = this.getMemberRowsGenderIndex(source, bounds);
    let hasGenderMismatch = false;

    for (let rowOffset = memberStartRowIndex; rowOffset < rawTable.length; rowOffset += 1) {
      const rowValues = rawTable[rowOffset];
      if (!rowValues || rowValues.every(cell => String(cell ?? '').trim() === '')) {
        continue;
      }

      const personMatch = this.memberRowUserMatcher.matchPerson(
        rowValues[firstNameIndex],
        rowValues[lastNameIndex],
        criteria.firstName,
        criteria.lastName,
      );

      if (personMatch === 'none') {
        continue;
      }

      if (personMatch === 'first-name-only') {
        continue;
      }

      if (genderIndex !== null && criteria.gender) {
        const rowGender = this.parsePublicSheetGender(rowValues[genderIndex]);
        if (rowGender !== criteria.gender) {
          hasGenderMismatch = true;
          continue;
        }
      }

      return {
        sourceId: source.sourceId,
        sheetName: source.sheetName,
        status: 'matched',
        matchedRowNumber: bounds.startRow + rowOffset,
      };
    }

    return {
      sourceId: source.sourceId,
      sheetName: source.sheetName,
      status: hasGenderMismatch ? 'gender-mismatch' : 'not-found',
    };
  }

  private getMemberRowsGenderIndex(source: PublicTrainingSource, bounds: TableBounds): number | null {
    if (!source.attendance.genderColumn) {
      return null;
    }

    return getRelativeColumnIndex(source.attendance.genderColumn, bounds);
  }

  private parsePublicSheetGender(value: unknown): Gender | null {
    const normalized = normalizeSheetText(value);
    if (['m', 'male', 'mannlich', 'maennlich'].includes(normalized)) {
      return 'm';
    }

    if (['w', 'female', 'weiblich'].includes(normalized)) {
      return 'w';
    }

    return null;
  }

  private getSourceTable(source: PublicTrainingSource): unknown[][] {
    const cacheKey = this.getSourceTableCacheKey(source);
    const cached = this.sourceTableCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const publicSheetId = this.configurationProvider.getPublicSheetId();
    const rawTable = this.gateway.getSheetValues(source.sheetName, {
      spreadsheetId: publicSheetId,
      rangeA1: source.tableRange,
    });
    this.sourceTableCache.set(cacheKey, rawTable);
    return rawTable;
  }

  private getSourceTableCacheKey(source: PublicTrainingSource): string {
    return `${source.sheetName}::${source.tableRange ?? ''}`;
  }

  private invalidateSourceCache(source: PublicTrainingSource): void {
    this.sourceTableCache.delete(this.getSourceTableCacheKey(source));
  }

  private findFirstEmptyMemberRowIndex(rawTable: unknown[][], memberStartRowIndex: number): number | null {
    for (let rowIndex = memberStartRowIndex; rowIndex < rawTable.length; rowIndex += 1) {
      const rowValues = rawTable[rowIndex] ?? [];
      if (rowValues.every(cell => String(cell ?? '').trim() === '')) {
        return rowIndex;
      }
    }

    return null;
  }

}
