import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGoogleGenAiSingleShotPrompt,
  GOOGLE_GENAI_PROMPT_MAX_CODE_UNITS,
} from "../src/execution/providers/buildGoogleGenAiSingleShotPrompt.js";
import type { Shot } from "../src/schemas/episodeManifest.schema.js";

function makeShot(overrides: Partial<Shot> = {}): Shot {
  return {
    id: "S01",
    order: 1,
    title: "TITLE-SENTINEL",
    type: "ESTABLISHING",
    durationSeconds: 5,
    characters: [],
    visualAction: "A storybook village wakes at dawn.",
    camera: "Slow push-in from a high angle.",
    dialogue: [],
    audio: { ambience: "AMBIENCE-SENTINEL", sfx: ["SFX-SENTINEL"], musicIntent: "MUSIC-SENTINEL" },
    references: { required: true, assetIds: ["ASSET-SENTINEL"], approvalStatus: "APPROVED" },
    generation: { provider: "RUNWAY", nativeAudio: false, status: "APPROVED_FOR_GENERATION", notes: "NOTES-SENTINEL" },
    continuityNotes: ["Warm light.", "Chimney smoke drifts left."],
    ...overrides,
  };
}

describe("Google-owned single-shot prompt builder", () => {
  it("composes visual action, camera, then continuity notes in that exact order", () => {
    expect(buildGoogleGenAiSingleShotPrompt(makeShot())).toBe(
      "A storybook village wakes at dawn. Camera: Slow push-in from a high angle. Continuity: Warm light. Chimney smoke drifts left.",
    );
  });

  it("omits the continuity section when there are no continuity notes", () => {
    expect(buildGoogleGenAiSingleShotPrompt(makeShot({ continuityNotes: [] }))).toBe(
      "A storybook village wakes at dawn. Camera: Slow push-in from a high angle.",
    );
  });

  it("collapses every whitespace run, including newlines and tabs, and trims", () => {
    const prompt = buildGoogleGenAiSingleShotPrompt(makeShot({
      visualAction: "  A  village\n\twakes. ",
      camera: "Push\r\nin.",
      continuityNotes: ["Warm\t light."],
    }));
    expect(prompt).toBe("A village wakes. Camera: Push in. Continuity: Warm light.");
  });

  it("is deterministic and does not mutate the shot", () => {
    const shot = makeShot();
    const snapshot = JSON.stringify(shot);
    const first = buildGoogleGenAiSingleShotPrompt(shot);
    for (let index = 0; index < 5; index += 1) expect(buildGoogleGenAiSingleShotPrompt(shot)).toBe(first);
    expect(JSON.stringify(shot)).toBe(snapshot);
  });

  it("never includes title, characters, audio, references, generation notes or durations", () => {
    const prompt = buildGoogleGenAiSingleShotPrompt(makeShot({ characters: ["OLLIE"] }));
    for (const sentinel of ["TITLE-SENTINEL", "AMBIENCE-SENTINEL", "SFX-SENTINEL", "MUSIC-SENTINEL", "ASSET-SENTINEL", "NOTES-SENTINEL", "OLLIE", "RUNWAY", "Audio:", "5"]) {
      expect(prompt).not.toContain(sentinel);
    }
  });

  it("refuses native audio and dialogue instead of silently dropping them", () => {
    expect(() => buildGoogleGenAiSingleShotPrompt(makeShot({
      generation: { provider: "VEO", nativeAudio: true, status: "APPROVED_FOR_GENERATION" },
    }))).toThrow(/native audio/);
    expect(() => buildGoogleGenAiSingleShotPrompt(makeShot({
      characters: ["OLLIE"],
      dialogue: [{ characterId: "OLLIE", text: "DIALOGUE-SENTINEL" }],
    }))).toThrow(/dialogue/);
  });

  it("accepts exactly the 1000 code-unit limit and rejects 1001 without truncation", () => {
    expect(GOOGLE_GENAI_PROMPT_MAX_CODE_UNITS).toBe(1000);
    const prefix = "Camera: x";
    const atLimit = makeShot({ visualAction: "a".repeat(1000 - prefix.length - 1), camera: "x", continuityNotes: [] });
    expect(buildGoogleGenAiSingleShotPrompt(atLimit)).toHaveLength(1000);
    const overLimit = makeShot({ visualAction: "a".repeat(1000 - prefix.length), camera: "x", continuityNotes: [] });
    expect(() => buildGoogleGenAiSingleShotPrompt(overLimit)).toThrow(/1000 UTF-16 code-unit limit/);
  });

  it("is pure: one type-only import, no Veo/Runway prompt coupling, no I/O, environment or clock", async () => {
    const source = await readFile(join(process.cwd(), "src/execution/providers/buildGoogleGenAiSingleShotPrompt.ts"), "utf8");
    const imports = [...source.matchAll(/^import\s[\s\S]*?from\s*"([^"]+)";/gm)].map((match) => match[0]);
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/^import type \{/);
    expect(imports[0]).toContain('"../../schemas/episodeManifest.schema.js"');
    expect(source).not.toMatch(/buildVeoPrompt|buildRunwayGen45Prompt|\/veo\/|\/runway\/|process\.|node:|console\.|Date\.|Math\.random|fetch\(|readFile|@google\/genai/);
  });
});
