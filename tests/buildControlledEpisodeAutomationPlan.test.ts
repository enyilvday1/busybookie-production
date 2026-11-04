import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../src/schemas/productionRules.schema.js";
import { buildBoundEpisodePreflight } from "../src/execution/buildBoundEpisodePreflight.js";
import { rawSha256, bindingDigest } from "../src/execution/episodeInputBinding.js";
import type { BoundEpisodePreflight, EvidenceAdoption, RuntimeIdentity } from "../src/execution/boundEpisodeProduction.types.js";
import { parseEpisodeAutomationPlan } from "../src/execution/episodeAutomationPlan.schema.js";
import { buildControlledEpisodeAutomationPlan } from "../src/execution/buildControlledEpisodeAutomationPlan.js";
import { createVisualAttemptAdmission } from "../src/execution/createVisualAttemptAdmission.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { inspectVisualAttemptExecutionLifecycle } from "../src/execution/inspectVisualAttemptExecutionLifecycle.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";

// B7E5D8Z16-B5: the pure BoundEpisodePreflight -> ControlledEpisodeAutomationPlan
// builder. Synthetic temporary media roots only; the SDK is a tripwire and
// network is rejected. Nothing here dispatches, reserves or submits.
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => { throw new Error("The real Google SDK must never be constructed by the plan builder tests."); }),
}));

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(options: Readonly<{ provider?: "RUNWAY" | "GOOGLE_GENAI" }> = {}) {
  const provider = options.provider ?? "GOOGLE_GENAI";
  const root = await mkdtemp(join(process.cwd(), ".b5-plan-builder-")); roots.push(root);
  const repositoryRoot = join(root, "repo"); const mediaRoot = join(root, "media");
  await mkdir(join(repositoryRoot, "episodes/EP02"), { recursive: true });
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  await mkdir(join(mediaRoot, "references"), { recursive: true });
  const episode = EpisodeManifestSchema.parse(JSON.parse(await readFile("episodes/EP02/episode.json", "utf8")));
  episode.status = "IN_PRODUCTION"; episode.approvals.script = "APPROVED";
  episode.approvals.storyboard = "APPROVED"; episode.approvals.references = "APPROVED";
  const template = episode.scenes[0]!.shots[0]!;
  const shot = (id: string, order: number) => ({ ...structuredClone(template), id, order,
    references: { required: true, assetIds: ["ref"], approvalStatus: "APPROVED" as const },
    generation: { provider, nativeAudio: false, status: "APPROVED_FOR_GENERATION" as const } });
  episode.scenes = [{ ...episode.scenes[0]!, id: "SC02", shots: [shot("S10", 3), shot("S11", 1)] },
    { ...episode.scenes[0]!, id: "SC01", shots: [shot("S01", 2)] }];
  for (const name of ["characters.json", "provider-routing-policy.json", "runway-policy.json", "veo-policy.json", "google-genai-policy.json", "google-genai-activation-policy.json"]) {
    await writeFile(join(repositoryRoot, "config", name), await readFile(join("config", name)));
  }
  // Synthetic copy only; the repository activation policy stays default-off.
  const activation = join(repositoryRoot, "config/google-genai-activation-policy.json");
  const policy = JSON.parse(await readFile(activation, "utf8")); policy.admission.newSubmissionsEnabled = true;
  await writeFile(activation, JSON.stringify(policy));
  const rules = ProductionRulesSchema.parse(JSON.parse(await readFile("config/production-rules.json", "utf8")));
  rules.storage.requireExternalMediaRoot = false;
  await writeFile(join(repositoryRoot, "config/production-rules.json"), JSON.stringify(rules));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==", "base64");
  await writeFile(join(mediaRoot, "references/ref.png"), png);
  const asset = { assetId: "ref", mediaRootRelativePath: "references/ref.png", bytes: png.length, sha256: rawSha256(png), contentType: "image/png" };
  await writeFile(join(mediaRoot, "references/visual-reference-asset-registry.json"), JSON.stringify({ schemaVersion: "1.0", assets: [asset] }));
  await writeFile(join(repositoryRoot, "runtime.txt"), "reviewed-runtime");
  const runtimeIdentity: RuntimeIdentity = { reviewedRevision: "a".repeat(40), repositoryRoot, mediaRoot, physicalMediaRoot: mediaRoot,
    executableInputs: [{ role: "RUNTIME", canonicalPath: join(repositoryRoot, "runtime.txt"), exists: true,
      rawSha256: rawSha256("reviewed-runtime"), bytes: 16 }], ffprobe: null };
  const manifest = join(repositoryRoot, "episodes/EP02/episode.json");
  await writeFile(manifest, JSON.stringify(episode));
  return { manifest, mediaRoot, input: { episodeId: "EP02", mediaRoot, runtimeIdentity } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function admit(f: Fixture, attemptNumber = 2) {
  return createVisualAttemptAdmission(f.mediaRoot, { attemptNumber, episodeId: "EP02", sceneId: "SC01", shotId: "S01",
    provider: "GOOGLE_GENAI", manifestRawSha256: rawSha256(await readFile(f.manifest)),
    promptIdentitySha256: "b".repeat(64), referenceIdentitySha256: "c".repeat(64),
    previousAttemptNumber: attemptNumber - 1, previousAttemptQcSha256: "d".repeat(64) });
}
const select = (f: Fixture, attemptNumber = 2): Promise<BoundEpisodePreflight> =>
  buildBoundEpisodePreflight({ ...f.input, visualAttemptSelection: { shotId: "S01", attemptNumber } });

async function accepted(f: Fixture, shotId: string) {
  const reservation = await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId, provider: "RUNWAY" });
  await createExecutionSubmission(f.mediaRoot, { reservationId: reservation.record.reservationId, episodeId: "EP02", shotId,
    provider: "RUNWAY", providerExecutionId: `synthetic-private-job-${shotId}`, providerEstimatedCredits: 60,
    recoveryMetadata: { request: { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4", promptText: "Synthetic evidence.",
      sourceImagePath: join(f.mediaRoot, "references/ref.png"), assetStrategy: "DATA_URI" }, locallyExpectedCredits: 60 } });
}
async function reviewedEvidence(f: Fixture): Promise<EvidenceAdoption[]> {
  const report = await buildBoundEpisodePreflight(f.input);
  const manifest = report.binding?.fileBindings.find(file => file.role === "MANIFEST")?.rawSha256;
  if (!manifest) throw new Error("Missing test manifest binding.");
  return report.observations.filter(observation => observation.lifecycle === "SUBMITTED" || observation.lifecycle === "COMPLETED")
    .map(observation => ({ target: observation.target, manifestRawSha256: manifest, observationSha256: bindingDigest(observation) }));
}

