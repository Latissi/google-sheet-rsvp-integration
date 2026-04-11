import { SubmitRsvpService } from '../../application/rsvp/SubmitRsvpService';
import { SyncAttendanceService } from '../../application/rsvp/SyncAttendanceService';
import { UpdateRsvpCommentService } from '../../application/rsvp/UpdateRsvpCommentService';
import { TrainingDefinition, TrainingSession } from '../../domain/types';
import { InMemoryUserRepository } from '../mocks/InMemoryUserRepository';
import { InMemoryTrainingRepository } from '../mocks/InMemoryTrainingRepository';
import { createUser } from '../mocks/testUserFactory';


describe('RSVP application services', () => {
  const definitions: TrainingDefinition[] = [{
    trainingId: 'wed-mixed',
    title: 'Outdoor Mittwoch',
    day: 'Mittwoch',
    startTime: '18:00',
    environment: 'Outdoor',
  }];
  const sessions: TrainingSession[] = [{
    sessionId: 'session-1',
    trainingId: 'wed-mixed',
    sessionDate: '2026-03-11',
    startTime: '18:00',
    status: 'Scheduled',
  }];

  it('stores an RSVP from an eligible user', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] })]);
    const service = new SubmitRsvpService(trainingRepository, userRepository, new SyncAttendanceService(trainingRepository));

    const result = service.execute({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    });

    expect(result.attendance).toEqual({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    });
    expect(trainingRepository.getAttendanceForSession('session-1')).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    }]);
  });

  it('overwrites an existing RSVP for the same user and session', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] })]);
    const service = new SubmitRsvpService(trainingRepository, userRepository, new SyncAttendanceService(trainingRepository));

    service.execute({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    });

    const result = service.execute({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Declined',
    });

    expect(result.attendance).toEqual({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Declined',
    });
    expect(trainingRepository.getAttendanceForSession('session-1')).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Declined',
    }]);
  });

  it('rejects RSVP for cancelled sessions', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const cancelledSessions: TrainingSession[] = [{
      ...sessions[0],
      status: 'Cancelled',
      additionalInfo: 'Halle gesperrt',
    }];
    const cancelledRepository = new InMemoryTrainingRepository(definitions, cancelledSessions);
    const userRepository = new InMemoryUserRepository([createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] })]);
    const service = new SubmitRsvpService(cancelledRepository, userRepository, new SyncAttendanceService(cancelledRepository));

    expect(() => service.execute({
      sessionId: 'session-1',
      memberId: 'M001',
      rsvpStatus: 'Accepted',
    })).toThrow('Training session "session-1" is cancelled.');
  });

  it('stores a trimmed RSVP comment for an eligible user', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] })]);
    const service = new UpdateRsvpCommentService(trainingRepository, trainingRepository, userRepository);

    const result = service.execute({
      memberId: 'M001',
      sessionId: 'session-1',
      comment: '  Bin 10 Minuten später da.  ',
    });

    expect(result).toEqual({ saved: true });
    expect(trainingRepository.rsvpComments.get('session-1::M001')).toBe('Bin 10 Minuten später da.');
  });

  it('rejects RSVP comments that exceed the maximum length', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    const userRepository = new InMemoryUserRepository([createUser({ memberId: 'M001', role: 'Mitglied', trainingIds: ['wed-mixed'] })]);
    const service = new UpdateRsvpCommentService(trainingRepository, trainingRepository, userRepository);

    expect(() => service.execute({
      memberId: 'M001',
      sessionId: 'session-1',
      comment: 'x'.repeat(301),
    })).toThrow('RSVP comment must not exceed 300 characters.');
  });
});