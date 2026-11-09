// Explicit server configuration. Reads only the COMMERCIAL_API_* keys from
// the environment object it is given; it never loads .env files and holds no
// secrets. An explicitly set but malformed value is always an error, never a
// silent fallback to the default.

export const DEFAULT_HOST = "127.0.0.1";

// Local-development default. Chosen to avoid every port already used by the
// repository's other local applications (asserted in tests/config.test.ts).
export const DEFAULT_PORT = 4480;

export const CONFIG_KEYS = {
  host: "COMMERCIAL_API_HOST",
  port: "COMMERCIAL_API_PORT",
  mode: "COMMERCIAL_API_ENV",
} as const;

export type ServerMode = "development" | "production";

export type ServerConfig = Readonly<{
  host: string;
  port: number;
  mode: ServerMode;
}>;

export type ConfigEnvironment = Readonly<Record<string, string | undefined>>;

export class ServerConfigError extends Error {
  override readonly name = "ServerConfigError";
}

const HOST_PATTERN = /^[A-Za-z0-9.:-]{1,253}$/;
const PORT_PATTERN = /^[0-9]{1,5}$/;

function parseMode(value: string | undefined): ServerMode {
  if (value === undefined) {
    return "development";
  }

  if (value === "development" || value === "production") {
    return value;
  }

  throw new ServerConfigError(`${CONFIG_KEYS.mode} must be "development" or "production".`);
}

function parseHost(value: string): string {
  if (!HOST_PATTERN.test(value)) {
    throw new ServerConfigError(`${CONFIG_KEYS.host} must be a hostname or IP address.`);
  }

  return value;
}

export function parsePort(value: string): number {
  const port = PORT_PATTERN.test(value) ? Number(value) : Number.NaN;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ServerConfigError(`${CONFIG_KEYS.port} must be an integer from 1 to 65535.`);
  }

  return port;
}

// Development falls back to safe local defaults when a key is unset.
// Production requires host and port to be set explicitly.
export function loadServerConfig(environment: ConfigEnvironment): ServerConfig {
  const mode = parseMode(environment[CONFIG_KEYS.mode]);
  const host = environment[CONFIG_KEYS.host];
  const port = environment[CONFIG_KEYS.port];

  if (mode === "production" && (host === undefined || port === undefined)) {
    throw new ServerConfigError(
      `${CONFIG_KEYS.host} and ${CONFIG_KEYS.port} are required when ${CONFIG_KEYS.mode} is "production".`,
    );
  }

  return Object.freeze({
    host: host === undefined ? DEFAULT_HOST : parseHost(host),
    port: port === undefined ? DEFAULT_PORT : parsePort(port),
    mode,
  });
}
