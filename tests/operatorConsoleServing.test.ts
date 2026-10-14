import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type { CanonicalEpisodeListing } from "../src/application/listCanonicalEpisodes.js";
import type { EpisodeProductionStatus } from "../src/application/readEpisodeProductionStatus.js";
import {
  loadOperatorConsoleAssets,
  MAX_OPERATOR_CONSOLE_FILE_BYTES,
  OPERATOR_CONSOLE_CSP,
  OPERATOR_CONSOLE_DIST_URL,
  OperatorConsoleBuildError,
  type OperatorConsoleAssets,
  type OperatorConsoleBuildFailure,
} from "../src/operatorServer/operatorConsoleAssets.js";
import { startOperatorServer, type RunningOperatorServer } from "../src/operatorServer/startOperatorServer.js";

// D3A (Step 1005 section 12): the real loader over temporary Vite-shaped
// fixtures; never the ignored apps/operator-console/dist and never a build.

const TOKEN = "a".repeat(64);
const WRONG_TOKEN = "b".repeat(64);
const NOW = new Date("2026-10-14T12:00:00.000Z");

const JS_NAME = "index-AbC123_x.js";
const CSS_NAME = "index-De4-56.css";
const LAZY_NAME = "chunk-Lazy9.js";
const JS_BODY = "export const fixture = 1;\n";
const CSS_BODY = "body{margin:0}\n";
const LAZY_BODY = "export const lazy = 2;\n";

// Mirrors the real Vite output: one external module script, one external
// stylesheet, nothing inline.
function indexHtml(script = `/assets/${JS_NAME}`, style = `/assets/${CSS_NAME}`, extraHead = "") {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    "    <title>Operator Console</title>",
    `    <script type="module" crossorigin src="${script}"></script>`,
    `    <link rel="stylesheet" crossorigin href="${style}">`,
    extraHead,
    "  </head>",
    "  <body>",
    '    <div id="root"></div>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

const fixtureRoots: string[] = [];

// { junction: true } links to a directory outside the build root.
type FixtureEntry = string | Buffer | { directory: true } | { junction: true };

async function fixture(entries: Record<string, FixtureEntry>): Promise<{ url: URL; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "bb-d3a-console-"));
  fixtureRoots.push(root);
  const dist = join(root, "dist");
  await mkdir(dist);
  for (const [name, content] of Object.entries(entries)) {
    const target = join(dist, ...name.split("/"));
    if (typeof content === "object" && !Buffer.isBuffer(content) && "directory" in content) {
      await mkdir(target, { recursive: true });
    } else if (typeof content === "object" && !Buffer.isBuffer(content) && "junction" in content) {
      const outside = join(root, "outside-target");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, "inner.js"), "x");
      await symlink(outside, target, "junction");
    } else {
      await mkdir(join(target, ".."), { recursive: true });
      await writeFile(target, content);
    }
  }
  return { url: pathToFileURL(`${dist}/`), path: dist };
}

function validBuild(overrides: Record<string, FixtureEntry | null> = {}): Record<string, FixtureEntry> {
  const entries: Record<string, FixtureEntry | null> = {
    "index.html": indexHtml(),
    [`assets/${JS_NAME}`]: JS_BODY,
    [`assets/${CSS_NAME}`]: CSS_BODY,
    [`assets/${LAZY_NAME}`]: LAZY_BODY,
    ...overrides,
  };
  return Object.fromEntries(Object.entries(entries).filter((entry): entry is [string, FixtureEntry] => entry[1] !== null));
}

async function expectBuildFailure(entries: Record<string, FixtureEntry>, failure: OperatorConsoleBuildFailure) {
  const { url, path } = await fixture(entries);
  const error = await loadOperatorConsoleAssets(url).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(OperatorConsoleBuildError);
  const buildError = error as OperatorConsoleBuildError;
  expect(buildError.failure).toBe(failure);
  expect(buildError.message).toBe(
    `Operator console build is missing or invalid (${failure}). Build it with: npm --prefix apps/operator-console run build`,
  );
  expect(buildError.cause).toBeUndefined();
  expect(buildError.message).not.toContain(path);
  expect(buildError.message).not.toContain(tmpdir());
}

