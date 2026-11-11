// Explicit commercial-worker configuration
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 17,
// "State-root binding", R44B8A). Reads only the COMMERCIAL_WORKER_* keys from
// the environment object it is given; no worker production module reads the
// process environment, and there is no process entry point.
//
// Deliberately stricter than the commercial-api configuration: both keys are
// always required, in every mode, and nothing is ever defaulted, derived or
// created. Durability must never weaken over a forgotten key. Error messages
// are fixed text and never echo a supplied value.

export const WORKER_CONFIG_KEYS = {
  mode: "COMMERCIAL_WORKER_ENV",
  stateRoot: "COMMERCIAL_WORKER_STATE_ROOT",
} as const;

// The published private/staging deployment binding (deployment/README.md,
// R44B8P0): the dedicated worker root on the persistent /var/lib/busybookie
// mount. A production worker accepts exactly this root and no other.
export const PRODUCTION_WORKER_STATE_ROOT = "/var/lib/busybookie/commercial-worker";

export type WorkerMode = "development" | "production";

export type WorkerConfig = Readonly<{
  mode: WorkerMode;
  // The explicit state root, exactly as configured; validated against the
  // host by the state-root binding before any use.
  stateRoot: string;
}>;

export type WorkerConfigEnvironment = Readonly<Record<string, string | undefined>>;

export type WorkerConfigErrorCode =
  | "WORKER_ENV_MISSING"
  | "WORKER_ENV_INVALID"
  | "WORKER_STATE_ROOT_MISSING"
  | "WORKER_STATE_ROOT_EMPTY"
  | "WORKER_STATE_ROOT_NOT_PRODUCTION_ROOT";

const MESSAGES: Readonly<Record<WorkerConfigErrorCode, string>> = {
  WORKER_ENV_MISSING: `${WORKER_CONFIG_KEYS.mode} is required.`,
  WORKER_ENV_INVALID: `${WORKER_CONFIG_KEYS.mode} must be "development" or "production".`,
  WORKER_STATE_ROOT_MISSING: `${WORKER_CONFIG_KEYS.stateRoot} is required.`,
  WORKER_STATE_ROOT_EMPTY: `${WORKER_CONFIG_KEYS.stateRoot} must not be empty.`,
  WORKER_STATE_ROOT_NOT_PRODUCTION_ROOT: `${WORKER_CONFIG_KEYS.stateRoot} must be the published production state root when ${WORKER_CONFIG_KEYS.mode} is "production".`,
};

export class WorkerConfigError extends Error {
  override readonly name = "WorkerConfigError";

  constructor(readonly code: WorkerConfigErrorCode) {
    super(MESSAGES[code]);
  }
}

function parseMode(value: string | undefined): WorkerMode {
  if (value === undefined) throw new WorkerConfigError("WORKER_ENV_MISSING");
  if (value === "development" || value === "production") return value;
  throw new WorkerConfigError("WORKER_ENV_INVALID");
}

export function loadWorkerConfig(environment: WorkerConfigEnvironment): WorkerConfig {
  const mode = parseMode(environment[WORKER_CONFIG_KEYS.mode]);
  const stateRoot = environment[WORKER_CONFIG_KEYS.stateRoot];
  if (stateRoot === undefined) throw new WorkerConfigError("WORKER_STATE_ROOT_MISSING");
  if (stateRoot === "") throw new WorkerConfigError("WORKER_STATE_ROOT_EMPTY");
  // The application half of the concrete deployment binding.
  if (mode === "production" && stateRoot !== PRODUCTION_WORKER_STATE_ROOT) throw new WorkerConfigError("WORKER_STATE_ROOT_NOT_PRODUCTION_ROOT");
  return Object.freeze({ mode, stateRoot });
}
