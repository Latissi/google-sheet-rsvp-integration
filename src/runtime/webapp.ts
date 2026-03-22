import {
  CancelTrainingSessionRequest,
  RegisterMemberRequest,
  SubmitRsvpRequest,
  UpdateSubscriptionPreferencesRequest,
} from '../application';
import { escapeHtml } from '../infrastructure/adapters/htmlEscape';
import { getSessionStartDate } from '../application/notifications/notificationUtils';
import { createRuntimeContext } from './createRuntimeContext';
import { getRuntimeLogger, sanitizeLogMessage } from './logging';
import { TrainingSession, UserRecord } from '../domain/types';

type RsvpResponse = Exclude<SubmitRsvpRequest['rsvpStatus'], 'Pending'>;

interface RegistrationUserLookup {
  getUserByEmail(email: string): UserRecord | null;
  getUserByName(name: string): UserRecord | null;
}

interface CancellationUserLookup {
  getUserByMemberId(memberId: string): UserRecord | null;
}

interface CancellationSessionLookup {
  getTrainingSessionById(sessionId: string): TrainingSession | null;
}

export interface RsvpRequestParameters {
  action?: string;
  memberId?: string;
  sessionId?: string;
  response?: string;
  respondedAt?: string;
}

export interface RegistrationRequestParameters {
  action?: string;
  memberId?: string;
  email?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  gender?: string;
}

export interface SubscriptionPreferencesRequestParameters {
  action?: string;
  memberId?: string;
  subscribedTrainingIds?: string;
}

export interface CancelTrainingRequestParameters {
  action?: string;
  memberId?: string;
  sessionId?: string;
  reason?: string;
  confirm?: string;
  cancelledAt?: string;
}

export interface RsvpResponsePayload {
  ok: boolean;
  message: string;
}

export interface RegistrationResponsePayload extends RsvpResponsePayload {
  memberId?: string;
  created?: boolean;
}

export interface CancelTrainingConfirmationPayload extends RsvpResponsePayload {
  memberId?: string;
  sessionId?: string;
  requiresConfirmation?: boolean;
}

export interface TrainerParticipationDispatchResult {
  sessionsProcessed: number;
  sentCount: number;
}

export interface RsvpRequestExecutor {
  execute(request: SubmitRsvpRequest): unknown;
}

export interface RegisterMemberExecutor {
  execute(request: RegisterMemberRequest): { user: UserRecord; created: boolean };
}

export interface UpdateSubscriptionPreferencesExecutor {
  execute(request: UpdateSubscriptionPreferencesRequest): { user: UserRecord };
}

export interface CancelTrainingExecutor {
  execute(request: CancelTrainingSessionRequest): { sentCount: number; alreadyCancelled: boolean };
}

interface TrainerParticipationReportExecutor {
  execute(request: { sessionId: string }): { sentCount: number };
}

interface TrainerParticipationDispatchRuntime {
  trainingDataRepository: {
    getUpcomingTrainingSessions(): TrainingSession[];
  };
  sendTrainerParticipationReportService: TrainerParticipationReportExecutor;
}

const PUBLIC_RSVP_ERROR_MESSAGE = 'RSVP request failed. The server could not save this response.';
const PUBLIC_REGISTRATION_ERROR_MESSAGE = 'Registration request failed. The server could not save this submission.';
const PUBLIC_PREFERENCES_ERROR_MESSAGE = 'Preferences request failed. The server could not save these subscription settings.';
const PUBLIC_CANCELLATION_ERROR_MESSAGE = 'Cancellation request failed. The server could not cancel this training.';
const DEFAULT_TRAINER_REPORT_WINDOW_HOURS = 24;
const CANCELLED_SESSION_PUBLIC_MESSAGE = 'Dieses Training entfällt. Eine Zu- oder Absage ist nicht mehr möglich.';

