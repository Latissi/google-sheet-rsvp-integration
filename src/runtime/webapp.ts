import { RegisterMemberRequest, SubmitRsvpRequest } from '../application';
import { getSessionStartDate } from '../application/notifications/notificationUtils';
import { createRuntimeContext } from './createRuntimeContext';
import { getRuntimeLogger } from './logging';
import { TRAINING_DAYS, TrainingDay, TrainingSession, UserRecord } from '../domain/types';

type RsvpResponse = Exclude<SubmitRsvpRequest['rsvpStatus'], 'Pending'>;

interface RegistrationUserLookup {
  getUserByEmail(email: string): UserRecord | null;
  getUserByName(name: string): UserRecord | null;
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
  fullName?: string;
  name?: string;
  gender?: string;
  subscribedTrainingIds?: string;
  subscribedTrainings?: string;
  notificationChannel?: string;
}

export interface RsvpResponsePayload {
  ok: boolean;
  message: string;
}

export interface RegistrationResponsePayload extends RsvpResponsePayload {
  memberId?: string;
  created?: boolean;
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

interface TrainerParticipationReportExecutor {
  execute(request: { sessionId: string }): { sentCount: number };
}

interface TrainerParticipationDispatchRuntime {
  trainingDataRepository: {
    getUpcomingTrainingSessions(): TrainingSession[];
  };
  sendTrainerParticipationReportService: TrainerParticipationReportExecutor;
}

const PUBLIC_RSVP_ERROR_MESSAGE = 'Die RSVP konnte momentan nicht verarbeitet werden.';
const PUBLIC_REGISTRATION_ERROR_MESSAGE = 'Die Registrierung konnte momentan nicht verarbeitet werden.';
const DEFAULT_TRAINER_REPORT_WINDOW_HOURS = 24;

export function handleRsvpRequest(
  parameters: RsvpRequestParameters,
  submitRsvpService: RsvpRequestExecutor,
  now: string = new Date().toISOString(),
): RsvpResponsePayload {
  if ((parameters.action ?? '').trim().toLowerCase() !== 'rsvp') {
    return {
      ok: false,
      message: 'Ungültige Aktion.',
    };
  }

  const memberId = parameters.memberId?.trim();
  const sessionId = parameters.sessionId?.trim();
  const rsvpStatus = parseRsvpStatus(parameters.response);

  if (!memberId || !sessionId || !rsvpStatus) {
    return {
      ok: false,
      message: 'Die RSVP-Anfrage ist unvollständig.',
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
    return {
      ok: false,
      message: PUBLIC_RSVP_ERROR_MESSAGE,
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
  if (action && action !== 'register') {
    return {
      ok: false,
      message: 'Ungültige Aktion.',
    };
  }

  const email = parameters.email?.trim() ?? '';
  const role = parameters.role?.trim() ?? '';
  const firstName = parameters.firstName?.trim();
  const lastName = parameters.lastName?.trim();
  const fullName = parameters.fullName?.trim() || parameters.name?.trim();
  const gender = parameters.gender?.trim();

  if (!email || !role || (!fullName && !firstName && !lastName)) {
    return {
      ok: false,
      message: 'Die Registrierungsanfrage ist unvollständig.',
    };
  }

  const existingUser = userLookup.getUserByEmail(email)
    ?? (fullName ? userLookup.getUserByName(fullName) : null);
  const memberId = existingUser?.memberId;

  try {
    const result = registerMemberService.execute({
      memberId,
      email,
      role,
      firstName,
      lastName,
      fullName,
      gender,
      subscribedTrainingIds: parseListParameter(parameters.subscribedTrainingIds),
      subscribedTrainings: parseTrainingDaysParameter(parameters.subscribedTrainings),
      notificationChannel: parameters.notificationChannel === 'email' ? 'email' : undefined,
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
      message: PUBLIC_REGISTRATION_ERROR_MESSAGE,
    };
  }
}

export function doGet(event?: GoogleAppsScript.Events.DoGet): GoogleAppsScript.Content.TextOutput {
  const parameters = event?.parameter ?? {};
  const logger = getRuntimeLogger();

  logger.info('doGet', 'start', {
    action: parameters.action,
    memberId: parameters.memberId,
    sessionId: parameters.sessionId,
  });

  try {
    const runtime = createRuntimeContext();
    const result = handleRsvpRequest(parameters, runtime.submitRsvpService);
    if (result.ok) {
      logger.info('doGet', 'completed', {
        action: parameters.action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
      });
    } else {
      logger.warn('doGet', 'completed-with-warning', {
        action: parameters.action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
      }, result.message);
    }

    return ContentService
      .createTextOutput(result.message)
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    logger.error('doGet', 'failed', error, {
      action: parameters.action,
      memberId: parameters.memberId,
      sessionId: parameters.sessionId,
    });
    return ContentService
      .createTextOutput(PUBLIC_RSVP_ERROR_MESSAGE)
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
      : handleRegistrationRequest(parameters, runtime.registerMemberService, runtime.userRepository);

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
      ? PUBLIC_RSVP_ERROR_MESSAGE
      : PUBLIC_REGISTRATION_ERROR_MESSAGE;

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

function parseListParameter(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const parsedValues = value
    .split(/[\n,;]+/)
    .map(entry => entry.trim())
    .filter(Boolean);

  return parsedValues.length > 0 ? parsedValues : undefined;
}

function parseTrainingDaysParameter(value: string | undefined): TrainingDay[] | undefined {
  const parsedValues = parseListParameter(value);
  if (!parsedValues) {
    return undefined;
  }

  const validTrainingDays = new Set<string>(TRAINING_DAYS);
  const trainingDays = parsedValues.filter((entry): entry is TrainingDay => validTrainingDays.has(entry));
  return trainingDays.length > 0 ? trainingDays : undefined;
}

function logPublicRequestError(action: string, error: unknown, context: Record<string, unknown>): void {
  getRuntimeLogger().error(`public-${action}`, 'failed', error, context);
}