import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Module-load observation: no mutation-capable authority may be loaded by the
// D1 server graph, and no child process may start.
const loaded = vi.hoisted(() => ({ c6: false, c7: false, c8: false, c8Cli: false }));

vi.mock("dotenv/config", () => ({}));
vi.mock("../src/execution/coordinateEpisodeAction.js", () => {
  loaded.c6 = true;
  return {};
});
vi.mock("../src/execution/runEpisodeAutomation.js", () => {
  loaded.c7 = true;
  return {};
});
vi.mock("../src/composition/runProductionEpisodeRoughCut.js", () => {
  loaded.c8 = true;
  return {};
});
vi.mock("../src/composition/cli/runEpisodeRoughCutCli.js", () => {
  loaded.c8Cli = true;
  return {};
});
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: vi.fn(actual.exec),
    execFile: vi.fn(actual.execFile),
    execFileSync: vi.fn(actual.execFileSync),
    execSync: vi.fn(actual.execSync),
    fork: vi.fn(actual.fork),
    spawn: vi.fn(actual.spawn),
    spawnSync: vi.fn(actual.spawnSync),
  };
});

import * as childProcess from "node:child_process";
import { readFile } from "node:fs/promises";
import { Server, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";

import type { CanonicalEpisodeListing } from "../src/application/listCanonicalEpisodes.js";
import type { EpisodeProductionStatus } from "../src/application/readEpisodeProductionStatus.js";
import { startOperatorServer, type RunningOperatorServer } from "../src/operatorServer/startOperatorServer.js";

const TOKEN = "a".repeat(64);
const WRONG_TOKEN = "b".repeat(64);
const NOW = new Date("2026-10-13T12:00:00.000Z");

const VISUAL_STATES = [
  "RESERVED_ONLY_INTERVENTION_REQUIRED",
  "SUBMITTED_RECONCILIATION_REQUIRED",
  "LIFECYCLE_COMPLETED",
  "CANONICAL_NOT_EXECUTABLE",
  "VISUAL_AUTHORIZATION_REQUIRED",
  "REFERENCE_UNAVAILABLE",
  "REFERENCE_SELECTION_REQUIRED",
  "READY_FOR_GENERATION",
];
const DIALOGUE_STATES = [
  "NO_DIALOGUE",
  "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
  "DIALOGUE_PLANNING_BLOCKED",
  "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
  "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
  "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
  "DIALOGUE_RECONCILIATION_REQUIRED",
  "DIALOGUE_AUDIO_REQUIRED",
  "PLACEMENT_REQUIRED",
  "COMPOSITION_AUDIO_RESOLVED",
];
const zeroCounts = (names: readonly string[], one: string) =>
  Object.fromEntries(names.map((name) => [name, name === one ? 1 : 0]));

const LISTING: readonly CanonicalEpisodeListing[] = [
  { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 1, shotCount: 1 },
  { episodeId: "EP03", manifest: "INVALID" },
];

function episodeStatus(visual: Record<string, unknown> = { state: "LIFECYCLE_COMPLETED", lifecycle: { path: "D:/SECRET_MEDIA/x.json" } }) {
  return {
    episode: { episodeId: "EP02", title: "Ollie finds a shell", scenes: [] },
    state: {
      episodeId: "EP02",
      shots: [
        {
          order: 1,
          sceneId: "SC01",
          shotId: "S01",
          visualGenerationState: { episodeId: "EP02", shotId: "S01", ...visual },
          dialogueCompositionState: { episodeId: "EP02", sceneId: "SC01", shotId: "S01", state: "NO_DIALOGUE" },
        },
      ],
      summary: {
        totalShots: 1,
        visualGenerationStates: zeroCounts(VISUAL_STATES, "LIFECYCLE_COMPLETED"),
        dialogueCompositionStates: zeroCounts(DIALOGUE_STATES, "NO_DIALOGUE"),
      },
    },
  } as unknown as EpisodeProductionStatus;
}

const listCanonicalEpisodes = vi.fn(async () => LISTING);
const readEpisodeProductionStatus = vi.fn(async (_episodeId: string) => episodeStatus());
let requestCounter = 0;
const logLines: string[] = [];
const observedTexts: string[] = [];
let server: RunningOperatorServer;

type Reply = { status: number; headers: IncomingHttpHeaders; body: string; json: { error?: Record<string, string> } & Record<string, unknown> };

function send(options: { method?: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolveReply, rejectReply) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: server.port,
        method: options.method ?? "GET",
        path: options.path,
        headers: options.headers ?? {},
        setHost: false,
        agent: false,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          observedTexts.push(data, JSON.stringify(res.headers));
          resolveReply({ status: res.statusCode ?? 0, headers: res.headers, body: data, json: data ? JSON.parse(data) : {} });
        });
      },
    );
    req.on("error", rejectReply);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

