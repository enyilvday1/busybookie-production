import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseGoogleGenAiOperatorCliArgs } from "../src/execution/cli/googleGenAiOperatorCliArgs.js";
import {
  GOOGLE_GENAI_OPERATOR_ERROR_TABLE,
  runGoogleGenAiOperatorCli,
  type RunGoogleGenAiOperatorCliDependencies,
} from "../src/execution/cli/runGoogleGenAiOperatorCli.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createGoogleGenAiOperatorProductionDependencies } from "../src/execution/createGoogleGenAiOperatorProductionDependencies.js";
import { GOOGLE_GENAI_OPERATOR_ERROR_CODES, executeGoogleGenAiOperatorSingleShot } from "../src/execution/executeGoogleGenAiOperatorSingleShot.js";
import { createExecutionReservationPath } from "../src/execution/executionReservationPath.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { inspectGoogleGenAiExecutionLifecycle } from "../src/execution/inspectGoogleGenAiExecutionLifecycle.js";
import { createGoogleGenAiSingleShotSecureProductionRecovery } from "../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";
import { readExecutionReservation } from "../src/execution/readExecutionReservation.js";
import { reconcileGoogleGenAiExecutionLifecycle } from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import { createGoogleGenAiVideoOutputPath } from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";
import type { GoogleGenAiFetch } from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";
import type { EpisodeManifest } from "../src/schemas/episodeManifest.schema.js";
import type { GoogleGenAiPolicy } from "../src/schemas/googleGenAiPolicy.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadGoogleGenAiActivationPolicy, type LoadedGoogleGenAiActivationPolicy } from "../src/validation/loadGoogleGenAiActivationPolicy.js";
import { loadGoogleGenAiPolicy } from "../src/validation/loadGoogleGenAiPolicy.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { validateEpisodeProduction } from "../src/validation/validateEpisodeProduction.js";

// The real SDK client is a tripwire: no B4X2 test may construct it.
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => {
    throw new Error("The real Google SDK must never be constructed by the operator CLI tests.");
  }),
}));
const { GoogleGenAI } = await import("@google/genai");

const SYNTHETIC_KEY = "synthetic-b4x2-cli-key";
const SENTINEL = "SENTINEL-B4X2-HOSTILE";
const INTERACTION_ID = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("busybookie-b4x2-cli", "utf8")]);
const sha256Hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

let episode: EpisodeManifest;
let committedActivationPolicy: LoadedGoogleGenAiActivationPolicy;
let googlePolicy: GoogleGenAiPolicy;
beforeAll(async () => {
  [episode, committedActivationPolicy, googlePolicy] = await Promise.all([loadEpisodeManifest("EP90"), loadGoogleGenAiActivationPolicy(), loadGoogleGenAiPolicy()]);
});

