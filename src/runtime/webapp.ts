import { PublicSourceRegistrationMatchStatus, PublicTrainingSource, PublicSourceRegistrationMatch, UserRecord } from '../domain/types';
import { createRuntimeContext } from './createRuntimeContext';
import { getRuntimeLogger } from './logging';
import {
  buildVerbosePublicErrorMessage,
  handleCancelTrainingConfirmationRequest,
  handleCancelTrainingRequest,
  handleRegistrationRequest,
  RegistrationResponsePayload,
  handleRsvpRequest,
  handleSubscriptionPreferencesRequest,
  parseListParameter,
  PUBLIC_CANCELLATION_ERROR_MESSAGE,
  PUBLIC_PREFERENCES_ERROR_MESSAGE,
  PUBLIC_REGISTRATION_ERROR_MESSAGE,
  PUBLIC_RSVP_ERROR_MESSAGE,
} from './requestHandlers';
import {
  buildRsvpResponseHtml,
  renderCancelTrainingConfirmation,
  renderOnboardingCompletionPage,
  renderPreferencesPage,
  renderRegistrationPage,
  PUBLIC_RSVP_RESPONSE_TITLE,
} from './htmlRendering';
export { runReminderDispatch, runTrainerParticipationReportDispatch } from './dispatchRunners';

type PublicTrainingMatchBadgeStatus = Extract<PublicSourceRegistrationMatchStatus, 'matched' | 'not-found'>;

function computeTrainingSheetNameMap(
  publicSources: PublicTrainingSource[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const source of publicSources) {
    for (const training of source.trainings) {
      if (!result.has(training.trainingId)) {
        result.set(training.trainingId, source.sheetName);
      }
    }
  }
  return result;
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
    const webAppUrl = runtime.configurationProvider.getWebAppUrl();

    if (action === 'join') {
      return renderRegistrationPage(undefined, {}, webAppUrl);
    }

    if (action === 'preferences') {
      const memberId = parameters.memberId?.trim() ?? '';
      return renderPreferencesPage({
        memberId,
        trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
        selectedTrainingIds: runtime.userRepository.getUserByMemberId(memberId)?.subscribedTrainingIds ?? [],
        formAction: webAppUrl,
        trainingMatchStatusMap: getTrainingMatchStatusMapForMember(runtime, memberId),
        trainingSheetNameMap: getTrainingSheetNameMap(runtime),
        mode: 'manage',
      });
    }

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

      return renderCancelTrainingConfirmation(result, parameters.reason?.trim() || '', webAppUrl);
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

    return HtmlService
      .createHtmlOutput(buildRsvpResponseHtml(result.ok, result.message))
      .setTitle(PUBLIC_RSVP_RESPONSE_TITLE);
  } catch (error) {
    logger.error('doGet', 'failed', error, {
      action,
      memberId: parameters.memberId,
      sessionId: parameters.sessionId,
    });
    if (action === 'cancel-training') {
      const errorMessage = buildVerbosePublicErrorMessage(PUBLIC_CANCELLATION_ERROR_MESSAGE, error);
      return renderCancelTrainingConfirmation({ ok: false, message: errorMessage }, '', '');
    }

    return HtmlService
      .createHtmlOutput(buildRsvpResponseHtml(false, buildVerbosePublicErrorMessage(PUBLIC_RSVP_ERROR_MESSAGE, error)))
      .setTitle(PUBLIC_RSVP_RESPONSE_TITLE);
  }
}

