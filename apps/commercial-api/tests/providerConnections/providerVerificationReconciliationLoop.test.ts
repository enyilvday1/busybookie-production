import { setImmediate as waitImmediate } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import type { TransactionalPool } from "../../src/database/runtimePool.js";
import {
  DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
  MAX_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
  MIN_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
  startProviderVerificationReconciliationLoop,
  type ProviderVerificationReconciliationScheduler,
} from "../../src/providerConnections/providerVerificationReconciliationLoop.js";
import {
  DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
  MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
  ProviderVerificationReconciliationError,
  type ProviderVerificationReconciliationContext,
  type ProviderVerificationReconciliationPassResult,
} from "../../src/providerConnections/providerVerificationReconciliationService.js";

const pool = {} as TransactionalPool;

const EMPTY_PASS: ProviderVerificationReconciliationPassResult =
  Object.freeze({
    cancelledJobs: 0,
    requeuedJobs: 0,
    completedJobs: 0,
  });

type PendingTimer = Readonly<{
  id: number;
  callback: () => void;
  delayMs: number;
}>;

function controlledScheduler() {
  let nextId = 1;
  let cancelCalls = 0;
  const pending = new Map<number, PendingTimer>();
  const scheduledDelays: number[] = [];

  const scheduler: ProviderVerificationReconciliationScheduler =
    Object.freeze({
      schedule: (callback, delayMs) => {
        const id = nextId;
        nextId += 1;

        scheduledDelays.push(delayMs);
        pending.set(id, Object.freeze({ id, callback, delayMs }));

        return id;
      },

      cancel: (handle) => {
        cancelCalls += 1;
        pending.delete(handle as number);
      },
    });

  return {
    scheduler,
    scheduledDelays,
    pendingCount: () => pending.size,
    cancelCalls: () => cancelCalls,
    fireNext: () => {
      const timer = pending.values().next().value as
        | PendingTimer
        | undefined;

      if (timer === undefined) {
        throw new Error("no scheduled reconciliation timer");
      }

      pending.delete(timer.id);
      timer.callback();
    },
  };
}

function gate() {
  let release:
    | ((value: ProviderVerificationReconciliationPassResult) => void)
    | undefined;

  const promise = new Promise<ProviderVerificationReconciliationPassResult>(
    (resolve) => {
      release = resolve;
    },
  );

  return {
    promise,
    release: () => release!(EMPTY_PASS),
  };
}