const LISTING: readonly CanonicalEpisodeListing[] = [
  { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 1, shotCount: 1 },
  { episodeId: "EP03", manifest: "INVALID" },
];

const zeroCounts = (names: readonly string[], one: string) =>
  Object.fromEntries(names.map((name) => [name, name === one ? 1 : 0]));

function episodeStatus() {
  return {
    episode: { episodeId: "EP02", title: "Ollie finds a shell", scenes: [] },
    state: {
      episodeId: "EP02",
      shots: [
        {
          order: 1,
          sceneId: "SC01",
          shotId: "S01",
          visualGenerationState: { episodeId: "EP02", shotId: "S01", state: "LIFECYCLE_COMPLETED" },
          dialogueCompositionState: { episodeId: "EP02", sceneId: "SC01", shotId: "S01", state: "NO_DIALOGUE" },
        },
      ],
      summary: {
        totalShots: 1,
        visualGenerationStates: zeroCounts(
          [
            "RESERVED_ONLY_INTERVENTION_REQUIRED",
            "SUBMITTED_RECONCILIATION_REQUIRED",
            "LIFECYCLE_COMPLETED",
            "CANONICAL_NOT_EXECUTABLE",
            "VISUAL_AUTHORIZATION_REQUIRED",
            "REFERENCE_UNAVAILABLE",
            "REFERENCE_SELECTION_REQUIRED",
            "READY_FOR_GENERATION",
          ],
          "LIFECYCLE_COMPLETED",
        ),
        dialogueCompositionStates: zeroCounts(
          [
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
          ],
          "NO_DIALOGUE",
        ),
      },
    },
  } as unknown as EpisodeProductionStatus;
}

const listCanonicalEpisodes = vi.fn(async () => LISTING);
const readEpisodeProductionStatus = vi.fn(async (_episodeId: string) => episodeStatus());
let requestCounter = 0;
const observedTexts: string[] = [];
let server: RunningOperatorServer;
let assets: OperatorConsoleAssets;
let validFixturePath: string;

type Reply = { status: number; headers: IncomingHttpHeaders; body: string };

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
          resolveReply({ status: res.statusCode ?? 0, headers: res.headers, body: data });
        });
      },
    );
    req.on("error", rejectReply);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

// Raw socket request for request targets the Node client would not send as-is.
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
const plain = (extra: Record<string, string> = {}) => ({ Host: host(), ...extra });
const authed = (extra: Record<string, string> = {}) => plain({ Authorization: `Bearer ${TOKEN}`, ...extra });
const get = (path: string, headers: Record<string, string> = plain()) => send({ path, headers });
const rawGet = (target: string, extra = "") =>
  raw(`GET ${target} HTTP/1.1\r\nHost: ${host()}\r\n${extra}Connection: close\r\n\r\n`);

const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, private",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

const ERROR_MESSAGES: Record<string, string> = {
  BAD_REQUEST: "The request is not valid for this API.",
  UNAUTHORIZED: "A valid operator token is required.",
  FORBIDDEN: "The request host or origin is not allowed.",
  NOT_FOUND: "Route not found.",
  METHOD_NOT_ALLOWED: "Only GET is supported for this route.",
};

function expectJsonError(reply: Reply, status: number, code: string) {
  expect(reply.status).toBe(status);
  expect(JSON.parse(reply.body)).toStrictEqual({
    error: { code, message: ERROR_MESSAGES[code], requestId: reply.headers["x-request-id"] },
  });
  expect(reply.headers).toMatchObject(API_HEADERS);
  expect(reply.body).not.toContain("<html");
}

function expectNoCors(reply: Reply) {
  expect(Object.keys(reply.headers).filter((name) => name.startsWith("access-control-"))).toEqual([]);
}

beforeAll(async () => {
  const valid = await fixture(validBuild());
  validFixturePath = valid.path;
  assets = await loadOperatorConsoleAssets(valid.url);
  server = await startOperatorServer({
    port: 0,
    token: TOKEN,
    consoleAssets: assets,
    dependencies: {
      listCanonicalEpisodes,
      readEpisodeProductionStatus,
      now: () => NOW,
      randomRequestId: () => `req-${++requestCounter}`,
    },
    log: () => undefined,
  });
});

