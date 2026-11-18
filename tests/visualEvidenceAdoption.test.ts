import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../src/schemas/productionRules.schema.js";
import { buildBoundEpisodePreflight } from "../src/execution/buildBoundEpisodePreflight.js";
import { bindingDigest, rawSha256 } from "../src/execution/episodeInputBinding.js";
import type { BoundEpisodePreflight, RuntimeIdentity } from "../src/execution/boundEpisodeProduction.types.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createExecutionCompletion } from "../src/execution/createExecutionCompletion.js";
import { buildRunwayGenerationRecord } from "../src/runway/audit/buildRunwayGenerationRecord.js";
import { writeRunwayGenerationRecord } from "../src/runway/audit/writeRunwayGenerationRecord.js";
import { createRunwayVideoOutputPath } from "../src/runway/output/runwayOutputPath.js";
import { buildControlledEpisodeAutomationPlan } from "../src/execution/buildControlledEpisodeAutomationPlan.js";
import { acquireEpisodeExecutionGuard, createCheckedEpisodeExecutionContext, readCheckedEpisodeJson,
  recheckEpisodeExecutionBindings, releaseEpisodeExecutionGuard, type CheckedEpisodeExecutionData } from "../src/execution/episodeExecutionGuard.js";
import { VisualEvidenceAdoptionSchema, serializeVisualEvidenceAdoption, calculateVisualEvidenceAdoptionSha256,
  type VisualEvidenceAdoption } from "../src/execution/visualEvidenceAdoption.schema.js";
import { createVisualEvidenceAdoptionPath } from "../src/execution/visualEvidenceAdoptionPath.js";
import { createVisualEvidenceAdoption, VisualEvidenceAdoptionExistsError } from "../src/execution/createVisualEvidenceAdoption.js";
import { readVisualEvidenceAdoptionEvidence, parseVisualEvidenceAdoptionBytes } from "../src/execution/readVisualEvidenceAdoption.js";
import { adoptCompletedVisualEvidence, VisualEvidenceAdoptionError,
  type AdoptCompletedVisualEvidenceDependencies } from "../src/execution/adoptCompletedVisualEvidence.js";
import { readEpisodeRuntimeIdentity } from "../src/execution/episodeInputBinding.js";

// Durable COMPLETED visual-evidence adoption. Synthetic temporary roots only;
// provider SDKs are constructor tripwires and the network is rejected.
// Nothing here reserves, submits, reconciles or generates.
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => { throw new Error("The Google SDK must never be constructed by evidence adoption."); }),
}));
vi.mock("@runwayml/sdk", () => {
  const RunwayML = vi.fn(() => { throw new Error("The Runway SDK must never be constructed by evidence adoption."); });
  return { default: RunwayML, RunwayML };
});

