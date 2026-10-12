import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  admitDialogueLineGeneration,
  createDialogueGenerationAdmission,
  type AdmitDialogueLineGenerationDependencies,
  type DialogueLineGenerationAdmissionInput,
} from "../src/dialogue/admitDialogueLineGeneration.js";
import { buildShotDialoguePlan, type ShotDialoguePlan } from "../src/dialogue/buildShotDialoguePlan.js";
import { createDialogueDirectSeedAudioReservation } from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";
import { createDialogueReservation } from "../src/dialogue/createDialogueReservation.js";
import {
  DialogueGenerationAdmissionSchema,
  type DialogueGenerationAdmission,
} from "../src/dialogue/dialogueGenerationAdmission.schema.js";
import {
  createDialogueGenerationAdmissionDirectory,
  createDialogueGenerationAdmissionFileName,
  createDialogueGenerationAdmissionPath,
  parseDialogueGenerationLedgerFileName,
} from "../src/dialogue/dialogueGenerationAdmissionPaths.js";
import { createDialogueReservationPath } from "../src/dialogue/dialogueReservationPath.js";
import {
  inspectDialogueGenerationAdmissionLedger,
  type DialogueGenerationAdmissionLedger,
} from "../src/dialogue/inspectDialogueGenerationAdmissionLedger.js";
import type { DialogueLineGenerationEvidence } from "../src/dialogue/inspectDialogueLineGenerationEvidence.js";
import type { CharacterBible } from "../src/schemas/character.schema.js";
import type { EpisodeManifest } from "../src/schemas/episodeManifest.schema.js";
import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";

// C6a shared paid dialogue generation admission (R1: resumable, no abandon).
// Every durable test runs on a fresh temp media root; nothing contacts a provider.

const LINE = "EP02_SC01_S02_L01";
const OLD_PLAN = "0".repeat(64);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mediaRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-c6a-admission-"));
  roots.push(root);
  return root;
}

type Speaker = "OLLIE" | "KACEY";

// OLLIE executes as DIRECT_SEED_AUDIO (reference voice); KACEY as LINE_SCOPED.
async function canonical(
  speaker: Speaker = "OLLIE",
  text?: string,
): Promise<{ episode: EpisodeManifest; bible: CharacterBible; plan: ShotDialoguePlan }> {
  const [loaded, bible] = await Promise.all([loadEpisodeManifest("EP02"), loadCharacterBible()]);
  const episode = structuredClone(loaded);
  const scene = episode.scenes[0]!;
  const shot = scene.shots[1]!;
  const template = shot.dialogue[0]!;
  shot.dialogue = [{ ...template, characterId: speaker, text: text ?? template.text }];
  shot.characters = [speaker];
  const plan = buildShotDialoguePlan({ episodeId: episode.episodeId, sceneId: scene.id, shot, bible });
  return { episode, bible, plan };
}

function admissionInput(
  root: string,
  plan: ShotDialoguePlan,
  overrides: Partial<DialogueLineGenerationAdmissionInput> = {},
): DialogueLineGenerationAdmissionInput {
  const line = plan.lines[0]!;
  const reference = "executionMode" in line.voice && line.voice.executionMode === "RUNWAY_REFERENCE_AUDIO";
  return {
    mediaRoot: root,
    plan,
    dialogueLineId: line.dialogueLineId,
    generationNamespace: reference ? "DIRECT_SEED_AUDIO" : "LINE_SCOPED",
    confirmPaidGeneration: true,
    ...overrides,
  };
}

async function ledgerFiles(root: string): Promise<string[]> {
  const directory = createDialogueGenerationAdmissionDirectory(root, "EP02", "SC01", "S02", LINE);
  try {
    return (await readdir(directory)).sort();
  } catch {
    return [];
  }
}