afterAll(async () => {
  await server.close();
  for (const root of fixtureRoots) {
    await rm(root, { recursive: true, force: true });
  }
});

beforeEach(() => {
  listCanonicalEpisodes.mockClear();
  readEpisodeProductionStatus.mockClear();
});

describe("D3A console loader", () => {
  it("B1: a missing build directory or a file in its place is BUILD_DIRECTORY_MISSING", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-d3a-console-"));
    fixtureRoots.push(root);
    const missing = await loadOperatorConsoleAssets(pathToFileURL(join(root, "absent-dist/"))).catch((error: unknown) => error);
    expect((missing as OperatorConsoleBuildError).failure).toBe("BUILD_DIRECTORY_MISSING");
    expect((missing as Error).message).not.toContain(root);
    await writeFile(join(root, "dist"), "not a directory");
    const fileInstead = await loadOperatorConsoleAssets(pathToFileURL(join(root, "dist"))).catch((error: unknown) => error);
    expect((fileInstead as OperatorConsoleBuildError).failure).toBe("BUILD_DIRECTORY_MISSING");
  });

  it("B2: a missing index.html is INDEX_HTML_MISSING", async () => {
    await expectBuildFailure(validBuild({ "index.html": null }), "INDEX_HTML_MISSING");
  });

  it("B3: a referenced script that is not in the build is REFERENCED_ASSET_MISSING", async () => {
    await expectBuildFailure(validBuild({ "index.html": indexHtml("/assets/index-Missing.js") }), "REFERENCED_ASSET_MISSING");
  });

  it("B4: a referenced stylesheet that is not in the build is REFERENCED_ASSET_MISSING", async () => {
    await expectBuildFailure(validBuild({ [`assets/${CSS_NAME}`]: null }), "REFERENCED_ASSET_MISSING");
  });

  it.each<[string, Record<string, FixtureEntry>]>([
    ["reference.html", { "reference.html": "<!doctype html>" }],
    ["a root source map", { "index.js.map": "{}" }],
    ["a root dotfile", { ".DS_Store": "x" }],
    ["an extra root directory", { "extra/file.txt": "x" }],
    ["index.html as a directory", { "index.html": { directory: true } }],
  ])("B5: %s at the build root is UNSAFE_BUILD_ENTRY", async (_label, extra) => {
    await expectBuildFailure({ ...validBuild(), ...extra }, "UNSAFE_BUILD_ENTRY");
  });

  it.each<[string, Record<string, FixtureEntry>]>([
    ["a source map", { [`assets/${JS_NAME}.map`]: "{}" }],
    ["an image", { "assets/logo-A1.png": "x" }],
    ["a dotfile", { "assets/.hidden.js": "x" }],
    ["a subdirectory", { "assets/chunks/inner.js": "x" }],
    ["an html file", { "assets/page-A1.html": "x" }],
    ["a junction/symlink to an outside directory", { "assets/linked": { junction: true } }],
  ])("B6: %s inside assets/ is UNSAFE_BUILD_ENTRY", async (_label, extra) => {
    await expectBuildFailure({ ...validBuild(), ...extra }, "UNSAFE_BUILD_ENTRY");
  });

  it.each([
    ["an absolute URL", indexHtml("https://cdn.example/x.js")],
    ["a relative path", indexHtml(`assets/${JS_NAME}`)],
    ["a data: URL", indexHtml("data:text/javascript,1")],
    ["a parent path", indexHtml(`/assets/../${JS_NAME}`)],
    ["a single-quoted reference", indexHtml().replace(`src="/assets/${JS_NAME}"`, `src='/assets/${JS_NAME}'`)],
    ["an unquoted reference", indexHtml().replace(`src="/assets/${JS_NAME}"`, `src=/assets/${JS_NAME}`)],
  ])("B7: an index reference to %s is UNSAFE_BUILD_ENTRY", async (_label, html) => {
    await expectBuildFailure(validBuild({ "index.html": html }), "UNSAFE_BUILD_ENTRY");
  });

  it.each([
    ["an inline script", indexHtml(undefined, undefined, "<script>window.x = 1;</script>")],
    ["a <style> element", indexHtml(undefined, undefined, "<style>body{color:red}</style>")],
    ["a style attribute", indexHtml().replace('<div id="root">', '<div id="root" style="color:red">')],
  ])("S23: an index containing %s is refused at startup (CSP compatibility)", async (_label, html) => {
    await expectBuildFailure(validBuild({ "index.html": html }), "UNSAFE_BUILD_ENTRY");
  });

  it("B8: a missing assets directory, an assets file, no module script or an oversize file is MALFORMED_BUILD_STRUCTURE", async () => {
    await expectBuildFailure({ "index.html": indexHtml() }, "MALFORMED_BUILD_STRUCTURE");
    await expectBuildFailure({ "index.html": indexHtml(), assets: "not a directory" }, "MALFORMED_BUILD_STRUCTURE");
    await expectBuildFailure(
      validBuild({ "index.html": indexHtml().replace(/ {4}<script[^\n]*\n/, "") }),
      "MALFORMED_BUILD_STRUCTURE",
    );
    await expectBuildFailure(
      validBuild({ [`assets/${LAZY_NAME}`]: Buffer.alloc(MAX_OPERATOR_CONSOLE_FILE_BYTES + 1, 0x20) }),
      "MALFORMED_BUILD_STRUCTURE",
    );
  });

  it("B9: a valid build maps exactly / and every allowlisted asset, frozen", async () => {
    expect(assets.lookup("/")?.body.toString("utf8")).toBe(indexHtml());
    expect(assets.lookup(`/assets/${JS_NAME}`)?.body.toString("utf8")).toBe(JS_BODY);
    expect(assets.lookup(`/assets/${CSS_NAME}`)?.body.toString("utf8")).toBe(CSS_BODY);
    // Unreferenced but valid assets (future lazy chunks) are servable.
    expect(assets.lookup(`/assets/${LAZY_NAME}`)?.body.toString("utf8")).toBe(LAZY_BODY);
    for (const key of [
      "/index.html",
      "/reference.html",
      "/favicon.ico",
      "/assets",
      "/assets/",
      `assets/${JS_NAME}`,
      `/assets/${JS_NAME}.map`,
      "//",
      "",
      "__proto__",
      "/constructor",
    ]) {
      expect(assets.lookup(key), key).toBeUndefined();
    }
    const index = assets.lookup("/")!;
    expect(Object.isFrozen(assets)).toBe(true);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.headers)).toBe(true);
  });

  it("B10: the default build root is anchored to the repository, not process.cwd()", async () => {
    expect(OPERATOR_CONSOLE_DIST_URL.href).toBe(new URL("../apps/operator-console/dist/", import.meta.url).href);
    const source = await readFile(new URL("../src/operatorServer/operatorConsoleAssets.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/process\.cwd|process\.chdir|process\.env/);
  });

  it("B11: build errors carry a fixed, path-free message and no cause", async () => {
    await expectBuildFailure(validBuild({ "index.html": null }), "INDEX_HTML_MISSING");
    const error = new OperatorConsoleBuildError("UNSAFE_BUILD_ENTRY");
    expect(error.name).toBe("OperatorConsoleBuildError");
    expect(error.message).not.toMatch(/[A-Za-z]:[\\/]|\/tmp\/|\\/);
  });
});

