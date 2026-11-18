import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import type { TransactionalPool } from "../src/database/runtimePool.js";
import type { VerifiedSchema } from "../src/database/verifyRuntimeDatabase.js";
import type {
  DisconnectConvergenceLoopOptions,
  DisconnectConvergenceLoopPolicy,
} from "../src/providerConnections/disconnectConvergenceLoop.js";
import type {
  ProviderVerificationReconciliationLoopOptions,
  ProviderVerificationReconciliationLoopPolicy,
} from "../src/providerConnections/providerVerificationReconciliationLoop.js";
import {
  runCommercialApiProcess,
  type CommercialApiProcessDependencies,
  type ShutdownSignal,
} from "../src/runCommercialApiProcess.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../src/startCommercialApiServer.js";
import { send } from "./httpClient.js";

const servers: RunningCommercialApiServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function waitFor(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    const poll = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() > deadline) {
        reject(new Error("condition not met"));
      } else {
        setTimeout(poll, 10);
      }
    };
    poll();
  });
}

describe("startCommercialApiServer", () => {
  it("listens on an ephemeral loopback port", async () => {
    const running = await startCommercialApiServer({ host: "127.0.0.1", port: 0 });
    servers.push(running);

    expect(running.host).toBe("127.0.0.1");
    expect(running.port).toBeGreaterThan(0);
    expect((await send(running.port, "GET", "/__health")).status).toBe(200);
  });

  it("stops accepting connections after close", async () => {
    const running = await startCommercialApiServer({ host: "127.0.0.1", port: 0 });
    expect((await send(running.port, "GET", "/__health")).status).toBe(200);

    await running.close();

    await expect(send(running.port, "GET", "/__health")).rejects.toMatchObject({ code: "ECONNREFUSED" });
  });

  it("makes close idempotent", async () => {
    const running = await startCommercialApiServer({ host: "127.0.0.1", port: 0 });
    const first = running.close();

    expect(running.close()).toBe(first);
    await first;
  });

  it("rejects an invalid port before binding", async () => {
    await expect(startCommercialApiServer({ host: "127.0.0.1", port: -1 })).rejects.toThrow();
    await expect(startCommercialApiServer({ host: "127.0.0.1", port: 70000 })).rejects.toThrow();
  });

  it("reports a failed bind instead of retrying elsewhere", async () => {
    const running = await startCommercialApiServer({ host: "127.0.0.1", port: 0 });
    servers.push(running);

    await expect(startCommercialApiServer({ host: "127.0.0.1", port: running.port })).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
  });
});

function fakeProcess(environment: Record<string, string | undefined>) {
  const signals = new EventEmitter();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];

  return {
    signals,
    stdout,
    stderr,
    exitCodes,
    dependencies: {
      environment,
      onSignal: (signal: ShutdownSignal, listener: () => void) => {
        signals.once(signal, listener);
      },
      writeStdout: (text: string) => {
        stdout.push(text);
      },
      writeStderr: (text: string) => {
        stderr.push(text);
      },
      setExitCode: (code: number) => {
        exitCodes.push(code);
      },
    },
  };
}

describe("runCommercialApiProcess", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("starts with no provider or media variables and shuts down on %s", async (signal) => {
    // Empty environment: no provider, media-root or database variables. The
    // configured default port is swapped for an ephemeral one.
    const fake = fakeProcess({});
    const running = await runCommercialApiProcess({
      ...fake.dependencies,
      startServer: (options) => startCommercialApiServer({ ...options, port: 0 }),
    });

    expect(running).not.toBeNull();
    expect(fake.stdout[0]).toMatch(/^commercial-api listening on 127\.0\.0\.1:\d+\n$/);
    expect((await send(running!.port, "GET", "/__health")).status).toBe(200);

    fake.signals.emit(signal);
    await waitFor(() => fake.stdout.includes("commercial-api: stopped\n"));

    expect(fake.stdout).toContain(`commercial-api: ${signal} received, shutting down\n`);
    await expect(send(running!.port, "GET", "/__health")).rejects.toMatchObject({ code: "ECONNREFUSED" });
    expect(fake.exitCodes).toEqual([]);
    expect(fake.stderr).toEqual([]);
  });

  it("handles a repeated signal only once", async () => {
    const fake = fakeProcess({});
    const running = await runCommercialApiProcess({
      ...fake.dependencies,
      startServer: (options) => startCommercialApiServer({ ...options, port: 0 }),
    });

    fake.signals.emit("SIGINT");
    fake.signals.emit("SIGTERM");
    await waitFor(() => fake.stdout.includes("commercial-api: stopped\n"));

    expect(running).not.toBeNull();
    expect(fake.stdout.filter((line) => line.includes("received"))).toHaveLength(1);
  });

  it("fails with exit code 1 on malformed configuration without starting", async () => {
    const fake = fakeProcess({ COMMERCIAL_API_PORT: "not-a-port" });
    let started = false;
    const result = await runCommercialApiProcess({
      ...fake.dependencies,
      startServer: async () => {
        started = true;
        throw new Error("unreachable");
      },
    });

    expect(result).toBeNull();
    expect(started).toBe(false);
    expect(fake.exitCodes).toEqual([1]);
    expect(fake.stderr).toEqual(["commercial-api: Configuration error: COMMERCIAL_API_PORT must be an integer from 1 to 65535.\n"]);
    expect(fake.stderr.join("")).not.toContain("not-a-port");
  });

  it("fails with exit code 1 and a generic message when the bind fails", async () => {
    const fake = fakeProcess({});
    const result = await runCommercialApiProcess({
      ...fake.dependencies,
      startServer: async () => {
        throw Object.assign(new Error("listen EADDRINUSE: detail"), { code: "EADDRINUSE" });
      },
    });

    expect(result).toBeNull();
    expect(fake.exitCodes).toEqual([1]);
    expect(fake.stderr).toEqual(["commercial-api: Could not listen on the configured host and port (EADDRINUSE).\n"]);
  });
});