export function handleRsvpRequest(
  parameters: RsvpRequestParameters,
  submitRsvpService: RsvpRequestExecutor,
  now: string = new Date().toISOString(),
): RsvpResponsePayload {
  if ((parameters.action ?? '').trim().toLowerCase() !== 'rsvp') {
    return {
      ok: false,
      message: 'Invalid action. Expected action=rsvp.',
    };
  }

  const memberId = parameters.memberId?.trim();
  const sessionId = parameters.sessionId?.trim();
  const rsvpStatus = parseRsvpStatus(parameters.response);

  if (!memberId || !sessionId || !rsvpStatus) {
    return {
      ok: false,
      message: 'Incomplete RSVP request. Required parameters: memberId, sessionId, response.',
    };
  }

  const respondedAt = parameters.respondedAt?.trim() || now;

  try {
    submitRsvpService.execute({
      memberId,
      sessionId,
      rsvpStatus,
      respondedAt,
      source: 'email-rsvp',
    });

    return {
      ok: true,
      message: rsvpStatus === 'Accepted'
        ? 'Danke, deine Teilnahme wurde gespeichert.'
        : 'Danke, deine Absage wurde gespeichert.',
    };
  } catch (error) {
    logPublicRequestError('rsvp', error, { memberId, sessionId, rsvpStatus });
    if (isCancelledSessionError(error)) {
      return {
        ok: false,
        message: CANCELLED_SESSION_PUBLIC_MESSAGE,
      };
    }
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_RSVP_ERROR_MESSAGE, error),
    };
  }
}

export function handleRegistrationRequest(
  parameters: RegistrationRequestParameters,
  registerMemberService: RegisterMemberExecutor,
  userLookup: RegistrationUserLookup,
  now: string = new Date().toISOString(),
): RegistrationResponsePayload {
  const action = (parameters.action ?? '').trim().toLowerCase();
  if (action !== 'register') {
    return {
      ok: false,
      message: 'Invalid action. Expected action=register.',
    };
  }

  const email = parameters.email?.trim() ?? '';
  const role = parameters.role?.trim() ?? '';
  const firstName = parameters.firstName?.trim() ?? '';
  const lastName = parameters.lastName?.trim() ?? '';
  const gender = parameters.gender?.trim();

  if (!email || !role || !firstName || !lastName) {
    return {
      ok: false,
      message: 'Incomplete registration request. Required parameters: email, role, firstName, lastName.',
    };
  }

  const existingUser = userLookup.getUserByEmail(email)
    ?? userLookup.getUserByName(`${firstName} ${lastName}`);
  const memberId = existingUser?.memberId;

  try {
    const result = registerMemberService.execute({
      memberId,
      email,
      role,
      firstName,
      lastName,
      gender,
    });

    return {
      ok: true,
      message: result.created
        ? 'Danke, deine Registrierung wurde gespeichert.'
        : 'Danke, deine Registrierung wurde aktualisiert.',
      memberId: result.user.memberId,
      created: result.created,
    };
  } catch (error) {
    logPublicRequestError('register', error, { email, role, memberId });
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_REGISTRATION_ERROR_MESSAGE, error),
    };
  }
}

export function handleSubscriptionPreferencesRequest(
  parameters: SubscriptionPreferencesRequestParameters,
  updateSubscriptionPreferencesService: UpdateSubscriptionPreferencesExecutor,
): RsvpResponsePayload {
  const action = (parameters.action ?? '').trim().toLowerCase();
  if (action !== 'preferences') {
    return {
      ok: false,
      message: 'Invalid action. Expected action=preferences.',
    };
  }

  const memberId = parameters.memberId?.trim() ?? '';
  if (!memberId || parameters.subscribedTrainingIds === undefined) {
    return {
      ok: false,
      message: 'Incomplete preferences request. Required parameters: memberId, subscribedTrainingIds.',
    };
  }

  try {
    updateSubscriptionPreferencesService.execute({
      memberId,
      subscribedTrainingIds: parseListParameter(parameters.subscribedTrainingIds),
    });

    return {
      ok: true,
      message: 'Danke, deine Benachrichtigungseinstellungen wurden gespeichert.',
    };
  } catch (error) {
    logPublicRequestError('preferences', error, { memberId });
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_PREFERENCES_ERROR_MESSAGE, error),
    };
  }
}

