import type { RecoverySleep } from "../../src/acceptanceRecoveryPolicy.js";

// Deterministic time for the startup acceptance-recovery policy: a monotonic
// clock in milliseconds that only moves when told to. Backoff sleeps (no
// signal) advance it at once. A request deadline (a sleep with a signal)
// stays pending until the request settles and cancels it, unless the
// deadline mode is "fire", which models a request hanging through the whole
// remaining budget: the clock jumps by the remaining budget and the
// deadline resolves. Nothing here waits in real time.
export function fakeRecoveryTime(options: Readonly<{ deadlines?: "pend" | "fire" }> = {}) {
  let now = 0;
  const backoffs: number[] = [];
  const deadlines: number[] = [];
  const sleep: RecoverySleep = async (ms, signal) => {
    if (signal === undefined) {
      backoffs.push(ms);
      now += ms;
      return;
    }
    deadlines.push(ms);
    if (signal.aborted) return;
    if (options.deadlines === "fire") {
      // Let a request that settles without I/O win first; only a request
      // still pending after the current turn is treated as hanging.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!signal.aborted) now += ms;
      return;
    }
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
  };
  return {
    monotonicNow: () => now,
    sleep,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
    backoffs,
    deadlines,
  };
}