describe("R44B11F provider verification reconciliation loop", () => {
  it("is cadence-driven at startup and forwards pool, fresh correlation IDs and the bounded batch size", async () => {
    const timers = controlledScheduler();
    const calls: Array<{
      pool: TransactionalPool;
      context: ProviderVerificationReconciliationContext;
    }> = [];

    let correlationSequence = 0;

    const loop = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: () => {
        throw new Error("unexpected failure report");
      },
      scheduler: timers.scheduler,
      correlationId: () => {
        correlationSequence += 1;
        return `correlation-${correlationSequence}`;
      },
      reconcile: async (receivedPool, context) => {
        calls.push({ pool: receivedPool, context });
        return EMPTY_PASS;
      },
    });

    // Starting the loop schedules the first pass; it does not execute it.
    expect(calls).toEqual([]);
    expect(timers.pendingCount()).toBe(1);
    expect(timers.scheduledDelays).toEqual([
      DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
    ]);
    expect(DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS).toBe(30_000);
    expect(DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE).toBe(25);

    timers.fireNext();
    await waitImmediate();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.pool).toBe(pool);
    expect(calls[0]!.context).toEqual({
      correlationId: "correlation-1",
      batchSize: 25,
    });

    // After the scheduled pass settles, the next pass is scheduled once.
    expect(timers.pendingCount()).toBe(1);
    expect(timers.scheduledDelays).toEqual([30_000, 30_000]);

    await loop.runNow();

    expect(calls).toHaveLength(2);
    expect(calls[1]!.pool).toBe(pool);
    expect(calls[1]!.context).toEqual({
      correlationId: "correlation-2",
      batchSize: 25,
    });

    // A pending timer already exists, so a manual pass does not add one.
    expect(timers.pendingCount()).toBe(1);

    loop.stop();

    // Injected policy is forwarded exactly at the inclusive upper bounds.
    const customTimers = controlledScheduler();
    const customContexts: ProviderVerificationReconciliationContext[] = [];

    const custom = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: () => {},
      scheduler: customTimers.scheduler,
      policy: {
        cadenceMs: MAX_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS,
        batchSize: MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
      },
      correlationId: () => "custom-correlation",
      reconcile: async (receivedPool, context) => {
        expect(receivedPool).toBe(pool);
        customContexts.push(context);
        return EMPTY_PASS;
      },
    });

    expect(customTimers.scheduledDelays).toEqual([3_600_000]);

    await custom.runNow();

    expect(customContexts).toEqual([
      { correlationId: "custom-correlation", batchSize: 100 },
    ]);

    custom.stop();
  });

  it("prohibits local re-entry and schedules exactly one later pass after the active pass settles", async () => {
    const timers = controlledScheduler();
    const pass = gate();

    let reconcileCalls = 0;

    const loop = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: () => {},
      scheduler: timers.scheduler,
      policy: { cadenceMs: 2_000 },
      reconcile: async () => {
        reconcileCalls += 1;
        return pass.promise;
      },
    });

    expect(timers.pendingCount()).toBe(1);

    const first = loop.runNow();
    await waitImmediate();

    expect(reconcileCalls).toBe(1);

    // The scheduled callback fires while runNow owns the pass; it must observe
    // the active pass and not start a second reconciliation.
    timers.fireNext();
    await waitImmediate();

    expect(reconcileCalls).toBe(1);
    expect(timers.pendingCount()).toBe(0);

    // A concurrent manual invocation is also a no-op.
    await loop.runNow();

    expect(reconcileCalls).toBe(1);
    expect(timers.pendingCount()).toBe(0);

    pass.release();
    await first;
    await waitImmediate();

    expect(reconcileCalls).toBe(1);
    expect(timers.pendingCount()).toBe(1);
    expect(timers.scheduledDelays).toEqual([2_000, 2_000]);

    loop.stop();

    expect(timers.pendingCount()).toBe(0);
  });

  it("reports failures by stable code without raw error text, survives a throwing reporter and retries later", async () => {
    const timers = controlledScheduler();
    const failures: string[] = [];

    const rawSecret = "sk-live-raw-provider-secret-do-not-log";
    let attempt = 0;
    let reporterShouldThrow = false;

    const loop = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: (text) => {
        failures.push(text);

        if (reporterShouldThrow) {
          throw new Error("diagnostic sink unavailable");
        }
      },
      scheduler: timers.scheduler,
      policy: { cadenceMs: 1_000 },
      reconcile: async () => {
        attempt += 1;

        if (attempt === 1) {
          throw new ProviderVerificationReconciliationError(
            "PROVIDER_VERIFICATION_RECONCILIATION_DATABASE_FAILURE",
            { cause: new Error(rawSecret) },
          );
        }

        if (attempt === 2) {
          throw new Error(`connection refused: ${rawSecret}`);
        }

        return EMPTY_PASS;
      },
    });

    await loop.runNow();

    expect(attempt).toBe(1);

    // Unexpected failure, and the diagnostics sink itself throws.
    reporterShouldThrow = true;

    await expect(loop.runNow()).resolves.toBeUndefined();

    expect(attempt).toBe(2);

    expect(failures).toEqual([
      "commercial-api: periodic provider verification reconciliation failed (PROVIDER_VERIFICATION_RECONCILIATION_DATABASE_FAILURE)\n",
      "commercial-api: periodic provider verification reconciliation failed (unexpected)\n",
    ]);

    for (const text of failures) {
      expect(text).not.toContain(rawSecret);
      expect(text).not.toContain("connection refused");
    }

    // The loop is neither stuck in running=true nor unscheduled: exactly one
    // timer is pending and the scheduled retry executes.
    expect(timers.pendingCount()).toBe(1);

    timers.fireNext();
    await waitImmediate();

    expect(attempt).toBe(3);
    expect(failures).toHaveLength(2);
    expect(timers.pendingCount()).toBe(1);

    loop.stop();
  });

  it("does not reschedule after shutdown during an active pass, cannot be restarted and stops idempotently", async () => {
    const timers = controlledScheduler();
    const pass = gate();

    let reconcileCalls = 0;

    const loop = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: () => {},
      scheduler: timers.scheduler,
      policy: { cadenceMs: 3_000 },
      reconcile: async () => {
        reconcileCalls += 1;
        return pass.promise;
      },
    });

    expect(timers.pendingCount()).toBe(1);

    const active = loop.runNow();
    await waitImmediate();

    expect(reconcileCalls).toBe(1);

    loop.stop();

    // The pending timer is cancelled.
    expect(timers.pendingCount()).toBe(0);
    expect(timers.cancelCalls()).toBe(1);

    loop.stop();

    expect(timers.cancelCalls()).toBe(1);

    pass.release();
    await active;
    await waitImmediate();

    // Settling the active pass after stop schedules nothing.
    expect(timers.pendingCount()).toBe(0);
    expect(timers.scheduledDelays).toEqual([3_000]);

    // A stopped loop cannot be restarted manually.
    await loop.runNow();

    expect(reconcileCalls).toBe(1);
    expect(timers.pendingCount()).toBe(0);
    expect(timers.scheduledDelays).toEqual([3_000]);
  });

  it("rejects cadence and batch policy outside the bounded contract", () => {
    const timers = controlledScheduler();
    let reconcileCalls = 0;

    const base = {
      pool,
      reportFailure: () => {},
      scheduler: timers.scheduler,
      reconcile: async () => {
        reconcileCalls += 1;
        return EMPTY_PASS;
      },
    } as const;

    expect(MIN_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS).toBe(1_000);
    expect(MAX_PROVIDER_VERIFICATION_RECONCILIATION_CADENCE_MS).toBe(3_600_000);
    expect(MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE).toBe(100);

    for (const policy of [
      { cadenceMs: 999 },
      { cadenceMs: 3_600_001 },
      { batchSize: 0 },
      { batchSize: 101 },
    ]) {
      expect(() =>
        startProviderVerificationReconciliationLoop({ ...base, policy }),
      ).toThrow(RangeError);
    }

    // Rejected policies never schedule or execute anything.
    expect(timers.pendingCount()).toBe(0);
    expect(reconcileCalls).toBe(0);

    // The inclusive lower bounds are accepted.
    const accepted = startProviderVerificationReconciliationLoop({
      ...base,
      policy: { cadenceMs: 1_000, batchSize: 1 },
    });

    expect(timers.scheduledDelays).toEqual([1_000]);

    accepted.stop();

    expect(timers.pendingCount()).toBe(0);
  });

  it("keeps two separately-created loop instances independent rather than sharing a process-global running flag", async () => {
    const firstTimers = controlledScheduler();
    const secondTimers = controlledScheduler();
    const firstPass = gate();

    let firstCalls = 0;
    let secondCalls = 0;

    const first = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: () => {},
      scheduler: firstTimers.scheduler,
      reconcile: async () => {
        firstCalls += 1;
        return firstPass.promise;
      },
    });

    const second = startProviderVerificationReconciliationLoop({
      pool,
      reportFailure: () => {},
      scheduler: secondTimers.scheduler,
      reconcile: async () => {
        secondCalls += 1;
        return EMPTY_PASS;
      },
    });

    const firstActive = first.runNow();
    await waitImmediate();

    expect(firstCalls).toBe(1);

    // If running were module-global, the second handle would no-op here.
    await second.runNow();

    expect(secondCalls).toBe(1);

    // The second loop's scheduled pass also runs while the first is active.
    secondTimers.fireNext();
    await waitImmediate();

    expect(secondCalls).toBe(2);
    expect(firstCalls).toBe(1);

    // Stopping the second loop does not stop the first.
    second.stop();

    firstPass.release();
    await firstActive;

    expect(firstTimers.pendingCount()).toBe(1);

    first.stop();

    expect(firstTimers.pendingCount()).toBe(0);
    expect(secondTimers.pendingCount()).toBe(0);
  });
});
