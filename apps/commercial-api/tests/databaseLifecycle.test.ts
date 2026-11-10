import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { runCommercialApiProcess, type CommercialApiProcessDependencies, type ShutdownSignal } from "../src/runCommercialApiProcess.js";
import type { RuntimePool } from "../src/database/runtimePool.js";
import { RuntimeDatabaseError, type VerifiedSchema } from "../src/database/verifyRuntimeDatabase.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../src/startCommercialApiServer.js";
import { send } from "./httpClient.js";

const DATABASE_ENV = { COMMERCIAL_API_DATABASE_URL: "postgres://app_runtime:hunter2@127.0.0.1:5433/app_db" };
const VERIFIED: VerifiedSchema = { latestVersion: 1, latestSha256: "a".repeat(64) };

const started: RunningCommercialApiServer[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((server) => server.close().catch(() => undefined)));
});

function waitFor(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (condition()) resolve();
      else if (Date.now() > deadline) reject(new Error("condition not met"));
      else setTimeout(poll, 5);
    };
    poll();
  });
}

function harness(overrides: Partial<CommercialApiProcessDependencies> & { readinessRows?: () => object[] } = {}) {
  const events: string[] = [];
  const signals = new EventEmitter();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  let poolEnds = 0;
  let readyRows: () => object[] = overrides.readinessRows ?? (() => [{ version: 1, sha256: VERIFIED.latestSha256 }]);

  const pool: RuntimePool = {
    query: async <Row extends object>() => ({ rows: readyRows() as Row[] }),
    end: async () => {
      poolEnds += 1;
      events.push("pool-ended");
    },
  };

  const dependencies: CommercialApiProcessDependencies = {
    environment: DATABASE_ENV,
    onSignal: (signal: ShutdownSignal, listener: () => void) => {
      signals.once(signal, listener);
    },
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text),
    setExitCode: (code) => exitCodes.push(code),
    loadMigrations: async () => [],
    createPool: async () => {
      events.push("pool-created");
      return pool;
    },
    verifyDatabase: async () => {
      events.push("verified");
      return VERIFIED;
    },
    startServer: async (options) => {
      events.push("listening");
      const server = await startCommercialApiServer({ ...options, port: 0 });
      started.push(server);
      return {
        ...server,
        close: async () => {
          await server.close();
          events.push("http-closed");
        },
      };
    },
    ...overrides,
  };

  return {
    dependencies,
    events,
    signals,
    stdout,
    stderr,
    exitCodes,
    poolEnds: () => poolEnds,
    setReadyRows: (rows: () => object[]) => {
      readyRows = rows;
    },
  };
}

