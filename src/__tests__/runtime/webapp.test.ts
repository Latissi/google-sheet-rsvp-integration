import {
  CancelTrainingSessionRequest,
  RegisterMemberRequest,
  SubmitRsvpRequest,
  UpdateSubscriptionPreferencesRequest,
} from '../../application';
import { UpdateRsvpCommentRequest } from '../../application/rsvp/UpdateRsvpCommentService';
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
  buildRsvpResponseHtml,
  buildCancelTrainingConfirmationHtml,
  shouldRenderRsvpCommentForm,
} from '../../runtime/htmlRendering';
import { doGet, doPost, getDoPostParameters } from '../../runtime/webapp';
import {
  handleCancelTrainingConfirmationRequest,
  handleCancelTrainingRequest,
  handleRegistrationRequest,
  handleRsvpCommentRequest,
  handleRsvpRequest,
  handleSubscriptionPreferencesRequest,
} from '../../runtime/requestHandlers';
import {
  runReminderDispatch,
  runReminderDispatchWithRuntime,
} from '../../runtime/dispatchRunners';
import * as createRuntimeContextModule from '../../runtime/createRuntimeContext';
import * as loggingModule from '../../runtime/logging';

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

class RecordingUpdateRsvpCommentService {
  public readonly requests: UpdateRsvpCommentRequest[] = [];