const temporaryDirectories: string[] = [];
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network is forbidden in these offline tests."));
});
afterEach(async () => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function mediaRootWithImage(): Promise<{ mediaRoot: string; imagePath: string }> {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-b4x2-cli-"));
  temporaryDirectories.push(mediaRoot);
  const imagePath = join(mediaRoot, "references", "EP90", "S01", "reference.png");
  await mkdir(dirname(imagePath), { recursive: true });
  await writeFile(imagePath, PNG);
  return { mediaRoot, imagePath };
}

const enabled = (): LoadedGoogleGenAiActivationPolicy => ({ ...committedActivationPolicy, admission: { newSubmissionsEnabled: true } });

type Io = { stdout: string[]; stderr: string[] };

function cliDependencies(mediaRoot: string, imagePath: string, overrides: Partial<RunGoogleGenAiOperatorCliDependencies> = {}, options: Partial<{
  activation: LoadedGoogleGenAiActivationPolicy;
  fetchImpl: GoogleGenAiFetch;
  createInteraction: () => Promise<{ id: unknown }>;
}> = {}) {
  const io: Io = { stdout: [], stderr: [] };
  const createInteraction = vi.fn(options.createInteraction ?? (async () => ({ id: INTERACTION_ID })));
  const tripwireFetch = vi.fn<GoogleGenAiFetch>(async () => { throw new Error("unexpected transport call"); });
  const createDependencies = vi.fn((apiKey: string) => Object.freeze({
    createInteraction,
    submittedRecovery: createGoogleGenAiSingleShotSecureProductionRecovery(apiKey, {
      fetchImpl: options.fetchImpl ?? tripwireFetch, nowMs: () => WALL_NOW, monotonicNowMs: () => 0,
    }),
  }));
  const spies = {
    createInteraction,
    createReservation: vi.fn(createExecutionReservation),
    createSubmission: vi.fn(createExecutionSubmission),
    loadActivationPolicy: vi.fn(async () => options.activation ?? enabled()),
    createDependencies,
    reconcile: vi.fn(reconcileGoogleGenAiExecutionLifecycle),
  };
  const dependencies: RunGoogleGenAiOperatorCliDependencies = {
    loadEnvironment: vi.fn(() => ({ BUSYBOOKIE_MEDIA_ROOT: mediaRoot, GEMINI_API_KEY: SYNTHETIC_KEY })),
    loadEpisodeManifest: vi.fn(async () => structuredClone(episode)),
    loadCharacterBible: vi.fn(() => loadCharacterBible()),
    loadProductionRules: vi.fn(() => loadProductionRules()),
    validateEpisodeProduction: vi.fn(validateEpisodeProduction),
    validateMediaRoot: vi.fn(async () => mediaRoot),
    loadActivationPolicy: spies.loadActivationPolicy,
    loadGooglePolicy: vi.fn(async () => googlePolicy),
    createDependencies: spies.createDependencies,
    createVisualReferenceVerifier: vi.fn(() => async () => ({ absolutePath: imagePath })),
    inspectLifecycle: vi.fn(inspectExecutionLifecycle),
    createReservation: spies.createReservation,
    createSubmission: spies.createSubmission,
    executeSingleShot: vi.fn(executeGoogleGenAiOperatorSingleShot),
    readReservation: vi.fn(readExecutionReservation),
    inspectGoogleLifecycle: vi.fn(inspectGoogleGenAiExecutionLifecycle),
    reconcile: spies.reconcile,
    writeStdout: (line) => { io.stdout.push(line); },
    writeStderr: (line) => { io.stderr.push(line); },
    ...overrides,
  };
  return { dependencies, io, spies };
}

/** Every dependency throws a hostile error if reached; used to prove the parser performs no side effect. */
function tripwireDependencies(io: Io): RunGoogleGenAiOperatorCliDependencies {
  const trip = () => { throw new Error(`side effect reached ${SENTINEL}`); };
  return {
    loadEnvironment: vi.fn(trip), loadEpisodeManifest: vi.fn(trip), loadCharacterBible: vi.fn(trip), loadProductionRules: vi.fn(trip),
    validateEpisodeProduction: vi.fn(trip), validateMediaRoot: vi.fn(trip), loadActivationPolicy: vi.fn(trip), loadGooglePolicy: vi.fn(trip),
    createDependencies: vi.fn(trip), createVisualReferenceVerifier: vi.fn(trip), inspectLifecycle: vi.fn(trip), createReservation: vi.fn(trip),
    createSubmission: vi.fn(trip), executeSingleShot: vi.fn(trip), readReservation: vi.fn(trip), inspectGoogleLifecycle: vi.fn(trip), reconcile: vi.fn(trip),
    writeStdout: (line) => { io.stdout.push(line); }, writeStderr: (line) => { io.stderr.push(line); },
  };
}

const EXECUTE_ARGS = ["execute", "--episode", "EP90", "--shot", "S01", "--image", "IMAGE", "--resolution", "720p", "--confirm-paid-generation"];
const executeArgs = (imagePath: string) => EXECUTE_ARGS.map((value) => (value === "IMAGE" ? imagePath : value));
const RECONCILE_ARGS = ["reconcile", "--episode", "EP90", "--shot", "S01"];

function parsed(lines: readonly string[]): Record<string, string> {
  return Object.fromEntries(lines.map((line) => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

function expectFailure(io: Io, exitCode: number, actual: number, code: string): Record<string, string> {
  expect(actual).toBe(exitCode);
  expect(io.stdout).toEqual([]);
  const fields = parsed(io.stderr);
  expect(fields.GOOGLE_GENAI_OPERATOR_RESULT).toBe("FAILED");
  expect(fields.ERROR_CODE).toBe(code);
  expect(fields.MESSAGE).toBe(GOOGLE_GENAI_OPERATOR_ERROR_TABLE[code as keyof typeof GOOGLE_GENAI_OPERATOR_ERROR_TABLE].message);
  expect(Object.keys(fields).every((key) => ["GOOGLE_GENAI_OPERATOR_RESULT", "SUBCOMMAND", "ERROR_CODE", "STAGE", "STATE_CHANGE", "RETRYABLE", "TRANSPORT_CODE", "MESSAGE"].includes(key))).toBe(true);
  return fields;
}

function expectNoLeak(io: Io): void {
  const output = [...io.stdout, ...io.stderr].join("\n");
  for (const forbidden of [SENTINEL, SYNTHETIC_KEY, INTERACTION_ID, "    at ", "Error:", "[object", "cause", "stack", "Bearer"]) {
    expect(output).not.toContain(forbidden);
  }
}

// ---------------------------------------------------------------------------
// Offline Google endpoint fake for the secure recovery chain (same contract as
// the B4V7 factory end-to-end test). Any unexpected URL fails loudly.
const ORIGIN = "https://generativelanguage.googleapis.com";
const FILE_ID = "operator-123";
const OUTPUT_URI = `${ORIGIN}/v1beta/files/${FILE_ID}:download?alt=media`;
const REPLAY_URL = `${ORIGIN}/v1beta/interactions/${INTERACTION_ID}?stream=true&include_input=false`;
const METADATA_URL = `${ORIGIN}/v1beta/files/${FILE_ID}`;
const SUBMITTED_AT = "2026-10-24T12:01:00.000Z";
const WALL_NOW = Date.parse(SUBMITTED_AT) + 19 * 60_000;
function makeMp4(): Buffer {
  const payload = Buffer.from("busybookie-b4x2-operator-output", "utf8");
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + payload.byteLength, 0);
  mdat.write("mdat", 4, "latin1");
  return Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.from([0x00, 0x00, 0x02, 0x00]), Buffer.from("isommp41", "latin1"), mdat, payload]);
}
const OUTPUT_BYTES = makeMp4();
const frame = (event: Record<string, unknown>) => `event: ${String(event.event_type)}\ndata: ${JSON.stringify(event)}\n\n`;
const completedSse = () => [
  { event_type: "interaction.created", interaction: { id: INTERACTION_ID, status: "in_progress" } },
  { event_type: "step.start", index: 0, step: { type: "model_output" } },
  { event_type: "step.delta", index: 0, delta: { type: "video", mime_type: "video/mp4", uri: OUTPUT_URI } },
  { event_type: "step.stop", index: 0 },
  { event_type: "interaction.completed", interaction: { id: INTERACTION_ID, status: "completed" } },
].map(frame).join("");
function googleFetch(): ReturnType<typeof vi.fn<GoogleGenAiFetch>> {
  return vi.fn<GoogleGenAiFetch>(async (url) => {
    if (url === REPLAY_URL) return new Response(new TextEncoder().encode(completedSse()), { headers: { "content-type": "text/event-stream" } });
    if (url === METADATA_URL) {
      return new Response(JSON.stringify({
        name: `files/${FILE_ID}`, state: "ACTIVE", source: "GENERATED", mimeType: "video/mp4", sizeBytes: String(OUTPUT_BYTES.byteLength),
        sha256Hash: Buffer.from(sha256Hex(OUTPUT_BYTES), "ascii").toString("base64"), expirationTime: "2026-10-26T12:00:00Z",
      }), { headers: { "content-type": "application/json" } });
    }
    if (url === OUTPUT_URI) {
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(OUTPUT_BYTES)); controller.close(); } }),
        { headers: { "content-type": "video/mp4", "content-length": String(OUTPUT_BYTES.byteLength) } });
    }
    throw new Error(`Unexpected fetch target in offline test: ${url}`);
  });
}

