import {
  readFile,
} from "node:fs/promises";

import {
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  inspectShotDialoguePlanningBlockers,
  type DialoguePlanningBlocker,
  type InspectShotDialoguePlanningBlockersInput,
  type ShotDialoguePlanningInspection,
  type ShotDialoguePlanningLine,
} from "../src/dialogue/inspectShotDialoguePlanningBlockers.js";

import type {
  CharacterBible,
  CharacterId,
} from "../src/schemas/character.schema.js";

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

async function fixtures(): Promise<{ episode: EpisodeManifest; bible: CharacterBible; shot: Shot }> {
  const [episode, bible] = await Promise.all([loadEpisodeManifest("EP02"), loadCharacterBible()]);
  return { episode, bible, shot: episode.scenes[0]!.shots[1]! };
}

// OLLIE is LOCKED reference audio, KACEY and MONT are LOCKED presets, GHOST is
// absent from the bible.
function shotWithSpeakers(base: Shot, speakers: readonly string[]): Shot {
  const shot = structuredClone(base);
  const template = shot.dialogue[0]!;
  shot.dialogue = speakers.map((characterId, index) => ({
    ...template,
    characterId,
    text: `Line ${index + 1} spoken by ${characterId}.`,
  }));
  shot.characters = [...new Set(speakers)];
  return shot;
}

function withPendingVoice(base: CharacterBible, characterId: string): CharacterBible {
  const bible = structuredClone(base);
  const character = bible.characters.find((candidate) => candidate.id === characterId)!;
  (character as { voice: unknown }).voice = {
    selectionStatus: "PENDING",
    provider: "RUNWAY",
    voiceName: null,
    deliveryTraits: ["young"],
  };
  return bible;
}

function inspect(shot: Shot, bible: CharacterBible): ShotDialoguePlanningInspection {
  return inspectShotDialoguePlanningBlockers({ episodeId: "EP02", sceneId: "SC01", shot, bible });
}