function record(overrides: Partial<DialogueGenerationAdmission> = {}): DialogueGenerationAdmission {
  return DialogueGenerationAdmissionSchema.parse({
    schemaVersion: "1.0",
    admissionId: "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    attemptNumber: 1,
    admittedAt: "2026-10-12T10:00:00.000Z",
    status: "ADMITTED",
    episodeId: "EP02",
    sceneId: "SC01",
    shotId: "S02",
    dialogueLineId: LINE,
    planKey: "a".repeat(64),
    generationNamespace: "DIRECT_SEED_AUDIO",
    provider: "RUNWAY",
    ...overrides,
  });
}

describe("C6a admission schema and path contract", () => {
  it("binds one ledger directory to the canonical line, outside both namespaces and planKey", () => {
    const root = join(tmpdir(), "c6a-path-root");
    const directory = createDialogueGenerationAdmissionDirectory(root, "EP02", "SC01", "S02", LINE);

    expect(directory).toBe(join(root, "voices", "EP02", "S02", LINE, "generation-admission"));
    expect(directory).not.toMatch(/direct-seed-audio|RUNWAY|[0-9a-f]{64}/);
    expect(createDialogueGenerationAdmissionFileName(LINE, 7)).toBe(`${LINE}_a7.dialogue-generation-admission.json`);
    expect(createDialogueGenerationAdmissionPath(root, "EP02", "SC01", "S02", LINE, 2)).toBe(
      `${directory}${sep}${LINE}_a2.dialogue-generation-admission.json`,
    );
  });

  it("rejects relative roots, unsafe ids, mismatched identity and non-positive attempts", () => {
    expect(() => createDialogueGenerationAdmissionDirectory("relative", "EP02", "SC01", "S02", LINE)).toThrow(/absolute/);
    expect(() => createDialogueGenerationAdmissionDirectory(" ", "EP02", "SC01", "S02", LINE)).toThrow(/required/);
    expect(() => createDialogueGenerationAdmissionDirectory(tmpdir(), "EP02", "SC02", "S02", LINE)).toThrow(/identity/);
    expect(() => createDialogueGenerationAdmissionDirectory(tmpdir(), "EP02", "SC01", "S02", "../x")).toThrow();
    expect(() => createDialogueGenerationAdmissionFileName(LINE, 0)).toThrow();
    expect(() => createDialogueGenerationAdmissionFileName(LINE, 1.5)).toThrow();
  });

  it("parses only the exact canonical admission file names", () => {
    expect(parseDialogueGenerationLedgerFileName(`${LINE}_a1.dialogue-generation-admission.json`, LINE)).toEqual({
      kind: "ADMISSION",
      attemptNumber: 1,
    });
    for (const name of [
      `${LINE}_a0.dialogue-generation-admission.json`,
      `${LINE}_a01.dialogue-generation-admission.json`,
      `${LINE}_a-1.dialogue-generation-admission.json`,
      `${LINE}_a1.dialogue-generation-abandonment.json`,
      `EP02_SC01_S02_L02_a1.dialogue-generation-admission.json`,
      `${LINE}_a1.dialogue-generation-admission.json.bak`,
      `${LINE}_a99999999999999999999.dialogue-generation-admission.json`,
    ]) {
      expect(parseDialogueGenerationLedgerFileName(name, LINE)).toBeNull();
    }
  });

  it("schema is strict, identity-checked and has no abandonment or planKey/namespace identity", () => {
    expect(record().generationNamespace).toBe("DIRECT_SEED_AUDIO");
    expect(() => record({ dialogueLineId: "EP02_SC01_S03_L01" })).toThrow();
    expect(() => record({ status: "ABANDONED" as never })).toThrow();
    expect(() => record({ generationNamespace: "OTHER" as never })).toThrow();
    expect(() => record({ provider: "VEO" as never })).toThrow();
    expect(() => DialogueGenerationAdmissionSchema.parse({ ...record(), extra: true })).toThrow();
    expect(() => record({ attemptNumber: 0 })).toThrow();
  });
});