// R44B11F Phase 4: background-loop orchestration. Everything here is a
// deterministic fake: no database, no listening socket, no loop timers.
const DATABASE_ENV = { COMMERCIAL_API_DATABASE_URL: "postgres://app_runtime:hunter2@127.0.0.1:5433/app_db" };
const VERIFIED: VerifiedSchema = { latestVersion: 1, latestSha256: "a".repeat(64) };

function orchestrationHarness(environment: Record<string, string | undefined> = DATABASE_ENV) {
  const fake = fakeProcess(environment);
  const events: string[] = [];
  const disconnectStarts: DisconnectConvergenceLoopOptions[] = [];
  const verificationStarts: ProviderVerificationReconciliationLoopOptions[] = [];
  let serverStarts = 0;
  let releaseHttpClose: (() => void) | undefined;

  const pool: TransactionalPool = {
    query: async <Row extends object>() => ({ rows: [] as Row[] }),
    end: async () => {
      events.push("pool-end");
    },
    connect: async () => {
      throw new Error("orchestration tests never check out a client");
    },
  };

  const fakeServer: RunningCommercialApiServer = {
    host: "127.0.0.1",
    port: 4321,
    close: () => {
      events.push("http-close-start");
      return new Promise<void>((resolve) => {
        releaseHttpClose = () => {
          events.push("http-close-settled");
          resolve();
        };
      });
    },
  };

  const dependencies: CommercialApiProcessDependencies = {
    ...fake.dependencies,
    loadMigrations: async () => [],
    createPool: async () => {
      events.push("pool-created");
      return pool;
    },
    verifyDatabase: async (receivedPool) => {
      expect(receivedPool).toBe(pool);
      events.push("db-verified");
      return VERIFIED;
    },
    startServer: async () => {
      serverStarts += 1;
      events.push("server-start");
      return fakeServer;
    },
    disconnectConvergence: {
      start: (options) => {
        disconnectStarts.push(options);
        events.push("disconnect-start");
        return { runNow: async () => {}, stop: () => events.push("disconnect-stop") };
      },
    },
    providerVerificationReconciliation: {
      start: (options) => {
        verificationStarts.push(options);
        events.push("verification-start");
        return { runNow: async () => {}, stop: () => events.push("verification-stop") };
      },
    },
  };

  return {
    ...fake,
    pool,
    events,
    dependencies,
    disconnectStarts,
    verificationStarts,
    serverStarts: () => serverStarts,
    releaseHttpClose: () => releaseHttpClose!(),
    count: (event: string) => events.filter((entry) => entry === event).length,
  };
}

