import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  classifyExecutionLifecycle,
  type ExecutionLifecycleClassification,
} from "../src/execution/classifyExecutionLifecycle.js";

import type {
  DialogueVisualAuthorization,
} from "../src/execution/dialogueVisualAuthorization.schema.js";

import type {
  ExecutionCompletion,
} from "../src/execution/executionCompletion.schema.js";

import type {
  ExecutionReservation,
} from "../src/execution/executionReservation.schema.js";

import type {
  ExecutionSubmission,
} from "../src/execution/executionSubmission.schema.js";

import {
  readVisualReferenceAssetRegistry,
} from "../src/execution/readVisualReferenceAssetRegistry.js";

import {
  resolveDurableShotExecutionReadiness,
} from "../src/execution/resolveDurableShotExecutionReadiness.js";

import {
  resolveDurableShotVisualGenerationState,
  type ResolveDurableShotVisualGenerationStateDependencies,
  type ResolveDurableShotVisualGenerationStateInput,
} from "../src/execution/resolveDurableShotVisualGenerationState.js";

import type {
  DialogueVisualAuthorizationReader,
} from "../src/execution/singleShotExecution.types.js";

import type {
  VisualReferenceAsset,
} from "../src/execution/visualReferenceAsset.schema.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "../src/execution/verifyApprovedVisualReferenceAsset.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==",
  "base64",
);

const VILLAGE_ID = "littleleaf-valley-storybook-village-v1";
const SECOND_ID = "littleleaf-valley-storybook-village-alt-v1";
const OLLIE_ID = "OLLIE_CHARACTER_MASTER_REFERENCE_V1";

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePathFor(assetId: string): string {
  return `references/test/${assetId}.png`;
}

function assetFor(assetId: string, overrides: Partial<VisualReferenceAsset> = {}): VisualReferenceAsset {
  return {
    assetId,
    mediaRootRelativePath: relativePathFor(assetId),
    bytes: PNG_BYTES.length,
    sha256: sha256(PNG_BYTES),
    contentType: "image/png",
    ...overrides,
  };
}

// Temporary media root holding real PNG bytes and a durable registry.
async function mediaRootWith(assets: readonly VisualReferenceAsset[]): Promise<string> {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-visual-generation-state-"));
  roots.push(mediaRoot);
  for (const asset of assets) {
    const imagePath = resolve(mediaRoot, ...asset.mediaRootRelativePath.split("/"));
    await mkdir(dirname(imagePath), { recursive: true });
    await writeFile(imagePath, PNG_BYTES);
  }
  await mkdir(resolve(mediaRoot, "references"), { recursive: true });
  await writeFile(
    resolve(mediaRoot, "references", "visual-reference-asset-registry.json"),
    JSON.stringify({ schemaVersion: "1.0", assets }),
  );
  return mediaRoot;
}

function requireShot(episode: EpisodeManifest, shotId: string): Shot {
  for (const scene of episode.scenes) {
    const shot = scene.shots.find((candidate) => candidate.id === shotId);
    if (shot) {
      return shot;
    }
  }
  throw new Error(`Expected ${episode.episodeId} ${shotId}.`);
}