export function doPost(
  event?: GoogleAppsScript.Events.DoPost,
): GoogleAppsScript.Content.TextOutput | GoogleAppsScript.HTML.HtmlOutput {
  const parameters = getDoPostParameters(event);
  const logger = getRuntimeLogger();
  const action = (parameters.action ?? '').trim().toLowerCase();
  const isOnboardingFlow = (parameters.flow ?? '').trim().toLowerCase() === 'onboarding';

  logger.info('doPost', 'start', {
    action,
    memberId: parameters.memberId,
    sessionId: parameters.sessionId,
  });

  try {
    const runtime = createRuntimeContext();
    const webAppUrl = runtime.configurationProvider.getWebAppUrl();

    const result = action === 'rsvp'
      ? handleRsvpRequest(parameters, runtime.submitRsvpService)
      : action === 'cancel-training'
        ? handleCancelTrainingRequest(parameters, runtime.cancelTrainingSessionService)
      : action === 'preferences'
        ? handleSubscriptionPreferencesRequest(parameters, runtime.updateSubscriptionPreferencesService)
      : action === 'register'
        ? handleRegistrationRequest(parameters, runtime.registerMemberService)
        : { ok: false, message: 'Invalid action.' };

    if (result.ok) {
      const successfulRegistration = action === 'register'
        ? result as RegistrationResponsePayload
        : undefined;
      logger.info('doPost', 'completed', {
        action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
        created: successfulRegistration?.created,
      });
    } else {
      logger.warn('doPost', 'completed-with-warning', {
        action,
        memberId: parameters.memberId,
        sessionId: parameters.sessionId,
      }, result.message);
    }

    if (isOnboardingFlow && action === 'register') {
      const registrationResult = result as RegistrationResponsePayload;
      const registeredMemberId = 'memberId' in result && typeof result.memberId === 'string'
        ? result.memberId
        : '';

      if (!result.ok || !registeredMemberId) {
        return renderRegistrationPage(result.message, parameters, webAppUrl);
      }

      return renderPreferencesPage({
        memberId: registeredMemberId,
        trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
        selectedTrainingIds: registrationResult.selectedTrainingIds ?? [],
        existingRegistrationEmail: registrationResult.created === false
          ? registrationResult.registeredEmail
          : undefined,
        formAction: webAppUrl,
        trainingMatchStatusMap: getTrainingMatchStatusMapFromParameters(runtime, parameters),
        trainingSheetNameMap: getTrainingSheetNameMap(runtime),
        mode: 'onboarding',
      });
    }

    if (isOnboardingFlow && action === 'preferences') {
      if (!result.ok) {
        return renderPreferencesPage({
          memberId: parameters.memberId?.trim() ?? '',
          trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
          selectedTrainingIds: parseListParameter(parameters.subscribedTrainingIds),
          message: result.message,
          formAction: webAppUrl,
          trainingMatchStatusMap: getTrainingMatchStatusMapForMember(runtime, parameters.memberId?.trim() ?? ''),
          trainingSheetNameMap: getTrainingSheetNameMap(runtime),
          mode: 'onboarding',
        });
      }

      const memberId = parameters.memberId?.trim() ?? '';
      const selectedTrainingIds = parseListParameter(parameters.subscribedTrainingIds);
      const user = runtime.userRepository.getUserByMemberId(memberId);
      if (!user) {
        return renderPreferencesPage({
          memberId,
          trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
          selectedTrainingIds,
          message: buildVerbosePublicErrorMessage(
            PUBLIC_PREFERENCES_ERROR_MESSAGE,
            new Error(`User with memberId "${memberId}" not found.`),
          ),
          formAction: webAppUrl,
          trainingMatchStatusMap: new Map(),
          trainingSheetNameMap: getTrainingSheetNameMap(runtime),
          mode: 'onboarding',
        });
      }

      runtime.syncPublicSourceMembersOnOnboardingService.execute({
        user,
        selectedTrainingIds,
      });

      return renderOnboardingCompletionPage();
    }

    if (action === 'preferences') {
      const memberId = parameters.memberId?.trim() ?? '';

      return renderPreferencesPage({
        memberId,
        trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
        selectedTrainingIds: runtime.userRepository.getUserByMemberId(memberId)?.subscribedTrainingIds ?? parseListParameter(parameters.subscribedTrainingIds),
        message: result.message,
        formAction: webAppUrl,
        trainingMatchStatusMap: getTrainingMatchStatusMapForMember(runtime, memberId),
        trainingSheetNameMap: getTrainingSheetNameMap(runtime),
        mode: 'manage',
      });
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

function computeTrainingMatchStatusMap(
  publicSources: PublicTrainingSource[],
  matches: PublicSourceRegistrationMatch[],
): Map<string, PublicTrainingMatchBadgeStatus> {
  const matchBySourceId = new Map(matches.map(m => [m.sourceId, m.status]));
  const result = new Map<string, PublicTrainingMatchBadgeStatus>();
  for (const source of publicSources) {
    const status = matchBySourceId.get(source.sourceId);
    if (status === 'matched' || status === 'not-found') {
      for (const training of source.trainings) {
        result.set(training.trainingId, status);
      }
    }
  }
  return result;
}

function getTrainingMatchStatusMapFromParameters(
  runtime: ReturnType<typeof createRuntimeContext>,
  parameters: Record<string, string>,
): Map<string, PublicTrainingMatchBadgeStatus> {
  const firstName = parameters.firstName?.trim() ?? '';
  const lastName = parameters.lastName?.trim() ?? '';
  if (!firstName || !lastName) {
    return new Map();
  }

  const matches = runtime.previewPublicSourceRegistrationMatchesService.execute({
    firstName,
    lastName,
    gender: parameters.gender === 'm' || parameters.gender === 'w' ? parameters.gender : undefined,
  }).matches;
  return computeTrainingMatchStatusMap(runtime.configurationProvider.getPublicTrainingSources(), matches);
}

function getTrainingMatchStatusMapForMember(
  runtime: ReturnType<typeof createRuntimeContext>,
  memberId: string,
): Map<string, PublicTrainingMatchBadgeStatus> {
  const user = runtime.userRepository.getUserByMemberId(memberId);
  if (!user) {
    return new Map();
  }

  return getTrainingMatchStatusMapForUser(runtime, user);
}

function getTrainingMatchStatusMapForUser(
  runtime: ReturnType<typeof createRuntimeContext>,
  user: UserRecord,
): Map<string, PublicTrainingMatchBadgeStatus> {
  const matches = runtime.previewPublicSourceRegistrationMatchesService.execute({
    firstName: user.personName.firstName,
    lastName: user.personName.lastName,
    gender: user.gender,
  }).matches;
  return computeTrainingMatchStatusMap(runtime.configurationProvider.getPublicTrainingSources(), matches);
}

function getTrainingSheetNameMap(
  runtime: ReturnType<typeof createRuntimeContext>,
): Map<string, string> {
  return computeTrainingSheetNameMap(runtime.configurationProvider.getPublicTrainingSources());
}

export function getDoPostParameters(
  event?: GoogleAppsScript.Events.DoPost,
): Record<string, string> {
  return {
    ...(event?.parameter ?? {}),
    ...parseFormUrlEncodedParameters(event?.postData?.contents),
  };
}

function parseFormUrlEncodedParameters(contents?: string): Record<string, string> {
  if (!contents) {
    return {};
  }

  return contents.split('&').reduce<Record<string, string>>((parameters, part) => {
    if (!part) {
      return parameters;
    }

    const [rawKey, rawValue = ''] = part.split('=', 2);
    const key = decodeFormUrlEncodedComponent(rawKey);
    if (!key) {
      return parameters;
    }

    parameters[key] = decodeFormUrlEncodedComponent(rawValue);
    return parameters;
  }, {});
}

function decodeFormUrlEncodedComponent(value: string): string {
  const normalizedValue = value.replace(/\+/g, ' ');

  try {
    return decodeURIComponent(normalizedValue);
  } catch {
    return normalizedValue;
  }
}