describe("BusyBookie shot dialogue planning blockers", () => {
  it("A a shot without dialogue has no lines and no blockers", async () => {
    const { episode, bible } = await fixtures();

    const result = inspect(episode.scenes[0]!.shots[0]!, bible);

    expect(result).toEqual({ lines: [], blockers: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("B known speakers with LOCKED voices produce no blockers", async () => {
    const { bible, shot } = await fixtures();

    const result = inspect(shotWithSpeakers(shot, ["OLLIE", "KACEY", "MONT"]), bible);

    expect(result.blockers).toEqual([]);
    expect(result.lines).toEqual([
      { lineNumber: 1, dialogueLineId: "EP02_SC01_S02_L01", characterId: "OLLIE" },
      { lineNumber: 2, dialogueLineId: "EP02_SC01_S02_L02", characterId: "KACEY" },
      { lineNumber: 3, dialogueLineId: "EP02_SC01_S02_L03", characterId: "MONT" },
    ]);
  });

  it("C an unknown speaker is a typed UNKNOWN_DIALOGUE_CHARACTER blocker", async () => {
    const { bible, shot } = await fixtures();

    const result = inspect(shotWithSpeakers(shot, ["GHOST"]), bible);

    expect(result.blockers).toEqual([
      { reason: "UNKNOWN_DIALOGUE_CHARACTER", lineNumber: 1, dialogueLineId: "EP02_SC01_S02_L01", characterId: "GHOST" },
    ]);
  });

  it("D a known speaker without a LOCKED voice is a typed VOICE_NOT_LOCKED blocker", async () => {
    const { bible: base, shot } = await fixtures();

    const result = inspect(shotWithSpeakers(shot, ["KACEY"]), withPendingVoice(base, "KACEY"));

    expect(result.blockers).toEqual([
      {
        reason: "VOICE_NOT_LOCKED",
        lineNumber: 1,
        dialogueLineId: "EP02_SC01_S02_L01",
        characterId: "KACEY",
        voiceSelectionStatus: "PENDING",
      },
    ]);
  });

  it("E every blocker is returned in canonical dialogue order with mixed reasons", async () => {
    const { bible: base, shot } = await fixtures();
    const bible = withPendingVoice(base, "OLLIE");

    const result = inspect(shotWithSpeakers(shot, ["OLLIE", "KACEY", "GHOST", "OLLIE"]), bible);

    expect(result.blockers.map((blocker) => [blocker.lineNumber, blocker.reason, blocker.characterId])).toEqual([
      [1, "VOICE_NOT_LOCKED", "OLLIE"],
      [3, "UNKNOWN_DIALOGUE_CHARACTER", "GHOST"],
      [4, "VOICE_NOT_LOCKED", "OLLIE"],
    ]);
    expect(result.lines.map((line) => line.dialogueLineId)).toEqual([
      "EP02_SC01_S02_L01",
      "EP02_SC01_S02_L02",
      "EP02_SC01_S02_L03",
      "EP02_SC01_S02_L04",
    ]);
  });

  it("F line ids equal the canonical planner's line ids", async () => {
    const { bible, shot: base } = await fixtures();
    const shot = shotWithSpeakers(base, ["OLLIE", "KACEY", "MONT", "KACEY"]);

    const result = inspect(shot, bible);
    const plan = buildShotDialoguePlan({ episodeId: "EP02", sceneId: "SC01", shot, bible });

    expect(result.lines.map((line) => [line.lineNumber, line.dialogueLineId, line.characterId])).toEqual(
      plan.lines.map((line) => [line.lineNumber, line.dialogueLineId, line.characterId]),
    );
  });

  it("G repeated speakers keep distinct canonical line ids", async () => {
    const { bible, shot } = await fixtures();

    const result = inspect(shotWithSpeakers(shot, ["KACEY", "KACEY", "KACEY"]), bible);

    expect(new Set(result.lines.map((line) => line.dialogueLineId)).size).toBe(3);
  });

  it("H is pure: inputs are not mutated and repeated calls are equal", async () => {
    const { bible: base, shot: baseShot } = await fixtures();
    const bible = withPendingVoice(base, "OLLIE");
    const shot = shotWithSpeakers(baseShot, ["OLLIE", "GHOST"]);
    const bibleBefore = structuredClone(bible);
    const shotBefore = structuredClone(shot);

    const first = inspect(shot, bible);
    const second = inspect(shot, bible);

    expect(first).toEqual(second);
    expect(bible).toEqual(bibleBefore);
    expect(shot).toEqual(shotBefore);
  });

  it("J result, arrays and items are frozen", async () => {
    const { bible: base, shot } = await fixtures();

    const result = inspect(shotWithSpeakers(shot, ["GHOST", "KACEY"]), withPendingVoice(base, "KACEY"));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lines)).toBe(true);
    expect(Object.isFrozen(result.blockers)).toBe(true);
    for (const item of [...result.lines, ...result.blockers]) {
      expect(Object.isFrozen(item)).toBe(true);
    }
  });

  it("L parity: no blockers exactly when the real planner succeeds", async () => {
    const { bible: base, shot } = await fixtures();
    const cases: readonly [readonly string[], CharacterBible][] = [
      [["OLLIE"], base],
      [["OLLIE", "KACEY"], base],
      [["GHOST"], base],
      [["KACEY", "GHOST"], base],
      [["OLLIE"], withPendingVoice(base, "OLLIE")],
      [["KACEY", "MONT"], withPendingVoice(base, "MONT")],
    ];

    for (const [speakers, bible] of cases) {
      const candidate = shotWithSpeakers(shot, speakers);
      const result = inspect(candidate, bible);
      const build = () => buildShotDialoguePlan({ episodeId: "EP02", sceneId: "SC01", shot: candidate, bible });

      if (result.blockers.length === 0) {
        expect(build, speakers.join(",")).not.toThrow();
      } else {
        expect(build, speakers.join(",")).toThrow();
      }
    }
  });

  it("I/K imports only the line-id authority and types; no fs, provider, write or error parsing", async () => {
    const source = await readFile(
      new URL("../src/dialogue/inspectShotDialoguePlanningBlockers.ts", import.meta.url),
      "utf8",
    );
    const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(
      (match) => `${match[2]}:${match[1]!.replace(/\s+/g, "")}`,
    );

    expect(imports).toEqual([
      "../schemas/character.schema.js:CharacterBible,CharacterId,CharacterVoice,",
      "../schemas/episodeManifest.schema.js:Shot,",
      "./buildShotDialoguePlan.js:createDialogueLineId,",
    ]);
    expect(source).not.toMatch(/node:|\bfetch\s*\(|\btry\b|\bcatch\b|\.message\b|instanceof\s+Error|\bawait\b/);
    expect(source).not.toMatch(/padStart|_L\$\{/);
  });

  it("exposes the locked blocker and input types", () => {
    expectTypeOf<DialoguePlanningBlocker>().toEqualTypeOf<
      | Readonly<{
          reason: "UNKNOWN_DIALOGUE_CHARACTER";
          lineNumber: number;
          dialogueLineId: string;
          characterId: CharacterId;
        }>
      | Readonly<{
          reason: "VOICE_NOT_LOCKED";
          lineNumber: number;
          dialogueLineId: string;
          characterId: CharacterId;
          voiceSelectionStatus: "PENDING";
        }>
    >();
    expectTypeOf<ShotDialoguePlanningLine>().toEqualTypeOf<
      Readonly<{ lineNumber: number; dialogueLineId: string; characterId: CharacterId }>
    >();
    expectTypeOf<InspectShotDialoguePlanningBlockersInput>().toEqualTypeOf<
      Readonly<{ episodeId: string; sceneId: string; shot: Shot; bible: CharacterBible }>
    >();
    expectTypeOf(inspectShotDialoguePlanningBlockers).returns.toEqualTypeOf<ShotDialoguePlanningInspection>();
  });
});
