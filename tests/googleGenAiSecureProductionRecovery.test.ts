import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createExecutionCompletionPath } from "../src/execution/executionCompletionPath.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createGoogleGenAiSingleShotProductionInteractionGetter } from "../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.js";
import { createGoogleGenAiSingleShotProductionOutputRetriever } from "../src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.js";
import { createGoogleGenAiSingleShotSecureProductionRecovery } from "../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";
import { materializeGoogleGenAiSingleShotOutput } from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";
import { persistGoogleGenAiSingleShotCompletion } from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";
import { recoverGoogleGenAiSingleShot } from "../src/execution/providers/recoverGoogleGenAiSingleShot.js";
import { submitGoogleGenAiSingleShot } from "../src/execution/providers/submitGoogleGenAiSingleShot.js";
import { reconcileGoogleGenAiExecutionLifecycle, type GoogleGenAiSubmittedRecoveryDependencies } from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import { verifyGoogleGenAiDurableCompletion } from "../src/execution/verifyGoogleGenAiDurableCompletion.js";
import { GOOGLE_GENAI_ACTIVATION_LIMITS } from "../src/googleGenai/googleGenAiActivationLimits.js";
import { downloadGoogleGenAiFile } from "../src/googleGenai/transport/downloadGoogleGenAiFile.js";
import { getGoogleGenAiFilesMetadata } from "../src/googleGenai/transport/getGoogleGenAiFilesMetadata.js";
import { replayGoogleGenAiInteraction } from "../src/googleGenai/transport/replayGoogleGenAiInteraction.js";
import { createGoogleGenAiVideoOutputPath } from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";
import type { GoogleGenAiFetch, GoogleGenAiInteractionReplayResult, GoogleGenAiRecoveryContext } from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";
import type { GoogleGenAiPolicy } from "../src/schemas/googleGenAiPolicy.schema.js";
import { loadGoogleGenAiPolicy } from "../src/validation/loadGoogleGenAiPolicy.js";
import { GoogleGenAI } from "@google/genai";

// Pass-through wrappers only: behavior is unchanged, but identity, call
// order and non-use of legacy/submission/SDK authorities become observable.
vi.mock("../src/execution/providers/recoverGoogleGenAiSingleShot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/recoverGoogleGenAiSingleShot.js")>();
  return { ...actual, recoverGoogleGenAiSingleShot: vi.fn(actual.recoverGoogleGenAiSingleShot) };
});
vi.mock("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js")>();
  return { ...actual, materializeGoogleGenAiSingleShotOutput: vi.fn(actual.materializeGoogleGenAiSingleShotOutput) };
});
vi.mock("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js")>();
  return { ...actual, persistGoogleGenAiSingleShotCompletion: vi.fn(actual.persistGoogleGenAiSingleShotCompletion) };
});
vi.mock("../src/execution/verifyGoogleGenAiDurableCompletion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/verifyGoogleGenAiDurableCompletion.js")>();
  return { ...actual, verifyGoogleGenAiDurableCompletion: vi.fn(actual.verifyGoogleGenAiDurableCompletion) };
});
vi.mock("../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.js")>();
  return { ...actual, createGoogleGenAiSingleShotProductionInteractionGetter: vi.fn(actual.createGoogleGenAiSingleShotProductionInteractionGetter) };
});
vi.mock("../src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.js")>();
  return { ...actual, createGoogleGenAiSingleShotProductionOutputRetriever: vi.fn(actual.createGoogleGenAiSingleShotProductionOutputRetriever) };
});
vi.mock("../src/execution/providers/submitGoogleGenAiSingleShot.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/submitGoogleGenAiSingleShot.js")>();
  return { ...actual, submitGoogleGenAiSingleShot: vi.fn(actual.submitGoogleGenAiSingleShot) };
});
// The protected transports themselves: what the factory forwards (context
// identity, call count) is observed at the exact transport boundary.
vi.mock("../src/googleGenai/transport/replayGoogleGenAiInteraction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/googleGenai/transport/replayGoogleGenAiInteraction.js")>();
  return { ...actual, replayGoogleGenAiInteraction: vi.fn(actual.replayGoogleGenAiInteraction) };
});
vi.mock("../src/googleGenai/transport/getGoogleGenAiFilesMetadata.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/googleGenai/transport/getGoogleGenAiFilesMetadata.js")>();
  return { ...actual, getGoogleGenAiFilesMetadata: vi.fn(actual.getGoogleGenAiFilesMetadata) };
});
vi.mock("../src/googleGenai/transport/downloadGoogleGenAiFile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/googleGenai/transport/downloadGoogleGenAiFile.js")>();
  return { ...actual, downloadGoogleGenAiFile: vi.fn(actual.downloadGoogleGenAiFile) };
});
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return { ...actual, GoogleGenAI: vi.fn(actual.GoogleGenAI) };
});