describe("C6a admission ledger reader", () => {
  async function seed(root: string, admission: DialogueGenerationAdmission): Promise<void> {
    await createDialogueGenerationAdmission(root, admission);
  }

  it("no ledger directory is an empty ledger (and never permission by itself)", async () => {
    const root = await mediaRoot();
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger).toEqual({ dialogueLineId: LINE, attempts: [], latest: null });
  });

  it("classifies a latest attempt with no bound reservation as PRE_RESERVATION_OPEN", async () => {
    const root = await mediaRoot();
    await seed(root, record());
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger.latest?.attemptState).toBe("PRE_RESERVATION_OPEN");
    expect(ledger.latest?.admission.attemptNumber).toBe(1);
  });

  it("classifies a bound reservation as RESERVED_ONLY_OPEN (never closed)", async () => {
    const root = await mediaRoot();
    await seed(root, record());
    await createDialogueDirectSeedAudioReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: "a".repeat(64),
      provider: "RUNWAY",
    });
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger.latest?.attemptState).toBe("RESERVED_ONLY_OPEN");
  });

  it("line-scoped bound evidence under another planKey is a hard failure", async () => {
    const root = await mediaRoot();
    await seed(root, record({ generationNamespace: "LINE_SCOPED" }));
    await createDialogueReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: OLD_PLAN,
      provider: "RUNWAY",
    });
    await expect(inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE)).rejects.toThrow(
      /line-scoped evidence belongs to plan/,
    );
  });

  it.each([
    ["a gap", async (root: string) => {
      await seed(root, record());
      await seed(root, record({ attemptNumber: 3, admissionId: "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e50" }));
    }, /not contiguous/],
    ["a stray file", async (root: string) => {
      await seed(root, record());
      const directory = createDialogueGenerationAdmissionDirectory(root, "EP02", "SC01", "S02", LINE);
      await writeFile(join(directory, `${LINE}_a1.dialogue-generation-abandonment.json`), "{}");
    }, /Unexpected file/],
    ["a non-file entry", async (root: string) => {
      const directory = createDialogueGenerationAdmissionDirectory(root, "EP02", "SC01", "S02", LINE);
      await mkdir(join(directory, `${LINE}_a1.dialogue-generation-admission.json`), { recursive: true });
    }, /non-file/],
    ["malformed JSON", async (root: string) => {
      const path = createDialogueGenerationAdmissionPath(root, "EP02", "SC01", "S02", LINE, 1);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "{");
    }, /malformed JSON/],
    ["a schema violation", async (root: string) => {
      const path = createDialogueGenerationAdmissionPath(root, "EP02", "SC01", "S02", LINE, 1);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ ...record(), status: "ABANDONED" }));
    }, /is invalid/],
    ["a record whose attempt differs from its path", async (root: string) => {
      const path = createDialogueGenerationAdmissionPath(root, "EP02", "SC01", "S02", LINE, 1);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(record({ attemptNumber: 2 })));
    }, /does not match its deterministic path/],
    ["an earlier attempt that is still open", async (root: string) => {
      await seed(root, record());
      await seed(root, record({ attemptNumber: 2, admissionId: "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e51" }));
    }, /although a later attempt exists/],
  ] as const)("fails hard on %s", async (_label, arrange, expected) => {
    const root = await mediaRoot();
    await arrange(root);
    await expect(inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE)).rejects.toThrow(expected);
  });

  it("ignores canonical .part temp files left by an interrupted create-once writer", async () => {
    const root = await mediaRoot();
    await seed(root, record());
    const directory = createDialogueGenerationAdmissionDirectory(root, "EP02", "SC01", "S02", LINE);
    await writeFile(
      join(directory, `${LINE}_a2.dialogue-generation-admission.json.part-123-0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f`),
      "{",
    );
    const ledger = await inspectDialogueGenerationAdmissionLedger(root, "EP02", "SC01", "S02", LINE);
    expect(ledger.attempts).toHaveLength(1);
  });

  it("the create-once writer fails closed on an existing attempt (no overwrite, no N+2)", async () => {
    const root = await mediaRoot();
    await createDialogueGenerationAdmission(root, record());
    await expect(
      createDialogueGenerationAdmission(root, record({ admissionId: "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e52" })),
    ).rejects.toThrow(/already exists/);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });
});