  execute(request: UpdateRsvpCommentRequest): void {
    this.requests.push(request);
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
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps RSVP query parameters to a submit request', () => {
    const service = new RecordingSubmitRsvpService();

    const result = handleRsvpRequest({
      action: 'rsvp',
      memberId: 'M001',
      sessionId: 'session-1',
      response: 'Accepted',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Teilnahme wurde gespeichert.',
      rsvpStatus: 'Accepted',
    });
    expect(service.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    }]);
  });

  it('maps declined RSVPs to the submit request and response payload', () => {
    const service = new RecordingSubmitRsvpService();

    const result = handleRsvpRequest({
      action: 'rsvp',
      memberId: 'M001',
      sessionId: 'session-1',
      response: 'Declined',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Absage wurde gespeichert.',
      rsvpStatus: 'Declined',
    });
    expect(service.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Declined',
    }]);
  });

  it('maps tentative RSVPs to the submit request and response payload', () => {
    const service = new RecordingSubmitRsvpService();

    const result = handleRsvpRequest({
      action: 'rsvp',
      memberId: 'M001',
      sessionId: 'session-1',
      response: 'Unsicher',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Rückmeldung wurde als unsicher gespeichert.',
      rsvpStatus: 'Tentative',
    });
    expect(service.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Tentative',
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
    }, failingService);

    expect(result).toEqual({
      ok: false,
      message: 'RSVP-Anfrage fehlgeschlagen. Die Antwort konnte nicht gespeichert werden. Details: Training session "[redacted]" not found.',
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
    }, failingService);

    expect(result).toEqual({
      ok: false,
      message: 'Dieses Training entfällt. Eine Rückmeldung ist nicht mehr möglich.',
    });
  });

  it('maps RSVP comment parameters to the dedicated follow-up request', () => {
    const service = new RecordingUpdateRsvpCommentService();

    const result = handleRsvpCommentRequest({
      action: 'rsvp-comment',
      memberId: 'M001',
      sessionId: 'session-1',
      comment: '  Komme 5 Minuten später.  ',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Danke, dein Kommentar wurde gespeichert.',
      commentSaved: true,
    });
    expect(service.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      comment: 'Komme 5 Minuten später.',
    }]);
  });

  it('treats blank RSVP comments as an optional no-op', () => {
    const service = new RecordingUpdateRsvpCommentService();

    const result = handleRsvpCommentRequest({
      action: 'rsvp-comment',
      memberId: 'M001',
      sessionId: 'session-1',
      comment: '   ',
    }, service);

    expect(result).toEqual({
      ok: true,
      message: 'Kein Kommentar gespeichert. Du kannst die Seite jetzt schließen oder noch einen Kommentar ergänzen.',
      commentSaved: false,
    });
    expect(service.requests).toEqual([]);
  });

  it('maps canonical registration parameters to a register request', () => {
    const service = new RecordingRegisterMemberService();

    const result = handleRegistrationRequest({
      action: 'register',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'w',
    }, service, '2026-03-09T12:00:00.000Z');

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Registrierung wurde gespeichert.',
      memberId: 'ada::lovelace',
      created: true,
      registeredEmail: 'ada@example.com',
      selectedTrainingIds: [],
    });
    expect(service.requests).toEqual([{
      memberId: 'ada::lovelace',
      email: 'ada@example.com',
      role: 'Mitglied',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'w',
    }]);
  });

  it('returns existing-member registration metadata for the onboarding preferences page', () => {
    const service = {
      execute(request: RegisterMemberRequest): { user: UserRecord; created: boolean } {
        return {
          user: {
            memberId: request.memberId ?? 'ada::lovelace',
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            gender: 'w',
            role: getRoleDefinition('Mitglied').roleId,
            roleDefinition: getRoleDefinition('Mitglied'),
            personName: createPersonName('Ada', 'Lovelace'),
            subscriptions: [{ trainingId: 'wed-mixed', notificationChannel: 'email' }],
            subscribedTrainingIds: ['wed-mixed'],
            subscribedTrainings: ['Mittwoch'],
          },
          created: false,
        };
      },
    };

    const result = handleRegistrationRequest({
      action: 'register',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      gender: 'w',
    }, service, '2026-03-09T12:00:00.000Z');

    expect(result).toEqual({
      ok: true,
      message: 'Danke, deine Registrierung wurde aktualisiert.',
      memberId: 'ada::lovelace',
      created: false,
      registeredEmail: 'ada@example.com',
      selectedTrainingIds: ['wed-mixed'],
    });
  });

  it('rejects registration requests without action register', () => {
    const service = new RecordingRegisterMemberService();

    const result = handleRegistrationRequest({
      email: 'ada@example.com',
      role: 'Mitglied',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }, service);

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
    }, service);

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
    expect(html).toContain('Mit der Anmeldung werden vorab Erinnerungen an deine Mail gesendet');
    expect(html).toContain('Bitte korrigieren');
  });

  it('renders a preferences page html with training options', () => {
    const html = buildPreferencesPageHtml({
      memberId: 'ada::lovelace',
      selectedTrainingIds: ['wed-mixed'],
      formAction: 'https://script.google.com/macros/s/test/exec',
      trainingMatchStatusMap: new Map([
        ['wed-mixed', 'matched'],
        ['fri-group', 'not-found'],
      ]),
      trainingSheetNameMap: new Map([
        ['wed-mixed', 'Mittwoch Liste'],
        ['fri-group', 'Freitag Liste'],
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
    expect(html).toContain('Mit dem Speichern aktivierst du die Mail-Erinnerungen für deine Auswahl.');
    expect(html).toContain('Trainings-Sheet, Tab: Mittwoch Liste');
    expect(html).toContain('Trainings-Sheet, Tab: Freitag Liste');
    expect(html).toContain('\u2713 Dein Name steht bereits im Trainings-Tab &quot;Mittwoch Liste&quot;.');
    expect(html).toContain('\u26a0 Dein Name fehlt noch im Trainings-Tab &quot;Freitag Liste&quot;.');
    expect(html).toContain('Beim Speichern wird er dort automatisch ergänzt.');
    expect(html).not.toContain('\u26a0 Geschlecht stimmt nicht');
    expect(html).not.toContain('\u26a0 Vorname unklar');
    expect(html).not.toContain('Abgleich mit den Trainings-Tabs');
  });

  it('renders an onboarding preferences page with an existing-member notice', () => {
    const html = buildPreferencesPageHtml({
      memberId: 'ada::lovelace',
      existingRegistrationEmail: 'ada@example.com',
      mode: 'onboarding',
      formAction: 'https://script.google.com/macros/s/test/exec',
      trainingDefinitions: [],
    });

    expect(html).toContain('Du bist bereits für E-Mail-Benachrichtigungen mit ada@example.com registriert.');
    expect(html).toContain('Du kannst deine Trainings-Erinnerungen hier aktualisieren.');
    expect(html).toContain('Deine Zu- oder Absagen aus den Erinnerungsmails aktualisieren automatisch das öffentliche Trainings-Sheet.');
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
    expect(html).toContain('Mit dem Speichern aktualisierst du deine Mail-Erinnerungen für diese Trainings.');
    expect(html).not.toContain('name="flow" value="onboarding"');
  });

  it('does not render the existing-member notice in manage mode', () => {
    const html = buildPreferencesPageHtml({
      memberId: 'ada::lovelace',
      existingRegistrationEmail: 'ada@example.com',
      mode: 'manage',
      formAction: 'https://script.google.com/macros/s/test/exec',
      trainingDefinitions: [],
    });

    expect(html).not.toContain('bereits für E-Mail-Benachrichtigungen');
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
    expect(html).toContain('Feedback-Links');
    expect(html).toContain('aktualisieren automatisch das öffentliche Trainings-Sheet');
    expect(html).toContain('wurde er beim Speichern automatisch ergänzt');
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

  it('marks the reminder watermark only after a successful dispatch run', () => {
    const markLastSuccessfulReminderDispatchAt = jest.fn<void, [string]>();
    const runtime = {
      trainingDataRepository: {
        markLastSuccessfulReminderDispatchAt,
        paintCancelledSessionColumn: jest.fn<void, [string]>(),
      },
      sendTrainingReminderService: {
        execute: ({ dispatchAt }: { dispatchAt: string }) => ({
          sessionsProcessed: dispatchAt === '2026-03-09T18:15:00.000Z' ? 1 : 0,
          sentCount: 2,
          errorCount: 0,
          pendingCancellations: [] as Array<{ sessionId: string; cancelledByMemberId: string; cancelledAt: string; reason?: string }>,
        }),
      },
      sendCancellationNotificationService: {
        execute: () => ({ sentCount: 0 }),
      },
    };

    const result = runReminderDispatchWithRuntime(runtime, '2026-03-09T18:15:00.000Z');

    expect(result).toEqual({
      sessionsProcessed: 1,
      sentCount: 2,
      errorCount: 0,
    });
    expect(markLastSuccessfulReminderDispatchAt).toHaveBeenCalledWith('2026-03-09T18:15:00.000Z');
  });

  it('does not mark the reminder watermark when dispatch fails', () => {
    const markLastSuccessfulReminderDispatchAt = jest.fn<void, [string]>();
    const runtime = {
      trainingDataRepository: {
        markLastSuccessfulReminderDispatchAt,
        paintCancelledSessionColumn: jest.fn<void, [string]>(),
      },
      sendTrainingReminderService: {
        execute: () => {
          throw new Error('mail failed');
        },
      },
      sendCancellationNotificationService: {
        execute: () => ({ sentCount: 0 }),
      },
    };

    expect(() => runReminderDispatchWithRuntime(runtime, '2026-03-09T18:15:00.000Z')).toThrow('mail failed');
    expect(markLastSuccessfulReminderDispatchAt).not.toHaveBeenCalled();
  });

  it('renders an RSVP success response as styled HTML', () => {
    const html = buildRsvpResponseHtml('Danke, deine Teilnahme wurde gespeichert.', 'Accepted');

    expect(html).toContain('Rückmeldung');
    expect(html).toContain('Danke, deine Teilnahme wurde gespeichert.');
    expect(html).toContain('alt="Zusage"');
  });

  it('renders an RSVP response with an optional follow-up comment form', () => {
    const html = buildRsvpResponseHtml(
      'Danke, deine Teilnahme wurde gespeichert.',
      'Accepted',
      {
        memberId: 'M001',
        sessionId: 'session-1',
        formAction: 'https://script.google.com/macros/s/test/exec',
        comment: 'Bin 10 Minuten später da.',
      },
    );

    expect(html).toContain('name="action" value="rsvp-comment"');
    expect(html).toContain('name="memberId" value="M001"');
    expect(html).toContain('name="sessionId" value="session-1"');
    expect(html).toContain('textarea name="comment"');
    expect(html).toContain('Kommentar speichern');
    expect(html).toContain('Bin 10 Minuten später da.');
    expect(html).toContain('target="_top"');
  });

  it('keeps the RSVP comment form visible until a comment is actually saved', () => {
    expect(shouldRenderRsvpCommentForm({ ok: true, message: 'Noch offen.', commentSaved: false })).toBe(true);
    expect(shouldRenderRsvpCommentForm({ ok: false, message: 'Fehler.', commentSaved: false })).toBe(true);
    expect(shouldRenderRsvpCommentForm({ ok: true, message: 'Gespeichert.', commentSaved: true })).toBe(false);
  });

  it('renders a declined RSVP response with the absage illustration', () => {
    const html = buildRsvpResponseHtml('Danke, deine Absage wurde gespeichert.', 'Declined');

    expect(html).toContain('Rückmeldung');
    expect(html).toContain('Danke, deine Absage wurde gespeichert.');
    expect(html).toContain('alt="Absage"');
  });

  it('renders a tentative RSVP response with the unsicher illustration', () => {
    const html = buildRsvpResponseHtml('Danke, deine Rückmeldung wurde als unsicher gespeichert.', 'Tentative');

    expect(html).toContain('Rückmeldung');
    expect(html).toContain('Danke, deine Rückmeldung wurde als unsicher gespeichert.');
    expect(html).toContain('alt="Unsicher"');
  });

  it('renders an RSVP error response without an illustration', () => {
    const html = buildRsvpResponseHtml('RSVP-Anfrage fehlgeschlagen.');

    expect(html).toContain('Rückmeldung');
    expect(html).toContain('RSVP-Anfrage fehlgeschlagen.');
    expect(html).not.toContain('alt="Zusage"');
    expect(html).not.toContain('alt="Unsicher"');
    expect(html).not.toContain('alt="Absage"');
  });

  it('renders the RSVP comment form after a successful RSVP doGet request', () => {
    const submitRsvpService = new RecordingSubmitRsvpService();
    const runtime = createRuntimeContextFixture({
      submitRsvpService,
      updateRsvpCommentService: new RecordingUpdateRsvpCommentService(),
    });
    const createRuntimeContextSpy = jest.spyOn(createRuntimeContextModule, 'createRuntimeContext').mockReturnValue(
      runtime as unknown as ReturnType<typeof createRuntimeContextModule.createRuntimeContext>,
    );
    const loggerSpy = jest.spyOn(loggingModule, 'getRuntimeLogger').mockReturnValue(createLoggerMock() as unknown as ReturnType<typeof loggingModule.getRuntimeLogger>);
    installHtmlServiceStub();

    const result = doGet({
      parameter: {
        action: 'rsvp',
        memberId: 'M001',
        sessionId: 'session-1',
        response: 'Accepted',
      },
    } as unknown as GoogleAppsScript.Events.DoGet) as unknown as { html: string; title: string };

    expect(submitRsvpService.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Accepted',
    }]);
    expect(result.title).toBe('Rückmeldung');
    expect(result.html).toContain('name="action" value="rsvp-comment"');
    expect(result.html).toContain('name="memberId" value="M001"');
    expect(result.html).toContain('name="sessionId" value="session-1"');
    expect(createRuntimeContextSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledTimes(1);
  });

  it('renders the RSVP comment form after a tentative RSVP doGet request', () => {
    const submitRsvpService = new RecordingSubmitRsvpService();
    const runtime = createRuntimeContextFixture({
      submitRsvpService,
      updateRsvpCommentService: new RecordingUpdateRsvpCommentService(),
    });
    const createRuntimeContextSpy = jest.spyOn(createRuntimeContextModule, 'createRuntimeContext').mockReturnValue(
      runtime as unknown as ReturnType<typeof createRuntimeContextModule.createRuntimeContext>,
    );
    const loggerSpy = jest.spyOn(loggingModule, 'getRuntimeLogger').mockReturnValue(createLoggerMock() as unknown as ReturnType<typeof loggingModule.getRuntimeLogger>);
    installHtmlServiceStub();

    const result = doGet({
      parameter: {
        action: 'rsvp',
        memberId: 'M001',
        sessionId: 'session-1',
        response: 'Unsicher',
      },
    } as unknown as GoogleAppsScript.Events.DoGet) as unknown as { html: string; title: string };

    expect(submitRsvpService.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      rsvpStatus: 'Tentative',
    }]);
    expect(result.title).toBe('Rückmeldung');
    expect(result.html).toContain('alt="Unsicher"');
    expect(result.html).toContain('name="action" value="rsvp-comment"');
    expect(createRuntimeContextSpy).toHaveBeenCalledTimes(1);
    expect(loggerSpy).toHaveBeenCalledTimes(1);
  });

  it('routes RSVP comment doPost requests to the follow-up service and returns html', () => {
    const updateRsvpCommentService = new RecordingUpdateRsvpCommentService();
    const runtime = createRuntimeContextFixture({
      submitRsvpService: new RecordingSubmitRsvpService(),
      updateRsvpCommentService,
    });
    jest.spyOn(createRuntimeContextModule, 'createRuntimeContext').mockReturnValue(
      runtime as unknown as ReturnType<typeof createRuntimeContextModule.createRuntimeContext>,
    );
    jest.spyOn(loggingModule, 'getRuntimeLogger').mockReturnValue(createLoggerMock() as unknown as ReturnType<typeof loggingModule.getRuntimeLogger>);
    installHtmlServiceStub();

    const result = doPost({
      parameter: {
        action: 'rsvp-comment',
        memberId: 'M001',
        sessionId: 'session-1',
      },
      postData: {
        contents: 'action=rsvp-comment&memberId=M001&sessionId=session-1&comment=Bin+spaeter+da',
        length: 76,
        name: 'postData',
        type: 'application/x-www-form-urlencoded',
      },
    } as unknown as GoogleAppsScript.Events.DoPost) as unknown as { html: string; title: string };

    expect(updateRsvpCommentService.requests).toEqual([{
      memberId: 'M001',
      sessionId: 'session-1',
      comment: 'Bin spaeter da',
    }]);
    expect(result.title).toBe('Rückmeldung');
    expect(result.html).toContain('Danke, dein Kommentar wurde gespeichert.');
    expect(result.html).not.toContain('name="action" value="rsvp-comment"');
  });

  it('renders a cancel training confirmation page using the shared page layout', () => {
    const html = buildCancelTrainingConfirmationHtml(
      { ok: true, message: 'Bitte bestätige die Absage.', memberId: 'trainer::one', sessionId: 'session-1', requiresConfirmation: true },
      'Wegen Regen',
      'https://script.google.com/macros/s/test/exec',
    );

    expect(html).toContain('Training absagen');
    expect(html).toContain('Bitte best\u00e4tige die Absage.');
    expect(html).toContain('name="confirm" value="yes"');
    expect(html).toContain('name="reason" value="Wegen Regen"');
    expect(html).toContain('Absage jetzt best\u00e4tigen');
    expect(html).toContain('history.back()');
    expect(html).not.toContain('javascript:window.close()');
  });

  it('renders a cancel training error page using the shared page layout', () => {
    const html = buildCancelTrainingConfirmationHtml(
      { ok: false, message: 'Absage fehlgeschlagen.' },
      '',
    );

    expect(html).toContain('Training absagen');
    expect(html).toContain('Absage fehlgeschlagen.');
    expect(html).not.toContain('name="confirm"');
  });

  it('ignores a time-trigger event object and dispatches using the current timestamp', () => {
    const executeReminderDispatch = jest.fn().mockReturnValue({
      sessionsProcessed: 1,
      sentCount: 2,
      errorCount: 0,
      pendingCancellations: [],
    });
    const markLastSuccessfulReminderDispatchAt = jest.fn<void, [string]>();
    const logger = {
      info: jest.fn<void, [string, string, Record<string, unknown>]>(),
      error: jest.fn<void, [string, string, unknown, Record<string, unknown>]>(),
    };
    const runtime = {
      trainingDataRepository: {
        markLastSuccessfulReminderDispatchAt,
        paintCancelledSessionColumn: jest.fn<void, [string]>(),
      },
      sendTrainingReminderService: {
        execute: executeReminderDispatch,
      },
      sendCancellationNotificationService: {
        execute: jest.fn().mockReturnValue({ sentCount: 0 }),
      },
    };

    const createRuntimeContextSpy = jest.spyOn(createRuntimeContextModule, 'createRuntimeContext').mockReturnValue(
      runtime as unknown as ReturnType<typeof createRuntimeContextModule.createRuntimeContext>,
    );
    const getRuntimeLoggerSpy = jest.spyOn(loggingModule, 'getRuntimeLogger').mockReturnValue(
      logger as unknown as ReturnType<typeof loggingModule.getRuntimeLogger>,
    );

    const result = (runReminderDispatch as unknown as (event: unknown) => { sessionsProcessed: number; sentCount: number; errorCount: number })({
      triggerUid: 'trigger-1',
      authMode: 'FULL',
    });

    expect(result).toEqual({
      sessionsProcessed: 1,
      sentCount: 2,
      errorCount: 0,
    });
    expect(createRuntimeContextSpy).toHaveBeenCalledTimes(1);
    expect(getRuntimeLoggerSpy).toHaveBeenCalledTimes(1);
    expect(executeReminderDispatch).toHaveBeenCalledWith({
      dispatchAt: expect.any(String),
    });

    const dispatchAt = executeReminderDispatch.mock.calls[0][0].dispatchAt;
    expect(Number.isNaN(new Date(dispatchAt).getTime())).toBe(false);
    expect(markLastSuccessfulReminderDispatchAt).toHaveBeenCalledWith(dispatchAt);
    expect(logger.info).toHaveBeenCalledWith('runReminderDispatch', 'start', { dispatchAt });
    expect(logger.error).not.toHaveBeenCalled();
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

function installHtmlServiceStub(): void {
  (globalThis as unknown as {
    HtmlService: {
      createHtmlOutput: (html: string) => { setTitle: (title: string) => { html: string; title: string } };
    };
  }).HtmlService = {
    createHtmlOutput(html: string) {
      return {
        setTitle(title: string) {
          return { html, title };
        },
      };
    },
  };
}

function createLoggerMock() {
  return {
    info: jest.fn<void, [string, string, Record<string, unknown>?]>(),
    warn: jest.fn<void, [string, string, Record<string, unknown>?, string?]>(),
    error: jest.fn<void, [string, string, unknown, Record<string, unknown>?]>(),
  };
}

function createRuntimeContextFixture(overrides: {
  submitRsvpService: RecordingSubmitRsvpService;
  updateRsvpCommentService: RecordingUpdateRsvpCommentService;
}) {
  return {
    configurationProvider: {
      getWebAppUrl: () => 'https://script.google.com/macros/s/test/exec',
      getPublicTrainingSources: () => [],
      getReminderPolicy: () => ({ offsets: [] }),
      getPublicSheetId: () => 'sheet-id',
    },
    userRepository: {
      getUserByMemberId: () => null,
    },
    trainingDataRepository: {
      getTrainingDefinitions: () => [],
    },
    publicSourceRepository: {},
    notificationSender: {},
    previewPublicSourceRegistrationMatchesService: {
      execute: () => ({ matches: [] }),
    },
    registerMemberService: new RecordingRegisterMemberService(),
    updateSubscriptionPreferencesService: new RecordingUpdateSubscriptionPreferencesService(),
    syncPublicSourceMembersOnOnboardingService: {
      execute: jest.fn(),
    },
    submitRsvpService: overrides.submitRsvpService,
    updateRsvpCommentService: overrides.updateRsvpCommentService,
    cancelTrainingSessionService: new RecordingCancelTrainingService(),
    syncAttendanceService: {
      execute: jest.fn(),
    },
    sendTrainingReminderService: {
      execute: jest.fn(),
    },
    sendCancellationNotificationService: {
      execute: jest.fn(),
    },
  };
}