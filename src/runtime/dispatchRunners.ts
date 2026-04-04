import { TrainingSession } from '../domain/types';
import { assertValidDate } from '../domain/validation';
import { getSessionStartDate } from '../application/notifications/notificationUtils';
import { createRuntimeContext } from './createRuntimeContext';
import { getRuntimeLogger } from './logging';

// ── Internal runtime slice types ──────────────────────────────────────────────

interface ReminderDispatchExecutor {
  execute(request: { dispatchAt: string }): {
    sessionsProcessed: number;
    sentCount: number;
    pendingCancellations: Array<{ sessionId: string; cancelledByMemberId: string; cancelledAt: string; reason?: string }>;
  };
}

interface CancellationExecutor {
  execute(request: { cancellation: { sessionId: string; cancelledByMemberId: string; cancelledAt: string; reason?: string } }): { sentCount: number };
}

interface ReminderDispatchRuntime {
  trainingDataRepository: {
    markLastSuccessfulReminderDispatchAt(completedAt: string): void;
  };
  sendTrainingReminderService: ReminderDispatchExecutor;
  sendCancellationNotificationService: CancellationExecutor;
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

// ── Return type ───────────────────────────────────────────────────────────────

export interface TrainerParticipationDispatchResult {
  sessionsProcessed: number;
  sentCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_TRAINER_REPORT_WINDOW_HOURS = 24;

// ── Dispatch runners ──────────────────────────────────────────────────────────

export function runReminderDispatch(dispatchAt: string = new Date().toISOString()) {
  const logger = getRuntimeLogger();
  const startedAt = Date.now();

  logger.info('runReminderDispatch', 'start', { dispatchAt });

  try {
    const runtime = createRuntimeContext();
    const result = runReminderDispatchWithRuntime(runtime, dispatchAt);
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

export function runReminderDispatchWithRuntime(
  runtime: ReminderDispatchRuntime,
  dispatchAt: string,
) {
  const dispatchDate = new Date(dispatchAt);
  assertValidDate(dispatchDate, 'dispatchAt');

  const result = runtime.sendTrainingReminderService.execute({ dispatchAt });

  let cancellationSentCount = 0;
  for (const cancellation of result.pendingCancellations) {
    cancellationSentCount += runtime.sendCancellationNotificationService.execute({ cancellation }).sentCount;
  }

  runtime.trainingDataRepository.markLastSuccessfulReminderDispatchAt(dispatchAt);
  return {
    sessionsProcessed: result.sessionsProcessed + result.pendingCancellations.length,
    sentCount: result.sentCount + cancellationSentCount,
  };
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
  assertValidDate(dispatchDate, 'dispatchAt');
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
