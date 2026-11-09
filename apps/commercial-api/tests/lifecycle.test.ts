import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { runCommercialApiProcess, type ShutdownSignal } from "../src/runCommercialApiProcess.js";
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