describe("D3A console serving", () => {
  it("S1/S2: GET / serves the exact index bytes without a bearer token", async () => {
    const reply = await get("/");
    expect(reply.status).toBe(200);
    expect(reply.body).toBe(indexHtml());
    expect(reply.headers["x-request-id"]).toMatch(/^req-\d+$/);
  });

  it("S3: the Host guard still applies to /", async () => {
    expectJsonError(await get("/", { Host: `evil.example:${server.port}` }), 403, "FORBIDDEN");
    expectJsonError(await send({ path: "/", headers: {} }), 403, "FORBIDDEN");
  });

  it("S4: the Origin policy still applies to /", async () => {
    expectJsonError(await get("/", plain({ Origin: "http://evil.example" })), 403, "FORBIDDEN");
    expectJsonError(await get("/", plain({ Origin: "null" })), 403, "FORBIDDEN");
    expect((await get("/", plain({ Origin: `http://127.0.0.1:${server.port}` }))).status).toBe(200);
    expect((await get("/", plain({ Origin: `http://localhost:${server.port}` }))).status).toBe(200);
    expect((await get("/")).status).toBe(200);
  });

  it("S5-S7: the index carries the exact CSP and HTML header policy", async () => {
    const reply = await get("/");
    const csp = reply.headers["content-security-policy"];
    expect(csp).toBe(OPERATOR_CONSOLE_CSP);
    expect(csp).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
    );
    expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|nonce-|data:|blob:|http/);
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(reply.headers["x-content-type-options"]).toBe("nosniff");
    expect(reply.headers["referrer-policy"]).toBe("no-referrer");
    expect(reply.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(reply.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(reply.headers["content-length"]).toBe(String(Buffer.byteLength(indexHtml())));
    expect(reply.headers["x-frame-options"]).toBeUndefined();
    expect(reply.headers["permissions-policy"]).toBeUndefined();
    expectNoCors(reply);
  });

  it("S8-S12: hashed assets are served with exact bytes, MIME and immutable private caching", async () => {
    const js = await get(`/assets/${JS_NAME}`);
    expect(js.status).toBe(200);
    expect(js.body).toBe(JS_BODY);
    expect(js.headers["content-type"]).toBe("text/javascript; charset=utf-8");
    const css = await get(`/assets/${CSS_NAME}`);
    expect(css.status).toBe(200);
    expect(css.body).toBe(CSS_BODY);
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    for (const reply of [js, css]) {
      expect(reply.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
      expect(reply.headers["x-content-type-options"]).toBe("nosniff");
      expect(reply.headers["referrer-policy"]).toBe("no-referrer");
      expect(reply.headers["cross-origin-resource-policy"]).toBe("same-origin");
      expect(reply.headers["content-security-policy"]).toBeUndefined();
      expectNoCors(reply);
    }
  });

  it.each([
    "/unknown",
    "/overview",
    `/assets/missing-A1.js`,
    "/index.html",
    "/reference.html",
    "/favicon.ico",
    "/deep/link",
    "/episodes/EP01",
    "/assets",
    "/assets/",
    "/.env",
    "/assets/.hidden",
    `/assets/${JS_NAME}.map`,
  ])("S13-S20: %s is 404 JSON (no fallback, listing, dotfile or source map)", async (path) => {
    expectJsonError(await get(path), 404, "NOT_FOUND");
  });

  it.each(["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("S21/S22: %s / is 405 with Allow: GET", async (method) => {
    const reply = await send({ method, path: "/", headers: plain() });
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe("GET");
    if (method !== "HEAD") expectJsonError(reply, 405, "METHOD_NOT_ALLOWED");
  });

  it("S21: HEAD on a hashed asset is 405 with Allow: GET", async () => {
    const reply = await send({ method: "HEAD", path: `/assets/${JS_NAME}`, headers: plain() });
    expect(reply.status).toBe(405);
    expect(reply.headers.allow).toBe("GET");
  });

  it("a console request with a body is 400", async () => {
    expectJsonError(await send({ path: "/", headers: plain({ "Content-Length": "2" }), body: "{}" }), 400, "BAD_REQUEST");
  });
});

describe("D3A API non-regression with console assets", () => {
  it.each(["/api", "/api/"])("A1/A2: %s is API territory: 401 without token, 404 JSON with token", async (path) => {
    expectJsonError(await get(path), 401, "UNAUTHORIZED");
    expectJsonError(await get(path, authed()), 404, "NOT_FOUND");
  });

  it("A3/A4: health without or with an invalid token stays 401 with the Bearer challenge", async () => {
    for (const headers of [plain(), plain({ Authorization: `Bearer ${WRONG_TOKEN}` })]) {
      const reply = await get("/api/v1/operator/health", headers);
      expectJsonError(reply, 401, "UNAUTHORIZED");
      expect(reply.headers["www-authenticate"]).toBe('Bearer realm="busybookie-operator"');
    }
  });

  it("A5: health is unchanged", async () => {
    const reply = await get("/api/v1/operator/health", authed());
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toStrictEqual({ apiVersion: "v1", status: "ok", readOnly: true });
    expect(reply.headers).toMatchObject(API_HEADERS);
  });

  it("A6: the episode list is unchanged", async () => {
    const reply = await get("/api/v1/operator/episodes", authed());
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toStrictEqual({
      apiVersion: "v1",
      episodes: [
        { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 1, shotCount: 1 },
        { episodeId: "EP03", manifest: "INVALID" },
      ],
    });
    expect(reply.headers).toMatchObject(API_HEADERS);
  });

  it("A7: episode detail is unchanged", async () => {
    const reply = await get("/api/v1/operator/episodes/EP02", authed());
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toMatchObject({
      apiVersion: "v1",
      episodeId: "EP02",
      title: "Ollie finds a shell",
      evaluatedAt: NOW.toISOString(),
      shots: [{ order: 1, sceneId: "SC01", shotId: "S01", visual: { state: "LIFECYCLE_COMPLETED" }, dialogue: { state: "NO_DIALOGUE" } }],
    });
    expect(readEpisodeProductionStatus.mock.calls).toEqual([["EP02"]]);
    expect(reply.headers).toMatchObject(API_HEADERS);
  });

  it("A8-A11: unknown API routes keep the D1 envelope, codes and cache policy and never return console HTML", async () => {
    for (const path of ["/api/v1/operator/nope", "/api/v2/operator/health", "/api/index.html", `/api/assets/${JS_NAME}`]) {
      expectJsonError(await get(path, authed()), 404, "NOT_FOUND");
      expectJsonError(await get(path), 401, "UNAUTHORIZED");
    }
    const notFound = await get("/api/v1/operator/episodes/EP04", authed());
    expect(notFound.status).toBe(404);
    expect(JSON.parse(notFound.body).error.message).toBe("Episode not found.");
  });

  it("A12: API method semantics are unchanged", async () => {
    const post = await send({ method: "POST", path: "/api/v1/operator/episodes", headers: authed() });
    expectJsonError(post, 405, "METHOD_NOT_ALLOWED");
    expect(post.headers.allow).toBe("GET");
    expectJsonError(
      await send({ method: "OPTIONS", path: "/api/v1/operator/episodes", headers: plain({ Origin: `http://127.0.0.1:${server.port}` }) }),
      401,
      "UNAUTHORIZED",
    );
    expect(listCanonicalEpisodes).not.toHaveBeenCalled();
  });

  it("A13: an unauthenticated query-string token request stays 401 (authentication before query checks)", async () => {
    const reply = await get(`/api/v1/operator/health?token=${TOKEN}`);
    expectJsonError(reply, 401, "UNAUTHORIZED");
    expect(reply.headers["www-authenticate"]).toBe('Bearer realm="busybookie-operator"');
    expectJsonError(await get("/api?x=1"), 401, "UNAUTHORIZED");
    expectJsonError(await get("/api/v1/operator/health?x=1", authed()), 400, "BAD_REQUEST");
  });

  it("A14: an API-only server (no console assets) answers non-API paths with 404 and keeps the API", async () => {
    const apiOnly = await startOperatorServer({
      port: 0,
      token: TOKEN,
      dependencies: { listCanonicalEpisodes, readEpisodeProductionStatus, now: () => NOW, randomRequestId: () => "req-api-only" },
      log: () => undefined,
    });
    const original = server;
    server = apiOnly;
    try {
      expectJsonError(await get("/"), 404, "NOT_FOUND");
      expectJsonError(await get(`/assets/${JS_NAME}`), 404, "NOT_FOUND");
      expectJsonError(await get("/api/v1/operator/health"), 401, "UNAUTHORIZED");
      expect((await get("/api/v1/operator/health", authed())).status).toBe(200);
    } finally {
      server = original;
      await apiOnly.close();
    }
  });
});

describe("D3A namespace partition and adversarial targets", () => {
  it.each(["/apiXYZ", "/API", "//api", "//api/v1/operator/health", "/api.json"])(
    "X1-X3: %s is not API territory: 404 JSON without a token",
    async (path) => {
      expectJsonError(await rawReply(path), 404, "NOT_FOUND");
    },
  );

  it.each(["/%61pi/v1/operator/health", "/api%2fv1%2foperator%2fhealth", "/%2e%2e/", "/%2e%2e%2fpackage.json", "/assets/%2e%2e%2fpackage.json"])(
    "X4/X5/X8: %s is 400 (no decoding)",
    async (path) => {
      expectJsonError(await rawReply(path), 400, "BAD_REQUEST");
    },
  );

  it("X6: /api/../index.html stays API territory (no normalization)", async () => {
    expectJsonError(await rawReply("/api/../index.html"), 401, "UNAUTHORIZED");
    expectJsonError(await rawReply("/api/../index.html", `Authorization: Bearer ${TOKEN}\r\n`), 404, "NOT_FOUND");
  });

  it.each(["/../", "/assets/../index.html", "/./", "/assets/./" + JS_NAME])("X7: raw %s is 404 (no normalization)", async (path) => {
    expectJsonError(await rawReply(path), 404, "NOT_FOUND");
  });

  it.each(["/assets\\..\\..\\package.json", "/..\\", "/C:/Windows/win.ini", "/C:\\Windows\\win.ini"])(
    "X9/X11: raw %s never serves a file",
    async (path) => {
      const reply = await rawGet(path);
      expect([400, 404]).toContain(reply.status);
      expect(reply.body).not.toContain("BEGIN");
      expect(reply.body).not.toContain('"name"');
    },
  );

  it.each(["/assets/%5c..%5cpackage.json", "/C%3A/Windows/win.ini", `/assets/${JS_NAME}%00`, "/%00", "/%zz", "/%", "/assets/%e0%a4%a"])(
    "X10-X13: %s is 400",
    async (path) => {
      expectJsonError(await rawReply(path), 400, "BAD_REQUEST");
    },
  );

  it("X12: a raw NUL byte in the target is rejected by the HTTP parser and the server keeps serving", async () => {
    const reply = await rawGet("/assets/x\u0000.js");
    expect(reply.status).toBe(400);
    expect((await get("/")).status).toBe(200);
  });

  it.each([`/assets/${JS_NAME}?v=1`, "/?", "/?x=1"])("X14: console target with a query %s is 400", async (path) => {
    expectJsonError(await rawReply(path), 400, "BAD_REQUEST");
  });

  it("X15: no response exposed a filesystem path, the build root or the token; the server still serves /", async () => {
    expect((await get("/")).status).toBe(200);
    const everything = observedTexts.join("\n");
    expect(everything).not.toContain(validFixturePath);
    expect(everything).not.toContain(tmpdir());
    expect(everything).not.toContain("apps/operator-console");
    expect(everything).not.toContain(TOKEN);
  });
});

// Raw request parsed into a Reply for targets the HTTP client would rewrite.
async function rawReply(target: string, extra = ""): Promise<Reply> {
  return new Promise((resolveRaw, rejectRaw) => {
    const socket = connect(server.port, "127.0.0.1", () =>
      socket.end(`GET ${target} HTTP/1.1\r\nHost: ${host()}\r\n${extra}Connection: close\r\n\r\n`),
    );
    let data = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => (data += chunk));
    socket.on("error", rejectRaw);
    socket.on("close", () => {
      observedTexts.push(data);
      const [head = "", body = ""] = data.split("\r\n\r\n");
      const [statusLine = "", ...headerLines] = head.split("\r\n");
      const headers: IncomingHttpHeaders = {};
      for (const line of headerLines) {
        const separator = line.indexOf(":");
        headers[line.slice(0, separator).toLowerCase()] = line.slice(separator + 1).trim();
      }
      resolveRaw({ status: Number(statusLine.split(" ")[1]), headers, body });
    });
  });
}