async function context(episodeId: string, shotId: string, mediaRoot: string) {
  const [episode, bible, rules, policy] = await Promise.all([
    loadEpisodeManifest(episodeId),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);
  return { episode, shot: requireShot(episode, shotId), bible, rules, policy, mediaRoot };
}

// Repository EP90/S01 is an EXECUTABLE Runway shot with one approved reference.
async function readyRunwayShot(assets: readonly VisualReferenceAsset[] = [assetFor(VILLAGE_ID)]) {
  return context("EP90", "S01", await mediaRootWith(assets));
}

// EP02/S02 made generation-ready in memory (dialogue, VEO, one approved reference).
async function readyDialogueShot() {
  const input = await context("EP02", "S02", await mediaRootWith([assetFor(OLLIE_ID)]));
  input.episode.status = "READY_FOR_GENERATION";
  input.episode.approvals.script = "APPROVED";
  input.episode.approvals.storyboard = "APPROVED";
  input.episode.approvals.references = "APPROVED";
  input.shot.references = { required: true, assetIds: [OLLIE_ID], approvalStatus: "APPROVED" };
  input.shot.generation.provider = "VEO";
  input.shot.generation.nativeAudio = true;
  input.shot.generation.status = "APPROVED_FOR_GENERATION";
  return input;
}

function authorizationFor(input: ResolveDurableShotVisualGenerationStateInput, provider: "RUNWAY" | "VEO" = "VEO"): DialogueVisualAuthorization {
  return {
    schemaVersion: "1.0",
    authorizationId: "11111111-1111-4111-8111-111111111111",
    authorizedAt: "2026-10-11T12:00:00.000Z",
    status: "AUTHORIZED",
    episodeId: input.episode.episodeId,
    shotId: input.shot.id,
    purpose: "DIALOGUE_VISUAL_GENERATION",
    provider,
    nativeAudioDisposition: "DISCARD_AFTER_VISUAL_GENERATION",
    dialogueAuthority: "EXTERNAL_VERIFIED_DIALOGUE",
    authorizationSource: "HUMAN_OPERATOR",
  };
}

function lifecycleRecords(episodeId: string, shotId: string) {
  const reservation: ExecutionReservation = {
    schemaVersion: "1.0",
    reservationId: "22222222-2222-4222-8222-222222222222",
    reservedAt: "2026-10-11T12:00:00.000Z",
    status: "RESERVED",
    episodeId,
    shotId,
    provider: "RUNWAY",
  };
  const submission: ExecutionSubmission = {
    schemaVersion: "1.0",
    submittedAt: "2026-10-11T12:01:00.000Z",
    status: "SUBMITTED",
    reservationId: reservation.reservationId,
    episodeId,
    shotId,
    provider: "RUNWAY",
    providerExecutionId: "task-runway-c2",
  };
  const completion: ExecutionCompletion = {
    schemaVersion: "1.0",
    completedAt: "2026-10-11T12:02:00.000Z",
    status: "COMPLETED",
    reservationId: reservation.reservationId,
    episodeId,
    shotId,
    provider: "RUNWAY",
    providerExecutionId: submission.providerExecutionId,
    generationRecordPath: `controlled/${episodeId}_${shotId}_task-runway-c2.runway-generation.json`,
  };
  return { reservation, submission, completion };
}

// Lifecycle classifications built through the real classifier and its integrity rules.
function lifecycleFor(state: "NOTHING" | "RESERVED_ONLY" | "SUBMITTED" | "COMPLETED", episodeId = "EP90", shotId = "S01"): ExecutionLifecycleClassification {
  const { reservation, submission, completion } = lifecycleRecords(episodeId, shotId);
  switch (state) {
    case "NOTHING":
      return classifyExecutionLifecycle({ reservation: null, submission: null, completion: null });
    case "RESERVED_ONLY":
      return classifyExecutionLifecycle({ reservation, submission: null, completion: null });
    case "SUBMITTED":
      return classifyExecutionLifecycle({ reservation, submission, completion: null });
    case "COMPLETED":
      return classifyExecutionLifecycle({ reservation, submission, completion });
  }
}

function dependencies(
  lifecycle: () => Promise<ExecutionLifecycleClassification>,
  authorization: DialogueVisualAuthorization | null = null,
) {
  const inspectLifecycle = vi.fn<ResolveDurableShotVisualGenerationStateDependencies["inspectLifecycle"]>(lifecycle);
  const readDialogueVisualAuthorization = vi.fn<DialogueVisualAuthorizationReader>(async () => authorization);
  const readRegistry = vi.fn<typeof readVisualReferenceAssetRegistry>(readVisualReferenceAssetRegistry);
  const verifyReference = vi.fn<typeof verifyApprovedVisualReferenceAsset>(
    (input) => verifyApprovedVisualReferenceAsset(input),
  );
  return { inspectLifecycle, readDialogueVisualAuthorization, readRegistry, verifyReference };
}

const nothing = async () => lifecycleFor("NOTHING");

describe("durable per-shot visual-generation state", () => {
  describe("durable lifecycle precedence (duplicate-generation guard)", () => {
    it.each([
      ["RESERVED_ONLY", "RESERVED_ONLY_INTERVENTION_REQUIRED"],
      ["SUBMITTED", "SUBMITTED_RECONCILIATION_REQUIRED"],
      ["COMPLETED", "LIFECYCLE_COMPLETED"],
    ] as const)("reports %s for an otherwise READY shot without readiness or reference admission", async (lifecycleState, expected) => {
      const input = await readyRunwayShot();
      const lifecycle = lifecycleFor(lifecycleState);
      const deps = dependencies(async () => lifecycle);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toEqual({ state: expected, episodeId: "EP90", shotId: "S01", lifecycle });
      expect(deps.inspectLifecycle).toHaveBeenCalledExactlyOnceWith(input.mediaRoot, "EP90", "S01");
      expect(deps.readDialogueVisualAuthorization).not.toHaveBeenCalled();
      expect(deps.readRegistry).not.toHaveBeenCalled();
      expect(deps.verifyReference).not.toHaveBeenCalled();
    });

    it.each(["RESERVED_ONLY", "SUBMITTED", "COMPLETED"] as const)("never evaluates readiness for a %s dialogue shot whose authorization reader would fail", async (lifecycleState) => {
      const input = await readyDialogueShot();
      const lifecycle = lifecycleFor(lifecycleState, "EP02", "S02");
      const deps = dependencies(async () => lifecycle);
      deps.readDialogueVisualAuthorization.mockRejectedValue(new Error("authorization must not be read"));

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result.state).not.toBe("READY_FOR_GENERATION");
      expect(result).toMatchObject({ lifecycle: { state: lifecycleState } });
      expect(deps.readDialogueVisualAuthorization).not.toHaveBeenCalled();
    });

    it("reports COMPLETED from the record chain alone without verifying generated video bytes", async () => {
      const input = await readyRunwayShot();
      const lifecycle = lifecycleFor("COMPLETED");
      const deps = dependencies(async () => lifecycle);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result.state).toBe("LIFECYCLE_COMPLETED");
      expect(Object.keys(result).sort()).toEqual(["episodeId", "lifecycle", "shotId", "state"]);
    });

    it.each([
      ["episode", "EP91", "S01"],
      ["shot", "EP90", "S02"],
    ] as const)("fails hard when existing lifecycle evidence belongs to another %s", async (_label, episodeId, shotId) => {
      const input = await readyRunwayShot();
      const deps = dependencies(async () => lifecycleFor("SUBMITTED", episodeId, shotId));

      await expect(resolveDurableShotVisualGenerationState(input, deps)).rejects.toThrow(
        `Execution lifecycle evidence for EP90/S01 belongs to ${episodeId}/${shotId}.`,
      );
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });

    it("propagates corrupt lifecycle evidence as a hard failure", async () => {
      const input = await readyRunwayShot();
      const { submission } = lifecycleRecords("EP90", "S01");
      const deps = dependencies(async () => classifyExecutionLifecycle({ reservation: null, submission, completion: null }));

      await expect(resolveDurableShotVisualGenerationState(input, deps)).rejects.toThrow(
        "Execution lifecycle submission exists without a durable reservation.",
      );
      expect(deps.readDialogueVisualAuthorization).not.toHaveBeenCalled();
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });
  });

  describe("NOTHING lifecycle with non-executable readiness", () => {
    it("maps NOT_READY to CANONICAL_NOT_EXECUTABLE without touching references", async () => {
      const input = await readyRunwayShot();
      input.episode.status = "DRAFT";
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toEqual({
        state: "CANONICAL_NOT_EXECUTABLE",
        episodeId: "EP90",
        shotId: "S01",
        readiness: await resolveDurableShotExecutionReadiness(input, {}),
      });
      expect(result).toMatchObject({ readiness: { disposition: "NOT_READY" } });
      expect(deps.readRegistry).not.toHaveBeenCalled();
      expect(deps.verifyReference).not.toHaveBeenCalled();
    });

    it("maps BLOCKED to CANONICAL_NOT_EXECUTABLE without touching references", async () => {
      const input = await context("EP91", "S01", await mediaRootWith([assetFor(VILLAGE_ID)]));
      input.rules.generation.supportedProviders = input.rules.generation.supportedProviders.filter((provider) => provider !== "VEO");
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({ state: "CANONICAL_NOT_EXECUTABLE", readiness: { disposition: "BLOCKED" } });
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });

    it("maps CONFLICT to CANONICAL_NOT_EXECUTABLE without touching references", async () => {
      const input = await context("EP91", "S01", await mediaRootWith([assetFor(VILLAGE_ID)]));
      input.shot.generation.provider = "RUNWAY";
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({ state: "CANONICAL_NOT_EXECUTABLE", readiness: { disposition: "CONFLICT" } });
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });

    it("maps missing dialogue visual authorization to VISUAL_AUTHORIZATION_REQUIRED", async () => {
      const input = await readyDialogueShot();
      const deps = dependencies(nothing, null);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({
        state: "VISUAL_AUTHORIZATION_REQUIRED",
        episodeId: "EP02",
        shotId: "S02",
        readiness: { disposition: "MANUAL_REVIEW", routing: { disposition: "MANUAL_REVIEW" } },
      });
      expect(deps.readDialogueVisualAuthorization).toHaveBeenCalledExactlyOnceWith(input.mediaRoot, "EP02", "S02");
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });

    it("does not label a non-authorization MANUAL_REVIEW as VISUAL_AUTHORIZATION_REQUIRED", async () => {
      const input = await readyRunwayShot();
      // The policy schema pins visualOnlyProvider to RUNWAY; the cast reaches
      // the manual-provider MANUAL_REVIEW path that is not authorization-related.
      (input.policy.nonDialogue as { visualOnlyProvider: string }).visualOnlyProvider = "MANUAL";
      input.shot.generation.provider = "MANUAL";
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({
        state: "CANONICAL_NOT_EXECUTABLE",
        readiness: { disposition: "MANUAL_REVIEW", routing: { disposition: "ROUTABLE" } },
      });
      expect(deps.readDialogueVisualAuthorization).not.toHaveBeenCalled();
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });

    it("propagates invalid durable authorization from C1 without touching references", async () => {
      const input = await readyDialogueShot();
      const deps = dependencies(nothing, authorizationFor(input, "RUNWAY"));

      await expect(resolveDurableShotVisualGenerationState(input, deps)).rejects.toThrow(
        "Dialogue visual authorization provider RUNWAY does not match manifest generation provider VEO for EP02/S02.",
      );
      expect(deps.readRegistry).not.toHaveBeenCalled();
    });
  });

  describe("NOTHING lifecycle with EXECUTABLE readiness", () => {
    it("returns REFERENCE_UNAVAILABLE for zero approved references without reading the registry", async () => {
      const input = await readyRunwayShot();
      input.shot.references = { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" };
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({
        state: "REFERENCE_UNAVAILABLE",
        provider: "RUNWAY",
        readiness: { disposition: "EXECUTABLE" },
      });
      expect(deps.readRegistry).not.toHaveBeenCalled();
      expect(deps.verifyReference).not.toHaveBeenCalled();
    });

    it("returns READY_FOR_GENERATION only after the strict verifier accepts the single registered reference", async () => {
      const input = await readyRunwayShot();
      const deps = dependencies(nothing);
      const candidate = resolve(input.mediaRoot, ...relativePathFor(VILLAGE_ID).split("/"));

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toEqual({
        state: "READY_FOR_GENERATION",
        episodeId: "EP90",
        shotId: "S01",
        readiness: await resolveDurableShotExecutionReadiness(input, {}),
        provider: "RUNWAY",
        reference: { assetId: VILLAGE_ID, absolutePath: await realpath(candidate) },
      });
      expect(deps.readRegistry).toHaveBeenCalledExactlyOnceWith(input.mediaRoot);
      expect(deps.verifyReference).toHaveBeenCalledExactlyOnceWith({
        mediaRoot: input.mediaRoot,
        sourceImagePath: candidate,
        approvedAssetIds: [VILLAGE_ID],
        registry: await readVisualReferenceAssetRegistry(input.mediaRoot),
      });
    });

    // B5C-X1: GOOGLE_GENAI is technically executable; SUBMITTED/COMPLETED stay owned by the lifecycle precedence above.
    it("returns READY_FOR_GENERATION with provider GOOGLE_GENAI for an explicitly selected visual-only Google shot", async () => {
      const runway = await readyRunwayShot();
      const shot: Shot = { ...runway.shot, generation: { ...runway.shot.generation, provider: "GOOGLE_GENAI" } };
      const episode: EpisodeManifest = {
        ...runway.episode,
        scenes: runway.episode.scenes.map((scene) => ({ ...scene, shots: scene.shots.map((candidate) => (candidate.id === shot.id ? shot : candidate)) })),
      };
      const input = { ...runway, episode, shot };
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({
        state: "READY_FOR_GENERATION",
        episodeId: "EP90",
        shotId: "S01",
        provider: "GOOGLE_GENAI",
        readiness: { disposition: "EXECUTABLE", executionProvider: "GOOGLE_GENAI" },
        reference: { assetId: VILLAGE_ID },
      });
    });

    it("forwards its authorization reader to C1 so an authorized dialogue shot becomes READY", async () => {
      const input = await readyDialogueShot();
      const deps = dependencies(nothing, authorizationFor(input));

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toMatchObject({ state: "READY_FOR_GENERATION", provider: "VEO", reference: { assetId: OLLIE_ID } });
      expect(deps.readDialogueVisualAuthorization).toHaveBeenCalledExactlyOnceWith(input.mediaRoot, "EP02", "S02");
    });

    it("fails hard when the single approved reference is not registered", async () => {
      const input = await readyRunwayShot([assetFor(SECOND_ID)]);
      const deps = dependencies(nothing);

      await expect(resolveDurableShotVisualGenerationState(input, deps)).rejects.toThrow(
        `Approved visual reference asset ${VILLAGE_ID} for EP90/S01 is not registered.`,
      );
      expect(deps.verifyReference).not.toHaveBeenCalled();
    });

    it("propagates a missing registry as a hard failure", async () => {
      const input = await readyRunwayShot();
      await rm(resolve(input.mediaRoot, "references", "visual-reference-asset-registry.json"));

      await expect(resolveDurableShotVisualGenerationState(input, dependencies(nothing)))
        .rejects.toThrow(/Visual reference asset registry is required but does not exist/);
    });

    it("propagates a malformed registry as a hard failure", async () => {
      const input = await readyRunwayShot();
      await writeFile(resolve(input.mediaRoot, "references", "visual-reference-asset-registry.json"), "{not json");

      await expect(resolveDurableShotVisualGenerationState(input, dependencies(nothing)))
        .rejects.toThrow(/malformed JSON/);
    });

    it.each([
      ["SHA-256 drift", { sha256: "0".repeat(64) }, /SHA-256 mismatch/],
      ["byte-count drift", { bytes: PNG_BYTES.length + 1 }, /byte-count mismatch/],
      ["content-type mismatch", { contentType: "image/jpeg" as const }, /content type mismatch/],
    ])("propagates strict verifier failure for %s", async (_label, overrides, expected) => {
      const input = await readyRunwayShot([assetFor(VILLAGE_ID, overrides)]);

      await expect(resolveDurableShotVisualGenerationState(input, dependencies(nothing)))
        .rejects.toThrow(expected);
    });

    it("propagates a missing reference file as a hard failure", async () => {
      const input = await readyRunwayShot();
      await rm(resolve(input.mediaRoot, ...relativePathFor(VILLAGE_ID).split("/")));

      await expect(resolveDurableShotVisualGenerationState(input, dependencies(nothing)))
        .rejects.toThrow(/could not be resolved/);
    });

    it("propagates the verifier's realpath containment failure", async () => {
      const input = await readyRunwayShot();
      const outside = await mkdtemp(join(tmpdir(), "busybookie-outside-"));
      roots.push(outside);
      const deps = dependencies(nothing);
      deps.verifyReference.mockImplementation((verifierInput) =>
        verifyApprovedVisualReferenceAsset(verifierInput, {
          realpath: async (path) => (path === verifierInput.sourceImagePath ? join(outside, "escaped.png") : path),
        }));

      await expect(resolveDurableShotVisualGenerationState(input, deps))
        .rejects.toThrow(/outside the trusted references root/);
    });

    it("verifies every candidate and requires human selection when several references are approved", async () => {
      const input = await readyRunwayShot([assetFor(VILLAGE_ID), assetFor(SECOND_ID)]);
      input.shot.references = { ...input.shot.references, assetIds: [SECOND_ID, VILLAGE_ID] };
      const deps = dependencies(nothing);

      const result = await resolveDurableShotVisualGenerationState(input, deps);

      expect(result).toEqual({
        state: "REFERENCE_SELECTION_REQUIRED",
        episodeId: "EP90",
        shotId: "S01",
        readiness: await resolveDurableShotExecutionReadiness(input, {}),
        provider: "RUNWAY",
        candidateAssetIds: [SECOND_ID, VILLAGE_ID],
      });
      expect(deps.verifyReference.mock.calls.map(([call]) => call.sourceImagePath)).toEqual([
        resolve(input.mediaRoot, ...relativePathFor(SECOND_ID).split("/")),
        resolve(input.mediaRoot, ...relativePathFor(VILLAGE_ID).split("/")),
      ]);
    });

    it("fails hard on a corrupt second candidate instead of selecting the first valid reference", async () => {
      const input = await readyRunwayShot([assetFor(VILLAGE_ID), assetFor(SECOND_ID, { sha256: "0".repeat(64) })]);
      input.shot.references = { ...input.shot.references, assetIds: [VILLAGE_ID, SECOND_ID] };
      const deps = dependencies(nothing);

      await expect(resolveDurableShotVisualGenerationState(input, deps)).rejects.toThrow(/SHA-256 mismatch/);
      expect(deps.verifyReference).toHaveBeenCalledTimes(2);
    });

    it("fails hard when one of several approved references is unregistered", async () => {
      const input = await readyRunwayShot([assetFor(VILLAGE_ID)]);
      input.shot.references = { ...input.shot.references, assetIds: [VILLAGE_ID, SECOND_ID] };

      // The strict verifier itself requires every approved id to be registered,
      // so it rejects the set while verifying the first candidate.
      await expect(resolveDurableShotVisualGenerationState(input, dependencies(nothing))).rejects.toThrow(
        `Approved visual reference asset id is not registered: ${SECOND_ID}.`,
      );
    });

    it("fails hard on an unregistered first candidate before any verification", async () => {
      const input = await readyRunwayShot([assetFor(VILLAGE_ID)]);
      input.shot.references = { ...input.shot.references, assetIds: [SECOND_ID, VILLAGE_ID] };
      const deps = dependencies(nothing);

      await expect(resolveDurableShotVisualGenerationState(input, deps)).rejects.toThrow(
        `Approved visual reference asset ${SECOND_ID} for EP90/S01 is not registered.`,
      );
      expect(deps.verifyReference).not.toHaveBeenCalled();
    });
  });

  describe("contract and boundaries", () => {
    it("accepts only canonical context and read-only dependency seams", () => {
      expectTypeOf<keyof ResolveDurableShotVisualGenerationStateInput>()
        .toEqualTypeOf<"episode" | "shot" | "bible" | "rules" | "policy" | "mediaRoot">();
      expectTypeOf<keyof ResolveDurableShotVisualGenerationStateDependencies>()
        .toEqualTypeOf<"inspectLifecycle" | "readDialogueVisualAuthorization" | "readRegistry" | "verifyReference">();
    });

    it("imports only read-only modules and never handles paid confirmation", async () => {
      const source = await readFile("src/execution/resolveDurableShotVisualGenerationState.ts", "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

      expect(imports).toEqual([
        "node:path",
        "../schemas/character.schema.js",
        "../schemas/episodeManifest.schema.js",
        "../schemas/providerRoutingPolicy.schema.js",
        "../schemas/productionRules.schema.js",
        "../planning/executionReadiness.types.js",
        "./classifyExecutionLifecycle.js",
        "./inspectExecutionLifecycle.js",
        "./readDialogueVisualAuthorization.js",
        "./readVisualReferenceAssetRegistry.js",
        "./resolveDurableShotExecutionReadiness.js",
        "./singleShotExecution.types.js",
        "./verifyApprovedVisualReferenceAsset.js",
      ]);
      expect(source).not.toMatch(
        /confirmPaidGeneration|create[A-Z]\w*\(|reconcile|Runway[A-Z]|Veo[A-Z]|download|writeFile|mkdir|execFile|spawn|ffmpeg/,
      );
    });

    it("leaves execution-time reference verification in executeSingleShot before reservation", async () => {
      const source = (await readFile("src/execution/executeSingleShot.ts", "utf8")).replace(/\r/g, "");

      expect(source).not.toContain("resolveDurableShotVisualGenerationState");
      expect(source.indexOf(".verifyVisualReference;")).toBeGreaterThan(source.indexOf("!request.confirmPaidGeneration"));
      expect(source.indexOf(".verifyVisualReference;")).toBeLessThan(source.indexOf(".createReservation("));
    });
  });
});
