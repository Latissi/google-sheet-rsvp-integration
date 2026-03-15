import { getRoleDefinition, parseRole } from '../../../domain/types';

describe('role domain model', () => {
  it('defines trainer with member and trainer-specific capabilities', () => {
    const trainerRole = getRoleDefinition('Trainer');

    expect(trainerRole.capabilities.canRsvpToTraining).toBe(true);
    expect(trainerRole.capabilities.canCancelTraining).toBe(true);
    expect(trainerRole.capabilities.receivesParticipationReportEmail).toBe(true);
    expect(trainerRole.capabilities.canViewMemberContactData).toBe(true);
  });

  it('defines member without trainer-only capabilities', () => {
    const memberRole = getRoleDefinition('Mitglied');

    expect(memberRole.capabilities.canRsvpToTraining).toBe(true);
    expect(memberRole.capabilities.canCancelTraining).toBe(false);
    expect(memberRole.capabilities.receivesParticipationReportEmail).toBe(false);
    expect(memberRole.capabilities.canViewMemberContactData).toBe(false);
  });

  it('rejects unsupported roles', () => {
    expect(() => parseRole('Admin')).toThrow('Unsupported role: "Admin"');
    expect(() => parseRole('member')).toThrow('Unsupported role: "member"');
  });
});