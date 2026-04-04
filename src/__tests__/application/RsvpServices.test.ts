import { SubmitRsvpService } from '../../application/rsvp/SubmitRsvpService';
import { SyncAttendanceService } from '../../application/rsvp/SyncAttendanceService';
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
      respondedAt: '2026-03-09T10:00:00.000Z',
    });

    expect(result.attendance.metadata.source).toBe('email-rsvp');
    expect(trainingRepository.getAttendanceForSession('session-1')).toHaveLength(1);
  });

  it('does not overwrite a newer manual attendance update', () => {
    const trainingRepository = new InMemoryTrainingRepository(definitions, sessions);
    trainingRepository.attendance.push({
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
      metadata: {
        source: 'manual',
        updatedAt: '2026-03-09T10:00:00.000Z',
      },
    });
    const service = new SyncAttendanceService(trainingRepository);

    const result = service.execute({
      record: {
        memberId: 'M001',
        sessionId: 'session-1',
        rsvpStatus: 'Declined',
        metadata: {
          source: 'email-rsvp',
          updatedAt: '2026-03-09T09:00:00.000Z',
        },
      },
    });

    expect(result.applied).toBe(false);
    expect(result.reason).toBe('older-update');
    expect(trainingRepository.getAttendanceForSession('session-1')[0].rsvpStatus).toBe('Accepted');
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
      respondedAt: '2026-03-09T10:00:00.000Z',
    })).toThrow('Training session "session-1" is cancelled.');
  });
});