const roots: string[] = [];
let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
});
afterEach(async () => {
  expect(network).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const ADOPTED_AT = "2026-11-18T09:00:00.000Z";
const ADOPTION_ID = "6f1c1f0e-8d2a-4c7e-9b1a-2f3d4e5f6a7b";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==", "base64");

type Kind = "EP90" | "MULTI";

// EP90: the real one-shot EP90 manifest (dialogue [], nativeAudio false).
// MULTI: an EP02-derived two-shot episode, S01 then S02.
async function fixture(kind: Kind = "EP90") {
  const root = await mkdtemp(join(process.cwd(), ".vea-")); roots.push(root);
  const repositoryRoot = join(root, "repo"); const mediaRoot = join(root, "media");
  const episodeId = kind === "EP90" ? "EP90" : "EP02";
  await mkdir(join(repositoryRoot, "episodes", episodeId), { recursive: true });
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  await mkdir(join(mediaRoot, "references"), { recursive: true });
  const episode = EpisodeManifestSchema.parse(JSON.parse(await readFile(`episodes/${episodeId}/episode.json`, "utf8")));
  let assetId: string;
  if (kind === "EP90") {
    expect(episode.scenes).toHaveLength(1);
    expect(episode.scenes[0]!.shots).toHaveLength(1);
    expect(episode.scenes[0]!.shots[0]!.dialogue).toEqual([]);
    expect(episode.scenes[0]!.shots[0]!.generation.nativeAudio).toBe(false);
    assetId = episode.scenes[0]!.shots[0]!.references.assetIds[0]!;
  } else {
    assetId = "ref";
    episode.status = "IN_PRODUCTION"; episode.approvals.script = "APPROVED";
    episode.approvals.storyboard = "APPROVED"; episode.approvals.references = "APPROVED";
    const template = episode.scenes[0]!.shots[0]!;
    const shot = (id: string, order: number) => ({ ...structuredClone(template), id, order,
      references: { required: true, assetIds: [assetId], approvalStatus: "APPROVED" as const },
      generation: { provider: "RUNWAY" as const, nativeAudio: false, status: "APPROVED_FOR_GENERATION" as const } });
    episode.scenes = [{ ...episode.scenes[0]!, id: "SC01", shots: [shot("S01", 1), shot("S02", 2)] }];
  }
  for (const name of ["characters.json", "provider-routing-policy.json", "runway-policy.json", "veo-policy.json",
    "google-genai-policy.json", "google-genai-activation-policy.json"]) {
    await writeFile(join(repositoryRoot, "config", name), await readFile(join("config", name)));
  }
  const rules = ProductionRulesSchema.parse(JSON.parse(await readFile("config/production-rules.json", "utf8")));
  rules.storage.requireExternalMediaRoot = false;
  await writeFile(join(repositoryRoot, "config/production-rules.json"), JSON.stringify(rules));
  await writeFile(join(mediaRoot, "references/ref.png"), PNG);
  await writeFile(join(mediaRoot, "references/visual-reference-asset-registry.json"), JSON.stringify({ schemaVersion: "1.0",
    assets: [{ assetId, mediaRootRelativePath: "references/ref.png", bytes: PNG.length, sha256: rawSha256(PNG), contentType: "image/png" }] }));
  await writeFile(join(repositoryRoot, "runtime.txt"), "reviewed-runtime");
  const runtimeIdentity: RuntimeIdentity = { reviewedRevision: "a".repeat(40), repositoryRoot, mediaRoot, physicalMediaRoot: mediaRoot,
    executableInputs: [{ role: "RUNTIME", canonicalPath: join(repositoryRoot, "runtime.txt"), exists: true,
      rawSha256: rawSha256("reviewed-runtime"), bytes: 16 }], ffprobe: null };
  const manifest = join(repositoryRoot, "episodes", episodeId, "episode.json");
  const save = () => writeFile(manifest, JSON.stringify(episode)); await save();
  const sceneId = episode.scenes[0]!.id;
  return { kind, episode, episodeId, sceneId, save, manifest, repositoryRoot, mediaRoot, runtimeIdentity,
    input: { episodeId, mediaRoot, runtimeIdentity } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function accepted(f: Fixture, shotId: string) {
  const reservation = await createExecutionReservation(f.mediaRoot, { episodeId: f.episodeId, shotId, provider: "RUNWAY" });
  const request = { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4", promptText: "Synthetic adoption evidence.",
    sourceImagePath: join(f.mediaRoot, "references/ref.png"), assetStrategy: "DATA_URI" } as const;
  const providerExecutionId = `synthetic-private-job-${shotId}`;
  await createExecutionSubmission(f.mediaRoot, { reservationId: reservation.record.reservationId, episodeId: f.episodeId, shotId,
    provider: "RUNWAY", providerExecutionId, providerEstimatedCredits: 60, recoveryMetadata: { request, locallyExpectedCredits: 60 } });
  return { reservation, request, providerExecutionId };
}
async function complete(f: Fixture, shotId: string) {
  const job = await accepted(f, shotId);
  const path = createRunwayVideoOutputPath(f.mediaRoot, f.episodeId, shotId, job.providerExecutionId, 1);
  await mkdir(dirname(path), { recursive: true }); const bytes = Buffer.from(`synthetic-local-video-evidence-${shotId}`); await writeFile(path, bytes);
  const record = buildRunwayGenerationRecord({ recordedAt: "2026-10-28T12:00:00.000Z", episodeId: f.episodeId, shotId,
    taskId: job.providerExecutionId, request: job.request, credits: { locallyExpected: 60, providerEstimated: 60, providerFinal: 60 },
    outputs: [{ outputIndex: 1, destinationPath: path, bytes: bytes.length, sha256: rawSha256(bytes), contentType: "video/mp4" }] });
  const recordPath = await writeRunwayGenerationRecord(f.mediaRoot, record);
  await createExecutionCompletion(f.mediaRoot, { reservationId: job.reservation.record.reservationId, episodeId: f.episodeId, shotId,
    provider: "RUNWAY", providerExecutionId: job.providerExecutionId, generationRecordPath: recordPath });
  return path;
}

// The operator's reviewed values, read from a fresh preflight.
async function reviewed(f: Fixture, shotId = "S01") {
  const report = await buildBoundEpisodePreflight(f.input);
  const manifest = report.binding?.fileBindings.find(file => file.role === "MANIFEST")?.rawSha256;
  const observation = report.observations.find(row => row.target.shotId === shotId);
  if (!manifest || !observation) throw new Error("Fixture needs a manifest and an observation.");
  return { report, manifestRawSha256: manifest, observationSha256: bindingDigest(observation), target: observation.target };
}

function dependencies(f: Fixture, overrides: Partial<AdoptCompletedVisualEvidenceDependencies> = {}): AdoptCompletedVisualEvidenceDependencies {
  return {
    readRuntimeIdentity: vi.fn(async () => f.runtimeIdentity) as unknown as typeof readEpisodeRuntimeIdentity,
    buildPreflight: vi.fn(buildBoundEpisodePreflight),
    createAdoption: vi.fn(createVisualEvidenceAdoption),
    readAdoption: vi.fn(readVisualEvidenceAdoptionEvidence),
    now: () => ADOPTED_AT,
    createAdoptionId: () => ADOPTION_ID,
    ...overrides,
  };
}
function operatorInput(f: Fixture, values: { manifestRawSha256: string; observationSha256: string }, shotId = "S01") {
  return { episodeId: f.episodeId, shotId, expectedManifestRawSha256: values.manifestRawSha256,
    expectedObservationSha256: values.observationSha256, repositoryRoot: f.repositoryRoot, mediaRoot: f.mediaRoot };
}
const adoptionDirectory = (f: Fixture, shotId = "S01") => join(f.mediaRoot, "generated-video", f.episodeId, shotId, "evidence-adoptions");
async function listing(path: string): Promise<string[]> {
  try { return (await readdir(path)).sort(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error;
  }
}
const row = (report: BoundEpisodePreflight, shotId = "S01") => report.shots.find(shot => shot.shotId === shotId)!;
const binding = (report: BoundEpisodePreflight, shotId = "S01") =>
  report.binding?.fileBindings.filter(file => file.role === `EVIDENCE_ADOPTION:${shotId}`) ?? [];

const M = "a".repeat(64); const O = "b".repeat(64);
const TARGET = { episodeId: "EP90", sceneId: "SC01", shotId: "S01", order: 1 };
const RECORD: VisualEvidenceAdoption = { schemaVersion: "1.0", recordType: "VISUAL_EVIDENCE_ADOPTION", adoptionId: ADOPTION_ID,
  adoptedAt: ADOPTED_AT, status: "ADOPTED", target: TARGET, manifestRawSha256: M, observationSha256: O,
  reviewScope: "VISUAL_OUTPUT", authorizationSource: "HUMAN_OPERATOR", activationEffect: "NONE_EVIDENCE_ONLY" };

describe("A. strict receipt schema", () => {
  it("accepts exactly the locked receipt", () => {
    expect(VisualEvidenceAdoptionSchema.parse(RECORD)).toEqual(RECORD);
    expect(Object.keys(VisualEvidenceAdoptionSchema.shape).sort()).toEqual(["activationEffect", "adoptedAt", "adoptionId",
      "authorizationSource", "manifestRawSha256", "observationSha256", "recordType", "reviewScope", "schemaVersion", "status", "target"]);
  });
  it.each([
    ["an extra top-level field", { ...RECORD, notes: "looks good" }],
    ["a provider execution identity", { ...RECORD, providerExecutionId: "task-1" }],
    ["a provider credential", { ...RECORD, apiKey: "secret" }],
    ["a task URL", { ...RECORD, taskUrl: "https://example.invalid/task" }],
    ["an extra target field", { ...RECORD, target: { ...TARGET, provider: "RUNWAY" } }],
    ["a missing target field", { ...RECORD, target: { episodeId: "EP90", sceneId: "SC01", shotId: "S01" } }],
    ["a non-canonical scene id", { ...RECORD, target: { ...TARGET, sceneId: "S1" } }],
    ["a non-canonical shot id", { ...RECORD, target: { ...TARGET, shotId: "SHOT1" } }],
    ["a non-canonical episode id", { ...RECORD, target: { ...TARGET, episodeId: "E90" } }],
    ["a zero order", { ...RECORD, target: { ...TARGET, order: 0 } }],
    ["an uppercase manifest digest", { ...RECORD, manifestRawSha256: "A".repeat(64) }],
    ["a short observation digest", { ...RECORD, observationSha256: "b".repeat(63) }],
    ["another schema version", { ...RECORD, schemaVersion: "2.0" }],
    ["another record type", { ...RECORD, recordType: "VISUAL_ATTEMPT_QC" }],
    ["another status", { ...RECORD, status: "AUTHORIZED" }],
    ["another review scope", { ...RECORD, reviewScope: "AUDIO_OUTPUT" }],
    ["another authorization source", { ...RECORD, authorizationSource: "AUTOMATION" }],
    ["an activation effect", { ...RECORD, activationEffect: "GENERATION_AUTHORIZED" }],
    ["a non-UUID adoption id", { ...RECORD, adoptionId: "adoption-1" }],
    ["a non-ISO timestamp", { ...RECORD, adoptedAt: "yesterday" }],
  ])("rejects %s", (_label, value) => {
    expect(VisualEvidenceAdoptionSchema.safeParse(value).success).toBe(false);
  });
});

describe("B. canonical adoption path", () => {
  const MEDIA = resolve("/busybookie-media");
  it("is deterministic under the shot's generated-video root", () => {
    const path = createVisualEvidenceAdoptionPath(MEDIA, "EP90", "S01", M, O);
    expect(path).toBe(resolve(MEDIA, "generated-video", "EP90", "S01", "evidence-adoptions", `${M}_${O}.visual-evidence-adoption.json`));
    expect(createVisualEvidenceAdoptionPath(MEDIA, "EP90", "S01", M, O)).toBe(path);
    expect(createVisualEvidenceAdoptionPath(MEDIA, "EP90", "S01", M, "c".repeat(64))).not.toBe(path);
  });
  it.each([
    ["a relative media root", "media", "EP90", "S01", M, O],
    ["an empty media root", "", "EP90", "S01", M, O],
    ["a traversal episode id", MEDIA, "../EP90", "S01", M, O],
    ["a bad episode id", MEDIA, "EP9", "S01", M, O],
    ["a traversal shot id", MEDIA, "EP90", "S01/../S02", M, O],
    ["a bad shot id", MEDIA, "EP90", "s01", M, O],
    ["an uppercase manifest digest", MEDIA, "EP90", "S01", "A".repeat(64), O],
    ["a traversal observation digest", MEDIA, "EP90", "S01", M, `../${"b".repeat(61)}`],
  ])("rejects %s", (_label, media, episode, shot, manifest, observation) => {
    expect(() => createVisualEvidenceAdoptionPath(media, episode, shot, manifest, observation)).toThrow();
  });
});

describe("C. create-once writer and strict reader", () => {
  async function media() {
    const root = await mkdtemp(join(process.cwd(), ".vea-")); roots.push(root);
    return join(root, "media");
  }
  const identity = { episodeId: "EP90", shotId: "S01", manifestRawSha256: M, observationSha256: O };
  const create = (mediaRoot: string) => createVisualEvidenceAdoption(mediaRoot,
    { target: TARGET, manifestRawSha256: M, observationSha256: O }, { now: () => ADOPTED_AT, createAdoptionId: () => ADOPTION_ID });

  it("publishes exactly the canonical bytes once, cleans its temporary file and reads back strictly", async () => {
    const mediaRoot = await media();
    const result = await create(mediaRoot);
    const path = createVisualEvidenceAdoptionPath(mediaRoot, "EP90", "S01", M, O);
    const bytes = await readFile(path, "utf8");
    expect(bytes).toBe(serializeVisualEvidenceAdoption(RECORD));
    expect(result).toEqual({ record: RECORD, adoptionPath: path, adoptionSha256: calculateVisualEvidenceAdoptionSha256(bytes) });
    expect(await listing(dirname(path))).toEqual([`${M}_${O}.visual-evidence-adoption.json`]);
    expect(await readVisualEvidenceAdoptionEvidence(mediaRoot, identity)).toEqual(result);
  });

  it("refuses a repeated creation and never replaces the existing receipt", async () => {
    const mediaRoot = await media();
    const first = await create(mediaRoot);
    const before = await readFile(first.adoptionPath);
    await expect(createVisualEvidenceAdoption(mediaRoot, { target: TARGET, manifestRawSha256: M, observationSha256: O },
      { now: () => "2026-11-19T00:00:00.000Z", createAdoptionId: () => randomUUID() })).rejects.toBeInstanceOf(VisualEvidenceAdoptionExistsError);
    expect(await readFile(first.adoptionPath)).toEqual(before);
    expect(await listing(dirname(first.adoptionPath))).toEqual([`${M}_${O}.visual-evidence-adoption.json`]);
  });

  it("rejects invalid writer input before any write", async () => {
    const mediaRoot = await media();
    await expect(createVisualEvidenceAdoption(mediaRoot, { target: TARGET, manifestRawSha256: M, observationSha256: O, extra: 1 } as never))
      .rejects.toThrow();
    await expect(createVisualEvidenceAdoption(mediaRoot, { target: { ...TARGET, sceneId: "SCENE" }, manifestRawSha256: M, observationSha256: O }))
      .rejects.toThrow();
    expect(await listing(join(mediaRoot, "generated-video"))).toEqual([]);
  });

  it("an absent receipt reads as null", async () => {
    expect(await readVisualEvidenceAdoptionEvidence(await media(), identity)).toBeNull();
  });

  it.each([
    ["compact (non-canonical) JSON", (record: VisualEvidenceAdoption) => JSON.stringify(record)],
    ["a missing trailing newline", (record: VisualEvidenceAdoption) => serializeVisualEvidenceAdoption(record).trimEnd()],
    ["malformed JSON", () => "{ not json\n"],
    ["an extra field", (record: VisualEvidenceAdoption) => `${JSON.stringify({ ...record, notes: "x" }, null, 2)}\n`],
    ["a receipt for another observation", (record: VisualEvidenceAdoption) => serializeVisualEvidenceAdoption({ ...record, observationSha256: "c".repeat(64) })],
    ["a receipt for another shot", (record: VisualEvidenceAdoption) => serializeVisualEvidenceAdoption({ ...record, target: { ...record.target, shotId: "S02" } })],
  ])("the strict reader rejects %s at the canonical path", async (_label, encode) => {
    const mediaRoot = await media();
    const path = createVisualEvidenceAdoptionPath(mediaRoot, "EP90", "S01", M, O);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, encode(RECORD));
    await expect(readVisualEvidenceAdoptionEvidence(mediaRoot, identity)).rejects.toThrow();
    expect(() => parseVisualEvidenceAdoptionBytes(Buffer.from(encode(RECORD)), identity)).toThrow();
  });

  it("rejects invalid UTF-8", () => {
    expect(() => parseVisualEvidenceAdoptionBytes(Buffer.from([0xff, 0xfe, 0x7b]), identity)).toThrow(/UTF-8/);
  });
});

describe("D. adoption service: EP90-style one-shot COMPLETED episode", () => {
  it("adopts exactly the VERIFIED COMPLETED output and the fresh preflight discovers it automatically", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const before = row(values.report);
    expect(before).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED", durableProvider: "RUNWAY",
      intentAlignment: "UNATTESTED_EXISTING_EVIDENCE" });
    expect(values.report).toMatchObject({ intentAlignment: "REVIEW_REQUIRED", completion: "INCOMPLETE", nextActionCandidate: null });
    // An absent receipt leaves the input binding unchanged.
    const absent = createVisualEvidenceAdoptionPath(f.mediaRoot, "EP90", "S01", values.manifestRawSha256, values.observationSha256);
    expect(binding(values.report)).toEqual([]);

    const deps = dependencies(f);
    const result = await adoptCompletedVisualEvidence(operatorInput(f, values), deps);

    expect(result.target).toEqual({ episodeId: "EP90", sceneId: f.sceneId, shotId: "S01", order: 1 });
    expect(result.receipt).toEqual({ ...RECORD, target: result.target, manifestRawSha256: values.manifestRawSha256,
      observationSha256: values.observationSha256 });
    expect(result.adoptionPath).toBe(absent);
    const bytes = await readFile(result.adoptionPath);
    expect(result.adoptionSha256).toBe(rawSha256(bytes));
    expect(bytes.toString("utf8")).not.toMatch(/synthetic-private-job|providerExecutionId|apiKey|https?:/);

    const after = result.postAdoptionPreflight;
    expect(row(after)).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED", intentAlignment: "REVIEWED" });
    expect(after).toMatchObject({ intentAlignment: "REVIEWED", completion: "VISUAL_PRODUCTION_COMPLETE", nextActionCandidate: null,
      generationMayBeAuthorized: false, recoveryMayBeAuthorized: false });
    expect(after.inventory).toMatchObject({ complete: true, fatalReasons: [] });
    // The receipt's exact bytes are part of the input binding.
    expect(binding(after)).toEqual([{ role: "EVIDENCE_ADOPTION:S01", canonicalPath: result.adoptionPath, exists: true,
      rawSha256: result.adoptionSha256, bytes: bytes.length }]);
    expect(after.observationsSha256).toBe(values.report.observationsSha256);
    expect(after.bindingSha256).not.toBe(values.report.bindingSha256);

    // Exactly two fresh preflights, neither given a transient adoption.
    expect(deps.buildPreflight).toHaveBeenCalledTimes(2);
    for (const [call] of vi.mocked(deps.buildPreflight).mock.calls) {
      expect(call).toEqual({ episodeId: "EP90", mediaRoot: f.mediaRoot, runtimeIdentity: f.runtimeIdentity });
    }
    expect(deps.readRuntimeIdentity).toHaveBeenCalledWith(f.repositoryRoot, f.mediaRoot, undefined);
    expect(deps.createAdoption).toHaveBeenCalledTimes(1);

    // An independent later preflight still sees the review.
    const later = await buildBoundEpisodePreflight(f.input);
    expect(later.completion).toBe("VISUAL_PRODUCTION_COMPLETE");
    expect(row(later).intentAlignment).toBe("REVIEWED");
  });

  it("refuses a second adoption of already reviewed evidence and leaves the receipt untouched", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const first = await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    const bytes = await readFile(first.adoptionPath);
    const deps = dependencies(f, { createAdoptionId: () => randomUUID() });
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values), deps))
      .rejects.toMatchObject({ code: "EVIDENCE_NOT_UNATTESTED", receiptWritten: false });
    expect(deps.createAdoption).not.toHaveBeenCalled();
    expect(await readFile(first.adoptionPath)).toEqual(bytes);
    expect(await listing(adoptionDirectory(f))).toEqual([`${values.manifestRawSha256}_${values.observationSha256}.visual-evidence-adoption.json`]);
  });

  it.each([
    ["sceneId", { sceneId: "SC01" }],
    ["order", { order: 1 }],
    ["target", { target: TARGET }],
    ["provider", { provider: "RUNWAY" }],
    ["evidenceAdoptions", { evidenceAdoptions: [] }],
  ])("rejects caller %s authority before any read", async (_label, extra) => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence({ ...operatorInput(f, values), ...extra } as never, deps)).rejects.toThrow();
    expect(deps.readRuntimeIdentity).not.toHaveBeenCalled();
    expect(deps.buildPreflight).not.toHaveBeenCalled();
    expect(await listing(adoptionDirectory(f))).toEqual([]);
  });

  it("refuses a mismatched expected manifest with no receipt", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, { ...values, manifestRawSha256: "c".repeat(64) }), deps))
      .rejects.toMatchObject({ name: "VisualEvidenceAdoptionError", code: "MANIFEST_MISMATCH", receiptWritten: false });
    expect(deps.createAdoption).not.toHaveBeenCalled();
    expect(await listing(adoptionDirectory(f))).toEqual([]);
  });

  it("refuses a mismatched expected observation with no receipt", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, { ...values, observationSha256: "d".repeat(64) }), deps))
      .rejects.toMatchObject({ code: "OBSERVATION_MISMATCH", receiptWritten: false });
    expect(deps.createAdoption).not.toHaveBeenCalled();
    expect(await listing(adoptionDirectory(f))).toEqual([]);
  });

  it("refuses a SUBMITTED (non-completed) shot with no receipt", async () => {
    const f = await fixture("EP90"); await accepted(f, "S01");
    const values = await reviewed(f);
    expect(row(values.report).lifecycle.lifecycle).toBe("SUBMITTED");
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values), deps)).rejects.toMatchObject({ code: "SHOT_NOT_COMPLETED" });
    expect(deps.createAdoption).not.toHaveBeenCalled();
    expect(await listing(adoptionDirectory(f))).toEqual([]);
  });

  it("refuses an unstarted (NOTHING) shot with no receipt", async () => {
    const f = await fixture("EP90");
    const values = await reviewed(f);
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values), deps)).rejects.toMatchObject({ code: "SHOT_NOT_COMPLETED" });
    expect(await listing(adoptionDirectory(f))).toEqual([]);
  });

  it("refuses a COMPLETED shot whose local completion verification fails, with no receipt", async () => {
    const f = await fixture("EP90"); const output = await complete(f, "S01");
    const values = await reviewed(f);
    await writeFile(output, "tampered-local-video-bytes");
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values), deps)).rejects.toMatchObject({ code: "COMPLETION_NOT_VERIFIED" });
    expect(deps.createAdoption).not.toHaveBeenCalled();
    expect(await listing(adoptionDirectory(f))).toEqual([]);
  });

  it("refuses an unknown shot with no receipt", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values, "S09"), dependencies(f))).rejects.toMatchObject({ code: "SHOT_NOT_FOUND" });
    expect(await listing(join(f.mediaRoot, "generated-video", "EP90", "S09"))).toEqual([]);
  });

  it("a written receipt whose post-adoption preflight does not review the shot reports receiptWritten", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    let calls = 0;
    const deps = dependencies(f, { buildPreflight: vi.fn(async (input: Parameters<typeof buildBoundEpisodePreflight>[0]) => {
      calls += 1;
      // Second (post-adoption) preflight sees an unrelated manifest change.
      if (calls === 2) { f.episode.title = `${f.episode.title} (edited)`; await f.save(); }
      return buildBoundEpisodePreflight(input);
    }) });
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values), deps))
      .rejects.toMatchObject({ code: "POST_ADOPTION_STATE_UNRESOLVED", receiptWritten: true });
  });
});