function attemptCandidate(preflight: BoundEpisodePreflight) {
  const candidate = preflight.nextActionCandidate;
  if (candidate?.kind !== "VISUAL_ATTEMPT_GENERATE") throw new Error("Fixture needs an attempt candidate.");
  return candidate;
}
function deepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}
const tripwireNetwork = () => vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
const OPERATING = { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true };
const ATTEMPT_ACTION_KEYS = ["attemptNumber", "confirmPaidGeneration", "costAuthority", "episodeId", "expectedAttemptLifecycle", "kind",
  "order", "referenceBinding", "resolvedProvider", "sceneId", "shotId"];
const BUILDER_ERROR = /^Controlled episode automation plan cannot be built:/;

describe("A. exact Attempt-2 candidate transformation", () => {
  it("copies the envelope, attempt identity, reference and cost authority exactly with one create", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork();
    const before = await select(f); const candidate = attemptCandidate(before);
    const plan = buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: [] });
    expect(plan).toEqual({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: before.episodeId, scope: before.scope,
      inputBinding: before.binding, inputBindingSha256: before.bindingSha256, observations: before.observations,
      observationsSha256: before.observationsSha256, evidenceAdoptions: [], maximumNewProviderCreates: 1, operatingCondition: OPERATING,
      actions: [{ episodeId: candidate.episodeId, sceneId: candidate.sceneId, shotId: candidate.shotId, order: candidate.order,
        kind: "VISUAL_ATTEMPT_GENERATE", attemptNumber: candidate.attemptNumber, expectedAttemptLifecycle: candidate.expectedAttemptLifecycle,
        resolvedProvider: candidate.provider, referenceBinding: candidate.referenceBinding,
        costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue, maxModeledValue: candidate.cost.perShotCap,
          policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true }] });
    const action = plan.actions[0];
    if (action.kind !== "VISUAL_ATTEMPT_GENERATE") throw new Error("Wrong action kind.");
    expect(Object.keys(action).sort()).toEqual(ATTEMPT_ACTION_KEYS);
    expect(action).toMatchObject({ episodeId: "EP02", sceneId: "SC01", shotId: "S01", order: 2, attemptNumber: 2,
      expectedAttemptLifecycle: "ADMITTED_ONLY", resolvedProvider: "GOOGLE_GENAI", confirmPaidGeneration: true });
    expect(action.referenceBinding).toEqual(before.binding?.referenceBindings.find(row => row.shotId === "S01"));
    expect(action.costAuthority).toEqual({ unit: "MICRO_USD", modeledValue: candidate.cost.modeledValue,
      maxModeledValue: candidate.cost.perShotCap, policySha256: candidate.cost.policySha256 });
    expect(action.costAuthority.policySha256).toBe(before.binding?.fileBindings.find(file => file.role === "GOOGLE_ACTIVATION")?.rawSha256);
    expect(plan.maximumNewProviderCreates).toBe(1);
    expect(network).not.toHaveBeenCalled();
  });
  it("equals the existing hand-assembled reviewed attempt plan", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const candidate = attemptCandidate(before);
    const manual = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02", scope: before.scope,
      inputBinding: before.binding, inputBindingSha256: before.bindingSha256, observations: before.observations,
      observationsSha256: before.observationsSha256, evidenceAdoptions: [], maximumNewProviderCreates: 1, operatingCondition: OPERATING,
      actions: [{ episodeId: candidate.episodeId, sceneId: candidate.sceneId, shotId: candidate.shotId, order: candidate.order,
        kind: "VISUAL_ATTEMPT_GENERATE", attemptNumber: candidate.attemptNumber, expectedAttemptLifecycle: candidate.expectedAttemptLifecycle,
        resolvedProvider: candidate.provider, referenceBinding: candidate.referenceBinding,
        costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue, maxModeledValue: candidate.cost.perShotCap,
          policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true }] });
    expect(buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: [] })).toEqual(manual);
  });
  it("leaves durable attempt and legacy state untouched", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f);
    const legacyBefore = await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01");
    buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: [] });
    expect((await inspectVisualAttemptExecutionLifecycle(f.mediaRoot, "EP02", "S01", 2)).state).toBe("ADMITTED_ONLY");
    expect(await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01")).toEqual(legacyBefore);
  });
});

