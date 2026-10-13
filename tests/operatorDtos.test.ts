import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import type { CanonicalEpisodeListing } from "../src/application/listCanonicalEpisodes.js";
import {
  createHealthDto,
  mapDialogueDto,
  mapEpisodeDetailDto,
  mapEpisodeListDto,
  mapVisualDto,
} from "../src/application/operatorDtos.js";
import type { EpisodeProductionStatus } from "../src/application/readEpisodeProductionStatus.js";
import type { DurableShotDialogueCompositionState } from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";
import type { DurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";

// Sentinels that must never appear in any serialized DTO.
const SENTINELS = [
  "D:/SECRET_MEDIA",
  "/secret/posix",
  "C:\\secret\\win",
  "SECRET_PLAN_KEY",
  "SECRET_ADMISSION_ID",
  "SECRET_ENV_VALUE",
  "SECRET_REASON_TEXT",
  "SECRET_ROUTING",
  "SECRET_ASSET_CANDIDATE",
  "SECRET_VOICE_STATUS",
  "at Object.<anonymous>",
];

function expectNoSentinels(value: unknown) {
  const json = JSON.stringify(value);
  for (const sentinel of SENTINELS) expect(json).not.toContain(sentinel.replace(/\\/g, "\\\\"));
  expect(json).not.toMatch(/[A-Za-z]:[\\/]|"\/[A-Za-z]/);
}

const READINESS = Object.freeze({
  disposition: "BLOCKED",
  executionProvider: "VEO",
  routing: { secret: "SECRET_ROUTING", path: "D:/SECRET_MEDIA/routing" },
  reasons: ["SECRET_REASON_TEXT"],
  blockers: ["S01: needs manual review.", `S01: line\nbreak\u0000here${"x".repeat(400)}`],
});

const LIFECYCLE = Object.freeze({
  state: "COMPLETED",
  reservationPath: "D:/SECRET_MEDIA/reservation.json",
  record: { path: "/secret/posix/record.json", stack: "at Object.<anonymous>" },
});

const base = { episodeId: "EP02", shotId: "S01" } as const;

const VISUAL_CASES: ReadonlyArray<readonly [DurableShotVisualGenerationState, Record<string, unknown>]> = [
  [{ ...base, state: "RESERVED_ONLY_INTERVENTION_REQUIRED", lifecycle: LIFECYCLE } as never, { state: "RESERVED_ONLY_INTERVENTION_REQUIRED" }],
  [{ ...base, state: "SUBMITTED_RECONCILIATION_REQUIRED", lifecycle: LIFECYCLE } as never, { state: "SUBMITTED_RECONCILIATION_REQUIRED" }],
  [{ ...base, state: "LIFECYCLE_COMPLETED", lifecycle: LIFECYCLE } as never, { state: "LIFECYCLE_COMPLETED" }],
  [{ ...base, state: "CANONICAL_NOT_EXECUTABLE", readiness: READINESS } as never, { state: "CANONICAL_NOT_EXECUTABLE", readiness: expectedReadiness() }],
  [{ ...base, state: "VISUAL_AUTHORIZATION_REQUIRED", readiness: READINESS } as never, { state: "VISUAL_AUTHORIZATION_REQUIRED", readiness: expectedReadiness() }],
  [{ ...base, state: "REFERENCE_UNAVAILABLE", readiness: READINESS, provider: "RUNWAY" } as never, { state: "REFERENCE_UNAVAILABLE", readiness: expectedReadiness(), provider: "RUNWAY" }],
  [
    { ...base, state: "REFERENCE_SELECTION_REQUIRED", readiness: READINESS, provider: "VEO", candidateAssetIds: ["SECRET_ASSET_CANDIDATE", "b"] } as never,
    { state: "REFERENCE_SELECTION_REQUIRED", readiness: expectedReadiness(), provider: "VEO", candidateReferenceCount: 2 },
  ],
  [
    { ...base, state: "READY_FOR_GENERATION", readiness: READINESS, provider: "VEO", reference: { assetId: "ollie-ref-01", absolutePath: "D:/SECRET_MEDIA/ref.png" } } as never,
    { state: "READY_FOR_GENERATION", readiness: expectedReadiness(), provider: "VEO", referenceAssetId: "ollie-ref-01" },
  ],
];

function expectedReadiness() {
  return {
    disposition: "BLOCKED",
    executionProvider: "VEO",
    blockers: ["S01: needs manual review.", `S01: line break here${"x".repeat(300 - "S01: line break here".length)}...`],
  };
}

const dbase = { episodeId: "EP02", sceneId: "SC01", shotId: "S02" } as const;
const BLOCKERS = [
  { reason: "UNKNOWN_DIALOGUE_CHARACTER", lineNumber: 1, dialogueLineId: "EP02_SC01_S02_L01", characterId: "OLLIE" },
  { reason: "VOICE_NOT_LOCKED", lineNumber: 2, dialogueLineId: "EP02_SC01_S02_L02", characterId: "KACEY", voiceSelectionStatus: "SECRET_VOICE_STATUS" },
];
const EXPECTED_BLOCKERS = BLOCKERS.map(({ reason, lineNumber, dialogueLineId, characterId }) => ({ reason, lineNumber, dialogueLineId, characterId }));
const WORK = [{ dialogueLineId: "EP02_SC01_S02_L01", namespace: "LINE_SCOPED", planKey: "SECRET_PLAN_KEY", state: "SUBMITTED" }];
const EXPECTED_WORK = [{ dialogueLineId: "EP02_SC01_S02_L01", namespace: "LINE_SCOPED", state: "SUBMITTED" }];
const LINES = { reservedLineIds: ["L1"], submittedLineIds: ["L2"], missingLineIds: ["L3"] };

const DIALOGUE_CASES: ReadonlyArray<readonly [DurableShotDialogueCompositionState, Record<string, unknown>]> = [
  [{ ...dbase, state: "NO_DIALOGUE" } as never, { state: "NO_DIALOGUE" }],
  [{ ...dbase, state: "PLACEMENT_REQUIRED", dialoguePlanKey: "SECRET_PLAN_KEY" } as never, { state: "PLACEMENT_REQUIRED" }],
  [{ ...dbase, state: "DIALOGUE_PLANNING_BLOCKED", blockers: BLOCKERS } as never, { state: "DIALOGUE_PLANNING_BLOCKED", blockers: EXPECTED_BLOCKERS }],
  [
    { ...dbase, state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED", blockers: BLOCKERS, activeWork: WORK } as never,
    { state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED", blockers: EXPECTED_BLOCKERS, activeWork: EXPECTED_WORK },
  ],
  [
    { ...dbase, state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED", dialoguePlanKey: "SECRET_PLAN_KEY", staleWork: WORK, ...LINES } as never,
    { state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED", staleWork: EXPECTED_WORK, ...LINES },
  ],
  [
    { ...dbase, state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED", dialoguePlanKey: "SECRET_PLAN_KEY", ...LINES } as never,
    { state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED", ...LINES },
  ],
  [
    {
      ...dbase,
      state: "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
      openAdmissions: [
        { dialogueLineId: "L1", attemptNumber: 2, admissionId: "SECRET_ADMISSION_ID", planKey: "SECRET_PLAN_KEY", generationNamespace: "DIRECT_SEED_AUDIO", matchesCurrentCanonicalPlan: false },
      ],
    } as never,
    {
      state: "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
      openAdmissions: [{ dialogueLineId: "L1", attemptNumber: 2, generationNamespace: "DIRECT_SEED_AUDIO", matchesCurrentCanonicalPlan: false }],
    },
  ],
  [
    { ...dbase, state: "DIALOGUE_RECONCILIATION_REQUIRED", dialoguePlanKey: "SECRET_PLAN_KEY", submittedLineIds: ["L2"], missingLineIds: ["L3"] } as never,
    { state: "DIALOGUE_RECONCILIATION_REQUIRED", submittedLineIds: ["L2"], missingLineIds: ["L3"] },
  ],
  [
    { ...dbase, state: "DIALOGUE_AUDIO_REQUIRED", dialoguePlanKey: "SECRET_PLAN_KEY", missingLineIds: ["L3"] } as never,
    { state: "DIALOGUE_AUDIO_REQUIRED", missingLineIds: ["L3"] },
  ],
  [
    {
      ...dbase,
      state: "COMPOSITION_AUDIO_RESOLVED",
      dialoguePlanKey: "SECRET_PLAN_KEY",
      audioPlan: { lines: [{ sourceAudioPath: "D:/SECRET_MEDIA/a.audio" }, { sourceAudioPath: "/secret/posix/b.audio" }] },
    } as never,
    { state: "COMPOSITION_AUDIO_RESOLVED", resolvedLineCount: 2 },
  ],
];

const VISUAL_STATE_NAMES = VISUAL_CASES.map(([state]) => state.state);
const DIALOGUE_STATE_NAMES = DIALOGUE_CASES.map(([state]) => state.state);

function counts(names: readonly string[], extra: Record<string, number> = {}) {
  return { ...Object.fromEntries(names.map((name, index) => [name, index])), ...extra };
}

function status(overrides: Partial<{ visual: unknown; dialogue: unknown; summaryVisual: unknown }> = {}): EpisodeProductionStatus {
  return {
    episode: {
      episodeId: "EP02",
      title: "Ollie finds a shell",
      scenes: [{ prompt: "SECRET_ENV_VALUE" }],
      generation: { path: "D:/SECRET_MEDIA" },
    },
    state: {
      episodeId: "EP02",
      shots: [
        {
          order: 1,
          sceneId: "SC01",
          shotId: "S01",
          visualGenerationState: overrides.visual ?? VISUAL_CASES[7]![0],
          dialogueCompositionState: overrides.dialogue ?? DIALOGUE_CASES[9]![0],
        },
      ],
      summary: {
        totalShots: 1,
        visualGenerationStates: overrides.summaryVisual ?? counts(VISUAL_STATE_NAMES, { SECRET_EXTRA_STATE: 7 }),
        dialogueCompositionStates: counts(DIALOGUE_STATE_NAMES),
      },
    },
  } as unknown as EpisodeProductionStatus;
}

describe("D1 DTO allowlist: visual states", () => {
  it("covers every backend visual state exactly once", () => {
    expect(new Set(VISUAL_STATE_NAMES).size).toBe(8);
  });

  it.each(VISUAL_CASES.map(([input, expected]) => [input.state, input, expected] as const))(
    "%s maps to its exact allowlisted shape",
    (_name, input, expected) => {
      const dto = mapVisualDto(input);
      expect(dto).toStrictEqual(expected);
      expectNoSentinels(dto);
    },
  );

  it("an unknown visual state throws instead of passing through", () => {
    expect(() => mapVisualDto({ ...base, state: "NEW_UNKNOWN_STATE" } as never)).toThrow(
      "Unsupported visual state for the operator DTO boundary.",
    );
  });
});

describe("D1 DTO allowlist: dialogue states", () => {
  it("covers every backend dialogue state exactly once", () => {
    expect(new Set(DIALOGUE_STATE_NAMES).size).toBe(10);
  });

  it.each(DIALOGUE_CASES.map(([input, expected]) => [input.state, input, expected] as const))(
    "%s maps to its exact allowlisted shape",
    (_name, input, expected) => {
      const dto = mapDialogueDto(input);
      expect(dto).toStrictEqual(expected);
      expectNoSentinels(dto);
    },
  );

  it("an unknown dialogue state throws instead of passing through", () => {
    expect(() => mapDialogueDto({ ...dbase, state: "NEW_UNKNOWN_STATE" } as never)).toThrow(
      "Unsupported dialogue state for the operator DTO boundary.",
    );
  });
});

describe("D1 DTO allowlist: episode documents", () => {
  it("health is a fixed, content-free document", () => {
    expect(createHealthDto()).toStrictEqual({ apiVersion: "v1", status: "ok", readOnly: true });
  });

  it("list items are VALID manifest summaries or bare INVALID markers", () => {
    const listing: CanonicalEpisodeListing[] = [
      { episodeId: "EP02", manifest: "VALID", title: "A\ntitle", sceneCount: 1, shotCount: 2 },
      { episodeId: "EP03", manifest: "INVALID" },
    ];
    expect(mapEpisodeListDto(listing)).toStrictEqual({
      apiVersion: "v1",
      episodes: [
        { episodeId: "EP02", manifest: "VALID", title: "A title", sceneCount: 1, shotCount: 2 },
        { episodeId: "EP03", manifest: "INVALID" },
      ],
    });
  });

  it("detail carries only allowlisted episode, summary and shot fields", () => {
    const dto = mapEpisodeDetailDto(status(), new Date("2026-10-13T12:00:00.000Z"));
    expect(Object.keys(dto)).toEqual(["apiVersion", "episodeId", "title", "evaluatedAt", "summary", "shots"]);
    expect(dto.evaluatedAt).toBe("2026-10-13T12:00:00.000Z");
    expect(Object.keys(dto.summary.visualGenerationStates).sort()).toEqual([...VISUAL_STATE_NAMES].sort());
    expect(Object.keys(dto.summary.dialogueCompositionStates).sort()).toEqual([...DIALOGUE_STATE_NAMES].sort());
    expect(dto.shots).toStrictEqual([
      {
        order: 1,
        sceneId: "SC01",
        shotId: "S01",
        visual: VISUAL_CASES[7]![1],
        dialogue: { state: "COMPOSITION_AUDIO_RESOLVED", resolvedLineCount: 2 },
      },
    ]);
    expectNoSentinels(dto);
    expect(JSON.stringify(dto)).not.toContain("SECRET_EXTRA_STATE");
  });

  it("rejects an evaluated state for a different episode and a non-integer summary count", () => {
    const mismatched = status();
    (mismatched.state as { episodeId: string }).episodeId = "EP03";
    expect(() => mapEpisodeDetailDto(mismatched, new Date())).toThrow(
      "Operator DTO episode identity does not match the evaluated state.",
    );
    expect(() =>
      mapEpisodeDetailDto(status({ summaryVisual: counts(VISUAL_STATE_NAMES, { LIFECYCLE_COMPLETED: -1 }) }), new Date()),
    ).toThrow("Operator DTO summary count is not a non-negative integer.");
  });

  it("documents episodeId scope as the current engine instance and adds no tenancy fields", async () => {
    const source = await readFile(new URL("../src/application/operatorDtos.ts", import.meta.url), "utf8");
    const prose = source.replace(/\s*\/\/\s*/g, " ").replace(/\s+/g, " ");
    expect(prose).toContain("identifies an episode within the current BusyBookie engine/production instance");
    expect(prose).toContain("It is not a globally unique or multi-tenant identifier.");
    expect(source).not.toMatch(/organisationId|organizationId|tenantId|workspaceId|projectId|agentId/);
    expect(source).not.toMatch(/busybookie\.(com|ai)/i);
    expect(source).not.toMatch(/\.\.\.(status|state|episode|visual|dialogue|shot|entry)\b/);
  });
});