describe("E. preflight auto-consumption", () => {
  it("a stale receipt for an earlier manifest neither reviews nor is scanned", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const adopted = await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    f.episode.title = `${f.episode.title} (revised)`; await f.save();
    const report = await buildBoundEpisodePreflight(f.input);
    const manifest = report.binding!.fileBindings.find(file => file.role === "MANIFEST")!.rawSha256!;
    expect(manifest).not.toBe(values.manifestRawSha256);
    expect(row(report)).toMatchObject({ completionVerification: "VERIFIED", intentAlignment: "UNATTESTED_EXISTING_EVIDENCE" });
    expect(report).toMatchObject({ intentAlignment: "REVIEW_REQUIRED", completion: "INCOMPLETE" });
    // The historical receipt still exists on disk, but only the current
    // canonical path is consulted, and it is absent.
    await expect(readFile(adopted.adoptionPath)).resolves.toBeDefined();
    expect(createVisualEvidenceAdoptionPath(f.mediaRoot, "EP90", "S01", manifest, bindingDigest(report.observations[0])))
      .not.toBe(adopted.adoptionPath);
    expect(binding(report)).toEqual([]);
  });

  it("a stale receipt for an earlier observation neither reviews nor is scanned", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    // A durable receipt for a different (historical) observation of S01.
    await createVisualEvidenceAdoption(f.mediaRoot, { target: values.target, manifestRawSha256: values.manifestRawSha256,
      observationSha256: "e".repeat(64) });
    const report = await buildBoundEpisodePreflight(f.input);
    expect(row(report).intentAlignment).toBe("UNATTESTED_EXISTING_EVIDENCE");
    expect(binding(report)).toEqual([]);
  });

  it("with no receipt, a shot completing does not change the input binding (actions do not drift)", async () => {
    const f = await fixture("EP90");
    const job = await accepted(f, "S01");
    const submitted = await buildBoundEpisodePreflight(f.input);
    expect(row(submitted).lifecycle.lifecycle).toBe("SUBMITTED");
    // Complete the already accepted job exactly as recovery would.
    const path = createRunwayVideoOutputPath(f.mediaRoot, "EP90", "S01", job.providerExecutionId, 1);
    await mkdir(dirname(path), { recursive: true }); const bytes = Buffer.from("synthetic-recovered-output"); await writeFile(path, bytes);
    const record = buildRunwayGenerationRecord({ recordedAt: "2026-10-28T12:00:00.000Z", episodeId: "EP90", shotId: "S01",
      taskId: job.providerExecutionId, request: job.request, credits: { locallyExpected: 60, providerEstimated: 60, providerFinal: 60 },
      outputs: [{ outputIndex: 1, destinationPath: path, bytes: bytes.length, sha256: rawSha256(bytes), contentType: "video/mp4" }] });
    await createExecutionCompletion(f.mediaRoot, { reservationId: job.reservation.record.reservationId, episodeId: "EP90", shotId: "S01",
      provider: "RUNWAY", providerExecutionId: job.providerExecutionId, generationRecordPath: await writeRunwayGenerationRecord(f.mediaRoot, record) });
    const completed = await buildBoundEpisodePreflight(f.input);
    expect(row(completed)).toMatchObject({ completionVerification: "VERIFIED", intentAlignment: "UNATTESTED_EXISTING_EVIDENCE" });
    expect(completed.bindingSha256).toBe(submitted.bindingSha256);
    expect(completed.observationsSha256).not.toBe(submitted.observationsSha256);
  });

  it("a receipt created after a binding was taken drifts that binding", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    const stale = await buildBoundEpisodePreflight({ ...f.input, expectedBinding: values.report.binding! });
    expect(stale.inventory.complete).toBe(false);
    expect(stale.inventory.fatalReasons).toEqual([expect.objectContaining({ code: "INPUT_BINDING_DRIFT", target: null })]);
  });

  it.each([
    ["malformed JSON", () => "{\n"],
    ["a schema-invalid record", (record: VisualEvidenceAdoption) => `${JSON.stringify({ ...record, activationEffect: "GENERATION" }, null, 2)}\n`],
    ["non-canonical bytes", (record: VisualEvidenceAdoption) => JSON.stringify(record)],
    ["another target order", (record: VisualEvidenceAdoption) => serializeVisualEvidenceAdoption({ ...record, target: { ...record.target, order: 7 } })],
    ["another target scene", (record: VisualEvidenceAdoption) => serializeVisualEvidenceAdoption({ ...record, target: { ...record.target, sceneId: "SC09" } })],
  ])("a receipt with %s at the exact expected path fails closed as INPUT_BINDING_DRIFT", async (_label, encode) => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const path = createVisualEvidenceAdoptionPath(f.mediaRoot, "EP90", "S01", values.manifestRawSha256, values.observationSha256);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, encode({ ...RECORD, target: values.target, manifestRawSha256: values.manifestRawSha256,
      observationSha256: values.observationSha256 }));
    const report = await buildBoundEpisodePreflight(f.input);
    expect(report.inventory.complete).toBe(false);
    expect(report.inventory.fatalReasons).toEqual([expect.objectContaining({ code: "INPUT_BINDING_DRIFT", target: values.target })]);
    expect(row(report)).toMatchObject({ disposition: "ERROR", intentAlignment: "UNATTESTED_EXISTING_EVIDENCE",
      primaryReason: expect.objectContaining({ code: "INPUT_BINDING_DRIFT" }) });
    expect(report).toMatchObject({ completion: "INCOMPLETE", nextActionCandidate: null, generationMayBeAuthorized: false });
    // And the service refuses rather than adopting over it.
    const deps = dependencies(f);
    await expect(adoptCompletedVisualEvidence(operatorInput(f, values), deps)).rejects.toMatchObject({ code: "PREFLIGHT_UNAVAILABLE" });
    expect(deps.createAdoption).not.toHaveBeenCalled();
  });

  it("existing transient evidenceAdoptions keep reviewing without any receipt, and combine with a durable one", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const transient = [{ target: values.target, manifestRawSha256: values.manifestRawSha256, observationSha256: values.observationSha256 }];
    const withoutReceipt = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: transient });
    expect(row(withoutReceipt).intentAlignment).toBe("REVIEWED");
    expect(binding(withoutReceipt)).toEqual([]);
    await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    const both = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: transient });
    expect(row(both).intentAlignment).toBe("REVIEWED");
    // A wrong transient adoption does not undo a valid durable receipt.
    const wrong = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: [{ ...transient[0]!, observationSha256: "f".repeat(64) }] });
    expect(row(wrong).intentAlignment).toBe("REVIEWED");
  });

  it("an expected binding that bound the receipt detects a tampered receipt as INPUT_BINDING_DRIFT", async () => {
    const f = await fixture("EP90"); await complete(f, "S01");
    const values = await reviewed(f);
    const adopted = await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    const expectedBinding = adopted.postAdoptionPreflight.binding!;
    const unchanged = await buildBoundEpisodePreflight({ ...f.input, expectedBinding });
    expect(unchanged.inventory).toMatchObject({ complete: true, fatalReasons: [] });
    // Same length, different bytes: a parseable but tampered receipt.
    const text = await readFile(adopted.adoptionPath, "utf8");
    await rm(adopted.adoptionPath);
    await writeFile(adopted.adoptionPath, text.replace(ADOPTED_AT, "2026-11-18T09:00:01.000Z"));
    const drifted = await buildBoundEpisodePreflight({ ...f.input, expectedBinding });
    expect(drifted.inventory.complete).toBe(false);
    expect(drifted.inventory.fatalReasons.some(issue => issue.code === "INPUT_BINDING_DRIFT")).toBe(true);
    expect(drifted.completion).toBe("INCOMPLETE");
  });
});