async function googleSubmittedShot(mediaRoot: string): Promise<void> {
  const reservation = await createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" }, { now: () => "2026-10-24T12:00:00.000Z" });
  await createExecutionSubmission(mediaRoot, {
    reservationId: reservation.record.reservationId, episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID,
    recoveryMetadata: {
      request: { model: "gemini-omni-1.1-flash", background: true, store: true, stream: false, promptText: "Operator reconcile test.", sourceImagePath: join(mediaRoot, "references", "EP90", "S01", "reference.png") },
      policySnapshot: googlePolicy,
    },
  }, { now: () => SUBMITTED_AT });
}

describe("operator CLI argument grammar (pure, exit 2, no side effects)", () => {
  it("parses the exact execute and reconcile grammars", () => {
    expect(parseGoogleGenAiOperatorCliArgs(["execute", "--episode", "EP90", "--shot", "S01", "--image", "/m/references/a.png", "--resolution", "720p", "--confirm-paid-generation"]))
      .toEqual({ subcommand: "execute", episodeId: "EP90", shotId: "S01", sourceImagePath: "/m/references/a.png", resolution: "720p", confirmPaidGeneration: true });
    expect(parseGoogleGenAiOperatorCliArgs(["execute", "--shot", "S03A", "--resolution", "720p", "--image", "x.png", "--episode", "EP123"]))
      .toEqual({ subcommand: "execute", episodeId: "EP123", shotId: "S03A", sourceImagePath: "x.png", resolution: "720p", confirmPaidGeneration: false });
    expect(parseGoogleGenAiOperatorCliArgs(RECONCILE_ARGS)).toEqual({ subcommand: "reconcile", episodeId: "EP90", shotId: "S01" });
  });

  it.each([
    ["no command", []],
    ["unknown command", ["status", "--episode", "EP90", "--shot", "S01"]],
    ["batch command", ["batch", "--episode", "EP90"]],
    ["missing shot", ["reconcile", "--episode", "EP90"]],
    ["missing episode", ["reconcile", "--shot", "S01"]],
    ["two shots", ["reconcile", "--episode", "EP90", "--shot", "S01", "--shot", "S02"]],
    ["extra execute flag on reconcile", ["reconcile", "--episode", "EP90", "--shot", "S01", "--image", "x.png"]],
    ["confirmation on reconcile", [...RECONCILE_ARGS, "--confirm-paid-generation"]],
    ["positional extra", [...RECONCILE_ARGS, "S02"]],
    ["malformed shot", ["reconcile", "--episode", "EP90", "--shot", "S1"]],
    ["malformed episode", ["reconcile", "--episode", "E90", "--shot", "S01"]],
    ["missing value", ["reconcile", "--episode", "--shot", "S01"]],
    ["execute without resolution", ["execute", "--episode", "EP90", "--shot", "S01", "--image", "x.png"]],
    ["execute without image", ["execute", "--episode", "EP90", "--shot", "S01", "--resolution", "720p"]],
    ["duplicate confirmation", [...EXECUTE_ARGS, "--confirm-paid-generation"]],
    ["provider override", [...EXECUTE_ARGS, "--provider", "GOOGLE_GENAI"]],
    ["policy path override", [...EXECUTE_ARGS, "--policy", "x.json"]],
    ["prompt override", [...EXECUTE_ARGS, "--prompt", "free text"]],
    ["force", [...RECONCILE_ARGS, "--force"]],
    ["all shots", ["reconcile", "--episode", "EP90", "--all"]],
  ])("rejects %s with USAGE_INVALID and touches nothing", async (_label, args) => {
    const io: Io = { stdout: [], stderr: [] };
    const dependencies = tripwireDependencies(io);
    const exitCode = await runGoogleGenAiOperatorCli(args, dependencies);
    const fields = expectFailure(io, 2, exitCode, "USAGE_INVALID");
    expect(fields.STAGE).toBe("ARGS");
    expect(fields.STATE_CHANGE).toBe("NONE");
    for (const [name, value] of Object.entries(dependencies)) {
      if (name !== "writeStdout" && name !== "writeStderr") expect(value, name).not.toHaveBeenCalled();
    }
    expectNoLeak(io);
  });
});

