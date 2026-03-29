import {
  CancelTrainingSessionRequest,
  RegisterMemberRequest,
  SubmitRsvpRequest,
  UpdateSubscriptionPreferencesRequest,
} from '../application';
import { TrainingSession, UserRecord } from '../domain/types';
import { getRuntimeLogger, sanitizeLogMessage } from './logging';

// ── Local type aliases ────────────────────────────────────────────────────────

type RsvpResponse = Exclude<SubmitRsvpRequest['rsvpStatus'], 'Pending'>;

// ── Internal lookup interfaces ────────────────────────────────────────────────

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

// ── Request parameter shapes ──────────────────────────────────────────────────

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
  flow?: string;
}

export interface SubscriptionPreferencesRequestParameters {
  action?: string;
  memberId?: string;
  subscribedTrainingIds?: string;
  flow?: string;
}

export interface CancelTrainingRequestParameters {
  action?: string;
  memberId?: string;
  sessionId?: string;
  reason?: string;
  confirm?: string;
  cancelledAt?: string;
}

// ── Response payload shapes ───────────────────────────────────────────────────

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

// ── Executor port interfaces ──────────────────────────────────────────────────

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

// ── Error message constants ───────────────────────────────────────────────────

export const PUBLIC_RSVP_ERROR_MESSAGE = 'RSVP request failed. The server could not save this response.';
export const PUBLIC_REGISTRATION_ERROR_MESSAGE = 'Registration request failed. The server could not save this submission.';
export const PUBLIC_PREFERENCES_ERROR_MESSAGE = 'Preferences request failed. The server could not save these subscription settings.';
export const PUBLIC_CANCELLATION_ERROR_MESSAGE = 'Cancellation request failed. The server could not cancel this training.';

const CANCELLED_SESSION_PUBLIC_MESSAGE = 'Dieses Training entfällt. Eine Zu- oder Absage ist nicht mehr möglich.';

// ── Request handlers ──────────────────────────────────────────────────────────

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
  const firstName = parameters.firstName?.trim() ?? '';
  const lastName = parameters.lastName?.trim() ?? '';
  const gender = parameters.gender?.trim() ?? '';

  if (!email || !firstName || !lastName || !gender) {
    return {
      ok: false,
      message: 'Incomplete registration request. Required parameters: email, firstName, lastName, gender.',
    };
  }

  const existingUser = userLookup.getUserByEmail(email)
    ?? userLookup.getUserByName(`${firstName} ${lastName}`);
  const memberId = existingUser?.memberId;

  try {
    const result = registerMemberService.execute({
      memberId,
      email,
      role: 'Mitglied',
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
    logPublicRequestError('register', error, { email, memberId });
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

// ── Private utilities ─────────────────────────────────────────────────────────

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

function isCancelledSessionError(error: unknown): boolean {
  return error instanceof Error && /is cancelled\.$/.test(error.message);
}

export function parseListParameter(value: string | undefined): string[] {
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

export function buildVerbosePublicErrorMessage(baseMessage: string, error: unknown): string {
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