describe("C6a shared admission gate (real temp filesystem)", () => {
  it("A cross-namespace concurrent first admissions: exactly one admission succeeds", async () => {
    const root = await mediaRoot();
    const seed = await canonical("OLLIE");
    const preset = await canonical("KACEY");
    expect(seed.plan.lines[0]!.dialogueLineId).toBe(preset.plan.lines[0]!.dialogueLineId);

    const results = await Promise.allSettled([
      admitDialogueLineGeneration(admissionInput(root, seed.plan)),
      admitDialogueLineGeneration(admissionInput(root, preset.plan)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it("B cross-plan concurrent first admissions: exactly one admission succeeds", async () => {
    const root = await mediaRoot();
    const first = await canonical("OLLIE");
    const second = await canonical("OLLIE", "A different canonical line text.");
    expect(first.plan.planKey).not.toBe(second.plan.planKey);

    const results = await Promise.allSettled([
      admitDialogueLineGeneration(admissionInput(root, first.plan)),
      admitDialogueLineGeneration(admissionInput(root, second.plan)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it("C same plan and namespace concurrently: one admission record; any other caller fails or resumes it", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");

    const results = await Promise.allSettled([
      admitDialogueLineGeneration(admissionInput(root, plan)),
      admitDialogueLineGeneration(admissionInput(root, plan)),
      admitDialogueLineGeneration(admissionInput(root, plan)),
    ]);
    const fulfilled = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));

    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
    expect(fulfilled.filter((value) => value.disposition === "ADMITTED")).toHaveLength(1);
    expect(new Set(fulfilled.map((value) => value.admission.admissionId)).size).toBe(1);
  });

  it("D exact resume reuses the open pre-reservation attempt and never creates N+1", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");
    const first = await admitDialogueLineGeneration(admissionInput(root, plan));
    const resumed = await admitDialogueLineGeneration(admissionInput(root, plan));

    expect(first.disposition).toBe("ADMITTED");
    expect(resumed.disposition).toBe("RESUMED");
    expect(resumed.admission).toEqual(first.admission);
    expect(resumed.admissionPath).toBe(first.admissionPath);
    expect(first.admission).toMatchObject({
      attemptNumber: 1,
      dialogueLineId: LINE,
      planKey: plan.planKey,
      generationNamespace: "DIRECT_SEED_AUDIO",
      provider: "RUNWAY",
    });
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it.each([
    ["a changed planKey", () => canonical("OLLIE", "Changed canonical text.")],
    ["a changed namespace / voice route", () => canonical("KACEY")],
  ] as const)("F an open attempt blocks %s without creating an attempt", async (_label, other) => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");
    await admitDialogueLineGeneration(admissionInput(root, plan));
    const changed = await other();

    await expect(admitDialogueLineGeneration(admissionInput(root, changed.plan))).rejects.toThrow(
      /can only be resumed by the identical canonical attempt/,
    );
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it("F rejects a namespace that the canonical voice does not execute in", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");
    await expect(
      admitDialogueLineGeneration(admissionInput(root, plan, { generationNamespace: "LINE_SCOPED" })),
    ).rejects.toThrow(/canonical voice executes in DIRECT_SEED_AUDIO/);
    expect(await ledgerFiles(root)).toEqual([]);
  });

  it("H a bound namespace reservation stops every further admission (no generation retry)", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");
    await admitDialogueLineGeneration(admissionInput(root, plan));
    await createDialogueDirectSeedAudioReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: plan.planKey,
      provider: "RUNWAY",
    });

    await expect(admitDialogueLineGeneration(admissionInput(root, plan))).rejects.toThrow(/RESERVED_ONLY/);
    const changed = await canonical("OLLIE", "A new plan after the reservation.");
    await expect(admitDialogueLineGeneration(admissionInput(root, changed.plan))).rejects.toThrow(/RESERVED_ONLY/);
    expect(await ledgerFiles(root)).toEqual([`${LINE}_a1.dialogue-generation-admission.json`]);
  });

  it.each([false, undefined, "true", 1] as const)(
    "I confirmPaidGeneration=%s writes nothing and reads nothing",
    async (confirmation) => {
      const root = await mediaRoot();
      const { plan } = await canonical("OLLIE");
      const inspectLedger = vi.fn();
      const classifyLineEvidence = vi.fn();
      const createAdmission = vi.fn();

      await expect(
        admitDialogueLineGeneration(
          admissionInput(root, plan, { confirmPaidGeneration: confirmation as never }),
          {
            inspectLedger,
            classifyLineEvidence,
            createAdmission,
            now: () => "2026-10-12T10:00:00.000Z",
            createAdmissionId: () => "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          } as unknown as AdmitDialogueLineGenerationDependencies,
        ),
      ).rejects.toThrow(/confirmation is required/);

      expect(inspectLedger).not.toHaveBeenCalled();
      expect(classifyLineEvidence).not.toHaveBeenCalled();
      expect(createAdmission).not.toHaveBeenCalled();
      expect(await readdir(root)).toEqual([]);
    },
  );
});

describe("C6a historical evidence (no ledger is never permission)", () => {
  it("J historical line-scoped RESERVED_ONLY blocks the first admission", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("KACEY");
    await createDialogueReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: plan.planKey,
      provider: "RUNWAY",
    });
    await expect(admitDialogueLineGeneration(admissionInput(root, plan))).rejects.toThrow(
      /current LINE_SCOPED lifecycle is RESERVED_ONLY/,
    );
    expect(await ledgerFiles(root)).toEqual([]);
  });

  it("J active older-plan Direct-SeedAudio work blocks a new-plan admission", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");
    await createDialogueDirectSeedAudioReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: OLD_PLAN,
      provider: "RUNWAY",
    });
    await expect(admitDialogueLineGeneration(admissionInput(root, plan))).rejects.toThrow(
      /active work outside the current plan: DIRECT_SEED_AUDIO/,
    );
    expect(await ledgerFiles(root)).toEqual([]);
  });

  it("J cross-namespace active work (line-scoped reservation) blocks a Direct-SeedAudio admission", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("OLLIE");
    await createDialogueReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: OLD_PLAN,
      provider: "RUNWAY",
    });
    await expect(admitDialogueLineGeneration(admissionInput(root, plan))).rejects.toThrow(
      /active work outside the current plan: LINE_SCOPED/,
    );
    expect(await ledgerFiles(root)).toEqual([]);
  });

  it("J line-scoped evidence from another plan fails hard (unchanged C3 rule)", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("KACEY");
    await createDialogueReservation(root, {
      episodeId: "EP02",
      sceneId: "SC01",
      shotId: "S02",
      dialogueLineId: LINE,
      planKey: OLD_PLAN,
      provider: "RUNWAY",
    });
    await expect(admitDialogueLineGeneration(admissionInput(root, plan))).rejects.toThrow(
      /belongs to dialogue plan/,
    );
    expect(await ledgerFiles(root)).toEqual([]);
  });

  it("J corrupt namespace evidence fails hard and admits nothing", async () => {
    const root = await mediaRoot();
    const { plan } = await canonical("KACEY");
    const path = createDialogueReservationPath(root, "EP02", "SC01", "S02", LINE);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ not json");
    await expect(admitDialogueLineGeneration(admissionInput(root, plan))).rejects.toThrow();
    expect(await ledgerFiles(root)).toEqual([]);
  });
});