export function handleCancelTrainingConfirmationRequest(
  parameters: CancelTrainingRequestParameters,
  userLookup: CancellationUserLookup,
  sessionLookup: CancellationSessionLookup,
): CancelTrainingConfirmationPayload {
  const action = (parameters.action ?? '').trim().toLowerCase();
  if (action !== 'cancel-training') {
    return {
      ok: false,
      message: 'Invalid action. Expected action=cancel-training.',
    };
  }

  const memberId = parameters.memberId?.trim() ?? '';
  const sessionId = parameters.sessionId?.trim() ?? '';
  if (!memberId || !sessionId) {
    return {
      ok: false,
      message: 'Incomplete cancellation request. Required parameters: memberId, sessionId.',
    };
  }

  const user = userLookup.getUserByMemberId(memberId);
  if (!user) {
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, new Error(`User with memberId "${memberId}" not found.`)),
    };
  }

  if (!user.roleDefinition.capabilities.canCancelTraining) {
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, new Error(`User "${memberId}" is not allowed to cancel trainings.`)),
    };
  }

  const session = sessionLookup.getTrainingSessionById(sessionId);
  if (!session) {
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, new Error(`Training session "${sessionId}" not found.`)),
    };
  }

  if (session.status === 'Cancelled') {
    return {
      ok: false,
      message: 'Dieses Training ist bereits abgesagt.',
      memberId,
      sessionId,
    };
  }

  return {
    ok: true,
    message: 'Bitte bestätige die Absage dieses Trainings.',
    memberId,
    sessionId,
    requiresConfirmation: true,
  };
}

export function handleCancelTrainingRequest(
  parameters: CancelTrainingRequestParameters,
  cancelTrainingService: CancelTrainingExecutor,
  now: string = new Date().toISOString(),
): RsvpResponsePayload {
  const action = (parameters.action ?? '').trim().toLowerCase();
  if (action !== 'cancel-training') {
    return {
      ok: false,
      message: 'Invalid action. Expected action=cancel-training.',
    };
  }

  const memberId = parameters.memberId?.trim() ?? '';
  const sessionId = parameters.sessionId?.trim() ?? '';
  const confirmed = (parameters.confirm ?? '').trim().toLowerCase() === 'yes';

  if (!memberId || !sessionId || !confirmed) {
    return {
      ok: false,
      message: 'Incomplete cancellation request. Required parameters: memberId, sessionId, confirm=yes.',
    };
  }

  try {
    const result = cancelTrainingService.execute({
      memberId,
      sessionId,
      cancelledAt: parameters.cancelledAt?.trim() || now,
      reason: parameters.reason?.trim() || undefined,
    });

    return {
      ok: true,
      message: result.alreadyCancelled
        ? 'Dieses Training war bereits abgesagt.'
        : `Das Training wurde abgesagt. ${result.sentCount} Benachrichtigungen wurden versendet.`,
    };
  } catch (error) {
    logPublicRequestError('cancel-training', error, { memberId, sessionId });
    return {
      ok: false,
      message: buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, error),
    };
  }
}

