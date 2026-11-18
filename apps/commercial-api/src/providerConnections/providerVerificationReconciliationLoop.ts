import { randomUUID } from "node:crypto";

import type { TransactionalPool } from "../database/runtimePool.js";
import {
  DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
  MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
  ProviderVerificationReconciliationError,
  reconcileProviderVerificationJobs,
} from "./providerVerificationReconciliationService.js";

export const DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS = 30_000;
export const MIN_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS = 1_000;
export const MAX_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS = 3_600_000;

export type ProviderVerificationReconciliationLoopPolicy = Readonly<{
  cadenceMs?: number;
  batchSize?: number;
}>;

export type ProviderVerificationReconciliationScheduler = Readonly<{
  schedule: (
    callback: () => void,
    delayMs: number,
  ) => unknown;
  cancel: (handle: unknown) => void;
}>;

export type ProviderVerificationReconciliationLoopOptions = Readonly<{
  pool: TransactionalPool;
  reportFailure: (text: string) => void;
  policy?: ProviderVerificationReconciliationLoopPolicy;
  scheduler?: ProviderVerificationReconciliationScheduler;
  reconcile?: typeof reconcileProviderVerificationJobs;
  correlationId?: () => string;
}>;

export type ProviderVerificationReconciliationLoopHandle = Readonly<{
  runNow: () => Promise<void>;
  stop: () => void;
}>;

type NormalizedPolicy = Readonly<{
  cadenceMs: number;
  batchSize: number;
}>;

const DEFAULT_SCHEDULER: ProviderVerificationReconciliationScheduler =
  Object.freeze({
    schedule: (callback, delayMs) =>
      setTimeout(callback, delayMs),
    cancel: (handle) =>
      clearTimeout(
        handle as ReturnType<typeof setTimeout>,
      ),
  });

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be between ${minimum} and ${maximum}`,
    );
  }

  return value;
}


function normalizePolicy(
  policy: ProviderVerificationReconciliationLoopPolicy | undefined,
): NormalizedPolicy {
  return Object.freeze({
    cadenceMs: boundedInteger(
      policy?.cadenceMs ??
        DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
      MIN_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
      MAX_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
      "provider verification reconciliation cadence",
    ),
    batchSize: boundedInteger(
      policy?.batchSize ??
        DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
      1,
      MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
      "provider verification reconciliation batch size",
    ),
  });
}

function reconciliationFailureCode(
  error: unknown,
): string {
  return error instanceof ProviderVerificationReconciliationError
    ? error.code
    : "unexpected";
}

export function startProviderVerificationReconciliationLoop(
  options: ProviderVerificationReconciliationLoopOptions,
): ProviderVerificationReconciliationLoopHandle {
  const policy = normalizePolicy(options.policy);
  const scheduler =
    options.scheduler ?? DEFAULT_SCHEDULER;
  const reconcile =
    options.reconcile ??
    reconcileProviderVerificationJobs;
  const correlationId =
    options.correlationId ?? randomUUID;

  let stopped = false;
  let running = false;
  let scheduled: unknown | undefined;

  const reportFailure = (error: unknown): void => {
    const code = reconciliationFailureCode(error);

    try {
      options.reportFailure(
        `commercial-api: periodic provider verification reconciliation failed (${code})\n`,
      );
    } catch {
      // Diagnostics failure must not terminate or overlap the loop.
    }
  };

  const scheduleNext = (): void => {
    if (
      stopped ||
      scheduled !== undefined
    ) {
      return;
    }

    scheduled = scheduler.schedule(
      () => {
        scheduled = undefined;
        void runPass();
      },
      policy.cadenceMs,
    );
  };

  const runPass = async (): Promise<void> => {
    if (stopped || running) {
      return;
    }

    running = true;

    try {
      try {
        await reconcile(options.pool, {
          correlationId: correlationId(),
          batchSize: policy.batchSize,
        });
      } catch (error) {
        reportFailure(error);
      }
    } finally {
      running = false;
      scheduleNext();
    }
  };

  // The first pass is cadence-driven. Database state is the durable
  // authority, so process restart simply resumes reconciliation on a
  // later scheduled pass.
  scheduleNext();

  return Object.freeze({
    runNow: () => runPass(),

    stop: () => {
      if (stopped) {
        return;
      }

      stopped = true;

      if (scheduled !== undefined) {
        scheduler.cancel(scheduled);
        scheduled = undefined;
      }
    },
  });
}