describe("operator CLI execute", () => {
  it("submits a synthetic shot, prints only the locked evidence and stops at SUBMITTED (exit 0)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath);
    const exitCode = await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies);

    expect(exitCode).toBe(0);
    expect(io.stderr).toEqual([]);
    const fields = parsed(io.stdout);
    expect(Object.keys(fields)).toEqual([
      "GOOGLE_GENAI_OPERATOR_RESULT", "EPISODE_ID", "SHOT_ID", "PROVIDER", "MODEL", "RESOLUTION", "EXPECTED_COST_MICRO_USD",
      "COST_CAP_MICRO_USD", "RESERVATION_ID", "PROVIDER_EXECUTION_ID_SHA256", "SUBMISSION_PATH", "NEXT_ACTION",
    ]);
    expect(fields).toMatchObject({
      GOOGLE_GENAI_OPERATOR_RESULT: "SUBMITTED", EPISODE_ID: "EP90", SHOT_ID: "S01", PROVIDER: "GOOGLE_GENAI", MODEL: "gemini-omni-1.1-flash",
      RESOLUTION: "720p", EXPECTED_COST_MICRO_USD: "1513600", COST_CAP_MICRO_USD: "2000000", PROVIDER_EXECUTION_ID_SHA256: sha256Hex(INTERACTION_ID), NEXT_ACTION: "reconcile",
    });
    expectNoLeak(io);
    expect(spies.createInteraction).toHaveBeenCalledTimes(1);
    expect(spies.createReservation).toHaveBeenCalledTimes(1);
    expect(spies.createSubmission).toHaveBeenCalledTimes(1);
    expect(spies.reconcile).not.toHaveBeenCalled();
    expect((await inspectExecutionLifecycle(mediaRoot, "EP90", "S01")).state).toBe("SUBMITTED");
  });

  it("refuses with the committed default-off policy: exit 3, no credential construction, no reservation, no create", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath, {}, { activation: committedActivationPolicy });
    const fields = expectFailure(io, 3, await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies), "NEW_SUBMISSIONS_DISABLED");
    expect(fields).toMatchObject({ SUBCOMMAND: "execute", STAGE: "ADMISSION", STATE_CHANGE: "NONE", RETRYABLE: "NO" });
    expect(spies.createDependencies).not.toHaveBeenCalled();
    expect(spies.createReservation).not.toHaveBeenCalled();
    expect(spies.createInteraction).not.toHaveBeenCalled();
    expect((await inspectExecutionLifecycle(mediaRoot, "EP90", "S01")).state).toBe("NOTHING");
  });

  it("refuses a missing credential before loading anything else (exit 3)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath, { loadEnvironment: vi.fn(() => ({ BUSYBOOKIE_MEDIA_ROOT: mediaRoot })) });
    expectFailure(io, 3, await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies), "CREDENTIAL_MISSING");
    expect(dependencies.loadEpisodeManifest).not.toHaveBeenCalled();
    expect(spies.createReservation).not.toHaveBeenCalled();
  });

  it("refuses a malformed credential through the real composition before any reservation (exit 3)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath, {
      loadEnvironment: vi.fn(() => ({ BUSYBOOKIE_MEDIA_ROOT: mediaRoot, GEMINI_API_KEY: `bad key ${SENTINEL}` })),
      createDependencies: vi.fn(createGoogleGenAiOperatorProductionDependencies),
    });
    expectFailure(io, 3, await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies), "CREDENTIAL_INVALID");
    expect(spies.createReservation).not.toHaveBeenCalled();
    expectNoLeak(io);
  });

  it("refuses an already-submitted Google shot without a second create (exit 3)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await googleSubmittedShot(mediaRoot);
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath);
    expectFailure(io, 3, await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies), "LIFECYCLE_EXISTS");
    expect(spies.createInteraction).not.toHaveBeenCalled();
    expect(spies.createReservation).not.toHaveBeenCalled();
  });

  it("maps a hostile create failure to SUBMISSION_ACCEPTANCE_UNCERTAIN (exit 4) without leaking any detail", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const hostile = Object.assign(new Error(`sdk ${SENTINEL}`, { cause: new Error(`cause ${SENTINEL}`) }), { providerBody: SENTINEL, headers: { authorization: `Bearer ${SENTINEL}` }, code: "SSE_HTTP_FAILED" });
    const { dependencies, io } = cliDependencies(mediaRoot, imagePath, {}, { createInteraction: async () => { throw hostile; } });
    const fields = expectFailure(io, 4, await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies), "SUBMISSION_ACCEPTANCE_UNCERTAIN");
    expect(fields).toMatchObject({ STAGE: "SUBMISSION", STATE_CHANGE: "RESERVED_ONLY" });
    expect(fields.TRANSPORT_CODE).toBeUndefined();
    expectNoLeak(io);
  });

  it.each([
    ["loadEnvironment", "ENVIRONMENT_INVALID", 3],
    ["loadEpisodeManifest", "EPISODE_INVALID", 3],
    ["validateEpisodeProduction", "EPISODE_INVALID", 3],
    ["validateMediaRoot", "MEDIA_ROOT_INVALID", 3],
    ["loadActivationPolicy", "CONFIG_INVALID", 3],
    ["loadGooglePolicy", "CONFIG_INVALID", 3],
    ["createDependencies", "CREDENTIAL_INVALID", 3],
    ["inspectLifecycle", "LIFECYCLE_UNREADABLE", 3],
    ["createReservation", "RESERVATION_FAILED", 4],
    ["createSubmission", "DURABLE_SUBMISSION_FAILED", 4],
    ["executeSingleShot", "INTERNAL_ERROR", 4],
  ] as const)("sanitizes a hostile %s failure to %s (exit %i)", async (name, code, exitCode) => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const stackful = new Error(`hostile ${SENTINEL}`, { cause: { secret: SENTINEL } });
    Object.assign(stackful, { providerBody: SENTINEL, code: "DOWNLOAD_TIMEOUT", response: { headers: { authorization: SENTINEL } } });
    const thrower = vi.fn(() => { throw stackful; });
    const { dependencies, io } = cliDependencies(mediaRoot, imagePath, { [name]: thrower });
    expectFailure(io, exitCode, await runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies), code);
    expect(thrower).toHaveBeenCalled();
    expectNoLeak(io);
  });

  it("does not rethrow or change the exit code when stderr itself fails", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies } = cliDependencies(mediaRoot, imagePath, { writeStderr: () => { throw new Error("broken pipe"); } }, { activation: committedActivationPolicy });
    await expect(runGoogleGenAiOperatorCli(executeArgs(imagePath), dependencies)).resolves.toBe(3);
  });

  it("assigns every closed error code exactly one fixed message and a locked exit category", () => {
    expect(Object.keys(GOOGLE_GENAI_OPERATOR_ERROR_TABLE).sort()).toEqual([...GOOGLE_GENAI_OPERATOR_ERROR_CODES].sort());
    for (const [code, entry] of Object.entries(GOOGLE_GENAI_OPERATOR_ERROR_TABLE)) {
      expect([2, 3, 4, 5], code).toContain(entry.exitCode);
      expect(entry.message, code).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(GOOGLE_GENAI_OPERATOR_ERROR_TABLE.USAGE_INVALID.exitCode).toBe(2);
    expect(GOOGLE_GENAI_OPERATOR_ERROR_TABLE.NEW_SUBMISSIONS_DISABLED.exitCode).toBe(3);
    expect(GOOGLE_GENAI_OPERATOR_ERROR_TABLE.SUBMISSION_ACCEPTANCE_UNCERTAIN.exitCode).toBe(4);
    expect(GOOGLE_GENAI_OPERATOR_ERROR_TABLE.RECOVERY_FAILED.exitCode).toBe(5);
  });
});

