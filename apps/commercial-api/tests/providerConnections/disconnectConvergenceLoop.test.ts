import { setImmediate as waitImmediate } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import type { TransactionalPool } from "../../src/database/runtimePool.js";
import {
  DisconnectConvergenceError,
  type DisconnectConvergenceContext,
} from "../../src/providerConnections/disconnectConvergenceService.js";
import {
  MAX_DISCONNECT_CONVERGENCE_CADENCE_MS,
  MIN_DISCONNECT_CONVERGENCE_CADENCE_MS,
  startDisconnectConvergenceLoop,
  type DisconnectConvergenceScheduler,
} from "../../src/providerConnections/disconnectConvergenceLoop.js";

const pool = {} as TransactionalPool;

type PendingTimer = Readonly<{
  id: number;
  callback: () => void;
  delayMs: number;
}>;

function controlledScheduler() {
  let nextId = 1;
  const pending = new Map<number, PendingTimer>();
  const scheduledDelays: number[] = [];

  const scheduler: DisconnectConvergenceScheduler =
    Object.freeze({
      schedule: (callback, delayMs) => {
        const id = nextId;
        nextId += 1;

        scheduledDelays.push(delayMs);
        pending.set(
          id,
          Object.freeze({
            id,
            callback,
            delayMs,
          }),
        );

        return id;
      },

      cancel: (handle) => {
        pending.delete(handle as number);
      },
    });

  return {
    scheduler,

    scheduledDelays,

    pendingCount: () => pending.size,

    fireNext: () => {
      const timer =
        pending.values().next().value as
          | PendingTimer
          | undefined;

      if (timer === undefined) {
        throw new Error(
          "no scheduled convergence timer",
        );
      }

      pending.delete(timer.id);
      timer.callback();
    },
  };
}

