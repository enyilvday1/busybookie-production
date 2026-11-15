import { randomUUID } from "node:crypto";

import type { TransactionalPool } from "../database/runtimePool.js";
import {
  DEFAULT_DISCONNECT_CONVERGENCE_CHILD_BATCH_SIZE,
  DEFAULT_DISCONNECT_CONVERGENCE_CONNECTION_BATCH_SIZE,
  DisconnectConvergenceError,
  MAX_DISCONNECT_CONVERGENCE_BATCH_SIZE,
  convergeDisconnectedProviderConnection,
  discoverDisconnectedProviderConnections,
} from "./disconnectConvergenceService.js";

export const DEFAULT_DISCONNECT_CONVERGENCE_CADENCE_MS = 30_000;
export const MIN_DISCONNECT_CONVERGENCE_CADENCE_MS = 1_000;
export const MAX_DISCONNECT_CONVERGENCE_CADENCE_MS = 3_600_000;

export type DisconnectConvergenceLoopPolicy = Readonly<{
  cadenceMs?: number;
  connectionBatchSize?: number;
  childBatchSize?: number;
}>;

export type DisconnectConvergenceScheduler = Readonly<{
  schedule: (
    callback: () => void,
    delayMs: number,
  ) => unknown;
  cancel: (handle: unknown) => void;
}>;

export type DisconnectConvergenceLoopOptions = Readonly<{
  pool: TransactionalPool;
  reportFailure: (text: string) => void;
  policy?: DisconnectConvergenceLoopPolicy;
  scheduler?: DisconnectConvergenceScheduler;
  discover?: typeof discoverDisconnectedProviderConnections;
  converge?: typeof convergeDisconnectedProviderConnection;
  correlationId?: () => string;
}>;

export type DisconnectConvergenceLoopHandle = Readonly<{
  runNow: () => Promise<void>;
  stop: () => void;
}>;

type NormalizedPolicy = Readonly<{
  cadenceMs: number;
  connectionBatchSize: number;
  childBatchSize: number;
}>;

const DEFAULT_SCHEDULER: DisconnectConvergenceScheduler =
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
  policy: DisconnectConvergenceLoopPolicy | undefined,
): NormalizedPolicy {
  return Object.freeze({
    cadenceMs: boundedInteger(
      policy?.cadenceMs ??
        DEFAULT_DISCONNECT_CONVERGENCE_CADENCE_MS,
      MIN_DISCONNECT_CONVERGENCE_CADENCE_MS,
      MAX_DISCONNECT_CONVERGENCE_CADENCE_MS,
      "disconnect convergence cadence",
    ),
    connectionBatchSize: boundedInteger(
      policy?.connectionBatchSize ??
        DEFAULT_DISCONNECT_CONVERGENCE_CONNECTION_BATCH_SIZE,
      1,
      MAX_DISCONNECT_CONVERGENCE_BATCH_SIZE,
      "disconnect convergence connection batch size",
    ),
    childBatchSize: boundedInteger(
      policy?.childBatchSize ??
        DEFAULT_DISCONNECT_CONVERGENCE_CHILD_BATCH_SIZE,
      1,
      MAX_DISCONNECT_CONVERGENCE_BATCH_SIZE,
      "disconnect convergence child batch size",
    ),
  });
}

function convergenceFailureCode(
  error: unknown,
): string {
  return error instanceof DisconnectConvergenceError
    ? error.code
    : "unexpected";
}

export function startDisconnectConvergenceLoop(
  options: DisconnectConvergenceLoopOptions,
): DisconnectConvergenceLoopHandle {
  const policy = normalizePolicy(options.policy);
  const scheduler =
    options.scheduler ?? DEFAULT_SCHEDULER;
  const discover =
    options.discover ??
    discoverDisconnectedProviderConnections;
  const converge =
    options.converge ??
    convergeDisconnectedProviderConnection;
  const correlationId =
    options.correlationId ?? randomUUID;

  let stopped = false;
  let running = false;
  let scheduled: unknown | undefined;

  const reportFailure = (
    scope: "discovery" | "connection",
    error: unknown,
  ): void => {
    const code = convergenceFailureCode(error);

    try {
      options.reportFailure(
        `commercial-api: periodic disconnect convergence ${scope} failed (${code})\n`,
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
      let connectionIds: readonly string[];

      try {
        connectionIds = await discover(
          options.pool,
          policy.connectionBatchSize,
        );
      } catch (error) {
        reportFailure("discovery", error);
        return;
      }

      for (const connectionId of connectionIds) {
        try {
          await converge(
            options.pool,
            connectionId,
            {
              correlationId: correlationId(),
              mode: "BACKGROUND",
              childBatchSize:
                policy.childBatchSize,
            },
          );
        } catch (error) {
          reportFailure("connection", error);
        }
      }
    } finally {
      running = false;
      scheduleNext();
    }
  };

  // The first pass is cadence-driven as well. No process-local flag is
  // durable authority; restart recovery comes from the residual database
  // state discovered on a later pass.
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
