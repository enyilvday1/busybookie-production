// The sticky worker-local host-fault latch
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
// "Acceptance handler and adapter", R44B6Y0).
//
// It starts clear and, once tripped, stays tripped for the life of the
// process: there is deliberately no way to reset it. The next clear state is
// a new process that passes startup reconciliation. It records only that a
// fault happened, never why, so it can hold no secret. Future new-work
// orchestration must consult it before any provider attempt; no production
// path does yet, because live provider execution is disabled.

export type HostFaultLatch = Readonly<{
  isTripped: () => boolean;
  trip: () => void;
}>;

export function createHostFaultLatch(): HostFaultLatch {
  let tripped = false;
  return Object.freeze({
    isTripped: () => tripped,
    trip: () => {
      tripped = true;
    },
  });
}