describe("R44B11E disconnect convergence loop", () => {
  it("uses bounded injected policy, BACKGROUND mode and continues after one connection fails", async () => {
    const timers = controlledScheduler();
    const failures: string[] = [];
    const calls: Array<{
      connectionId: string;
      context: DisconnectConvergenceContext;
    }> = [];

    let correlationSequence = 0;

    const loop = startDisconnectConvergenceLoop({
      pool,
      reportFailure: (text) =>
        failures.push(text),
      scheduler: timers.scheduler,
      policy: {
        cadenceMs: 5_000,
        connectionBatchSize: 7,
        childBatchSize: 9,
      },
      correlationId: () => {
        correlationSequence += 1;
        return `correlation-${correlationSequence}`;
      },
      discover: async (
        receivedPool,
        limit,
      ) => {
        expect(receivedPool).toBe(pool);
        expect(limit).toBe(7);

        return [
          "connection-one",
          "connection-two",
        ];
      },
      converge: async (
        receivedPool,
        connectionId,
        context,
      ) => {
        expect(receivedPool).toBe(pool);

        calls.push({
          connectionId,
          context,
        });

        if (
          connectionId ===
          "connection-one"
        ) {
          throw new DisconnectConvergenceError(
            "DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION",
          );
        }

        return Object.freeze({
          cancelledAuthorizations: 0,
          cancelledAttempts: 0,
          destroyedCredentialVersions: 0,
        });
      },
    });

    expect(timers.pendingCount()).toBe(1);
    expect(timers.scheduledDelays).toEqual([
      5_000,
    ]);

    await loop.runNow();

    expect(calls).toEqual([
      {
        connectionId: "connection-one",
        context: {
          correlationId: "correlation-1",
          mode: "BACKGROUND",
          childBatchSize: 9,
        },
      },
      {
        connectionId: "connection-two",
        context: {
          correlationId: "correlation-2",
          mode: "BACKGROUND",
          childBatchSize: 9,
        },
      },
    ]);

    expect(failures).toEqual([
      "commercial-api: periodic disconnect convergence connection failed (DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION)\n",
    ]);

    loop.stop();

    expect(timers.pendingCount()).toBe(0);
  });

  it("prohibits local re-entry and schedules exactly one later pass after the active pass settles", async () => {
    const timers = controlledScheduler();

    let discoverCalls = 0;
    let releaseDiscovery:
      | ((value: readonly string[]) => void)
      | undefined;

    const discoveryGate =
      new Promise<readonly string[]>(
        (resolve) => {
          releaseDiscovery = resolve;
        },
      );

    const loop = startDisconnectConvergenceLoop({
      pool,
      reportFailure: () => {},
      scheduler: timers.scheduler,
      policy: {
        cadenceMs: 2_000,
      },
      discover: async () => {
        discoverCalls += 1;
        return discoveryGate;
      },
      converge: async () =>
        Object.freeze({
          cancelledAuthorizations: 0,
          cancelledAttempts: 0,
          destroyedCredentialVersions: 0,
        }),
    });

    expect(timers.pendingCount()).toBe(1);

    const first = loop.runNow();

    await waitImmediate();

    expect(discoverCalls).toBe(1);

    // Consume the already-scheduled timer while runNow still owns the pass.
    // Its callback must observe running=true and perform no second discovery.
    timers.fireNext();

    await waitImmediate();

    expect(discoverCalls).toBe(1);
    expect(timers.pendingCount()).toBe(0);

    await loop.runNow();

    expect(discoverCalls).toBe(1);

    releaseDiscovery!([]);

    await first;
    await waitImmediate();

    expect(discoverCalls).toBe(1);
    expect(timers.pendingCount()).toBe(1);
    expect(timers.scheduledDelays).toEqual([
      2_000,
      2_000,
    ]);

    loop.stop();

    expect(timers.pendingCount()).toBe(0);
  });

  it("reports discovery failure and permits a later retry", async () => {
    const timers = controlledScheduler();
    const failures: string[] = [];

    let discoveryAttempt = 0;

    const loop = startDisconnectConvergenceLoop({
      pool,
      reportFailure: (text) =>
        failures.push(text),
      scheduler: timers.scheduler,
      discover: async () => {
        discoveryAttempt += 1;

        if (discoveryAttempt === 1) {
          throw new DisconnectConvergenceError(
            "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
          );
        }

        return [];
      },
      converge: async () =>
        Object.freeze({
          cancelledAuthorizations: 0,
          cancelledAttempts: 0,
          destroyedCredentialVersions: 0,
        }),
    });

    await loop.runNow();

    expect(discoveryAttempt).toBe(1);

    expect(failures).toEqual([
      "commercial-api: periodic disconnect convergence discovery failed (DISCONNECT_CONVERGENCE_DATABASE_FAILURE)\n",
    ]);

    await loop.runNow();

    expect(discoveryAttempt).toBe(2);

    loop.stop();
  });

  it("stops scheduling after shutdown even when shutdown occurs during an active pass", async () => {
    const timers = controlledScheduler();

    let releaseDiscovery:
      | ((value: readonly string[]) => void)
      | undefined;

    const discoveryGate =
      new Promise<readonly string[]>(
        (resolve) => {
          releaseDiscovery = resolve;
        },
      );

    const loop = startDisconnectConvergenceLoop({
      pool,
      reportFailure: () => {},
      scheduler: timers.scheduler,
      policy: {
        cadenceMs: 3_000,
      },
      discover: async () => discoveryGate,
      converge: async () =>
        Object.freeze({
          cancelledAuthorizations: 0,
          cancelledAttempts: 0,
          destroyedCredentialVersions: 0,
        }),
    });

    expect(timers.pendingCount()).toBe(1);

    const active = loop.runNow();

    await waitImmediate();

    loop.stop();

    expect(timers.pendingCount()).toBe(0);

    releaseDiscovery!([]);

    await active;
    await waitImmediate();

    expect(timers.pendingCount()).toBe(0);

    // Stopped loops cannot be manually restarted either.
    await loop.runNow();

    expect(timers.pendingCount()).toBe(0);
  });

  it("rejects cadence and batch policy outside the bounded contract", () => {
    const base = {
      pool,
      reportFailure: () => {},
      scheduler: controlledScheduler().scheduler,
      discover: async () => [],
      converge: async () =>
        Object.freeze({
          cancelledAuthorizations: 0,
          cancelledAttempts: 0,
          destroyedCredentialVersions: 0,
        }),
    } as const;

    expect(() =>
      startDisconnectConvergenceLoop({
        ...base,
        policy: {
          cadenceMs:
            MIN_DISCONNECT_CONVERGENCE_CADENCE_MS -
            1,
        },
      }),
    ).toThrow(RangeError);

    expect(() =>
      startDisconnectConvergenceLoop({
        ...base,
        policy: {
          cadenceMs:
            MAX_DISCONNECT_CONVERGENCE_CADENCE_MS +
            1,
        },
      }),
    ).toThrow(RangeError);

    expect(() =>
      startDisconnectConvergenceLoop({
        ...base,
        policy: {
          connectionBatchSize: 0,
        },
      }),
    ).toThrow(RangeError);

    expect(() =>
      startDisconnectConvergenceLoop({
        ...base,
        policy: {
          childBatchSize: 101,
        },
      }),
    ).toThrow(RangeError);
  });
  it("keeps two separately-created loop instances independent rather than sharing a process-global running flag", async () => {
    const firstTimers = controlledScheduler();
    const secondTimers = controlledScheduler();

    let firstDiscoverCalls = 0;
    let secondDiscoverCalls = 0;

    let releaseFirst:
      | ((value: readonly string[]) => void)
      | undefined;

    const firstGate =
      new Promise<readonly string[]>(
        (resolve) => {
          releaseFirst = resolve;
        },
      );

    const first =
      startDisconnectConvergenceLoop({
        pool,
        reportFailure: () => {},
        scheduler: firstTimers.scheduler,
        discover: async () => {
          firstDiscoverCalls += 1;
          return firstGate;
        },
        converge: async () =>
          Object.freeze({
            cancelledAuthorizations: 0,
            cancelledAttempts: 0,
            destroyedCredentialVersions: 0,
          }),
      });

    const second =
      startDisconnectConvergenceLoop({
        pool,
        reportFailure: () => {},
        scheduler: secondTimers.scheduler,
        discover: async () => {
          secondDiscoverCalls += 1;
          return [];
        },
        converge: async () =>
          Object.freeze({
            cancelledAuthorizations: 0,
            cancelledAttempts: 0,
            destroyedCredentialVersions: 0,
          }),
      });

    const firstActive = first.runNow();

    await waitImmediate();

    expect(firstDiscoverCalls).toBe(1);

    // If running were module-global, this second handle would incorrectly
    // no-op while the first handle owns its pass.
    await second.runNow();

    expect(secondDiscoverCalls).toBe(1);

    releaseFirst!([]);

    await firstActive;

    first.stop();
    second.stop();

    expect(firstTimers.pendingCount()).toBe(0);
    expect(secondTimers.pendingCount()).toBe(0);
  });
});