const SYNTHETIC_KEY = "synthetic-b4v7-recovery-key";
const INTERACTION_ID = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";
const RESERVATION_ID = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://generativelanguage.googleapis.com";
const FILE_ID = "factory-123";
const OUTPUT_URI = `${ORIGIN}/v1beta/files/${FILE_ID}:download?alt=media`;
const REPLAY_URL = `${ORIGIN}/v1beta/interactions/${INTERACTION_ID}?stream=true&include_input=false`;
const METADATA_URL = `${ORIGIN}/v1beta/files/${FILE_ID}`;
const SUBMITTED_AT_MS = Date.UTC(2026, 9, 24, 12, 1);
const WALL_NOW = SUBMITTED_AT_MS + 19 * 60_000;

function makeMp4(label = "busybookie-b4v7-secure-factory-output"): Buffer {
  const payload = Buffer.from(label, "utf8");
  const mdat = Buffer.alloc(8);
  mdat.writeUInt32BE(8 + payload.byteLength, 0);
  mdat.write("mdat", 4, "latin1");
  return Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from("ftypisom", "latin1"),
    Buffer.from([0x00, 0x00, 0x02, 0x00]), Buffer.from("isommp41", "latin1"), mdat, payload,
  ]);
}
const OUTPUT_BYTES = makeMp4();
const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const encoder = new TextEncoder();
type SseEvent = { event_type: string; [key: string]: unknown };
const frame = (event: SseEvent) => `event: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`;
const created = (status: string) => frame({ event_type: "interaction.created", interaction: { id: INTERACTION_ID, status } });
function completedSse(uri = OUTPUT_URI): string {
  return created("in_progress") + [
    { event_type: "step.start", index: 0, step: { type: "model_output" } },
    { event_type: "step.delta", index: 0, delta: { type: "video", mime_type: "video/mp4", uri } },
    { event_type: "step.stop", index: 0 },
    { event_type: "interaction.completed", interaction: { id: INTERACTION_ID, status: "completed" } },
  ].map(frame).join("");
}
const sseResponse = (text: string) => new Response(encoder.encode(text), { headers: { "content-type": "text/event-stream" } });
function metadataResponse(bytes: Uint8Array = OUTPUT_BYTES): Response {
  return new Response(JSON.stringify({
    name: `files/${FILE_ID}`, state: "ACTIVE", source: "GENERATED", mimeType: "video/mp4",
    sizeBytes: String(bytes.byteLength), sha256Hash: Buffer.from(sha256Hex(bytes), "ascii").toString("base64"),
    expirationTime: "2026-10-26T12:00:00Z",
  }), { headers: { "content-type": "application/json" } });
}
function downloadResponse(bytes: Uint8Array = OUTPUT_BYTES): Response {
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (let offset = 0; offset < bytes.byteLength; offset += 11) controller.enqueue(bytes.slice(offset, offset + 11));
    controller.close();
  } });
  return new Response(stream, { headers: { "content-type": "video/mp4", "content-length": String(bytes.byteLength) } });
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>;
type FakeFetch = ReturnType<typeof vi.fn<GoogleGenAiFetch>>;
/** In-process Google endpoint fake; any unexpected URL fails the test loudly. */
function googleFetch(routes: Readonly<{ replay?: Route; metadata?: Route; download?: Route }> = {}): FakeFetch {
  return vi.fn<GoogleGenAiFetch>(async (url, init) => {
    if (url === REPLAY_URL) return (routes.replay ?? (() => sseResponse(completedSse())))(url, init);
    if (url === METADATA_URL) return (routes.metadata ?? (() => metadataResponse()))(url, init);
    if (url === OUTPUT_URI) return (routes.download ?? (() => downloadResponse()))(url, init);
    throw new Error(`Unexpected fetch target in offline test: ${url}`);
  });
}
const callsTo = (fetchImpl: FakeFetch, url: string) => fetchImpl.mock.calls.filter(([called]) => called === url).length;

