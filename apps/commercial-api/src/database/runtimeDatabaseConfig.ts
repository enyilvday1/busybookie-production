import { ServerConfigError, type ConfigEnvironment, type ServerMode } from "../config.js";

// Runtime API database configuration. Distinct from the migration commands'
// COMMERCIAL_API_MIGRATION_* keys and from the test suite's
// COMMERCIAL_API_TEST_* keys; there is no fallback between them.
export const RUNTIME_DATABASE_KEYS = {
  url: "COMMERCIAL_API_DATABASE_URL",
  tls: "COMMERCIAL_API_DATABASE_TLS",
  caFile: "COMMERCIAL_API_DATABASE_CA_FILE",
  poolMax: "COMMERCIAL_API_DATABASE_POOL_MAX",
  connectTimeoutMs: "COMMERCIAL_API_DATABASE_CONNECT_TIMEOUT_MS",
  statementTimeoutMs: "COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS",
  lockTimeoutMs: "COMMERCIAL_API_DATABASE_LOCK_TIMEOUT_MS",
  idleInTransactionTimeoutMs: "COMMERCIAL_API_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS",
} as const;

// disable:     no TLS. Development against a loopback host only.
// require:     encrypted, but the server certificate is NOT verified. Development only.
// verify-full: encrypted; certificate chain and server hostname verified. Required in production.
export type DatabaseTlsMode = "disable" | "require" | "verify-full";

type BoundedInteger = Readonly<{ key: string; min: number; max: number; fallback: number }>;

// Documented defaults, used only when a key is unset. Zero is never accepted:
// PostgreSQL treats a zero timeout as "no timeout".
const BOUNDED_SETTINGS = {
  poolMax: { key: RUNTIME_DATABASE_KEYS.poolMax, min: 1, max: 100, fallback: 10 },
  connectTimeoutMs: { key: RUNTIME_DATABASE_KEYS.connectTimeoutMs, min: 100, max: 60_000, fallback: 5_000 },
  statementTimeoutMs: { key: RUNTIME_DATABASE_KEYS.statementTimeoutMs, min: 100, max: 600_000, fallback: 15_000 },
  lockTimeoutMs: { key: RUNTIME_DATABASE_KEYS.lockTimeoutMs, min: 100, max: 600_000, fallback: 5_000 },
  idleInTransactionTimeoutMs: {
    key: RUNTIME_DATABASE_KEYS.idleInTransactionTimeoutMs,
    min: 100,
    max: 3_600_000,
    fallback: 30_000,
  },
} as const satisfies Record<string, BoundedInteger>;

export type RuntimeDatabaseConfig = Readonly<{
  url: string;
  host: string;
  tls: DatabaseTlsMode;
  caFile: string | null;
  poolMax: number;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const INTEGER_PATTERN = /^[0-9]{1,7}$/;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host);
}

// Never echoes the value: the URL may contain a password.
function parseRuntimeUrl(value: string): Readonly<{ url: string; host: string }> {
  const invalid = () =>
    new ServerConfigError(
      `${RUNTIME_DATABASE_KEYS.url} must be a postgres:// or postgresql:// URL with a user, host and database name and no query parameters.`,
    );

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }

  // Connection-string parameters (sslmode, options, ...) would override the
  // explicit settings below inside pg, so none are accepted.
  if (
    (url.protocol !== "postgres:" && url.protocol !== "postgresql:") ||
    url.hostname === "" ||
    url.username === "" ||
    url.pathname.length < 2 ||
    url.pathname.slice(1).includes("/") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw invalid();
  }

  return { url: value, host: url.hostname };
}

function parseTlsMode(value: string | undefined, mode: ServerMode, host: string): DatabaseTlsMode {
  if (value === undefined) {
    // Locked secure policy: verify-full unless developing against loopback.
    return mode === "development" && isLoopbackHost(host) ? "disable" : "verify-full";
  }

  if (value !== "disable" && value !== "require" && value !== "verify-full") {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.tls} must be "disable", "require" or "verify-full".`);
  }

  return value;
}

function parseBoundedInteger(environment: ConfigEnvironment, setting: BoundedInteger): number {
  const value = environment[setting.key];
  if (value === undefined) {
    return setting.fallback;
  }

  const parsed = INTEGER_PATTERN.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < setting.min || parsed > setting.max) {
    throw new ServerConfigError(`${setting.key} must be an integer from ${setting.min} to ${setting.max}.`);
  }

  return parsed;
}

// Returns null only in development when no database is configured; the API
// then runs with /__ready permanently reporting not ready. Production always
// requires a database.
export function loadRuntimeDatabaseConfig(environment: ConfigEnvironment, mode: ServerMode): RuntimeDatabaseConfig | null {
  const rawUrl = environment[RUNTIME_DATABASE_KEYS.url];

  if (rawUrl === undefined) {
    const dependentKeys = Object.values(RUNTIME_DATABASE_KEYS).filter(
      (key) => key !== RUNTIME_DATABASE_KEYS.url && environment[key] !== undefined,
    );
    if (mode === "production") {
      throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.url} is required when COMMERCIAL_API_ENV is "production".`);
    }
    if (dependentKeys.length > 0) {
      throw new ServerConfigError(`Database settings are set but ${RUNTIME_DATABASE_KEYS.url} is not.`);
    }
    return null;
  }

  const { url, host } = parseRuntimeUrl(rawUrl);
  const tls = parseTlsMode(environment[RUNTIME_DATABASE_KEYS.tls], mode, host);
  const caFileValue = environment[RUNTIME_DATABASE_KEYS.caFile];

  if (caFileValue !== undefined && caFileValue.trim() === "") {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.caFile} must be a file path when set.`);
  }
  if (caFileValue !== undefined && tls !== "verify-full") {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.caFile} is only valid with ${RUNTIME_DATABASE_KEYS.tls}=verify-full.`);
  }
  if (tls === "disable" && !isLoopbackHost(host)) {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.tls}=disable is only permitted for a loopback database host.`);
  }
  if (mode === "production" && tls !== "verify-full") {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.tls} must be "verify-full" in production.`);
  }
  if (mode === "production" && caFileValue === undefined) {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.caFile} is required in production.`);
  }

  return Object.freeze({
    url,
    host,
    tls,
    caFile: caFileValue ?? null,
    poolMax: parseBoundedInteger(environment, BOUNDED_SETTINGS.poolMax),
    connectTimeoutMs: parseBoundedInteger(environment, BOUNDED_SETTINGS.connectTimeoutMs),
    statementTimeoutMs: parseBoundedInteger(environment, BOUNDED_SETTINGS.statementTimeoutMs),
    lockTimeoutMs: parseBoundedInteger(environment, BOUNDED_SETTINGS.lockTimeoutMs),
    idleInTransactionTimeoutMs: parseBoundedInteger(environment, BOUNDED_SETTINGS.idleInTransactionTimeoutMs),
  });
}