// Raw socket request for header shapes the Node client will not produce.
function raw(text: string): Promise<{ status: number; body: string }> {
  return new Promise((resolveRaw, rejectRaw) => {
    const socket = connect(server.port, "127.0.0.1", () => socket.end(text));
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (data += chunk));
    socket.on("error", rejectRaw);
    socket.on("close", () => {
      observedTexts.push(data);
      const [head = "", body = ""] = data.split("\r\n\r\n");
      resolveRaw({ status: Number(head.split(" ")[1]), body });
    });
  });
}

const host = () => `127.0.0.1:${server.port}`;
const authed = (extra: Record<string, string> = {}) => ({ Host: host(), Authorization: `Bearer ${TOKEN}`, ...extra });
const get = (path: string, headers: Record<string, string> = authed()) => send({ path, headers });

const EXPECTED_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

function expectSecurityHeaders(reply: Reply) {
  expect(reply.headers).toMatchObject(EXPECTED_HEADERS);
  expect(reply.headers["x-request-id"]).toMatch(/^req-\d+$/);
  expect(Object.keys(reply.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
}

function expectError(reply: Reply, status: number, code: string, message: string) {
  expect(reply.status).toBe(status);
  expect(reply.json).toStrictEqual({ error: { code, message, requestId: reply.headers["x-request-id"] } });
  expectSecurityHeaders(reply);
}

beforeAll(async () => {
  server = await startOperatorServer({
    port: 0,
    token: TOKEN,
    dependencies: {
      listCanonicalEpisodes,
      readEpisodeProductionStatus,
      now: () => NOW,
      randomRequestId: () => `req-${++requestCounter}`,
    },
    log: (text) => logLines.push(text),
  });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  listCanonicalEpisodes.mockClear();
  readEpisodeProductionStatus.mockClear();
});

describe("D1 server: loopback binding and lifecycle", () => {
  it("binds the IPv4 loopback address on an ephemeral port", () => {
    expect(server.origin).toBe(`http://127.0.0.1:${server.port}`);
    expect(server.port).toBeGreaterThan(0);
  });

  it("offers no host option: a supplied wildcard host is ignored and loopback is still used", async () => {
    const other = await startOperatorServer({ port: 0, token: TOKEN, host: "0.0.0.0" } as never);
    try {
      expect(other.origin.startsWith("http://127.0.0.1:")).toBe(true);
    } finally {
      await other.close();
    }
  });

  it("refuses invalid ports and reports EADDRINUSE without falling back", async () => {
    for (const port of [-1, 65536, 1.5, Number.NaN]) {
      await expect(startOperatorServer({ port, token: TOKEN })).rejects.toThrow(
        "Operator server port must be an integer from 0 to 65535.",
      );
    }
    await expect(startOperatorServer({ port: server.port, token: TOKEN })).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("generates a fresh 64-hex token per launch when none is injected, and close is idempotent", async () => {
    const first = await startOperatorServer({ port: 0 });
    const second = await startOperatorServer({ port: 0 });
    try {
      expect(first.token).toMatch(/^[0-9a-f]{64}$/);
      expect(second.token).toMatch(/^[0-9a-f]{64}$/);
      expect(first.token).not.toBe(second.token);
    } finally {
      await first.close();
      await first.close();
      await second.close();
    }
  });

  it("importing the server modules does not listen", async () => {
    vi.resetModules();
    const listen = vi.spyOn(Server.prototype, "listen");
    try {
      await import("../src/operatorServer/createOperatorServer.js");
      await import("../src/operatorServer/startOperatorServer.js");
      await import("../src/operatorServer/cli/runOperatorServerCli.js");
      expect(listen).not.toHaveBeenCalled();
    } finally {
      listen.mockRestore();
    }
  });
});

describe("D1 server: Host and Origin", () => {
  it("accepts 127.0.0.1:<port> and localhost:<port>", async () => {
    expect((await get("/api/v1/operator/health")).status).toBe(200);
    expect((await get("/api/v1/operator/health", authed({ Host: `localhost:${server.port}` }))).status).toBe(200);
  });

  it.each([
    ["another port", () => `127.0.0.1:${server.port + 1}`],
    ["IPv6 loopback", () => `[::1]:${server.port}`],
    ["a rebound DNS name", () => `evil.example:${server.port}`],
    ["no port", () => "127.0.0.1"],
    ["upper-case localhost", () => `LOCALHOST:${server.port}`],
  ])("refuses Host with %s (403)", async (_label, value) => {
    expectError(
      await get("/api/v1/operator/health", authed({ Host: value() })),
      403,
      "FORBIDDEN",
      "The request host or origin is not allowed.",
    );
  });

  it("refuses a missing Host (403) and a duplicated Host (400)", async () => {
    expectError(
      await send({ path: "/api/v1/operator/health", headers: { Authorization: `Bearer ${TOKEN}` } }),
      403,
      "FORBIDDEN",
      "The request host or origin is not allowed.",
    );
    const duplicate = await raw(
      `GET /api/v1/operator/health HTTP/1.1\r\nHost: ${host()}\r\nHost: ${host()}\r\nAuthorization: Bearer ${TOKEN}\r\nConnection: close\r\n\r\n`,
    );
    expect(duplicate.status).toBe(400);
    expect(JSON.parse(duplicate.body).error.code).toBe("BAD_REQUEST");
  });

  it("accepts an absent Origin and the server's own origins", async () => {
    expect((await get("/api/v1/operator/health", authed({ Origin: `http://127.0.0.1:${server.port}` }))).status).toBe(200);
    expect((await get("/api/v1/operator/health", authed({ Origin: `http://localhost:${server.port}` }))).status).toBe(200);
  });

  it.each(["null", "http://evil.example", "https://127.0.0.1:1", "http://127.0.0.1"])(
    "refuses Origin %s (403) even with a valid token",
    async (origin) => {
      expectError(
        await get("/api/v1/operator/health", authed({ Origin: origin })),
        403,
        "FORBIDDEN",
        "The request host or origin is not allowed.",
      );
    },
  );

  it("never emits CORS headers; OPTIONS without a token is 401, with a token 405", async () => {
    const preflight = await send({
      method: "OPTIONS",
      path: "/api/v1/operator/episodes",
      headers: { Host: host(), Origin: `http://127.0.0.1:${server.port}`, "Access-Control-Request-Method": "GET" },
    });
    expectError(preflight, 401, "UNAUTHORIZED", "A valid operator token is required.");
    const authedOptions = await send({ method: "OPTIONS", path: "/api/v1/operator/episodes", headers: authed() });
    expectError(authedOptions, 405, "METHOD_NOT_ALLOWED", "Only GET is supported for this route.");
  });
});

describe("D1 server: per-launch token", () => {
  it.each([
    ["missing", {}],
    ["wrong token of the same length", { Authorization: `Bearer ${WRONG_TOKEN}` }],
    ["lower-case scheme", { Authorization: `bearer ${TOKEN}` }],
    ["upper-case hex", { Authorization: `Bearer ${TOKEN.toUpperCase()}` }],
    ["truncated", { Authorization: `Bearer ${TOKEN.slice(1)}` }],
    ["token in the query string only", {}],
  ])("rejects a %s token with 401 and a Bearer challenge", async (label, extra) => {
    const path = label.includes("query") ? `/api/v1/operator/health?token=${TOKEN}` : "/api/v1/operator/health";
    const reply = await send({ path, headers: { Host: host(), ...extra } });
    expectError(reply, 401, "UNAUTHORIZED", "A valid operator token is required.");
    expect(reply.headers["www-authenticate"]).toBe('Bearer realm="busybookie-operator"');
  });

  it("rejects duplicated Authorization headers", async () => {
    const reply = await raw(
      `GET /api/v1/operator/health HTTP/1.1\r\nHost: ${host()}\r\nAuthorization: Bearer ${TOKEN}\r\nAuthorization: Bearer ${TOKEN}\r\nConnection: close\r\n\r\n`,
    );
    expect(reply.status).toBe(401);
  });

  it("authentication runs before route matching, so unknown routes are not revealed", async () => {
    expectError(
      await send({ path: "/api/v1/operator/does-not-exist", headers: { Host: host() } }),
      401,
      "UNAUTHORIZED",
      "A valid operator token is required.",
    );
  });
});

describe("D1 server: routes", () => {
  it("GET health", async () => {
    const reply = await get("/api/v1/operator/health");
    expect(reply.status).toBe(200);
    expect(reply.json).toStrictEqual({ apiVersion: "v1", status: "ok", readOnly: true });
    expectSecurityHeaders(reply);
    expect(listCanonicalEpisodes).not.toHaveBeenCalled();
  });

  it("GET episodes is manifest-level only (no durable evaluation)", async () => {
    const reply = await get("/api/v1/operator/episodes");
    expect(reply.status).toBe(200);
    expect(reply.json).toStrictEqual({
      apiVersion: "v1",
      episodes: [
        { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 1, shotCount: 1 },
        { episodeId: "EP03", manifest: "INVALID" },
      ],
    });
    expectSecurityHeaders(reply);
    expect(readEpisodeProductionStatus).not.toHaveBeenCalled();
  });

  it("GET episode detail evaluates exactly the listed valid episode", async () => {
    const reply = await get("/api/v1/operator/episodes/EP02");
    expect(reply.status).toBe(200);
    expect(reply.json).toMatchObject({
      apiVersion: "v1",
      episodeId: "EP02",
      title: "Ollie finds a shell",
      evaluatedAt: NOW.toISOString(),
      shots: [{ order: 1, sceneId: "SC01", shotId: "S01", visual: { state: "LIFECYCLE_COMPLETED" }, dialogue: { state: "NO_DIALOGUE" } }],
    });
    expect(reply.body).not.toContain("SECRET_MEDIA");
    expect(readEpisodeProductionStatus.mock.calls).toEqual([["EP02"]]);
    expectSecurityHeaders(reply);
  });

  it.each(["EP2", "ep02", "EP0002", "EP02.json", "..", "EP%30%32"])(
    "malformed or encoded episode ID %s is 400 without evaluation",
    async (segment) => {
      expectError(await get(`/api/v1/operator/episodes/${segment}`), 400, "BAD_REQUEST", "The request is not valid for this API.");
      expect(readEpisodeProductionStatus).not.toHaveBeenCalled();
    },
  );

  it.each(["EP04", "EP03"])("unlisted or INVALID-manifest episode %s is 404 without evaluation", async (episodeId) => {
    expectError(await get(`/api/v1/operator/episodes/${episodeId}`), 404, "NOT_FOUND", "Episode not found.");
    expect(readEpisodeProductionStatus).not.toHaveBeenCalled();
  });

  it.each([
    "/api/v1/operator",
    "/api/v1/operator/",
    "/api/v1/operator/episodes/",
    "/api/v1/operator/episodes/EP02/shots",
    "/api/v1/operator/health/",
    "/api/v2/operator/health",
    "/",
  ])("unknown route %s is 404", async (path) => {
    expectError(await get(path), 404, "NOT_FOUND", "Route not found.");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])("%s on a known route is 405 with Allow: GET", async (method) => {
    const reply = await send({ method, path: "/api/v1/operator/episodes", headers: authed() });
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe("GET");
    if (method !== "HEAD") expect(reply.json.error?.code).toBe("METHOD_NOT_ALLOWED");
    expect(listCanonicalEpisodes).not.toHaveBeenCalled();
  });

  it("POST on an unknown route is 404", async () => {
    expectError(await send({ method: "POST", path: "/api/v1/operator/episodes/EP02/automate", headers: authed() }), 404, "NOT_FOUND", "Route not found.");
  });

  it.each([
    ["a query string", () => ({ path: "/api/v1/operator/episodes?refresh=1" })],
    ["an empty query string", () => ({ path: "/api/v1/operator/episodes?" })],
    ["a request body", () => ({ path: "/api/v1/operator/episodes", body: "{}", headers: authed({ "Content-Length": "2" }) })],
    [
      "chunked transfer encoding",
      () => ({ path: "/api/v1/operator/episodes", body: "x", headers: authed({ "Transfer-Encoding": "chunked" }) }),
    ],
    ["a request target over 2048 bytes", () => ({ path: `/api/v1/operator/episodes/${"E".repeat(2100)}` })],
  ])("%s is 400 without reading state", async (_label, options) => {
    expectError(await send({ headers: authed(), ...options() }), 400, "BAD_REQUEST", "The request is not valid for this API.");
    expect(listCanonicalEpisodes).not.toHaveBeenCalled();
  });
});

describe("D1 server: read failures stay local", () => {
  it("a listing failure is 503 with a fixed message; the reason goes only to the local log", async () => {
    listCanonicalEpisodes.mockRejectedValueOnce(
      new Error("ENOENT: no such file or directory, scandir 'D:/SECRET_MEDIA/episodes'", { cause: new Error("inner D:/SECRET_MEDIA") }),
    );
    const reply = await get("/api/v1/operator/episodes");
    expectError(
      reply,
      503,
      "STATE_UNAVAILABLE",
      "Production state could not be read. See the operator server log for this request ID.",
    );
    expect(reply.body).not.toMatch(/SECRET_MEDIA|ENOENT|stack|at /);
    const requestId = String(reply.headers["x-request-id"]);
    const record = logLines.find((line) => line.includes(requestId)) ?? "";
    expect(record).toContain(`${requestId} STATE_UNAVAILABLE GET /api/v1/operator/episodes`);
    expect(record).toContain("Reason: ENOENT: no such file or directory, scandir 'D:/SECRET_MEDIA/episodes'");
    expect(record).toContain("Cause 1: inner D:/SECRET_MEDIA");
  });

  it("a C4 failure on detail is 503 with no path, stack or raw error", async () => {
    const failure = new Error("Corrupt lifecycle record at D:/SECRET_MEDIA/generated/EP02/S01.json");
    failure.stack = "Error: Corrupt\n    at SECRET_STACK_FRAME";
    readEpisodeProductionStatus.mockRejectedValueOnce(failure);
    const reply = await get("/api/v1/operator/episodes/EP02");
    expectError(
      reply,
      503,
      "STATE_UNAVAILABLE",
      "Production state could not be read. See the operator server log for this request ID.",
    );
    expect(reply.body).not.toMatch(/SECRET|Corrupt/);
    expect(logLines.join("\n")).not.toContain("SECRET_STACK_FRAME");
  });

  it("a DTO mapping failure (unknown backend state) is 500, never a pass-through", async () => {
    readEpisodeProductionStatus.mockResolvedValueOnce(episodeStatus({ state: "NEW_UNKNOWN_STATE", absolutePath: "D:/SECRET_MEDIA" }));
    const reply = await get("/api/v1/operator/episodes/EP02");
    expectError(
      reply,
      500,
      "INTERNAL_ERROR",
      "An internal operator server error occurred. See the operator server log for this request ID.",
    );
    expect(reply.body).not.toContain("SECRET_MEDIA");
  });

  it("errors are deterministic apart from the request ID", async () => {
    const first = await get("/api/v1/operator/episodes/EP9");
    const second = await get("/api/v1/operator/episodes/EP9");
    expect({ ...first.json.error, requestId: "" }).toStrictEqual({ ...second.json.error, requestId: "" });
  });
});

describe("D1 server: nothing leaks and nothing mutates", () => {
  it("the token never appears in any response body, response header or log line", () => {
    expect(observedTexts.length).toBeGreaterThan(40);
    for (const text of [...observedTexts, ...logLines]) expect(text).not.toContain(TOKEN);
  });

  it("no mutation authority was loaded and no child process was started", () => {
    expect(loaded).toStrictEqual({ c6: false, c7: false, c8: false, c8Cli: false });
    for (const name of ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"] as const) {
      expect(vi.mocked(childProcess[name]), name).not.toHaveBeenCalled();
    }
  });

  it("application services do not depend on transport, token or localhost semantics", async () => {
    for (const file of ["listCanonicalEpisodes.ts", "readEpisodeProductionStatus.ts", "operatorDtos.ts"]) {
      const source = await readFile(new URL(`../src/application/${file}`, import.meta.url), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, file).not.toMatch(
        /node:http|operatorServer|\bauthorization\b|\bbearer\b|\btoken\b|localhost|127\.0\.0\.1|\bhost\b|\borigin\b/i,
      );
    }
  });
});
