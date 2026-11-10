import { readFile } from "node:fs/promises";

import pg from "pg";

import { ServerConfigError } from "../config.js";
import { redactConnectionSecrets } from "./databaseConfig.js";
import { RUNTIME_DATABASE_KEYS, type RuntimeDatabaseConfig } from "./runtimeDatabaseConfig.js";

// The narrow surface the API needs from its pool; tests supply fakes.
export type RuntimePool = Readonly<{
  query: <Row extends object>(sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  end: () => Promise<void>;
}>;

// One checked-out session. Every statement of a transaction must run on the
// same client; Pool.query() may use a different connection per call.
export type RuntimeClient = Readonly<{
  query: <Row extends object>(sql: string, params?: unknown[]) => Promise<{ rows: Row[] }>;
  // Passing an error destroys the connection instead of returning it to the
  // pool (used when a rollback could not be confirmed).
  release: (destroyWithError?: Error) => void;
}>;

export type TransactionalPool = RuntimePool &
  Readonly<{
    connect: () => Promise<RuntimeClient>;
  }>;

const PEM_CERTIFICATE = "-----BEGIN CERTIFICATE-----";

// Explicit TLS mapping. "require" encrypts without verifying the server;
// "verify-full" verifies the chain (against the configured CA when given,
// otherwise Node's trust store) and the server hostname.
export function toPgSslOptions(config: RuntimeDatabaseConfig, caPem: string | null): pg.PoolConfig["ssl"] {
  switch (config.tls) {
    case "disable":
      return false;
    case "require":
      return { rejectUnauthorized: false };
    case "verify-full":
      return caPem === null ? { rejectUnauthorized: true } : { rejectUnauthorized: true, ca: caPem };
  }
}

// Timeouts are PostgreSQL session settings sent as connection startup
// parameters, so every pooled session carries them without extra SQL.
export function toPgPoolConfig(config: RuntimeDatabaseConfig, caPem: string | null): pg.PoolConfig {
  return {
    connectionString: config.url,
    ssl: toPgSslOptions(config, caPem),
    max: config.poolMax,
    connectionTimeoutMillis: config.connectTimeoutMs,
    statement_timeout: config.statementTimeoutMs,
    lock_timeout: config.lockTimeoutMs,
    idle_in_transaction_session_timeout: config.idleInTransactionTimeoutMs,
    application_name: "commercial-api",
  };
}

async function readCaCertificate(path: string): Promise<string> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.caFile} could not be read.`);
  }
  if (!contents.includes(PEM_CERTIFICATE)) {
    throw new ServerConfigError(`${RUNTIME_DATABASE_KEYS.caFile} does not contain a PEM certificate.`);
  }
  return contents;
}

export type PoolErrorReporter = (text: string) => void;

// Creates the process's single runtime pool. Idle-client errors (for example
// the server closing a connection) are reported with their class only; the
// pool discards the broken client and the live readiness probe reflects any
// lasting outage.
export async function createRuntimePool(config: RuntimeDatabaseConfig, reportError: PoolErrorReporter): Promise<TransactionalPool> {
  const caPem = config.caFile === null ? null : await readCaCertificate(config.caFile);
  const pool = new pg.Pool(toPgPoolConfig(config, caPem));

  pool.on("error", (error: Error & { code?: unknown }) => {
    const code = typeof error.code === "string" ? error.code : error.name;
    reportError(redactConnectionSecrets(`commercial-api: idle database connection error (${code})\n`, config.url));
  });

  return Object.freeze({
    query: async <Row extends object>(sql: string, params?: unknown[]) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows as Row[] };
    },
    end: () => pool.end(),
    connect: async () => {
      const client = await pool.connect();
      return Object.freeze({
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          const result = await client.query(sql, params);
          return { rows: result.rows as Row[] };
        },
        release: (destroyWithError?: Error) => client.release(destroyWithError),
      });
    },
  });
}