describe("F. multi-shot: an earlier completed shot, and future controlled-plan bindings", () => {
  it("adopts a completed earlier shot without requiring the episode to complete", async () => {
    const f = await fixture("MULTI"); await complete(f, "S01");
    const values = await reviewed(f);
    const result = await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    const after = result.postAdoptionPreflight;
    expect(result.target).toEqual({ episodeId: "EP02", sceneId: "SC01", shotId: "S01", order: 1 });
    expect(row(after)).toMatchObject({ completionVerification: "VERIFIED", intentAlignment: "REVIEWED" });
    expect(row(after, "S02").lifecycle.lifecycle).toBe("NOTHING");
    expect(after.completion).toBe("INCOMPLETE");
    // The receipt itself is evidence only: it creates no durable lifecycle
    // for any shot and no plan; continuation still needs a fresh plan.
    expect(after.observations.map(observation => observation.lifecycle)).toEqual(["COMPLETED", "NOTHING"]);
    expect(result.receipt.activationEffect).toBe("NONE_EVIDENCE_ONLY");
  });

  it("checked execution rechecks the bound receipt from the media root and detects tampering", async () => {
    const f = await fixture("MULTI"); await complete(f, "S01");
    const values = await reviewed(f);
    const result = await adoptCompletedVisualEvidence(operatorInput(f, values), dependencies(f));
    const after = result.postAdoptionPreflight;
    // Before review, unattested S01 evidence blocked any continuation
    // candidate; the review unblocks planning of the next shot only.
    expect(values.report.nextActionCandidate).toBeNull();
    expect(after.nextActionCandidate).toMatchObject({ kind: "VISUAL_GENERATE", shotId: "S02" });
    // A real schema-2.0 plan built from the post-adoption preflight, with no
    // transient adoption; its single action and create allowance are the
    // planner's, unchanged by the receipt.
    const plan = buildControlledEpisodeAutomationPlan({ preflight: after, evidenceAdoptions: [] });
    expect(plan).toMatchObject({ evidenceAdoptions: [], maximumNewProviderCreates: 1,
      actions: [expect.objectContaining({ kind: "VISUAL_GENERATE", shotId: "S02", confirmPaidGeneration: true })] });
    expect(plan.inputBinding.fileBindings.filter(file => file.role === "EVIDENCE_ADOPTION:S01")).toEqual([
      expect.objectContaining({ canonicalPath: result.adoptionPath, exists: true, rawSha256: result.adoptionSha256 })]);

    const guard = await acquireEpisodeExecutionGuard({ mediaRoot: f.mediaRoot, episodeId: "EP02",
      manifestRawSha256: values.manifestRawSha256, sessionId: randomUUID() });
    try {
      const context = await createCheckedEpisodeExecutionContext({ plan, guard } as unknown as CheckedEpisodeExecutionData);
      await expect(recheckEpisodeExecutionBindings(context)).resolves.toBeUndefined();
      // Read from the media root, never the repository root.
      expect(await readCheckedEpisodeJson(context, "EVIDENCE_ADOPTION:S01", value => VisualEvidenceAdoptionSchema.parse(value)))
        .toEqual(result.receipt);
      const text = await readFile(result.adoptionPath, "utf8");
      await rm(result.adoptionPath);
      await writeFile(result.adoptionPath, text.replace(ADOPTED_AT, "2026-11-18T09:00:01.000Z"));
      await expect(recheckEpisodeExecutionBindings(context)).rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
      await expect(readCheckedEpisodeJson(context, "EVIDENCE_ADOPTION:S01", value => value)).rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
    } finally {
      await releaseEpisodeExecutionGuard(guard);
    }
  });
});

describe("G. evidence-only boundary", () => {
  it("the adoption modules import no provider, transaction, guard, plan or write-capable execution authority", async () => {
    const read = async (path: string) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
    for (const path of [
      "src/execution/visualEvidenceAdoption.schema.ts",
      "src/execution/visualEvidenceAdoptionPath.ts",
      "src/execution/readVisualEvidenceAdoption.ts",
      "src/execution/createVisualEvidenceAdoption.ts",
      "src/execution/adoptCompletedVisualEvidence.ts",
      "src/execution/cli/visualEvidenceAdoptionCliArgs.ts",
      "src/execution/cli/runVisualEvidenceAdoptionCli.ts",
    ]) {
      const imports = [...(await read(path)).matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]!);
      for (const specifier of imports) {
        expect(specifier, `${path} -> ${specifier}`).not.toMatch(
          /genai|runwayml|\/runway\/|\/veo\/|googleGenai|providers\/|executeSingleShot|coordinateEpisodeAction|runEpisodeAutomation|episodeExecutionGuard|createExecution(Reservation|Submission|Completion)|reconcile|recover|TransactionRunner|buildControlledEpisodeAutomationPlan|child_process|node:http/i,
        );
      }
    }
  });
});