export function doGet(
  event?: GoogleAppsScript.Events.DoGet,
): GoogleAppsScript.Content.TextOutput | GoogleAppsScript.HTML.HtmlOutput {
  const parameters = event?.parameter ?? {};
  const logger = getRuntimeLogger();
  const action = (parameters.action ?? '').trim().toLowerCase();

  logger.info('doGet', 'start', {
    action,
    memberId: parameters.memberId,
    sessionId: parameters.sessionId,
  });

  try {
    const runtime = createRuntimeContext();
    if (action === 'cancel-training') {
      const result = handleCancelTrainingConfirmationRequest(parameters, runtime.userRepository, runtime.trainingDataRepository);
      if (result.ok) {
        logger.info('doGet', 'completed', {
          action,
          memberId: parameters.memberId,
          sessionId: parameters.sessionId,
        });
      } else {
        logger.warn('doGet', 'completed-with-warning', {
          action,
          memberId: parameters.memberId,
          sessionId: parameters.sessionId,
        }, result.message);
      }

      return renderCancelTrainingConfirmation(result, parameters.reason?.trim() || '');
    }

    const result = handleRsvpRequest(parameters, runtime.submitRsvpService);
    if (result.ok) {
      logger.info('doGet', 'completed', {
        action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
      });
    } else {
      logger.warn('doGet', 'completed-with-warning', {
        action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
      }, result.message);
    }

    return ContentService
      .createTextOutput(result.message)
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    logger.error('doGet', 'failed', error, {
      action,
      memberId: parameters.memberId,
      sessionId: parameters.sessionId,
    });
    if (action === 'cancel-training') {
      const errorMessage = buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, error);
      return HtmlService
        .createHtmlOutput(`<!DOCTYPE html><html><body><p>${escapeHtml(errorMessage)}</p></body></html>`)
        .setTitle('Training absagen');
    }

    return ContentService
      .createTextOutput(buildVerbosePublicErrorMessage(PUBLIC_RSVP_ERROR_MESSAGE, error))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

export function doPost(event?: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const parameters = event?.parameter ?? {};
  const logger = getRuntimeLogger();
  const action = (parameters.action ?? '').trim().toLowerCase();

  logger.info('doPost', 'start', {
    action,
    memberId: parameters.memberId,
    sessionId: parameters.sessionId,
  });

  try {
    const runtime = createRuntimeContext();
    const result = action === 'rsvp'
      ? handleRsvpRequest(parameters, runtime.submitRsvpService)
      : action === 'cancel-training'
        ? handleCancelTrainingRequest(parameters, runtime.cancelTrainingSessionService)
      : action === 'preferences'
        ? handleSubscriptionPreferencesRequest(parameters, runtime.updateSubscriptionPreferencesService)
      : action === 'register'
        ? handleRegistrationRequest(parameters, runtime.registerMemberService, runtime.userRepository)
        : { ok: false, message: 'Invalid action.' };

    if (result.ok) {
      logger.info('doPost', 'completed', {
        action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
        created: 'created' in result ? result.created : undefined,
      });
    } else {
      logger.warn('doPost', 'completed-with-warning', {
        action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
      }, result.message);
    }

    return ContentService
      .createTextOutput(result.message)
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    logger.error('doPost', 'failed', error, {
      action,
      memberId: parameters.memberId,
      sessionId: parameters.sessionId,
    });

    const fallbackMessage = action === 'rsvp'
      ? buildVerbosePublicErrorMessage(PUBLIC_RSVP_ERROR_MESSAGE, error)
      : action === 'cancel-training'
        ? buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, error)
      : action === 'preferences'
        ? buildVerbosePublicErrorMessage(PUBLIC_PREFERENCES_ERROR_MESSAGE, error)
      : buildVerbosePublicErrorMessage(PUBLIC_REGISTRATION_ERROR_MESSAGE, error);

    return ContentService
      .createTextOutput(fallbackMessage)
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

export function runReminderDispatch(dispatchAt: string = new Date().toISOString()) {
  const logger = getRuntimeLogger();
  const startedAt = Date.now();

  logger.info('runReminderDispatch', 'start', { dispatchAt });

  try {
    const runtime = createRuntimeContext();
    const result = runtime.sendTrainingReminderService.execute({ dispatchAt });
    logger.info('runReminderDispatch', 'completed', {
      dispatchAt,
      sessionsProcessed: result.sessionsProcessed,
      sentCount: result.sentCount,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error('runReminderDispatch', 'failed', error, {
      dispatchAt,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function runTrainerParticipationReport(sessionId: string) {
  const logger = getRuntimeLogger();
  const startedAt = Date.now();

  logger.info('runTrainerParticipationReport', 'start', { sessionId });

  try {
    const runtime = createRuntimeContext();
    const result = runtime.sendTrainerParticipationReportService.execute({ sessionId });
    logger.info('runTrainerParticipationReport', 'completed', {
      sessionId,
      sentCount: result.sentCount,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error('runTrainerParticipationReport', 'failed', error, {
      sessionId,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function runTrainerParticipationReportDispatch(
  dispatchAt: string = new Date().toISOString(),
  windowHours: number = DEFAULT_TRAINER_REPORT_WINDOW_HOURS,
) {
  const logger = getRuntimeLogger();
  const startedAt = Date.now();

  logger.info('runTrainerParticipationReportDispatch', 'start', { dispatchAt, windowHours });

  try {
    const runtime = createRuntimeContext();
    const result = runTrainerParticipationReportDispatchWithRuntime(runtime, dispatchAt, windowHours);
    logger.info('runTrainerParticipationReportDispatch', 'completed', {
      dispatchAt,
      windowHours,
      sessionsProcessed: result.sessionsProcessed,
      sentCount: result.sentCount,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.error('runTrainerParticipationReportDispatch', 'failed', error, {
      dispatchAt,
      windowHours,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

export function runTrainerParticipationReportDispatchWithRuntime(
  runtime: TrainerParticipationDispatchRuntime,
  dispatchAt: string,
  windowHours: number = DEFAULT_TRAINER_REPORT_WINDOW_HOURS,
): TrainerParticipationDispatchResult {
  const dispatchDate = new Date(dispatchAt);
  if (Number.isNaN(dispatchDate.getTime())) {
    throw new Error('dispatchAt must be a valid ISO timestamp.');
  }
  if (!Number.isFinite(windowHours) || windowHours <= 0) {
    throw new Error('windowHours must be a positive number.');
  }

  const windowEnd = dispatchDate.getTime() + (windowHours * 60 * 60 * 1000);
  const sessions = runtime.trainingDataRepository
    .getUpcomingTrainingSessions()
    .filter(session => session.status === 'Scheduled')
    .filter(session => {
      const startTime = getSessionStartDate(session).getTime();
      return startTime >= dispatchDate.getTime() && startTime < windowEnd;
    });

  let sentCount = 0;
  for (const session of sessions) {
    sentCount += runtime.sendTrainerParticipationReportService.execute({ sessionId: session.sessionId }).sentCount;
  }

  return {
    sessionsProcessed: sessions.length,
    sentCount,
  };
}

function parseRsvpStatus(value: string | undefined): RsvpResponse | null {
  const normalizedValue = (value ?? '').trim().toLowerCase();
  if (['accepted', 'accept', 'yes', 'ja', 'zugesagt'].includes(normalizedValue)) {
    return 'Accepted';
  }

  if (['declined', 'decline', 'no', 'nein', 'abgesagt'].includes(normalizedValue)) {
    return 'Declined';
  }

  return null;
}

function renderCancelTrainingConfirmation(
  result: CancelTrainingConfirmationPayload,
  reason: string,
): GoogleAppsScript.HTML.HtmlOutput {
  const escapedMessage = escapeHtml(result.message);
  if (!result.ok || !result.requiresConfirmation || !result.memberId || !result.sessionId) {
    return HtmlService
      .createHtmlOutput(`<!DOCTYPE html><html><body><p>${escapedMessage}</p></body></html>`)
      .setTitle('Training absagen');
  }

  return HtmlService.createHtmlOutput(`<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f2eb; color: #1f2937; }
      main { max-width: 32rem; margin: 3rem auto; background: #fff; border-radius: 12px; padding: 2rem; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12); }
      h1 { margin-top: 0; font-size: 1.5rem; }
      p { line-height: 1.5; }
      form { margin-top: 1.5rem; }
      button { background: #b42318; color: #fff; border: 0; border-radius: 999px; padding: 0.85rem 1.2rem; cursor: pointer; font-size: 1rem; }
      a { color: #1d4ed8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Training absagen</h1>
      <p>${escapedMessage}</p>
      <p>Diese Aktion informiert alle Abonnenten sofort und unterdrückt weitere RSVP-Erinnerungen für dieses Training.</p>
      <form method="post">
        <input type="hidden" name="action" value="cancel-training" />
        <input type="hidden" name="memberId" value="${escapeHtml(result.memberId)}" />
        <input type="hidden" name="sessionId" value="${escapeHtml(result.sessionId)}" />
        <input type="hidden" name="confirm" value="yes" />
        <input type="hidden" name="reason" value="${escapeHtml(reason)}" />
        <button type="submit">Absage jetzt bestätigen</button>
      </form>
      <p><a href="javascript:window.close()">Abbrechen</a></p>
    </main>
  </body>
</html>`).setTitle('Training absagen');
}

function isCancelledSessionError(error: unknown): boolean {
  return error instanceof Error && /is cancelled\.$/.test(error.message);
}

function parseListParameter(value: string | undefined): string[] {
  if (value === undefined) {
    return [];
  }

  return value
    .split(/[\n,;]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function logPublicRequestError(action: string, error: unknown, context: Record<string, unknown>): void {
  getRuntimeLogger().error(`public-${action}`, 'failed', error, context);
}

function buildVerbosePublicErrorMessage(baseMessage: string, error: unknown): string {
  const detail = getPublicErrorDetail(error);
  return detail ? `${baseMessage} Details: ${detail}` : baseMessage;
}

function getPublicErrorDetail(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '').trim();
  if (!message) {
    return null;
  }

  return sanitizeLogMessage(message);
}