describe("B. no attempt inference", () => {
  it("an unadmitted selection between admitted attempts yields no plan; the exact admitted attempt is used verbatim", async () => {
    const f = await fixture(); await admit(f, 2); await admit(f, 4);
    for (const attemptNumber of [3, 5]) {
      const report = await select(f, attemptNumber);
      expect(report.nextActionCandidate).toBeNull();
      expect(() => buildControlledEpisodeAutomationPlan({ preflight: report, evidenceAdoptions: [] })).toThrow(BUILDER_ERROR);
    }
    const plan = buildControlledEpisodeAutomationPlan({ preflight: await select(f, 4), evidenceAdoptions: [] });
    expect(plan.actions[0]).toMatchObject({ kind: "VISUAL_ATTEMPT_GENERATE", attemptNumber: 4 });
  });
  it("copies the candidate attempt number as given rather than deriving one", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const candidate = attemptCandidate(before);
    const preflight: BoundEpisodePreflight = { ...before, nextActionCandidate: { ...candidate, attemptNumber: 7 } };
    expect(buildControlledEpisodeAutomationPlan({ preflight, evidenceAdoptions: [] }).actions[0]).toMatchObject({ attemptNumber: 7 });
  });
});

describe("C. legacy candidate families", () => {
  it("VISUAL_GENERATE carries the reviewed reference and cost with a create allowance of 1", async () => {
    const f = await fixture();
    const before = await buildBoundEpisodePreflight(f.input);
    const candidate = before.nextActionCandidate;
    if (candidate?.kind !== "VISUAL_GENERATE") throw new Error("Fixture needs a generation frontier.");
    const plan = buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: [] });
    expect(plan.maximumNewProviderCreates).toBe(1);
    expect(plan.actions).toEqual([{ episodeId: "EP02", sceneId: candidate.sceneId, shotId: "S11", order: 1, kind: "VISUAL_GENERATE",
      expectedLifecycle: "NOTHING", resolvedProvider: candidate.provider, referenceBinding: candidate.referenceBinding,
      costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue, maxModeledValue: candidate.cost.perShotCap,
        policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true }]);
  });
  it("VISUAL_RECONCILE copies the exact durable job identity with a create allowance of 0 and preserves adoptions", async () => {
    const f = await fixture({ provider: "RUNWAY" }); await accepted(f, "S11");
    const evidenceAdoptions = await reviewedEvidence(f);
    expect(evidenceAdoptions).toHaveLength(1);
    const before = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions });
    const candidate = before.nextActionCandidate;
    if (candidate?.kind !== "VISUAL_RECONCILE") throw new Error("Fixture needs a reconciliation frontier.");
    const plan = buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions });
    expect(plan.maximumNewProviderCreates).toBe(0);
    expect(plan.evidenceAdoptions).toEqual(evidenceAdoptions);
    expect(plan.actions).toEqual([{ episodeId: "EP02", sceneId: candidate.sceneId, shotId: "S11", order: 1, kind: "VISUAL_RECONCILE",
      expectedLifecycle: "SUBMITTED", reservationId: candidate.observation.reservationId, durableProvider: "RUNWAY",
      providerExecutionIdentitySha256: candidate.observation.providerExecutionIdentitySha256,
      submissionSha256: candidate.observation.submissionSha256, reservationSha256: candidate.observation.reservationSha256,
      confirmReconciliation: true }]);
    expect(JSON.stringify(plan)).not.toContain("synthetic-private-job-S11");
  });
  it("never synthesizes adoptions and rejects a tampered adoption through the parser", async () => {
    const f = await fixture({ provider: "RUNWAY" }); await accepted(f, "S11");
    const evidenceAdoptions = await reviewedEvidence(f);
    const before = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions });
    expect(buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: [] }).evidenceAdoptions).toEqual([]);
    const tampered = evidenceAdoptions.map(adoption => ({ ...adoption, observationSha256: "e".repeat(64) }));
    expect(() => buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: tampered })).toThrow(/Evidence adoption hash does not match/);
  });
});