describe("C6a gate state machine (injected evidence)", () => {
  function evidence(overrides: Partial<DialogueLineGenerationEvidence> = {}): DialogueLineGenerationEvidence {
    return Object.freeze({
      dialogueLineId: LINE,
      namespace: "DIRECT_SEED_AUDIO",
      lifecycleState: "NOTHING",
      staleWork: Object.freeze([]),
      ...overrides,
    });
  }

  function ledger(state: string | null, admission: DialogueGenerationAdmission = record()): DialogueGenerationAdmissionLedger {
    return Object.freeze({
      dialogueLineId: LINE,
      attempts: state === null ? Object.freeze([]) : Object.freeze([admission]),
      latest:
        state === null
          ? null
          : Object.freeze({ admission, admissionPath: "C:/ledger/a1", attemptState: state as never }),
    });
  }

  async function run(
    plan: ShotDialoguePlan,
    ledgers: readonly DialogueGenerationAdmissionLedger[],
    lineEvidence: DialogueLineGenerationEvidence = evidence(),
  ) {
    const inspectLedger = vi.fn();
    for (const value of ledgers) inspectLedger.mockResolvedValueOnce(value);
    const classifyLineEvidence = vi.fn(async () => lineEvidence);
    const createAdmission = vi.fn(async () => "C:/ledger/new");
    const promise = admitDialogueLineGeneration(admissionInput("C:/controlled-media-root", plan), {
      inspectLedger,
      classifyLineEvidence,
      createAdmission,
      now: () => "2026-10-12T11:00:00.000Z",
      createAdmissionId: () => "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9",
    } as unknown as AdmitDialogueLineGenerationDependencies);
    return { promise, inspectLedger, classifyLineEvidence, createAdmission };
  }

  it("COMPLETED latest attempt allows the next attempt number when the line rule permits", async () => {
    const { plan } = await canonical("OLLIE");
    const completed = record({ planKey: OLD_PLAN });
    const next = DialogueGenerationAdmissionSchema.parse({
      ...completed,
      admissionId: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9",
      attemptNumber: 2,
      admittedAt: "2026-10-12T11:00:00.000Z",
      planKey: plan.planKey,
    });
    const controlled = await run(plan, [
      ledger("CLOSED_BY_COMPLETION", completed),
      Object.freeze({
        dialogueLineId: LINE,
        attempts: Object.freeze([completed, next]),
        latest: Object.freeze({ admission: next, admissionPath: "C:/ledger/new", attemptState: "PRE_RESERVATION_OPEN" as const }),
      }),
    ]);

    await expect(controlled.promise).resolves.toMatchObject({ disposition: "ADMITTED", admission: { attemptNumber: 2 } });
    expect(controlled.createAdmission).toHaveBeenCalledWith("C:/controlled-media-root", next);
  });

  it.each([
    ["SUBMITTED_OPEN", /requires reconciliation/],
    ["RESERVED_ONLY_OPEN", /requires human intervention/],
  ] as const)("%s latest attempt is never retried", async (state, expected) => {
    const { plan } = await canonical("OLLIE");
    const controlled = await run(plan, [ledger(state, record({ planKey: plan.planKey }))]);
    await expect(controlled.promise).rejects.toThrow(expected);
    expect(controlled.createAdmission).not.toHaveBeenCalled();
  });

  it.each([
    ["historical SUBMITTED current lifecycle", evidence({ lifecycleState: "SUBMITTED" })],
    ["historical COMPLETED current lifecycle", evidence({ lifecycleState: "COMPLETED" })],
    [
      "active work in another namespace",
      evidence({
        staleWork: Object.freeze([
          Object.freeze({ dialogueLineId: LINE, namespace: "LINE_SCOPED" as const, planKey: OLD_PLAN, state: "SUBMITTED" as const }),
        ]),
      }),
    ],
  ] as const)("no ledger + %s blocks without writing", async (_label, lineEvidence) => {
    const { plan } = await canonical("OLLIE");
    const controlled = await run(plan, [ledger(null)], lineEvidence);
    await expect(controlled.promise).rejects.toThrow(/admission blocked/);
    expect(controlled.createAdmission).not.toHaveBeenCalled();
  });

  it("post-acquire re-check failure leaves the attempt untouched (no deletion, no abandonment)", async () => {
    const { plan } = await canonical("OLLIE");
    const controlled = await run(plan, [ledger(null), ledger("RESERVED_ONLY_OPEN")]);
    await expect(controlled.promise).rejects.toThrow(/no longer the open pre-reservation attempt/);
    expect(controlled.createAdmission).toHaveBeenCalledTimes(1);
  });
});