describe("database startup", () => {
  it("creates the pool and verifies the schema before listening, then serves readiness", async () => {
    const h = harness();
    const running = await runCommercialApiProcess(h.dependencies);

    expect(running).not.toBeNull();
    expect(h.events).toEqual(["pool-created", "verified", "listening"]);
    expect(h.stdout[0]).toBe("commercial-api: database verified\n");
    expect((await send(running!.port, "GET", "/__ready")).status).toBe(200);
    expect((await send(running!.port, "GET", "/__health")).status).toBe(200);
  });

  it("turns not ready when the database stops answering after startup", async () => {
    const h = harness();
    const running = await runCommercialApiProcess({ ...h.dependencies, readinessTimeoutMs: 50 });

    expect((await send(running!.port, "GET", "/__ready")).status).toBe(200);
    h.setReadyRows(() => {
      throw Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" });
    });
    expect((await send(running!.port, "GET", "/__ready")).status).toBe(503);
    expect((await send(running!.port, "GET", "/__health")).status).toBe(200);
  });

  it.each([
    ["DATABASE_CONNECTION_FAILED", new RuntimeDatabaseError("DATABASE_CONNECTION_FAILED", "ECONNREFUSED"), "(ECONNREFUSED)"],
    ["DATABASE_VERSION_UNSUPPORTED", new RuntimeDatabaseError("DATABASE_VERSION_UNSUPPORTED"), ""],
    ["SCHEMA_MISSING", new RuntimeDatabaseError("SCHEMA_MISSING"), ""],
    ["SCHEMA_BEHIND", new RuntimeDatabaseError("SCHEMA_BEHIND"), ""],
    ["SCHEMA_AHEAD", new RuntimeDatabaseError("SCHEMA_AHEAD"), ""],
    ["SCHEMA_DRIFT", new RuntimeDatabaseError("SCHEMA_DRIFT"), ""],
  ])("closes the pool, never listens and exits 1 on %s", async (code, error, detail) => {
    const h = harness({
      verifyDatabase: async () => {
        throw error;
      },
    });

    expect(await runCommercialApiProcess(h.dependencies)).toBeNull();
    expect(h.events).toEqual(["pool-created", "pool-ended"]);
    expect(h.poolEnds()).toBe(1);
    expect(h.exitCodes).toEqual([1]);
    expect(h.stderr).toEqual([
      `commercial-api: Database startup verification failed: ${code}${detail === "" ? "" : ` ${detail}`}.\n`,
    ]);
    expect(h.stderr.join("")).not.toContain("hunter2");
  });

  it("closes the pool when listening fails after verification", async () => {
    const h = harness({
      startServer: async () => {
        throw Object.assign(new Error("listen EADDRINUSE"), { code: "EADDRINUSE" });
      },
    });

    expect(await runCommercialApiProcess(h.dependencies)).toBeNull();
    expect(h.events).toEqual(["pool-created", "verified", "pool-ended"]);
    expect(h.exitCodes).toEqual([1]);
    expect(h.stderr).toEqual(["commercial-api: Could not listen on the configured host and port (EADDRINUSE).\n"]);
  });

  it("creates no pool and exits 1 on invalid database configuration", async () => {
    const h = harness({ environment: { COMMERCIAL_API_DATABASE_URL: "postgres://app_runtime:hunter2@127.0.0.1:5433/app_db?sslmode=disable" } });

    expect(await runCommercialApiProcess(h.dependencies)).toBeNull();
    expect(h.events).toEqual([]);
    expect(h.exitCodes).toEqual([1]);
    expect(h.stderr[0]).toMatch(/^commercial-api: Configuration error: COMMERCIAL_API_DATABASE_URL must be/);
    expect(h.stderr.join("")).not.toContain("hunter2");
  });

  it("requires a database in production", async () => {
    const h = harness({
      environment: { COMMERCIAL_API_ENV: "production", COMMERCIAL_API_HOST: "127.0.0.1", COMMERCIAL_API_PORT: "8080" },
    });

    expect(await runCommercialApiProcess(h.dependencies)).toBeNull();
    expect(h.events).toEqual([]);
    expect(h.stderr[0]).toContain("COMMERCIAL_API_DATABASE_URL is required");
  });

  it("runs without a database in development, reporting not ready", async () => {
    const h = harness({ environment: {} });
    const running = await runCommercialApiProcess(h.dependencies);

    expect(h.events).toEqual(["listening"]);
    expect(h.stdout).toContain("commercial-api: no database configured; /__ready reports not ready\n");
    expect((await send(running!.port, "GET", "/__ready")).status).toBe(503);
    expect((await send(running!.port, "GET", "/__health")).status).toBe(200);
  });
});

describe("database shutdown", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("on %s closes HTTP first, then the pool, exactly once", async (signal) => {
    const h = harness();
    const running = await runCommercialApiProcess(h.dependencies);

    h.signals.emit(signal);
    h.signals.emit(signal === "SIGINT" ? "SIGTERM" : "SIGINT");
    await waitFor(() => h.stdout.includes("commercial-api: stopped\n"));

    expect(h.events).toEqual(["pool-created", "verified", "listening", "http-closed", "pool-ended"]);
    expect(h.poolEnds()).toBe(1);
    expect(h.exitCodes).toEqual([]);
    await expect(send(running!.port, "GET", "/__health")).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("reports not ready as soon as shutdown begins", async () => {
    let releaseClose!: () => void;
    const h = harness();
    const startServer = h.dependencies.startServer!;
    const running = await runCommercialApiProcess({
      ...h.dependencies,
      startServer: async (options) => {
        const server = await startServer(options);
        return { ...server, close: () => new Promise<void>((resolve) => (releaseClose = () => void server.close().then(resolve))) };
      },
    });

    h.signals.emit("SIGTERM");
    // The listener is still open while close is held; readiness must already be false.
    expect((await send(running!.port, "GET", "/__ready")).status).toBe(503);
    releaseClose();
    await waitFor(() => h.stdout.includes("commercial-api: stopped\n"));
  });

  it("reports an unclean shutdown when the pool does not close in time", async () => {
    const h = harness();
    const running = await runCommercialApiProcess({
      ...h.dependencies,
      poolCloseTimeoutMs: 50,
      createPool: async () => ({
        query: async <Row extends object>() => ({ rows: [{ version: 1, sha256: VERIFIED.latestSha256 }] as Row[] }),
        end: () => new Promise<void>(() => {}),
      }),
    });

    expect(running).not.toBeNull();
    h.signals.emit("SIGINT");
    await waitFor(() => h.exitCodes.length > 0);

    expect(h.exitCodes).toEqual([1]);
    expect(h.stderr).toContain("commercial-api: shutdown did not complete cleanly\n");
  });
});
