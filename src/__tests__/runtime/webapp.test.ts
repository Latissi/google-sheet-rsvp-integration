import {
  RegisterMemberRequest,
  SubmitRsvpRequest,
  UpdateSubscriptionPreferencesRequest,
} from '../../application';
import {
  createCompositeMemberId,
  createPersonName,
  getRoleDefinition,
  TrainingSession,
  UserRecord,
} from '../../domain/types';
import {
  handleRegistrationRequest,
  handleRsvpRequest,
  handleSubscriptionPreferencesRequest,
  runTrainerParticipationReportDispatchWithRuntime,
} from '../../runtime/webapp';

class RecordingSubmitRsvpService {
  public readonly requests: SubmitRsvpRequest[] = [];

  execute(request: SubmitRsvpRequest): void {
    this.requests.push(request);
  }
}

class RecordingRegisterMemberService {
  public readonly requests: RegisterMemberRequest[] = [];

  execute(request: RegisterMemberRequest): { user: UserRecord; created: boolean } {
    this.requests.push(request);
    return {
      user: {
        memberId: request.memberId ?? createCompositeMemberId(request.firstName, request.lastName),
        name: `${request.firstName} ${request.lastName}`.trim(),
        email: request.email,
        gender: request.gender === 'm' || request.gender === 'w' ? request.gender : undefined,
        role: getRoleDefinition('Mitglied').roleId,
        roleDefinition: getRoleDefinition('Mitglied'),
        personName: createPersonName(request.firstName, request.lastName),
        subscriptions: [],
        subscribedTrainingIds: [],
        subscribedTrainings: [],
      },
      created: true,
    };
  }
}

class RecordingUpdateSubscriptionPreferencesService {
  public readonly requests: UpdateSubscriptionPreferencesRequest[] = [];

  execute(request: UpdateSubscriptionPreferencesRequest): { user: UserRecord } {
    this.requests.push(request);
    return {
      user: {
        memberId: request.memberId,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        gender: 'w',
        role: getRoleDefinition('Mitglied').roleId,
        roleDefinition: getRoleDefinition('Mitglied'),
        personName: createPersonName('Ada', 'Lovelace'),
        subscriptions: request.subscribedTrainingIds.map(trainingId => ({ trainingId, notificationChannel: 'email' })),
        subscribedTrainingIds: request.subscribedTrainingIds,
        subscribedTrainings: [],
      },
    };
  }
}

class EmptyUserLookup {
  getUserByEmail(): UserRecord | null { return null; }
  getUserByName(): UserRecord | null { return null; }
}

describe('webapp RSVP handler', () => {
  it('maps RSVP query parameters to a submit request', () => {
    const service = new RecordingSubmitRsvpService();

    const result = handleRsvpRequest({
      action: 'rsvp',
      memberId: 'M001',
      sessionId: 'session-1',
      response: 'Accepted',
      respondedAt: '2026-03-09T12:00:00.000Z',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Teilnahme wurde gespeichert.',
    });
    expect(service.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
      respondedAt: '2026-03-09T12:00:00.000Z',
      source: 'email-rsvp',
    }]);
  });

  it('rejects incomplete RSVP requests', () => {
    const service = new RecordingSubmitRsvpService();

    const result = handleRsvpRequest({
      action: 'rsvp',
      memberId: 'M001',
      response: 'Accepted',
    }, service);

    expect(result).toEqual({
      ok: false,
      message: 'Die RSVP-Anfrage ist unvollständig.',
    });
    expect(service.requests).toEqual([]);
  });

  it('returns a readable error if RSVP submission fails', () => {
    const failingService = {
      execute(): void {
        throw new Error('Training session "session-1" not found.');
      },
    };

    const result = handleRsvpRequest({
      action: 'rsvp',
      memberId: 'M001',
      sessionId: 'session-1',
      response: 'Declined',
    }, failingService, '2026-03-09T12:00:00.000Z');

    expect(result).toEqual({
      ok: false,
      message: 'Die RSVP konnte momentan nicht verarbeitet werden.',
    });
  });

  it('maps canonical registration parameters to a register request', () => {
    const service = new RecordingRegisterMemberService();

    const result = handleRegistrationRequest({
      action: 'register',
      email: 'ada@example.com',
      role: 'Mitglied',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'w',
    }, service, new EmptyUserLookup(), '2026-03-09T12:00:00.000Z');

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Registrierung wurde gespeichert.',
      memberId: 'ada::lovelace',
      created: true,
    });
    expect(service.requests).toEqual([{
      memberId: undefined,
      email: 'ada@example.com',
      role: 'Mitglied',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'w',
    }]);
  });

  it('rejects registration requests without action register', () => {
    const service = new RecordingRegisterMemberService();

    const result = handleRegistrationRequest({
      email: 'ada@example.com',
      role: 'Mitglied',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }, service, new EmptyUserLookup());

    expect(result).toEqual({
      ok: false,
      message: 'Ungültige Aktion.',
    });
    expect(service.requests).toEqual([]);
  });

  it('maps preferences parameters to a dedicated update request', () => {
    const service = new RecordingUpdateSubscriptionPreferencesService();

    const result = handleSubscriptionPreferencesRequest({
      action: 'preferences',
      memberId: 'ada::lovelace',
      subscribedTrainingIds: 'wed-mixed; fri-outdoor',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Benachrichtigungseinstellungen wurden gespeichert.',
    });
    expect(service.requests).toEqual([{
      memberId: 'ada::lovelace',
      subscribedTrainingIds: ['wed-mixed', 'fri-outdoor'],
    }]);
  });

  it('allows clearing preferences with an empty subscribedTrainingIds value', () => {
    const service = new RecordingUpdateSubscriptionPreferencesService();

    const result = handleSubscriptionPreferencesRequest({
      action: 'preferences',
      memberId: 'ada::lovelace',
      subscribedTrainingIds: '',
    }, service);

    expect(result.ok).toBe(true);
    expect(service.requests).toEqual([{
      memberId: 'ada::lovelace',
      subscribedTrainingIds: [],
    }]);
  });

  it('dispatches trainer participation reports for sessions in the configured window', () => {
    const sessions: TrainingSession[] = [
      {
        sessionId: 'session-1',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-09',
        startTime: '18:00',
        status: 'Scheduled',
      },
      {
        sessionId: 'session-2',
        trainingId: 'wed-mixed',
        sessionDate: '2026-03-11',
        startTime: '18:00',
        status: 'Scheduled',
      },
    ];

    const runtime = {
      trainingDataRepository: {
        getUpcomingTrainingSessions: () => sessions,
      },
      sendTrainerParticipationReportService: {
        execute: ({ sessionId }: { sessionId: string }) => ({ sentCount: sessionId === 'session-1' ? 2 : 1 }),
      },
    };

    const result = runTrainerParticipationReportDispatchWithRuntime(
      runtime,
      '2026-03-09T00:00:00.000Z',
      24,
    );

    expect(result).toEqual({
      sessionsProcessed: 1,
      sentCount: 2,
    });
  });
});