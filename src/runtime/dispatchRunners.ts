import { assertValidDate } from '../domain/validation';
import { createRuntimeContext } from './createRuntimeContext';
import { getRuntimeLogger } from './logging';

// ── Internal runtime slice types ──────────────────────────────────────────────

interface ReminderDispatchExecutor {
  execute(request: { dispatchAt: string }): {
    sessionsProcessed: number;
    sentCount: number;
    errorCount: number;
    pendingCancellations: Array<{ sessionId: string; cancelledByMemberId: string; cancelledAt: string; reason?: string }>;
  };
}

interface CancellationExecutor {
  execute(request: { cancellation: { sessionId: string; cancelledByMemberId: string; cancelledAt: string; reason?: string } }): { sentCount: number };
}

interface ReminderDispatchRuntime {
  trainingDataRepository: {
    markLastSuccessfulReminderDispatchAt(completedAt: string): void;
    paintCancelledSessionColumn(sessionId: string): void;
  };
  sendTrainingReminderService: ReminderDispatchExecutor;
  sendCancellationNotificationService: CancellationExecutor;
}

// ── Dispatch runners ──────────────────────────────────────────────────────────

export function runReminderDispatch() {
  const logger = getRuntimeLogger();
  const startedAt = Date.now();
  const dispatchAt = new Date().toISOString();

  logger.info('runReminderDispatch', 'start', { dispatchAt });

  try {
    const runtime = createRuntimeContext();
    const result = runReminderDispatchWithRuntime(runtime, dispatchAt);
    logger.info('runReminderDispatch', 'completed', {
      dispatchAt,
      sessionsProcessed: result.sessionsProcessed,
      sentCount: result.sentCount,
      errorCount: result.errorCount,
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
    runtime.trainingDataRepository.paintCancelledSessionColumn(cancellation.sessionId);
  }

  runtime.trainingDataRepository.markLastSuccessfulReminderDispatchAt(dispatchAt);
  return {
    sessionsProcessed: result.sessionsProcessed + result.pendingCancellations.length,
    sentCount: result.sentCount + cancellationSentCount,
    errorCount: result.errorCount,
  };
}
