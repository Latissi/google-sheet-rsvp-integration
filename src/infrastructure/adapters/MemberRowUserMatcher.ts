import { UserRecord } from '../../domain/types';

export type MemberRowPersonMatchResult = 'full-name' | 'first-name-only' | 'none';

export class MemberRowUserMatcher {
  findUser(firstName: unknown, lastName: unknown, users: UserRecord[]): UserRecord | null {
    const normalizedFirstName = this.normalizeText(firstName);
    const normalizedLastName = this.normalizeText(lastName);
    const normalizedName = this.normalizeText(`${String(firstName ?? '').trim()} ${String(lastName ?? '').trim()}`);
    const normalizedMemberId = this.normalizeText(`${String(firstName ?? '').trim()}::${String(lastName ?? '').trim()}`);

    if (!normalizedFirstName && !normalizedLastName) {
      return null;
    }

    return users.find(user => (
      normalizedName === this.normalizeText(user.name)
      || normalizedMemberId === this.normalizeText(user.memberId)
      || (
        normalizedFirstName === this.normalizeText(user.personName?.firstName ?? '')
        && normalizedLastName === this.normalizeText(user.personName?.lastName ?? '')
      )
    )) ?? null;
  }

  matchPerson(
    rowFirstName: unknown,
    rowLastName: unknown,
    personFirstName: unknown,
    personLastName: unknown,
  ): MemberRowPersonMatchResult {
    const normalizedRowFirstName = this.normalizeText(rowFirstName);
    const normalizedRowLastName = this.normalizeText(rowLastName);
    const normalizedPersonFirstName = this.normalizeText(personFirstName);
    const normalizedPersonLastName = this.normalizeText(personLastName);

    if (!normalizedRowFirstName && !normalizedRowLastName) {
      return 'none';
    }

    if (
      normalizedRowFirstName
      && normalizedRowFirstName === normalizedPersonFirstName
      && !normalizedRowLastName
    ) {
      return 'first-name-only';
    }

    if (
      normalizedRowFirstName
      && normalizedRowLastName
      && normalizedRowFirstName === normalizedPersonFirstName
      && normalizedRowLastName === normalizedPersonLastName
    ) {
      return 'full-name';
    }

    return 'none';
  }

  /**
   * Intentionally more robust than sheetUtils.normalizeSheetString:
   * includes Unicode NFKD decomposition, diacritic removal, and ß→ss
   * substitution so that German names with umlauts match correctly.
   */
  private normalizeText(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss')
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
}