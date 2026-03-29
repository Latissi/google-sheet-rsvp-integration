import { escapeHtml } from '../infrastructure/adapters/htmlEscape';
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

export function doGet(
  event?: GoogleAppsScript.Events.DoGet,
): GoogleAppsScript.Content.TextOutput | GoogleAppsScript.HTML.HtmlOutput {
  const parameters = event?.parameter ?? {};
  const logger = getRuntimeLogger();
  const action = (parameters.action ?? '').trim().toLowerCase();

  if (action === 'join') {
    return renderRegistrationPage();
  }

  logger.info('doGet', 'start', {
    action,
    memberId: parameters.memberId,
    sessionId: parameters.sessionId,
  });

  try {
    const runtime = createRuntimeContext();
    if (action === 'preferences') {
      return renderPreferencesPage({
        memberId: parameters.memberId?.trim() ?? '',
        trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
        selectedTrainingIds: runtime.userRepository.getUserByMemberId(parameters.memberId?.trim() ?? '')?.subscribedTrainingIds ?? [],
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

export function doPost(
  event?: GoogleAppsScript.Events.DoPost,
): GoogleAppsScript.Content.TextOutput | GoogleAppsScript.HTML.HtmlOutput {
  const parameters = event?.parameter ?? {};
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
        return renderRegistrationPage(result.message, parameters);
      }

      return renderPreferencesPage({
        memberId: registeredMemberId,
        trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
        selectedTrainingIds: runtime.userRepository.getUserByMemberId(registeredMemberId)?.subscribedTrainingIds ?? [],
        message: result.message,
      });
    }

    if (isOnboardingFlow && action === 'preferences') {
      if (!result.ok) {
        return renderPreferencesPage({
          memberId: parameters.memberId?.trim() ?? '',
          trainingDefinitions: runtime.trainingDataRepository.getTrainingDefinitions(),
          selectedTrainingIds: parseListParameter(parameters.subscribedTrainingIds),
          message: result.message,
        });
      }

      return renderOnboardingCompletionPage();
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