describe("D. required preflight authority", () => {
  it.each([
    ["missing binding", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, binding: null }), /no input binding\./],
    ["missing bindingSha256", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, bindingSha256: null }), /no input binding digest/],
    ["missing candidate", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, nextActionCandidate: null }), /no next action candidate/],
    ["incomplete inventory", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, inventory: { ...before.inventory, complete: false } }), /inventory is incomplete/],
  ] as const)("fails closed on %s", async (_label, mutate, message) => {
    const f = await fixture(); await admit(f);
    const preflight = mutate(await select(f));
    expect(() => buildControlledEpisodeAutomationPlan({ preflight, evidenceAdoptions: [] })).toThrow(message);
  });
  it("a real NOT_ADMITTED preflight has no candidate and builds nothing", async () => {
    const f = await fixture();
    const report = await select(f);
    expect(report.nextActionCandidate).toBeNull();
    expect(() => buildControlledEpisodeAutomationPlan({ preflight: report, evidenceAdoptions: [] })).toThrow(/no next action candidate/);
  });
  it.each([
    ["action", { kind: "VISUAL_GENERATE" }], ["actions", []], ["attemptNumber", 3], ["maximumNewProviderCreates", 1],
    ["operatingCondition", OPERATING], ["confirmPaidGeneration", true],
  ] as const)("rejects caller-supplied %s authority", async (field, value) => {
    const f = await fixture(); await admit(f);
    const preflight = await select(f);
    expect(() => buildControlledEpisodeAutomationPlan({ preflight, evidenceAdoptions: [], [field]: value } as never)).toThrow(TypeError);
  });
  it("requires explicit evidenceAdoptions", async () => {
    const f = await fixture(); await admit(f);
    const preflight = await select(f);
    expect(() => buildControlledEpisodeAutomationPlan({ preflight } as never)).toThrow(TypeError);
    expect(() => buildControlledEpisodeAutomationPlan({ preflight, evidenceAdoptions: null } as never)).toThrow(TypeError);
    expect(() => buildControlledEpisodeAutomationPlan(null as never)).toThrow(TypeError);
  });
});

