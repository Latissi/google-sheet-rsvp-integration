import { escapeHtml } from '../infrastructure/adapters/htmlEscape';
import { PublicSourceRegistrationMatchStatus, PublicTrainingSource, PublicSourceRegistrationMatch, UserRecord } from '../domain/types';
import { createRuntimeContext } from './createRuntimeContext';
import { getRuntimeLogger } from './logging';
import {
  buildVerbosePublicErrorMessage,
  handleCancelTrainingConfirmationRequest,
  handleCancelTrainingRequest,
  handleRegistrationRequest,
  handleRsvpRequest,
  handleSubscriptionPreferencesRequest,
  parseListParameter,
  PUBLIC_CANCELLATION_ERROR_MESSAGE,
  PUBLIC_PREFERENCES_ERROR_MESSAGE,
  PUBLIC_REGISTRATION_ERROR_MESSAGE,
  PUBLIC_RSVP_ERROR_MESSAGE,
} from './requestHandlers';
import {
  renderCancelTrainingConfirmation,
  renderOnboardingCompletionPage,
  renderPreferencesPage,
  renderRegistrationPage,
} from './htmlRendering';
export { runReminderDispatch, runTrainerParticipationReportDispatch } from './dispatchRunners';

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

    if (isOnboardingFlow && action === 'preferences') {
      const memberId = (parameters.memberId ?? '').trim();
      if (!memberId || !runtime.userRepository.getUserByMemberId(memberId)) {
        logger.warn('doPost', 'onboarding-step2-user-not-found', { memberId });
        return renderRegistrationPage(
          'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.',
          {}, webAppUrl,
        );
      }
    }

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

    if (isOnboardingFlow && action === 'register') {
      const registeredMemberId = 'memberId' in result && typeof result.memberId === 'string'
        ? result.memberId
        : '';

      if (!result.ok || !registeredMemberId) {
        return renderRegistrationPage(result.message, parameters, webAppUrl);
      }

      return renderPreferencesPage({
        memberId: registeredMemberId,
        trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
        selectedTrainingIds: runtime.userRepository.getUserByMemberId(registeredMemberId)?.subscribedTrainingIds ?? [],
        formAction: webAppUrl,
        trainingMatchStatusMap: getTrainingMatchStatusMapFromParameters(runtime, parameters),
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
          mode: 'onboarding',
        });
      }

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
): Map<string, PublicSourceRegistrationMatchStatus> {
  const matchBySourceId = new Map(matches.map(m => [m.sourceId, m.status]));
  const result = new Map<string, PublicSourceRegistrationMatchStatus>();
  for (const source of publicSources) {
    const status = matchBySourceId.get(source.sourceId);
    if (status !== undefined) {
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
): Map<string, PublicSourceRegistrationMatchStatus> {
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
): Map<string, PublicSourceRegistrationMatchStatus> {
  const user = runtime.userRepository.getUserByMemberId(memberId);
  if (!user) {
    return new Map();
  }

  return getTrainingMatchStatusMapForUser(runtime, user);
}

function getTrainingMatchStatusMapForUser(
  runtime: ReturnType<typeof createRuntimeContext>,
  user: UserRecord,
): Map<string, PublicSourceRegistrationMatchStatus> {
  const matches = runtime.previewPublicSourceRegistrationMatchesService.execute({
    firstName: user.personName.firstName,
    lastName: user.personName.lastName,
    gender: user.gender,
  }).matches;
  return computeTrainingMatchStatusMap(runtime.configurationProvider.getPublicTrainingSources(), matches);
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

