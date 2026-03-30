import {
  CancelTrainingSessionRequest,
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
  buildOnboardingCompletionHtml,
  buildPreferencesPageHtml,
  buildRegistrationPageHtml,
} from '../../runtime/htmlRendering';
import { getDoPostParameters } from '../../runtime/webapp';
import {
  handleCancelTrainingConfirmationRequest,
  handleCancelTrainingRequest,
  handleRegistrationRequest,
  handleRsvpRequest,
  handleSubscriptionPreferencesRequest,
} from '../../runtime/requestHandlers';
import {
  runReminderDispatchWithRuntime,
  runTrainerParticipationReportDispatchWithRuntime,
} from '../../runtime/dispatchRunners';

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

class RecordingCancelTrainingService {
  public readonly requests: CancelTrainingSessionRequest[] = [];

  execute(request: CancelTrainingSessionRequest): { sentCount: number; alreadyCancelled: boolean } {
    this.requests.push(request);
    return {
      sentCount: 3,
      alreadyCancelled: false,
    };
  }
}

class EmptyUserLookup {
  getUserByMemberId(): UserRecord | null { return null; }
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
      message: 'Incomplete RSVP request. Required parameters: memberId, sessionId, response.',
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
      message: 'RSVP request failed. The server could not save this response. Details: Training session "[redacted]" not found.',
    });
  });

  it('returns a dedicated message for cancelled training sessions', () => {
    const failingService = {
      execute(): void {
        throw new Error('Training session "session-1" is cancelled.');
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
      message: 'Dieses Training entfällt. Eine Zu- oder Absage ist nicht mehr möglich.',
    });
  });

  it('maps canonical registration parameters to a register request', () => {
    const service = new RecordingRegisterMemberService();

    const result = handleRegistrationRequest({
      action: 'register',
      email: 'ada@example.com',
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
      message: 'Invalid action. Expected action=register.',
    });
    expect(service.requests).toEqual([]);
  });

  it('requires gender during registration', () => {
    const service = new RecordingRegisterMemberService();

    const result = handleRegistrationRequest({
      action: 'register',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }, service, new EmptyUserLookup());

    expect(result).toEqual({
      ok: false,
      message: 'Incomplete registration request. Required parameters: email, firstName, lastName, gender.',
    });
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

  it('renders a public registration page html', () => {
    const html = buildRegistrationPageHtml(
      'Bitte korrigieren',
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        gender: 'w',
      },
      'https://script.google.com/macros/s/test/exec',
    );

    expect(html).toContain('name="action" value="register"');
    expect(html).toContain('name="flow" value="onboarding"');
    expect(html).toContain('action="https://script.google.com/macros/s/test/exec"');
    expect(html).toContain('target="_top"');
    expect(html).toContain('Öffentliche Registrierung erstellt immer ein Mitgliedskonto');
    expect(html).toContain('Bitte korrigieren');
  });

  it('renders a preferences page html with training options', () => {
    const html = buildPreferencesPageHtml({
      memberId: 'ada::lovelace',
      selectedTrainingIds: ['wed-mixed'],
      formAction: 'https://script.google.com/macros/s/test/exec',
      trainingMatchStatusMap: new Map([
        ['wed-mixed', 'matched'],
        ['fri-group', 'ambiguous'],
      ]),
      trainingDefinitions: [{
        trainingId: 'wed-mixed',
        title: 'Mittwoch Training',
        day: 'Mittwoch',
        startTime: '18:00',
      }, {
        trainingId: 'fri-group',
        title: 'Freitag Training',
        day: 'Freitag',
        startTime: '18:00',
      }],
    });

    expect(html).toContain('name="memberId" value="ada::lovelace"');
    expect(html).toContain('Mittwoch Training');
    expect(html).toContain('subscribedTrainingIds');
    expect(html).toContain('action="https://script.google.com/macros/s/test/exec"');
    expect(html).toContain('target="_top"');
    expect(html).toContain('\u2713 Bereits eingetragen');
    expect(html).toContain('\u26a0 Vorname unklar');
    expect(html).not.toContain('Abgleich mit den Trainings-Tabs');
  });

  it('renders a reusable manage-preferences page without onboarding flow state', () => {
    const html = buildPreferencesPageHtml({
      memberId: 'ada::lovelace',
      mode: 'manage',
      formAction: 'https://script.google.com/macros/s/test/exec',
      trainingDefinitions: [{
        trainingId: 'wed-mixed',
        title: 'Mittwoch Training',
        day: 'Mittwoch',
        startTime: '18:00',
      }],
    });

    expect(html).toContain('Einstellungen speichern');
    expect(html).not.toContain('name="flow" value="onboarding"');
  });

  it('prefers form body parameters over query parameters in doPost parsing', () => {
    const parameters = getDoPostParameters({
      pathInfo: '',
      contextPath: '',
      contentLength: 72,
      queryString: 'action=join&flow=wrong&memberId=query-id&sessionId=session-1',
      parameter: {
        action: 'join',
        flow: 'wrong',
        memberId: 'query-id',
        sessionId: 'session-1',
      },
      parameters: {
        action: ['join'],
        flow: ['wrong'],
        memberId: ['query-id'],
        sessionId: ['session-1'],
      },
      postData: {
        contents: 'action=register&flow=onboarding&memberId=body-id&firstName=Ada+Marie',
        length: 72,
        name: 'postData',
        type: 'application/x-www-form-urlencoded',
      },
    } as unknown as GoogleAppsScript.Events.DoPost);

    expect(parameters).toEqual({
      action: 'register',
      flow: 'onboarding',
      memberId: 'body-id',
      sessionId: 'session-1',
      firstName: 'Ada Marie',
    });
  });

  it('renders an onboarding completion page html', () => {
    const html = buildOnboardingCompletionHtml();

    expect(html).toContain('Deine Registrierung ist abgeschlossen.');
    expect(html).toContain('RSVP-Links');
  });

  it('builds a confirmation payload for trainer cancellation links', () => {
    const trainer = {
      ...createUserRecord('trainer::one', 'Trainer One', 'Trainer'),
    };
    const result = handleCancelTrainingConfirmationRequest(
      {
        action: 'cancel-training',
        memberId: 'trainer::one',
        sessionId: 'session-1',
      },
      { getUserByMemberId: () => trainer },
      { getTrainingSessionById: () => ({ sessionId: 'session-1', trainingId: 'wed-mixed', sessionDate: '2026-03-11', startTime: '18:00', status: 'Scheduled' }) },
    );

    expect(result).toEqual({
      ok: true,
      message: 'Bitte bestätige die Absage dieses Trainings.',
      memberId: 'trainer::one',
      sessionId: 'session-1',
      requiresConfirmation: true,
    });
  });

  it('maps confirmed cancellation parameters to a cancel request', () => {
    const service = new RecordingCancelTrainingService();

    const result = handleCancelTrainingRequest({
      action: 'cancel-training',
      memberId: 'trainer::one',
      sessionId: 'session-1',
      confirm: 'yes',
      cancelledAt: '2026-03-09T12:00:00.000Z',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Das Training wurde abgesagt. 3 Benachrichtigungen wurden versendet.',
    });
    expect(service.requests).toEqual([{
      memberId: 'trainer::one',
      sessionId: 'session-1',
      cancelledAt: '2026-03-09T12:00:00.000Z',
      reason: undefined,
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

  it('marks the reminder watermark only after a successful dispatch run', () => {
    const markLastSuccessfulReminderDispatchAt = jest.fn<void, [string]>();
    const runtime = {
      trainingDataRepository: {
        markLastSuccessfulReminderDispatchAt,
      },
      sendTrainingReminderService: {
        execute: ({ dispatchAt }: { dispatchAt: string }) => ({
          sessionsProcessed: dispatchAt === '2026-03-09T18:15:00.000Z' ? 1 : 0,
          sentCount: 2,
        }),
      },
    };

    const result = runReminderDispatchWithRuntime(runtime, '2026-03-09T18:15:00.000Z');

    expect(result).toEqual({
      sessionsProcessed: 1,
      sentCount: 2,
    });
    expect(markLastSuccessfulReminderDispatchAt).toHaveBeenCalledWith('2026-03-09T18:15:00.000Z');
  });

  it('does not mark the reminder watermark when dispatch fails', () => {
    const markLastSuccessfulReminderDispatchAt = jest.fn<void, [string]>();
    const runtime = {
      trainingDataRepository: {
        markLastSuccessfulReminderDispatchAt,
      },
      sendTrainingReminderService: {
        execute: () => {
          throw new Error('mail failed');
        },
      },
    };

    expect(() => runReminderDispatchWithRuntime(runtime, '2026-03-09T18:15:00.000Z')).toThrow('mail failed');
    expect(markLastSuccessfulReminderDispatchAt).not.toHaveBeenCalled();
  });
});

function createUserRecord(memberId: string, name: string, role: 'Mitglied' | 'Trainer'): UserRecord {
  const [firstName, ...rest] = name.split(' ');
  return {
    memberId,
    name,
    email: `${memberId}@example.com`,
    role,
    roleDefinition: getRoleDefinition(role),
    personName: createPersonName(firstName ?? '', rest.join(' ')),
    subscriptions: [],
    subscribedTrainingIds: [],
    subscribedTrainings: [],
  };
}