import { createCustomerApplication } from "./application/customerApplication.js";
import type { AuthenticationAdapter } from "./authentication/authenticationAdapter.js";
import { loadServerConfig, ServerConfigError, type ConfigEnvironment } from "./config.js";
import type { ApplicationRouter } from "./createCommercialApiServer.js";
import { MigrationError } from "./database/migrationError.js";
import { discoverMigrations, type MigrationFile } from "./database/migrationFiles.js";
import { loadRuntimeDatabaseConfig, type RuntimeDatabaseConfig } from "./database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "./database/runtimePool.js";
import {
  createReadinessCheck,
  RuntimeDatabaseError,
  verifyRuntimeDatabase,
  type VerifiedSchema,
} from "./database/verifyRuntimeDatabase.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "./startCommercialApiServer.js";

export const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

// A readiness probe answers within this bound or reports not ready.
export const DEFAULT_READINESS_TIMEOUT_MS = 2_000;
// Pool shutdown is abandoned (and reported) after this bound.
export const DEFAULT_POOL_CLOSE_TIMEOUT_MS = 5_000;

export type CommercialApiProcessDependencies = Readonly<{
  environment: ConfigEnvironment;
  onSignal: (signal: ShutdownSignal, listener: () => void) => void;
  writeStdout: (text: string) => void;
  writeStderr: (text: string) => void;
  setExitCode: (code: number) => void;
  startServer?: typeof startCommercialApiServer;
  createPool?: (config: RuntimeDatabaseConfig, reportError: (text: string) => void) => Promise<TransactionalPool>;
  loadMigrations?: () => Promise<readonly MigrationFile[]>;
  verifyDatabase?: (pool: TransactionalPool, migrations: readonly MigrationFile[]) => Promise<VerifiedSchema>;
  // Code-level composition only (never read from the environment). When
  // supplied, the authenticated customer routes are installed on the single
  // runtime pool. The default entry point supplies none: no production
  // identity-provider adapter exists yet, so those routes are not exposed.
  authentication?: AuthenticationAdapter;
  readinessTimeoutMs?: number;
  poolCloseTimeoutMs?: number;
}>;

function describeStartupFailure(error: unknown): string {
  if (error instanceof ServerConfigError) {
    return `Configuration error: ${error.message}`;
  }
  if (error instanceof RuntimeDatabaseError) {
    return `Database startup verification failed: ${error.code}${error.detail === undefined ? "" : ` (${error.detail})`}.`;
  }
  if (error instanceof MigrationError) {
    return `Committed migrations could not be read: ${error.code}.`;
  }
  return "Database startup failed.";
}

// Process startup and shutdown.
//
// Startup order: validate configuration; create the single runtime pool;
// verify connectivity, PostgreSQL version, runtime-role safety and the
// applied schema against the committed migrations; only then listen. Any
// failure closes the pool and exits 1 without listening, so an orchestrator
// sees a failed start with the failure class in the log rather than a live
// process that can never become ready. Migrations are never run here.
//
// In development with no database configured the API still listens, and
// /__ready reports not ready.
//
// Shutdown on SIGINT/SIGTERM (once): readiness flips to not ready, the HTTP
// server stops accepting connections and drains, then the pool is closed.
//
// Returns the running server, or null when startup failed (the exit code is
// then already set).
export async function runCommercialApiProcess(
  dependencies: CommercialApiProcessDependencies,
): Promise<RunningCommercialApiServer | null> {
  const startServer = dependencies.startServer ?? startCommercialApiServer;
  const createPool = dependencies.createPool ?? createRuntimePool;
  const loadMigrations = dependencies.loadMigrations ?? (() => discoverMigrations());
  const verifyDatabase = dependencies.verifyDatabase ?? verifyRuntimeDatabase;
  const poolCloseTimeoutMs = dependencies.poolCloseTimeoutMs ?? DEFAULT_POOL_CLOSE_TIMEOUT_MS;

  const failStartup = (message: string) => {
    dependencies.writeStderr(`commercial-api: ${message}\n`);
    dependencies.setExitCode(1);
  };

  let pool: TransactionalPool | null = null;
  let application: ApplicationRouter | undefined;
  let poolClosing: Promise<boolean> | undefined;

  // Idempotent and bounded; resolves false if the pool did not close cleanly in time.
  const closePool = (): Promise<boolean> => {
    poolClosing ??= (async () => {
      if (pool === null) {
        return true;
      }
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), poolCloseTimeoutMs);
        timer.unref();
      });
      try {
        return await Promise.race([pool.end().then(() => true, () => false), timedOut]);
      } finally {
        clearTimeout(timer);
      }
    })();
    return poolClosing;
  };

  let draining = false;
  let liveReadiness: () => Promise<boolean> = async () => false;
  let host: string;
  let port: number;
  let databaseConfigured: boolean;

  try {
    const config = loadServerConfig(dependencies.environment);
    const databaseConfig = loadRuntimeDatabaseConfig(dependencies.environment, config.mode);
    host = config.host;
    port = config.port;
    databaseConfigured = databaseConfig !== null;

    if (dependencies.authentication !== undefined && databaseConfig === null) {
      throw new ServerConfigError("The authenticated application requires a configured database.");
    }

    if (databaseConfig !== null) {
      const migrations = await loadMigrations();
      pool = await createPool(databaseConfig, dependencies.writeStderr);
      const verified = await verifyDatabase(pool, migrations);
      liveReadiness = createReadinessCheck(pool, verified, dependencies.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS);
      if (dependencies.authentication !== undefined) {
        application = createCustomerApplication({ authentication: dependencies.authentication, pool, reportFailure: dependencies.writeStderr });
      }
      dependencies.writeStdout("commercial-api: database verified\n");
    }
  } catch (error) {
    await closePool();
    failStartup(describeStartupFailure(error));
    return null;
  }

  let running: RunningCommercialApiServer;
  try {
    running = await startServer({
      host,
      port,
      dependencies: {
        checkReadiness: () => (draining ? Promise.resolve(false) : liveReadiness()),
        ...(application === undefined ? {} : { application }),
      },
    });
  } catch (error) {
    await closePool();
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    failStartup(`Could not listen on the configured host and port${typeof code === "string" ? ` (${code})` : ""}.`);
    return null;
  }

  dependencies.writeStdout(`commercial-api listening on ${running.host}:${running.port}\n`);
  if (!databaseConfigured) {
    dependencies.writeStdout("commercial-api: no database configured; /__ready reports not ready\n");
  }

  let shuttingDown = false;

  for (const signal of SHUTDOWN_SIGNALS) {
    dependencies.onSignal(signal, () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      draining = true;

      dependencies.writeStdout(`commercial-api: ${signal} received, shutting down\n`);
      void running
        .close()
        .then(
          () => true,
          () => false,
        )
        .then(async (httpClosed) => {
          const poolClosed = await closePool();
          if (httpClosed && poolClosed) {
            dependencies.writeStdout("commercial-api: stopped\n");
          } else {
            dependencies.writeStderr("commercial-api: shutdown did not complete cleanly\n");
            dependencies.setExitCode(1);
          }
        });
    });
  }

  return running;
}
