import { UserRecord } from '../../domain/types';

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

  private normalizeText(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
}