describe("runCommercialApiProcess background reconciliation loops (R44B11F Phase 4)", () => {
  it("starts both loops on the verified pool before the server and stops both on a clean shutdown", async () => {
    const harness = orchestrationHarness();
    const disconnectPolicy: DisconnectConvergenceLoopPolicy = { cadenceMs: 5_000, connectionBatchSize: 7, childBatchSize: 9 };
    const verificationPolicy: ProviderVerificationReconciliationLoopPolicy = { cadenceMs: 4_000, batchSize: 11 };

    const running = await runCommercialApiProcess({
      ...harness.dependencies,
      disconnectConvergence: { ...harness.dependencies.disconnectConvergence, policy: disconnectPolicy },
      providerVerificationReconciliation: {
        ...harness.dependencies.providerVerificationReconciliation,
        policy: verificationPolicy,
      },
    });

    expect(running).not.toBeNull();
    expect(harness.events).toEqual([
      "pool-created",
      "db-verified",
      "disconnect-start",
      "verification-start",
      "server-start",
    ]);

    expect(harness.disconnectStarts).toHaveLength(1);
    expect(harness.verificationStarts).toHaveLength(1);
    expect(harness.disconnectStarts[0]!.pool).toBe(harness.pool);
    expect(harness.verificationStarts[0]!.pool).toBe(harness.pool);
    expect(harness.disconnectStarts[0]!.policy).toBe(disconnectPolicy);
    expect(harness.verificationStarts[0]!.policy).toBe(verificationPolicy);
    // Code-level seam only: no scheduler or reconcile override is injected.
    expect(Object.keys(harness.verificationStarts[0]!).sort()).toEqual(["policy", "pool", "reportFailure"]);

    // reportFailure is the process stderr writer.
    harness.verificationStarts[0]!.reportFailure("verification diagnostic\n");
    expect(harness.stderr).toEqual(["verification diagnostic\n"]);

    harness.signals.emit("SIGTERM");
    harness.releaseHttpClose();
    await waitFor(() => harness.stdout.includes("commercial-api: stopped\n"));

    expect(harness.count("verification-stop")).toBe(1);
    expect(harness.count("disconnect-stop")).toBe(1);
    expect(harness.count("pool-end")).toBe(1);
    expect(harness.exitCodes).toEqual([]);
  });

  it("stops the started disconnect loop and closes the pool when the verification loop fails to start", async () => {
    const harness = orchestrationHarness();
    const rawText = "verification starter raw detail sk-secret";

    const result = await runCommercialApiProcess({
      ...harness.dependencies,
      providerVerificationReconciliation: {
        start: () => {
          harness.events.push("verification-start-throws");
          throw new Error(rawText);
        },
      },
    });

    expect(result).toBeNull();
    expect(harness.events).toEqual([
      "pool-created",
      "db-verified",
      "disconnect-start",
      "verification-start-throws",
      "disconnect-stop",
      "pool-end",
    ]);
    expect(harness.serverStarts()).toBe(0);
    expect(harness.exitCodes).toEqual([1]);
    expect(harness.stderr).toEqual(["commercial-api: Database startup failed.\n"]);
    expect([...harness.stderr, ...harness.stdout].join("")).not.toContain(rawText);
    expect(harness.stdout).toEqual([]);
  });

  it("stops both loops and closes the pool when the HTTP bind fails after both loops started", async () => {
    const harness = orchestrationHarness();

    const result = await runCommercialApiProcess({
      ...harness.dependencies,
      startServer: async () => {
        harness.events.push("server-start-throws");
        throw Object.assign(new Error("listen EADDRINUSE: detail"), { code: "EADDRINUSE" });
      },
    });

    expect(result).toBeNull();
    expect(harness.events).toEqual([
      "pool-created",
      "db-verified",
      "disconnect-start",
      "verification-start",
      "server-start-throws",
      "verification-stop",
      "disconnect-stop",
      "pool-end",
    ]);
    expect(harness.exitCodes).toEqual([1]);
    expect(harness.stderr).toEqual(["commercial-api: Could not listen on the configured host and port (EADDRINUSE).\n"]);
  });

  it("stops both loops before HTTP draining, ends the pool only after HTTP close settles, and handles repeated signals once", async () => {
    const harness = orchestrationHarness();

    const running = await runCommercialApiProcess(harness.dependencies);
    expect(running).not.toBeNull();
    harness.events.splice(0);

    harness.signals.emit("SIGINT");
    harness.signals.emit("SIGTERM");

    // HTTP close is still pending: the pool must not be ended yet.
    expect(harness.events).toEqual(["verification-stop", "disconnect-stop", "http-close-start"]);

    // Let any premature continuation run before releasing HTTP close.
    await new Promise((resolve) => setImmediate(resolve));
    expect(harness.events).not.toContain("pool-end");

    harness.releaseHttpClose();
    await waitFor(() => harness.stdout.includes("commercial-api: stopped\n"));

    harness.signals.emit("SIGTERM");
    harness.signals.emit("SIGINT");
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.events).toEqual([
      "verification-stop",
      "disconnect-stop",
      "http-close-start",
      "http-close-settled",
      "pool-end",
    ]);
    expect(harness.stdout.filter((line) => line.includes("received"))).toEqual([
      "commercial-api: SIGINT received, shutting down\n",
    ]);
    expect(harness.exitCodes).toEqual([]);
    expect(harness.stderr).toEqual([]);
  });

  it("starts neither background loop when no database is configured", async () => {
    const harness = orchestrationHarness({});

    const running = await runCommercialApiProcess(harness.dependencies);

    expect(running).not.toBeNull();
    expect(harness.events).toEqual(["server-start"]);
    expect(harness.disconnectStarts).toEqual([]);
    expect(harness.verificationStarts).toEqual([]);
    expect(harness.stdout).toEqual([
      "commercial-api listening on 127.0.0.1:4321\n",
      "commercial-api: no database configured; /__ready reports not ready\n",
    ]);

    harness.signals.emit("SIGINT");
    harness.releaseHttpClose();
    await waitFor(() => harness.stdout.includes("commercial-api: stopped\n"));

    expect(harness.events).toEqual(["server-start", "http-close-start", "http-close-settled"]);
    expect(harness.exitCodes).toEqual([]);
  });
});
