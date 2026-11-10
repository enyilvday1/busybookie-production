import type { WorkerSecurityEvent, WorkerSecurityEventSink } from "../../src/workerControl/workerSecurityEvents.js";

// TEST FIXTURE ONLY. Records worker security events in memory for exact
// assertions; production source cannot import it (boundary test). `failing`
// simulates a security log that cannot accept events.
export function createRecordingWorkerSecurityEventSink(): Readonly<{
  sink: WorkerSecurityEventSink;
  events: WorkerSecurityEvent[];
  setFailing: (failing: boolean) => void;
}> {
  const events: WorkerSecurityEvent[] = [];
  let failing = false;
  return Object.freeze({
    events,
    setFailing: (value: boolean) => {
      failing = value;
    },
    sink: Object.freeze({
      record: async (event: WorkerSecurityEvent) => {
        if (failing) throw new Error("security log unavailable");
        events.push(event);
      },
    }),
  });
}