describe("E. the existing parser rejects inconsistent output", () => {
  type Attempt = ReturnType<typeof attemptCandidate>;
  it.each([
    ["wrong binding digest", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, bindingSha256: "f".repeat(64) })],
    ["wrong observations digest", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, observationsSha256: "f".repeat(64) })],
    ["foreign episode", (before: BoundEpisodePreflight): BoundEpisodePreflight => ({ ...before, episodeId: "EP03" })],
    ["candidate order drift", (before: BoundEpisodePreflight, c: Attempt): BoundEpisodePreflight => ({ ...before, nextActionCandidate: { ...c, order: 3 } })],
    ["candidate attempt 1", (before: BoundEpisodePreflight, c: Attempt): BoundEpisodePreflight => ({ ...before, nextActionCandidate: { ...c, attemptNumber: 1 } })],
    ["cost above its cap", (before: BoundEpisodePreflight, c: Attempt): BoundEpisodePreflight =>
      ({ ...before, nextActionCandidate: { ...c, cost: { ...c.cost, modeledValue: c.cost.perShotCap + 1 } } })],
    ["foreign cost unit", (before: BoundEpisodePreflight, c: Attempt): BoundEpisodePreflight =>
      ({ ...before, nextActionCandidate: { ...c, cost: { ...c.cost, unit: "USD_CENTS" } } })],
    ["unreviewed reference", (before: BoundEpisodePreflight, c: Attempt): BoundEpisodePreflight =>
      ({ ...before, nextActionCandidate: { ...c, referenceBinding: { ...c.referenceBinding, sha256: "f".repeat(64) } } })],
  ] as const)("%s", async (_label, mutate) => {
    const f = await fixture(); await admit(f);
    const before = await select(f);
    let error: unknown = null;
    try { buildControlledEpisodeAutomationPlan({ preflight: mutate(before, attemptCandidate(before)), evidenceAdoptions: [] }); } catch (cause) { error = cause; }
    expect(error).toBeInstanceOf(Error);
    // Rejected by parseEpisodeAutomationPlan, not by the builder's own preconditions.
    const message = error instanceof Error ? error.message : "";
    expect(message).not.toMatch(BUILDER_ERROR);
    expect(message).toMatch(/Episode automation plan is invalid|INPUT_BINDING_DRIFT/);
  });
});

describe("F. frozen defensive result", () => {
  it("is recursively frozen and independent of every caller-held input", async () => {
    const f = await fixture({ provider: "RUNWAY" }); await accepted(f, "S11");
    const evidenceAdoptions = await reviewedEvidence(f);
    const before = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions });
    // An unfrozen JSON copy the caller keeps mutating after the build.
    const mutable = JSON.parse(JSON.stringify(before));
    const plan = buildControlledEpisodeAutomationPlan({ preflight: mutable, evidenceAdoptions });
    expect(deepFrozen(plan)).toBe(true);
    expect(plan.inputBinding).not.toBe(mutable.binding); expect(plan.observations).not.toBe(mutable.observations);
    expect(plan.evidenceAdoptions).not.toBe(evidenceAdoptions);
    const snapshot = JSON.stringify(plan);
    mutable.episodeId = "EP03";
    mutable.binding.referenceBindings[0].approvedAssetIds.push("later");
    mutable.observations[0].lifecycle = "COMPLETED";
    evidenceAdoptions.push({ ...evidenceAdoptions[0]!, observationSha256: "e".repeat(64) });
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(Reflect.set(plan, "maximumNewProviderCreates", 1)).toBe(false);
  });
});

describe("G. no new I/O or provider capability", () => {
  it("imports only the shared types and the existing parser, and names no I/O, environment or provider surface", async () => {
    const source = await readFile("src/execution/buildControlledEpisodeAutomationPlan.ts", "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map(match => match[1]).sort();
    expect(imports).toEqual(["./boundEpisodeProduction.types.js", "./episodeAutomationPlan.schema.js"]);
    const code = source.split(/\r?\n/).filter(line => !line.trim().startsWith("//")).join("\n");
    for (const forbidden of [/process\./, /\bnode:/, /\bfetch\b/, /\brequire\(/, /\bimport\(/, /@google/, /runway/i, /\bveo\b/i,
      /readFile|writeFile|readBoundFile|mkdir|rename|unlink/, /createExecution|createVisualAttempt|Reservation|Submission|Completion/,
      /buildBoundEpisodePreflight|inspect[A-Z]/, /\bDate\b|Math\.random/, /\bsetTimeout\b|\bawait\b|\basync\b/]) {
      expect(code).not.toMatch(forbidden);
    }
    // No type assertion stands in for parser authority (only `as const` literals).
    expect(code).not.toMatch(/\bas\s+(?!const\b)[A-Za-z{[(]/);
  });
  it("is synchronous and touches neither network nor the SDK while building", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const network = tripwireNetwork();
    const result: unknown = buildControlledEpisodeAutomationPlan({ preflight: before, evidenceAdoptions: [] });
    expect(result).not.toBeInstanceOf(Promise);
    expect(network).not.toHaveBeenCalled();
  });
});