describe("operator CLI reconcile", () => {
  it("recovers an existing Google submission with new submissions disabled, via the real secure factory and reconciler (exit 0)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await googleSubmittedShot(mediaRoot);
    expect(committedActivationPolicy.admission.newSubmissionsEnabled).toBe(false);
    const fetchImpl = googleFetch();
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath, { loadActivationPolicy: vi.fn(() => loadGoogleGenAiActivationPolicy()) }, { activation: committedActivationPolicy, fetchImpl });

    const exitCode = await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies);
    expect(io.stderr).toEqual([]);
    expect(exitCode).toBe(0);
    const fields = parsed(io.stdout);
    expect(fields).toEqual({
      GOOGLE_GENAI_OPERATOR_RESULT: "COMPLETED", RECONCILIATION_MODE: "RECOVERED_SUBMISSION", EPISODE_ID: "EP90", SHOT_ID: "S01", PROVIDER: "GOOGLE_GENAI",
      PROVIDER_EXECUTION_ID_SHA256: sha256Hex(INTERACTION_ID), OUTPUT_PATH: createGoogleGenAiVideoOutputPath(mediaRoot, "EP90", "S01", INTERACTION_ID),
      OUTPUT_BYTES: String(OUTPUT_BYTES.byteLength), OUTPUT_SHA256: sha256Hex(OUTPUT_BYTES), CONTENT_TYPE: "video/mp4",
      GENERATION_RECORD_PATH: expect.any(String), COMPLETION_PATH: expect.any(String),
    });
    expect(await readFile(fields.OUTPUT_PATH!)).toEqual(OUTPUT_BYTES);
    expectNoLeak(io);

    // Recovery-side authority only: the secure factory output reached the real reconciler unchanged.
    expect(spies.reconcile).toHaveBeenCalledTimes(1);
    const submittedRecovery = spies.createDependencies.mock.results[0]!.value.submittedRecovery;
    expect(spies.reconcile.mock.calls[0]).toEqual([{ mediaRoot, episodeId: "EP90", shotId: "S01" }, { submittedRecovery }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(dependencies.loadActivationPolicy).not.toHaveBeenCalled();
    expect(dependencies.loadGooglePolicy).not.toHaveBeenCalled();
    expect(dependencies.loadEpisodeManifest).not.toHaveBeenCalled();
    expect(spies.createReservation).not.toHaveBeenCalled();
    expect(spies.createSubmission).not.toHaveBeenCalled();
    expect(spies.createInteraction).not.toHaveBeenCalled();
    expect(dependencies.executeSingleShot).not.toHaveBeenCalled();

    // A second reconcile is offline durable verification.
    const second = cliDependencies(mediaRoot, imagePath, {}, { fetchImpl });
    expect(await runGoogleGenAiOperatorCli(RECONCILE_ARGS, second.dependencies)).toBe(0);
    expect(parsed(second.io.stdout).RECONCILIATION_MODE).toBe("DURABLE_COMPLETION");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("refuses when no lifecycle exists (exit 3)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath);
    expectFailure(io, 3, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "NO_LIFECYCLE");
    expect(spies.reconcile).not.toHaveBeenCalled();
  });

  it.each(["RUNWAY", "VEO"] as const)("refuses an incompatible %s lifecycle (exit 3)", async (provider) => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider });
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath);
    expectFailure(io, 3, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "INCOMPATIBLE_PROVIDER_STATE");
    expect(spies.reconcile).not.toHaveBeenCalled();
  });

  it("refuses a Google reservation without a submission and never submits (exit 4)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await createExecutionReservation(mediaRoot, { episodeId: "EP90", shotId: "S01", provider: "GOOGLE_GENAI" });
    const { dependencies, io, spies } = cliDependencies(mediaRoot, imagePath);
    expectFailure(io, 4, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "RESERVED_WITHOUT_SUBMISSION");
    expect(spies.reconcile).not.toHaveBeenCalled();
    expect(spies.createInteraction).not.toHaveBeenCalled();
  });

  it("refuses corrupt lifecycle records (exit 4)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const path = createExecutionReservationPath(mediaRoot, "EP90", "S01");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `{ "corrupt": "${SENTINEL}"`);
    const { dependencies, io } = cliDependencies(mediaRoot, imagePath);
    expectFailure(io, 4, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "LIFECYCLE_INVALID");
    expectNoLeak(io);
  });

  it("refuses reconcile without a credential (exit 3)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    const { dependencies, io } = cliDependencies(mediaRoot, imagePath, { loadEnvironment: vi.fn(() => ({ BUSYBOOKIE_MEDIA_ROOT: mediaRoot })) });
    expectFailure(io, 3, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "CREDENTIAL_MISSING");
  });

  it("reports a closed transport code with its retryable flag (exit 5)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await googleSubmittedShot(mediaRoot);
    const { dependencies, io } = cliDependencies(mediaRoot, imagePath, { reconcile: vi.fn(async () => { throw new GoogleGenAiSecureOutputTransportError("DOWNLOAD_TIMEOUT"); }) });
    const fields = expectFailure(io, 5, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "RECOVERY_FAILED");
    expect(fields).toMatchObject({ TRANSPORT_CODE: "DOWNLOAD_TIMEOUT", RETRYABLE: "YES", STAGE: "RECONCILE" });
  });

  it("never prints an unlisted or accessor-backed code and maps it to RECONCILE_FAILED (exit 5)", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await googleSubmittedShot(mediaRoot);
    const getter = vi.fn(() => "DOWNLOAD_TIMEOUT");
    const accessor = Object.defineProperty(new Error(SENTINEL), "code", { get: getter });
    for (const hostile of [Object.assign(new Error(SENTINEL), { code: `NOT_LISTED_${SENTINEL}`, retryable: true }), accessor, { code: SENTINEL }, SENTINEL, null]) {
      const { dependencies, io } = cliDependencies(mediaRoot, imagePath, { reconcile: vi.fn(async () => { throw hostile; }) });
      const fields = expectFailure(io, 5, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "RECONCILE_FAILED");
      expect(fields.TRANSPORT_CODE).toBeUndefined();
      expect(fields.RETRYABLE).toBe("NO");
      expectNoLeak(io);
    }
    expect(getter).not.toHaveBeenCalled();
  });

  it("maps a real pending/unknown reconciler failure to RECONCILE_FAILED without detail", async () => {
    const { mediaRoot, imagePath } = await mediaRootWithImage();
    await googleSubmittedShot(mediaRoot);
    const { dependencies, io } = cliDependencies(mediaRoot, imagePath, { reconcile: vi.fn(async () => { throw new Error(`remote pending ${SENTINEL}`); }) });
    expectFailure(io, 5, await runGoogleGenAiOperatorCli(RECONCILE_ARGS, dependencies), "RECONCILE_FAILED");
    expectNoLeak(io);
  });
});