const temporaryDirectories: string[] = [];
let policySnapshot: GoogleGenAiPolicy;
beforeAll(async () => { policySnapshot = await loadGoogleGenAiPolicy(); });
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network is forbidden in these offline tests."));
});
afterEach(async () => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
  expect(vi.mocked(submitGoogleGenAiSingleShot)).not.toHaveBeenCalled();
  expect(vi.mocked(createGoogleGenAiSingleShotProductionInteractionGetter)).not.toHaveBeenCalled();
  expect(vi.mocked(createGoogleGenAiSingleShotProductionOutputRetriever)).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function submittedShot(): Promise<string> {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-google-genai-secure-factory-"));
  temporaryDirectories.push(mediaRoot);
  await createExecutionReservation(mediaRoot, { episodeId: "EP92", shotId: "S01", provider: "GOOGLE_GENAI" }, {
    now: () => "2026-10-24T12:00:00.000Z", createReservationId: () => RESERVATION_ID,
  });
  await createExecutionSubmission(mediaRoot, {
    reservationId: RESERVATION_ID, episodeId: "EP92", shotId: "S01", provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID,
    recoveryMetadata: {
      request: {
        model: "gemini-omni-1.1-flash", background: true, store: true, stream: false,
        promptText: "Busybookie secure production recovery factory test.",
        sourceImagePath: join(mediaRoot, "references", "EP92", "S01", "reference.png"),
      },
      policySnapshot,
    },
  }, { now: () => "2026-10-24T12:01:00.000Z" });
  return mediaRoot;
}
const reconcile = (mediaRoot: string, submittedRecovery: GoogleGenAiSubmittedRecoveryDependencies) =>
  reconcileGoogleGenAiExecutionLifecycle({ mediaRoot, episodeId: "EP92", shotId: "S01" }, { submittedRecovery });
const outputPath = (mediaRoot: string) => createGoogleGenAiVideoOutputPath(mediaRoot, "EP92", "S01", INTERACTION_ID);
async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}
function settle<T>(promise: Promise<T>): Promise<unknown> {
  return promise.then(() => undefined, (error: unknown) => error);
}
// Condition-driven: yields cooperatively (real setImmediate; only setTimeout/clearTimeout are faked) until the
// condition holds. Real filesystem completion is not bounded by any event-loop turn count; the existing Vitest
// test timeout remains the only outer bound.
async function waitUntil(condition: () => boolean): Promise<void> {
  while (!condition()) await new Promise<void>((resolve) => setImmediate(resolve));
  expect(condition()).toBe(true);
}
const fixedClocks = () => ({ nowMs: vi.fn(() => WALL_NOW), monotonicNowMs: vi.fn(() => 0) });

