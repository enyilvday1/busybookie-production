import { describe, expect, it } from "vitest";

import { loadWorkerConfig, PRODUCTION_WORKER_STATE_ROOT, WORKER_CONFIG_KEYS, WorkerConfigError } from "../src/workerConfig.js";

// R44B8: the explicit commercial-worker configuration (architecture section
// 17, "State-root binding", R44B8A). Parsing only: filesystem policy is
// tested with the state-root binding, never through configuration parsing.

const DEVELOPMENT_ROOT = "/srv/dev/busybookie-worker-state";
const SECRET_LOOKING = "fixture-machine-credential-should-never-echo";

const codeOf = (environment: Readonly<Record<string, string | undefined>>) => {
  try {
    loadWorkerConfig(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerConfigError);
    const text = `${(error as Error).message} ${JSON.stringify(error)}`;
    // Fixed messages: no supplied value or environment dump ever appears.
    // (The mode is a closed enum whose valid words appear in the fixed text.)
    for (const [key, value] of Object.entries(environment)) {
      if (key !== "COMMERCIAL_WORKER_ENV" && value !== undefined && value.length > 0) expect(text.includes(value)).toBe(false);
    }
    return (error as WorkerConfigError).code;
  }
  throw new Error("expected a configuration error");
};

describe("loadWorkerConfig", () => {
  it("names exactly the locked keys and production root", () => {
    expect(WORKER_CONFIG_KEYS).toEqual({ mode: "COMMERCIAL_WORKER_ENV", stateRoot: "COMMERCIAL_WORKER_STATE_ROOT" });
    expect(PRODUCTION_WORKER_STATE_ROOT).toBe("/var/lib/busybookie/commercial-worker");
  });

  it("A: refuses a missing COMMERCIAL_WORKER_ENV, even with a valid root (no development default)", () => {
    expect(codeOf({ COMMERCIAL_WORKER_STATE_ROOT: DEVELOPMENT_ROOT })).toBe("WORKER_ENV_MISSING");
    expect(codeOf({})).toBe("WORKER_ENV_MISSING");
  });

  it.each(["", "Development", "PRODUCTION", "staging", "test", " production", "production "])("B: refuses the invalid COMMERCIAL_WORKER_ENV %j", (value) => {
    expect(codeOf({ COMMERCIAL_WORKER_ENV: value, COMMERCIAL_WORKER_STATE_ROOT: DEVELOPMENT_ROOT })).toBe("WORKER_ENV_INVALID");
  });

  it.each(["development", "production"] as const)("C: refuses a missing COMMERCIAL_WORKER_STATE_ROOT in %s", (mode) => {
    expect(codeOf({ COMMERCIAL_WORKER_ENV: mode })).toBe("WORKER_STATE_ROOT_MISSING");
  });

  it.each(["development", "production"] as const)("D: refuses an empty state root in %s", (mode) => {
    expect(codeOf({ COMMERCIAL_WORKER_ENV: mode, COMMERCIAL_WORKER_STATE_ROOT: "" })).toBe("WORKER_STATE_ROOT_EMPTY");
  });

  it("E: accepts an explicit development root exactly as given (filesystem policy is checked later)", () => {
    expect(loadWorkerConfig({ COMMERCIAL_WORKER_ENV: "development", COMMERCIAL_WORKER_STATE_ROOT: DEVELOPMENT_ROOT })).toEqual({
      mode: "development",
      stateRoot: DEVELOPMENT_ROOT,
    });
  });

  it("F: accepts the exact published production root", () => {
    expect(loadWorkerConfig({ COMMERCIAL_WORKER_ENV: "production", COMMERCIAL_WORKER_STATE_ROOT: "/var/lib/busybookie/commercial-worker" })).toEqual({
      mode: "production",
      stateRoot: "/var/lib/busybookie/commercial-worker",
    });
  });

  it.each([
    "/var/lib/busybookie/commercial-worker/",
    "/var/lib/busybookie/commercial-worker-2",
    "/var/lib/busybookie",
    "/var/lib/busybookie/media",
    "/var/lib/busybookie/media/commercial-worker",
    "/var/lib/busybookie/../busybookie/commercial-worker",
    "/tmp/commercial-worker",
    "var/lib/busybookie/commercial-worker",
    "/VAR/LIB/BUSYBOOKIE/COMMERCIAL-WORKER",
    DEVELOPMENT_ROOT,
  ])("G: refuses the non-canonical production root %j without echoing it", (root) => {
    expect(codeOf({ COMMERCIAL_WORKER_ENV: "production", COMMERCIAL_WORKER_STATE_ROOT: root })).toBe("WORKER_STATE_ROOT_NOT_PRODUCTION_ROOT");
  });

  it("H: ignores unrelated keys and never echoes them", () => {
    const config = loadWorkerConfig({
      COMMERCIAL_WORKER_ENV: "development",
      COMMERCIAL_WORKER_STATE_ROOT: DEVELOPMENT_ROOT,
      COMMERCIAL_API_ENV: "production",
      BUSYBOOKIE_MEDIA_ROOT: "/var/lib/busybookie/media",
      UNRELATED: SECRET_LOOKING,
    });
    expect(config).toEqual({ mode: "development", stateRoot: DEVELOPMENT_ROOT });
    expect(JSON.stringify(config).includes(SECRET_LOOKING)).toBe(false);
    // An unrelated key never stands in for a missing worker key.
    expect(codeOf({ COMMERCIAL_API_ENV: "production", BUSYBOOKIE_MEDIA_ROOT: "/var/lib/busybookie/media", UNRELATED: SECRET_LOOKING })).toBe(
      "WORKER_ENV_MISSING",
    );
    expect(codeOf({ COMMERCIAL_WORKER_ENV: "production", BUSYBOOKIE_MEDIA_ROOT: "/var/lib/busybookie/commercial-worker" })).toBe("WORKER_STATE_ROOT_MISSING");
  });

  it("I: returns an immutable configuration", () => {
    const config = loadWorkerConfig({ COMMERCIAL_WORKER_ENV: "development", COMMERCIAL_WORKER_STATE_ROOT: DEVELOPMENT_ROOT });
    expect(Object.isFrozen(config)).toBe(true);
    expect(() => {
      (config as { stateRoot: string }).stateRoot = "/elsewhere";
    }).toThrow(TypeError);
    expect(Object.keys(config).sort()).toEqual(["mode", "stateRoot"]);
  });
});