describe("operator CLI source boundaries", () => {
  it("keeps the entry script a minimal adapter with one import and no orchestration", async () => {
    const script = await readFile(join(process.cwd(), "scripts/google-genai-operator.ts"), "utf8");
    expect(script).toBe([
      "import {",
      "  runGoogleGenAiOperatorCli,",
      '} from "../src/execution/cli/runGoogleGenAiOperatorCli.js";',
      "",
      "runGoogleGenAiOperatorCli().then(",
      "  (code) => {",
      "    process.exitCode = code;",
      "  },",
      "  () => {",
      "    process.stderr.write(",
      '      "GOOGLE_GENAI_OPERATOR_RESULT=FAILED\\nERROR_CODE=INTERNAL_ERROR\\n",',
      "    );",
      "    process.exitCode = 4;",
      "  },",
      ");",
      "",
    ].join("\n"));
  });

  it("never formats a caught value or reaches for raw console/inspection APIs", async () => {
    for (const file of ["src/execution/cli/runGoogleGenAiOperatorCli.ts", "src/execution/cli/googleGenAiOperatorCliArgs.ts", "src/execution/executeGoogleGenAiOperatorSingleShot.ts"]) {
      const source = await readFile(join(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/console\.|util\.inspect|node:util|JSON\.stringify\(\s*error|\$\{\s*error|error\.message|error\.stack|\.cause\b|process\.exit\(/);
    }
    const runner = await readFile(join(process.cwd(), "src/execution/cli/runGoogleGenAiOperatorCli.ts"), "utf8");
    expect(runner).not.toMatch(/loadProviderRoutingPolicy|executeSingleShot\.js|createProductionSingleShotExecutionDependencies|createProductionExecutionReconcileDependencies|reconcileExecutionLifecycle\.js|\/routing\/|\/runway\/|\/veo\/|ProductionInteractionGetter|ProductionOutputRetriever/);
    expect(runner).toContain("loadGoogleGenAiActivationPolicy()");
    expect(runner).toContain("loadGoogleGenAiPolicy()");
    expect(runner).toContain("createVisualReferenceVerifier:\n      createProductionVisualReferenceVerifier,");
    expect(runner).toContain("createDependencies:\n      createGoogleGenAiOperatorProductionDependencies,");
  });
});
