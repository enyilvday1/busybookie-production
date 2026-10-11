import {
  readFile,
} from "node:fs/promises";

import {
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

import {
  evaluateShotExecutionReadiness,
} from "../src/planning/evaluateShotExecutionReadiness.js";

import type {
  DialogueVisualAuthorization,
} from "../src/execution/dialogueVisualAuthorization.schema.js";

import {
  resolveDurableShotExecutionReadiness,
  type ResolveDurableShotExecutionReadinessDependencies,
  type ResolveDurableShotExecutionReadinessInput,
} from "../src/execution/resolveDurableShotExecutionReadiness.js";

import type {
  DialogueVisualAuthorizationReader,
} from "../src/execution/singleShotExecution.types.js";

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

const mediaRoot = "controlled-media-root";

function requireShot(episode: EpisodeManifest, shotId: string): Shot {
  for (const scene of episode.scenes) {
    const shot = scene.shots.find((candidate) => candidate.id === shotId);
    if (shot) {
      return shot;
    }
  }
  throw new Error(`Expected ${episode.episodeId} ${shotId}.`);
}

async function context(episodeId: string, shotId: string) {
  const [episode, bible, rules, policy] = await Promise.all([
    loadEpisodeManifest(episodeId),
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);
  return { episode, shot: requireShot(episode, shotId), bible, rules, policy, mediaRoot };
}

// In-memory EP02 S02 made generation-ready, mirroring makeS02Ready in the
// execution integration tests.
async function generationReadyDialogueShot() {
  const input = await context("EP02", "S02");
  input.episode.status = "READY_FOR_GENERATION";
  input.episode.approvals.script = "APPROVED";
  input.episode.approvals.storyboard = "APPROVED";
  input.episode.approvals.references = "APPROVED";
  input.shot.references = {
    required: true,
    assetIds: ["OLLIE_CHARACTER_MASTER_REFERENCE_V1"],
    approvalStatus: "APPROVED",
  };
  input.shot.generation.provider = "VEO";
  input.shot.generation.nativeAudio = true;
  input.shot.generation.status = "APPROVED_FOR_GENERATION";
  return input;
}

function authorizationFor(
  input: ResolveDurableShotExecutionReadinessInput,
  overrides: Partial<DialogueVisualAuthorization> = {},
): DialogueVisualAuthorization {
  return {
    schemaVersion: "1.0",
    authorizationId: "11111111-1111-4111-8111-111111111111",
    authorizedAt: "2026-10-11T12:00:00.000Z",
    status: "AUTHORIZED",
    episodeId: input.episode.episodeId,
    shotId: input.shot.id,
    purpose: "DIALOGUE_VISUAL_GENERATION",
    provider: "VEO",
    nativeAudioDisposition: "DISCARD_AFTER_VISUAL_GENERATION",
    dialogueAuthority: "EXTERNAL_VERIFIED_DIALOGUE",
    authorizationSource: "HUMAN_OPERATOR",
    ...overrides,
  };
}

function reader(result: DialogueVisualAuthorization | null) {
  return vi.fn<DialogueVisualAuthorizationReader>(async () => result);
}

function canonical(input: ResolveDurableShotExecutionReadinessInput) {
  return evaluateShotExecutionReadiness(input.episode, input.shot, input.bible, input.rules, input.policy);
}

function durablyResolved(input: ResolveDurableShotExecutionReadinessInput, authorization: DialogueVisualAuthorization) {
  return evaluateShotExecutionReadiness(input.episode, input.shot, input.bible, input.rules, input.policy, {
    provider: authorization.provider,
    source: "DURABLE_DIALOGUE_VISUAL_AUTHORIZATION",
  });
}

describe("durable authorization-aware shot execution readiness", () => {
  describe("canonical dispositions that never consult durable authorization", () => {
    it("returns an EXECUTABLE non-dialogue shot unchanged without reading authorization", async () => {
      const input = await context("EP90", "S01");
      const read = reader(null);

      const result = await resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: read });

      expect(result.disposition).toBe("EXECUTABLE");
      expect(result).toEqual(canonical(input));
      expect(read).not.toHaveBeenCalled();
    });

    it("returns NOT_READY unchanged without reading authorization", async () => {
      const input = await context("EP90", "S01");
      input.episode.status = "DRAFT";
      const read = reader(null);

      const result = await resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: read });

      expect(result.disposition).toBe("NOT_READY");
      expect(result).toEqual(canonical(input));
      expect(read).not.toHaveBeenCalled();
    });

    it("returns BLOCKED unchanged without reading authorization", async () => {
      const input = await context("EP91", "S01");
      input.rules.generation.supportedProviders = input.rules.generation.supportedProviders
        .filter((provider) => provider !== "VEO");
      const read = reader(null);

      const result = await resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: read });

      expect(result.disposition).toBe("BLOCKED");
      expect(result).toEqual(canonical(input));
      expect(read).not.toHaveBeenCalled();
    });

    it("returns CONFLICT unchanged without reading authorization", async () => {
      const input = await context("EP91", "S01");
      input.shot.generation.provider = "RUNWAY";
      const read = reader(null);

      const result = await resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: read });

      expect(result.disposition).toBe("CONFLICT");
      expect(result).toEqual(canonical(input));
      expect(read).not.toHaveBeenCalled();
    });

    it("returns MANUAL_REVIEW from a MANUAL execution provider unchanged when routing is not MANUAL_REVIEW", async () => {
      const input = await context("EP90", "S01");
      // The policy schema pins visualOnlyProvider to RUNWAY, so this path is
      // unreachable with a valid policy; the cast exercises the defensive
      // routing half of the gate that executeSingleShot has always had.
      (input.policy.nonDialogue as { visualOnlyProvider: string }).visualOnlyProvider = "MANUAL";
      input.shot.generation.provider = "MANUAL";
      const read = reader(null);

      const result = await resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: read });

      expect(result.disposition).toBe("MANUAL_REVIEW");
      expect(result.routing.disposition).not.toBe("MANUAL_REVIEW");
      expect(result).toEqual(canonical(input));
      expect(read).not.toHaveBeenCalled();
    });

    it("does not require the authorization reader when durable resolution is not needed", async () => {
      const input = await context("EP90", "S01");

      await expect(resolveDurableShotExecutionReadiness(input, {})).resolves.toEqual(canonical(input));
      await expect(resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: undefined }))
        .resolves.toEqual(canonical(input));
    });
  });

  describe("dialogue MANUAL_REVIEW durable authorization resolution", () => {
    it("reads once with the exact identity and keeps MANUAL_REVIEW when no authorization exists", async () => {
      const input = await generationReadyDialogueShot();
      const initial = canonical(input);
      expect(initial.disposition).toBe("MANUAL_REVIEW");
      expect(initial.routing.disposition).toBe("MANUAL_REVIEW");
      const read = reader(null);

      const result = await resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: read });

      expect(read).toHaveBeenCalledExactlyOnceWith(mediaRoot, "EP02", "S02");
      expect(result).toEqual(initial);
    });

    it("re-evaluates a valid VEO authorization with the exact durable resolution", async () => {
      const input = await generationReadyDialogueShot();
      const authorization = authorizationFor(input);

      const result = await resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: reader(authorization) },
      );

      expect(result).toEqual(durablyResolved(input, authorization));
      expect(result.disposition).toBe("EXECUTABLE");
      expect(result.executionProvider).toBe("VEO");
      expect(result.reasons).toContain(
        "S02: dialogue visual provider VEO was explicitly resolved by durable human authorization.",
      );
    });

    it("returns the second canonical evaluation instead of forcing EXECUTABLE", async () => {
      const input = await generationReadyDialogueShot();
      input.episode.status = "DRAFT";
      const authorization = authorizationFor(input);

      const result = await resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: reader(authorization) },
      );

      expect(result).toEqual(durablyResolved(input, authorization));
      expect(result.disposition).toBe("NOT_READY");
      expect(result.blockers.join(" ")).toMatch(/status is DRAFT/);
    });

    it("rejects an authorization provider that differs from the manifest provider", async () => {
      const input = await generationReadyDialogueShot();

      await expect(resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: reader(authorizationFor(input, { provider: "RUNWAY" })) },
      )).rejects.toThrow(
        "Dialogue visual authorization provider RUNWAY does not match manifest generation provider VEO for EP02/S02.",
      );
    });

    it("rejects an authorization for a different episode", async () => {
      const input = await generationReadyDialogueShot();

      await expect(resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: reader(authorizationFor(input, { episodeId: "EP91" })) },
      )).rejects.toThrow("Dialogue visual authorization episode EP91 does not match execution episode EP02.");
    });

    it("rejects an authorization for a different shot", async () => {
      const input = await generationReadyDialogueShot();

      await expect(resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: reader(authorizationFor(input, { shotId: "S01" })) },
      )).rejects.toThrow("Dialogue visual authorization shot S01 does not match execution shot S02.");
    });

    it("checks episode identity before shot and provider identity", async () => {
      const input = await generationReadyDialogueShot();

      await expect(resolveDurableShotExecutionReadiness(
        input,
        {
          readDialogueVisualAuthorization: reader(
            authorizationFor(input, { episodeId: "EP91", shotId: "S01", provider: "RUNWAY" }),
          ),
        },
      )).rejects.toThrow(/episode EP91 does not match execution episode EP02/);
    });

    it("schema-parses injected authorization before trusting its identity or provider", async () => {
      const input = await generationReadyDialogueShot();
      const invalid = {
        ...authorizationFor(input, { episodeId: "EP91", provider: "RUNWAY" }),
        status: "REVOKED",
      } as unknown as DialogueVisualAuthorization;

      const failure = resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: reader(invalid) },
      );

      await expect(failure).rejects.toThrow();
      await expect(failure).rejects.toMatchObject({ name: "ZodError" });
    });

    it("propagates authorization reader failures unchanged", async () => {
      const input = await generationReadyDialogueShot();
      const failure = new Error("Dialogue visual authorization contains malformed JSON: controlled");

      await expect(resolveDurableShotExecutionReadiness(
        input,
        { readDialogueVisualAuthorization: vi.fn<DialogueVisualAuthorizationReader>(async () => { throw failure; }) },
      )).rejects.toBe(failure);
    });

    it("fails closed without a filesystem fallback when the required reader is missing", async () => {
      const input = await generationReadyDialogueShot();

      await expect(resolveDurableShotExecutionReadiness(input, {})).rejects.toThrow(
        "readDialogueVisualAuthorization dependency is required to resolve dialogue visual MANUAL_REVIEW.",
      );
      await expect(resolveDurableShotExecutionReadiness(input, { readDialogueVisualAuthorization: undefined }))
        .rejects.toThrow("readDialogueVisualAuthorization dependency is required to resolve dialogue visual MANUAL_REVIEW.");
    });
  });

  describe("contract", () => {
    it("accepts only canonical context and the optional authorization reader", () => {
      expectTypeOf<keyof ResolveDurableShotExecutionReadinessInput>()
        .toEqualTypeOf<"episode" | "shot" | "bible" | "rules" | "policy" | "mediaRoot">();
      expectTypeOf<keyof ResolveDurableShotExecutionReadinessDependencies>()
        .toEqualTypeOf<"readDialogueVisualAuthorization">();
    });

    it("keeps the resolver read-only and free of execution side effects", async () => {
      const source = await readFile("src/execution/resolveDurableShotExecutionReadiness.ts", "utf8");
      const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);

      expect(imports).toEqual([
        "../schemas/character.schema.js",
        "../schemas/episodeManifest.schema.js",
        "../schemas/providerRoutingPolicy.schema.js",
        "../schemas/productionRules.schema.js",
        "../planning/executionReadiness.types.js",
        "../planning/evaluateShotExecutionReadiness.js",
        "./dialogueVisualAuthorization.schema.js",
        "./singleShotExecution.types.js",
      ]);
      expect(source).not.toMatch(
        /node:|readDialogueVisualAuthorization\.js|createDialogueVisualAuthorization|Reservation|Submission|Completion|verifyVisualReference|confirmPaidGeneration|reconcile|Runway|Veo|execFile|spawn|writeFile/,
      );
    });

    it("delegates executeSingleShot readiness to this resolver", async () => {
      const source = await readFile("src/execution/executeSingleShot.ts", "utf8");

      expect(source).toContain("await resolveDurableShotExecutionReadiness(");
      expect(source).not.toMatch(/evaluateShotExecutionReadiness|DialogueVisualAuthorizationSchema/);
      expect(source.indexOf("resolveDurableShotExecutionReadiness(\n"))
        .toBeLessThan(source.indexOf("confirmPaidGeneration"));
    });
  });
});