describe("dormant secure Google production recovery factory", () => {
  describe("construction", () => {
    it("constructs offline: zero fetch, zero clock reads, zero replay/metadata/download, no SDK", () => {
      const fetchImpl = googleFetch();
      const clocks = fixedClocks();
      const dependencies = createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl, ...clocks });
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(clocks.nowMs).not.toHaveBeenCalled();
      expect(clocks.monotonicNowMs).not.toHaveBeenCalled();
      expect(Object.isFrozen(dependencies)).toBe(true);
      expect(Object.keys(dependencies).sort()).toEqual(["downloadUri", "monotonicNowMs", "nowMs", "policy", "prepareUri", "replayInteraction"]);
      expect(dependencies.nowMs).toBe(clocks.nowMs);
      expect(dependencies.monotonicNowMs).toBe(clocks.monotonicNowMs);
      // No completion-timestamp clock, filesystem or legacy dependency is supplied.
      expect(Object.hasOwn(dependencies, "now")).toBe(false);
      expect(Object.hasOwn(dependencies, "outputFileSystem")).toBe(false);
      expect(Object.hasOwn(dependencies, "completionFileSystem")).toBe(false);
      expect(Object.hasOwn(dependencies, "getInteraction")).toBe(false);
      expect(Object.hasOwn(dependencies, "retrieveOutput")).toBe(false);
      expect(JSON.stringify(dependencies)).not.toContain(SYNTHETIC_KEY);
    });

    it("injects exactly the transport-policy fields of the frozen activation-limits authority, deep-frozen", () => {
      const { policy } = createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY);
      const { limits, timeouts, recovery } = GOOGLE_GENAI_ACTIVATION_LIMITS;
      expect(policy).toStrictEqual({
        limits: {
          maxOutputBytes: limits.maxOutputBytes, filesMetadataMaxResponseBytes: limits.filesMetadataMaxResponseBytes,
          sseMaxEventBytes: limits.sseMaxEventBytes, sseMaxResponseBytesPerAttempt: limits.sseMaxResponseBytesPerAttempt,
          sseMaxEventsPerAttempt: limits.sseMaxEventsPerAttempt,
        },
        timeouts: {
          streamConnectHeadersTimeoutMs: timeouts.streamConnectHeadersTimeoutMs, streamIdleTimeoutMs: timeouts.streamIdleTimeoutMs,
          streamAttemptTimeoutMs: timeouts.streamAttemptTimeoutMs, filesMetadataTimeoutMs: timeouts.filesMetadataTimeoutMs,
          filesDownloadTimeoutMs: timeouts.filesDownloadTimeoutMs, reconciliationAttemptTimeoutMs: timeouts.reconciliationAttemptTimeoutMs,
        },
        recovery: {
          automatedRemoteRecoveryHorizonMs: recovery.automatedRemoteRecoveryHorizonMs, filesMinRemainingLifetimeMs: recovery.filesMinRemainingLifetimeMs,
          maxStreamRecoveryAttemptsPerReconciliation: recovery.maxStreamRecoveryAttemptsPerReconciliation,
          maxFilesDownloadAttemptsPerReconciliation: recovery.maxFilesDownloadAttemptsPerReconciliation,
          streamRecoveryFirstRetryDelayMs: recovery.streamRecoveryFirstRetryDelayMs,
          streamRecoverySecondRetryDelayMs: recovery.streamRecoverySecondRetryDelayMs,
          filesDownloadRetryDelayMs: recovery.filesDownloadRetryDelayMs,
        },
      });
      for (const section of [policy, policy.limits, policy.timeouts, policy.recovery]) expect(Object.isFrozen(section)).toBe(true);
      expect(JSON.stringify(policy)).not.toMatch(/cost|createTimeoutMs|maxReferenceImageBytes|newSubmissionsEnabled/);
    });

    it("defaults to native clocks and leaves fetch to the protected transports' native default", () => {
      const dependencies = createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY);
      expect(dependencies.nowMs).toBe(Date.now);
      expect(typeof dependencies.monotonicNowMs!()).toBe("number");
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it.each([["empty", ""], ["blank", "   "], ["inner whitespace", "bad key"], ["newline", "bad\nkey"], ["non-ASCII", "kéy"], ["non-string", 7]] as const)(
      "fails closed on a %s API key without echoing it and without constructing anything",
      (_label, apiKey) => {
        const fetchImpl = googleFetch();
        let thrown: unknown;
        try { createGoogleGenAiSingleShotSecureProductionRecovery(apiKey as string, { fetchImpl }); } catch (error) { thrown = error; }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe("Google GenAI secure production recovery requires a non-empty visible-ASCII API key.");
        expect(Object.hasOwn(thrown as object, "cause")).toBe(false);
        if (typeof apiKey === "string" && apiKey.trim()) expect(String(thrown) + (thrown as Error).stack).not.toContain(apiKey.trim());
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );

    it.each([["fetchImpl", { fetchImpl: "fetch" }], ["nowMs", { nowMs: 5 }], ["monotonicNowMs", { monotonicNowMs: {} }], ["options object", null]] as const)(
      "fails closed on a malformed %s option",
      (_label, options) => {
        expect(() => createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, options as never))
          .toThrow("Google GenAI secure production recovery options must provide functions for fetchImpl, nowMs and monotonicNowMs when present.");
      },
    );
  });

  describe("end-to-end secure recovery through the real reconciler (no network)", () => {
    it("replays exactly once, shares one observation and one context, streams the output, then persists and reverifies", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mediaRoot = await submittedShot();
      const fetchImpl = googleFetch();
      const factory = createGoogleGenAiSingleShotSecureProductionRecovery(` ${SYNTHETIC_KEY} `, { fetchImpl, ...fixedClocks() });
      // Spies forward to the REAL factory closures; they only record arguments/results.
      const replayInteraction = vi.fn(factory.replayInteraction);
      const prepareUri = vi.fn(factory.prepareUri);
      const downloadUri = vi.fn(factory.downloadUri);
      const result = await reconcile(mediaRoot, { ...factory, replayInteraction, prepareUri, downloadUri });

      expect(result).toMatchObject({ lifecycleState: "COMPLETED", reconciliationMode: "RECOVERED_SUBMISSION", remoteStatus: "completed", providerExecutionId: INTERACTION_ID });
      expect(vi.getTimerCount()).toBe(0);

      // B: exactly one replay, one metadata, one download — every request a GET to the fixed Google origin.
      expect(replayInteraction).toHaveBeenCalledTimes(1);
      expect(callsTo(fetchImpl, REPLAY_URL)).toBe(1);
      expect(callsTo(fetchImpl, METADATA_URL)).toBe(1);
      expect(callsTo(fetchImpl, OUTPUT_URI)).toBe(1);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      for (const [url, init] of fetchImpl.mock.calls) {
        expect(url.startsWith(`${ORIGIN}/v1beta/`)).toBe(true);
        expect(init.method).toBe("GET");
        expect(init.redirect).toBe("manual");
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(SYNTHETIC_KEY);
        expect(url).not.toContain(SYNTHETIC_KEY);
      }

      // C: the SAME observation object reaches recovery and the materializer output adapter.
      const observation: GoogleGenAiInteractionReplayResult = await replayInteraction.mock.results[0]!.value;
      const recoverCalls = vi.mocked(recoverGoogleGenAiSingleShot).mock.calls;
      expect(recoverCalls).toHaveLength(1);
      expect(await recoverCalls[0]![1].getInteraction(INTERACTION_ID)).toBe(observation);
      const materializeCalls = vi.mocked(materializeGoogleGenAiSingleShotOutput).mock.calls;
      expect(materializeCalls).toHaveLength(1);
      const [materializeInput, materializeDependencies] = materializeCalls[0]!;
      expect(await materializeDependencies.retrieveOutput(INTERACTION_ID)).toBe(observation);
      expect(replayInteraction).toHaveBeenCalledTimes(1);

      // D: ONE shared reconciliation context reaches replay, metadata, download and the materializer —
      // verified both at the dependency seam and at the protected transport boundary itself.
      const context: GoogleGenAiRecoveryContext = replayInteraction.mock.calls[0]![1];
      expect(prepareUri.mock.calls[0]![1]).toBe(context);
      expect(downloadUri.mock.calls[0]![2]).toBe(context);
      expect(materializeDependencies.context).toBe(context);
      expect(vi.mocked(replayGoogleGenAiInteraction).mock.calls).toHaveLength(1);
      expect(vi.mocked(getGoogleGenAiFilesMetadata).mock.calls).toHaveLength(1);
      expect(vi.mocked(downloadGoogleGenAiFile).mock.calls).toHaveLength(1);
      expect(vi.mocked(replayGoogleGenAiInteraction).mock.calls[0]![0]).toBe(INTERACTION_ID);
      expect(vi.mocked(replayGoogleGenAiInteraction).mock.calls[0]![1]).toBe(context);
      expect(vi.mocked(getGoogleGenAiFilesMetadata).mock.calls[0]![1]).toBe(context);
      expect(vi.mocked(downloadGoogleGenAiFile).mock.calls[0]![2]).toBe(context);
      // The factory binds the same policy object and its clocks into every transport.
      for (const dependencies of [
        vi.mocked(replayGoogleGenAiInteraction).mock.calls[0]![2],
        vi.mocked(getGoogleGenAiFilesMetadata).mock.calls[0]![2],
        vi.mocked(downloadGoogleGenAiFile).mock.calls[0]![3],
      ]) {
        expect(dependencies.policy).toBe(factory.policy);
        expect(dependencies.fetchImpl).toBe(fetchImpl);
        expect(dependencies.apiKey).toBe(SYNTHETIC_KEY);
      }
      expect(vi.mocked(getGoogleGenAiFilesMetadata).mock.calls[0]![2].nowMs).toBe(factory.nowMs);
      expect(vi.mocked(downloadGoogleGenAiFile).mock.calls[0]![3].nowMs).toBe(factory.nowMs);
      expect(vi.mocked(downloadGoogleGenAiFile).mock.calls[0]![3].monotonicNowMs).toBe(factory.monotonicNowMs);

      // E: the factory's secure path drives the streaming materializer (prepared metadata + sink), no inline/whole-buffer path.
      expect(materializeDependencies.prepareUri).toBe(prepareUri);
      expect(materializeDependencies.downloadUri).toBe(downloadUri);
      expect(materializeDependencies.policy).toBe(factory.policy);
      expect(materializeInput.maxOutputBytes).toBe(GOOGLE_GENAI_ACTIVATION_LIMITS.limits.maxOutputBytes);
      expect(typeof downloadUri.mock.calls[0]![1].writeChunk).toBe("function");
      expect(observation.outputVideo).toEqual({ type: "video", mime_type: "video/mp4", uri: OUTPUT_URI });
      expect((await readFile(outputPath(mediaRoot))).equals(OUTPUT_BYTES)).toBe(true);
      expect(result.generationRecord.outputs[0]).toMatchObject({ sha256: sha256Hex(OUTPUT_BYTES), bytes: OUTPUT_BYTES.byteLength });

      // F: materialization precedes persistence, which precedes the durable reverification.
      const materializeOrder = vi.mocked(materializeGoogleGenAiSingleShotOutput).mock.invocationCallOrder[0]!;
      const persistOrder = vi.mocked(persistGoogleGenAiSingleShotCompletion).mock.invocationCallOrder;
      const verifyOrder = vi.mocked(verifyGoogleGenAiDurableCompletion).mock.invocationCallOrder;
      expect(persistOrder).toHaveLength(1);
      expect(verifyOrder).toHaveLength(1);
      expect(materializeOrder).toBeLessThan(persistOrder[0]!);
      expect(persistOrder[0]!).toBeLessThan(verifyOrder[0]!);
      expect(await exists(createExecutionCompletionPath(mediaRoot, "EP92", "S01"))).toBe(true);
      // Completion timestamp clock stays with persistence, not the factory clock.
      expect(Object.hasOwn(factory, "now")).toBe(false);
      // G/H: no legacy lookup, SDK client or submission (asserted for every test in afterEach).
    });

    it("works with the factory object passed unchanged (no test wrappers) and sends the key only to Google", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mediaRoot = await submittedShot();
      const fetchImpl = googleFetch();
      const result = await reconcile(mediaRoot, createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl, ...fixedClocks() }));
      expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
      expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([REPLAY_URL, METADATA_URL, OUTPUT_URI]);
      // Unwrapped factory: the one reconciler context arrives unchanged at every protected transport.
      const context = vi.mocked(replayGoogleGenAiInteraction).mock.calls[0]![1];
      expect(vi.mocked(replayGoogleGenAiInteraction)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(getGoogleGenAiFilesMetadata).mock.calls.map((call) => call[1])).toEqual([context]);
      expect(vi.mocked(getGoogleGenAiFilesMetadata).mock.calls[0]![1]).toBe(context);
      expect(vi.mocked(downloadGoogleGenAiFile).mock.calls[0]![2]).toBe(context);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("stops after one replay of a pending interaction: no metadata, download, materialization or completion", async () => {
      const mediaRoot = await submittedShot();
      const fetchImpl = googleFetch({ replay: () => sseResponse(created("in_progress")) });
      await expect(reconcile(mediaRoot, createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl, ...fixedClocks() })))
        .rejects.toThrow(/still pending/);
      expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([REPLAY_URL]);
      expect(vi.mocked(materializeGoogleGenAiSingleShotOutput)).not.toHaveBeenCalled();
      expect(await exists(createExecutionCompletionPath(mediaRoot, "EP92", "S01"))).toBe(false);
    });

    it("shares the materializer's two-attempt ceiling and 10000-ms delay without multiplying retries", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const mediaRoot = await submittedShot();
      let downloads = 0;
      const fetchImpl = googleFetch({ download: () => (++downloads === 1 ? new Response(null, { status: 503 }) : downloadResponse()) });
      const outcome = reconcile(mediaRoot, createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl, ...fixedClocks() }));
      // Parent deadline timer + the materializer's retry delay.
      await waitUntil(() => vi.getTimerCount() === 2);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(callsTo(fetchImpl, METADATA_URL)).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect((await outcome).reconciliationMode).toBe("RECOVERED_SUBMISSION");
      expect(callsTo(fetchImpl, REPLAY_URL)).toBe(1);
      expect(callsTo(fetchImpl, METADATA_URL)).toBe(2);
      expect(callsTo(fetchImpl, OUTPUT_URI)).toBe(2);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("never sends the credential to a non-Google URI or follows a redirect", async () => {
      const evil = "https://evil.example/v1beta/files/x:download?alt=media";
      const evilRoot = await submittedShot();
      const evilFetch = googleFetch({ replay: () => sseResponse(completedSse(evil)) });
      const evilError = await settle(reconcile(evilRoot, createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl: evilFetch, ...fixedClocks() })));
      expect(evilError).toBeInstanceOf(Error);
      expect(evilFetch.mock.calls.map(([url]) => url)).toEqual([REPLAY_URL]);

      const redirectRoot = await submittedShot();
      const redirectFetch = googleFetch({ download: () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }) });
      const redirectError = await settle(reconcile(redirectRoot, createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl: redirectFetch, ...fixedClocks() })));
      expect(redirectError).toMatchObject({ code: "DOWNLOAD_REDIRECT_REJECTED" });
      expect(redirectFetch.mock.calls.every(([url]) => url.startsWith(`${ORIGIN}/`))).toBe(true);
      expect(callsTo(redirectFetch, OUTPUT_URI)).toBe(1);
      for (const error of [evilError, redirectError]) {
        expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(SYNTHETIC_KEY);
      }
      expect(await exists(outputPath(redirectRoot))).toBe(false);
      expect((await readdir(join(redirectRoot, "generated-video", "EP92", "S01"))).filter((entry) => entry.endsWith(".part"))).toEqual([]);
    });

    it("surfaces sanitized typed transport failures without the credential", async () => {
      const mediaRoot = await submittedShot();
      const fetchImpl = googleFetch({ metadata: () => new Response(null, { status: 404 }) });
      const error = await settle(reconcile(mediaRoot, createGoogleGenAiSingleShotSecureProductionRecovery(SYNTHETIC_KEY, { fetchImpl, ...fixedClocks() })));
      expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
      expect(error).toMatchObject({ code: "FILES_METADATA_HTTP_FAILED", httpStatus: 404, retryable: false });
      expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(SYNTHETIC_KEY);
      expect(callsTo(fetchImpl, OUTPUT_URI)).toBe(0);
    });
  });
});
