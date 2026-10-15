import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import { buildDialogueCompositionShotNormalizationPlan } from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { buildEditorialPlan, type BuildEditorialPlanInput } from "../src/editorial/buildEditorialPlan.js";
import { validateEditorialPlan, editorialDurationFrames } from "../src/editorial/validateEditorialPlan.js";
import { validateEditorialPlanAgainstSource } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import { canonicalizeEditorialPlan, canonicalEditorialJson, hashEditorialPlan, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { resolveEditorialAssetPath } from "../src/editorial/resolveEditorialAssetPath.js";
import { buildEditorialRoughCutRenderPlan } from "../src/editorial/buildEditorialRoughCutRenderPlan.js";
import { buildEpisodeRoughCutRenderPlan } from "../src/composition/buildEpisodeRoughCutRenderPlan.js";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import type { EditorialPlan } from "../src/editorial/editorialPlan.schema.js";

// Local, in-memory fixtures only. Repeated in the six allowed files to avoid an extra helper path
// or importing another test module (which would register its tests more than once).
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
function mutable<T>(value: T): Mutable<T> { return structuredClone(value) as Mutable<T>; }
type Spec = { seconds?: number; native?: boolean; dialogue?: boolean; scene?: string; overrun?: boolean };
function fixture(specs: readonly Spec[] = [{}], mediaRoot = "D:/Busybookie/Production"): BuildEditorialPlanInput {
  const postProduction = { aspectRatio: "16:9" as const, width: 1920, height: 1080, timelineFps: 25, audioSampleRateHz: 48000 };
  const scenes: { id: string; title: string; summary: string; shots: unknown[] }[] = [];
  specs.forEach((spec, i) => {
    const sceneId = spec.scene ?? "SC01";
    let scene = scenes.find((s) => s.id === sceneId);
    if (!scene) { scene = { id: sceneId, title: sceneId, summary: "Synthetic scene", shots: [] }; scenes.push(scene); }
    scene.shots.push({
      id: `S${String(i + 1).padStart(2, "0")}`, order: i + 1, title: `Shot ${i + 1}`, type: "ACTION",
      durationSeconds: spec.seconds ?? 4, characters: ["OLLIE"], visualAction: "Walk", camera: "Wide",
      dialogue: spec.dialogue ? [{ characterId: "OLLIE", text: "Hello" }] : [],
      audio: { sfx: [], ambience: "Non-rendering intent" },
      references: { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" },
      generation: { provider: "VEO", nativeAudio: spec.native ?? false, status: "PLANNED" }, continuityNotes: [],
    });
  });
  // Deliberately reverse scene and within-scene storage; global shot.order remains the authority.
  scenes.reverse(); scenes.forEach((s) => s.shots.reverse());
  const episode = EpisodeManifestSchema.parse({
    schemaVersion: "1.0", episodeId: "EP02", title: "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
    audience: { description: "Children", minAgeYears: 3, maxAgeYears: 6 }, learningGoals: ["Share"],
    emotionalTheme: "Kindness", targetDurationSeconds: 60,
    approvals: { script: "PENDING", storyboard: "PENDING", references: "PENDING", roughCut: "PENDING", finalQc: "PENDING" }, scenes,
  });
  const ordered = episode.scenes.flatMap((s) => s.shots.map((shot) => ({ sceneId: s.id, shot }))).sort((a,b) => a.shot.order-b.shot.order);
  const shots: PreparedEpisodeCompositionShot[] = ordered.map(({sceneId, shot}, i) => {
    const spec = specs[i]!;
    const admitted = {
      sceneId, shotId: shot.id, order: shot.order, title: shot.title, durationSeconds: shot.durationSeconds,
      nativeAudio: shot.generation.nativeAudio, provider: "VEO" as const, providerExecutionId: `task-${i}`,
      sourceVideoPath: `D:/generated/${shot.id}.mp4`, sourceBytes: 100 + i, sourceSha256: String(i % 10).repeat(64), sourceContentType: null,
    };
    const sourceMedia = {
      sourceVideoPath: admitted.sourceVideoPath, formatName: "mp4", durationSeconds: shot.durationSeconds,
      video: { codecName: "h264", profile: "High", width: 1920, height: 1080, pixelFormat: "yuv420p", frameRate: 25 },
      audio: admitted.nativeAudio ? { codecName: "aac", profile: null, sampleRateHz: 48000, channels: 2, channelLayout: "stereo" } : null,
    };
    const args = { mediaRoot, episodeId: episode.episodeId, shot: admitted, sourceMedia, postProduction };
    const startSeconds = 0.123;
    const durationSeconds = spec.overrun ? shot.durationSeconds - startSeconds + 0.0000005 : 0.537;
    const normalizationPlan = spec.dialogue ? buildDialogueCompositionShotNormalizationPlan({
      ...args,
      dialogueAudio: {
        schemaVersion: "1.0", audioMode: "REPLACE_SOURCE_WITH_DIALOGUE", mixNativeAudio: false,
        episodeId: episode.episodeId, sceneId, shotId: shot.id, dialoguePlanKey: "a".repeat(64),
        shotDurationSeconds: shot.durationSeconds, sourceNativeAudio: admitted.nativeAudio,
        sourceAudioDisposition: admitted.nativeAudio ? "DISCARD_NATIVE_AUDIO" : "NO_SOURCE_AUDIO", audioKey: "b".repeat(64),
        lines: [{ lineNumber: 1, dialogueLineId: `${episode.episodeId}_${sceneId}_${shot.id}_L01`,
          sourceAudioPath: "D:/voice/line.wav", sourceSha256: "c".repeat(64), sourceBytes: 77, startSeconds, durationSeconds,
          endSeconds: Math.min(startSeconds + durationSeconds, shot.durationSeconds) }],
      },
    }) : buildCompositionShotNormalizationPlan(args);
    return { ...admitted, normalizationPlan, normalizationCacheStatus: "HIT",
      normalizedArtifact: { outputPath: normalizationPlan.outputPath, sha256: "d".repeat(64), bytes: 200,
        contentType: "video/mp4", durationSeconds: shot.durationSeconds, durationToleranceSeconds: 1/25 } };
  });
  return { episode, postProduction, mediaRoot, preparedComposition: { episodeId: episode.episodeId, title: episode.title,
    totalShots: shots.length, totalDurationSeconds: shots.reduce((sum, s) => sum + s.durationSeconds, 0), shots } };
}
function assertParity(input: BuildEditorialPlanInput) {
  const plan = buildEditorialPlan(input);
  validateEditorialPlanAgainstSource({ ...input, plan });
  const oldPlan = buildEpisodeRoughCutRenderPlan(input);
  const newPlan = buildEditorialRoughCutRenderPlan({ plan, mediaRoot: input.mediaRoot });
  expect(newPlan).toStrictEqual(oldPlan);
  expect(newPlan.renderKey).toBe(oldPlan.renderKey);
  expect(newPlan.outputPath).toBe(oldPlan.outputPath);
  const command = (p: typeof oldPlan) => buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "controlled-ffmpeg", plan: p, outputPath: p.outputPath });
  expect(command(newPlan)).toStrictEqual(command(oldPlan));
  return { plan, oldPlan, newPlan };
}



const windowsHost = sep === "\\";
// Windows-host rows P01-P04; POSIX-host rows P05-P10 run only on a native POSIX runtime (DEFERRED here).
const parityRoots = [
  "D:/Busybookie/Production", "D:\\Busybookie\\Production", " D:/Busybookie/Production/ ", "D:\\Busybookie\\Production\\",
  ...(windowsHost ? [] : ["/srv/busybookie/production"]),
];

function inputPaths(args: readonly string[]): string[] {
  return args.flatMap((arg, index) => (arg === "-i" ? [args[index + 1]!] : []));
}

function explicitParity(input: BuildEditorialPlanInput) {
  const plan = buildEditorialPlan(input);
  validateEditorialPlanAgainstSource({ ...input, plan });
  const oldPlan = buildEpisodeRoughCutRenderPlan(input);
  const newPlan = buildEditorialRoughCutRenderPlan({ plan, mediaRoot: input.mediaRoot });
  expect(newPlan).toStrictEqual(oldPlan);
  expect(newPlan.renderKey).toBe(oldPlan.renderKey);
  expect(newPlan.outputPath).toBe(oldPlan.outputPath);
  expect(newPlan.totalDurationSeconds).toBe(oldPlan.totalDurationSeconds);
  expect(newPlan.shots.map((shot) => [shot.shotId, shot.order, shot.sourceVideoPath]))
    .toStrictEqual(oldPlan.shots.map((shot) => [shot.shotId, shot.order, shot.sourceVideoPath]));
  const outputPath = oldPlan.outputPath.replace(/\.mp4$/, ".parity-only.mp4");
  const ffmpegExecutable = "C:/controlled/never-launched/ffmpeg.exe";
  const oldCommand = buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable, plan: oldPlan, outputPath });
  const newCommand = buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable, plan: newPlan, outputPath });
  expect(newCommand.executable).toBe(oldCommand.executable);
  expect(newCommand.args).toStrictEqual(oldCommand.args);
  expect(newCommand).toStrictEqual(oldCommand);
  expect(inputPaths(newCommand.args)).toStrictEqual(inputPaths(oldCommand.args));
  expect(inputPaths(newCommand.args)).toStrictEqual(newPlan.shots.map((shot) => shot.sourceVideoPath));
  return { plan, oldPlan, newPlan, oldCommand, newCommand };
}

const scenarios = [
  ["T01 v1 native audio", [{ native: true }]],
  ["T02 v1 synthetic silence", [{}]],
  ["T03 multi-scene scrambled storage", [{ scene: "SC02", seconds: 5 }, { scene: "SC01", seconds: 6 }, { scene: "SC02", seconds: 4 }]],
  ["T04 v2 dialogue", [{ dialogue: true }]],
  ["T04 v2 dialogue replacing native audio", [{ dialogue: true, native: true }]],
  ["T04 v2 tiny accepted end overrun", [{ dialogue: true, overrun: true }]],
  ["T05 mixed v1/v2", [{ native: true }, { dialogue: true }, {}, { dialogue: true, native: true, scene: "SC02" }]],
  ["T21 noisy fractional durations", [{ seconds: 0.28 }, { seconds: 1.12, dialogue: true }, { seconds: 2.2, native: true }]],
  ["T21 frame boundaries 1 and 750", [{ seconds: 0.04 }, { seconds: 30 }]],
] as const;

describe("E2 STRAIGHT_CUT old/new rough-cut planning parity", () => {
  for (const root of parityRoots) {
    it.each(scenarios)(`T21 %s at root ${JSON.stringify(root)}`, (_label, specs) => {
      explicitParity(fixture(specs, root));
    });
  }

  it("T21 ordered left-fold total is preserved where it differs from totalFrames/25", () => {
    const { plan, newPlan, newCommand } = explicitParity(fixture([{ seconds: 0.28 }, { seconds: 1.12 }, { seconds: 2.2 }]));
    expect(plan.durationFrames).toBe(90);
    expect(newPlan.totalDurationSeconds).toBe(0.28 + 1.12 + 2.2);
    expect(newPlan.totalDurationSeconds).toBe(3.6000000000000005);
    expect(newPlan.totalDurationSeconds).not.toBe(plan.durationFrames / 25);
    expect(newCommand.args[newCommand.args.indexOf("-t") + 1]).toBe("3.6000000000000005");
  });

  it("T21 every legal frame duration keeps exact parity in ordered multi-shot batches", () => {
    for (let first = 1; first <= 750; first += 50) {
      const specs = Array.from({ length: 50 }, (_, offset) => ({ seconds: JSON.parse(String((first + offset) / 25)) as number }));
      const { plan } = explicitParity(fixture(specs));
      expect(plan.shots.map((shot) => shot.durationFrames)).toStrictEqual(specs.map((_, offset) => first + offset));
    }
  });

  it("T21 adapter consumes only the validated plan and local root, never prepared source", () => {
    const input = fixture([{}, { dialogue: true }]);
    const plan = buildEditorialPlan(input);
    const roundTrip = JSON.parse(canonicalizeEditorialPlan(plan)) as EditorialPlan;
    expect(buildEditorialRoughCutRenderPlan({ plan: roundTrip, mediaRoot: input.mediaRoot }))
      .toStrictEqual(buildEpisodeRoughCutRenderPlan(input));
  });
});

describe("E2 coexistence: existing production path untouched", () => {
  const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
  const scriptsRoot = fileURLToPath(new URL("../scripts/", import.meta.url));
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
    });
  }

  it("T22 no existing source, script or CLI imports the editorial modules (no cutover)", () => {
    const editorialDirectory = join(srcRoot, "editorial");
    const production = [...sourceFiles(srcRoot), ...sourceFiles(scriptsRoot)]
      .filter((path) => !path.startsWith(editorialDirectory));
    expect(production.length).toBeGreaterThan(100);
    for (const path of production) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/from\s+["'][^"']*editorial\//);
    }
  });

  it("T22 editorial modules are pure: no fs, process, env, child process or tool launch", () => {
    const editorial = sourceFiles(join(srcRoot, "editorial"));
    expect(editorial.map((path) => path.slice(path.lastIndexOf(sep) + 1)).sort()).toStrictEqual([
      "audioMixDecisions.schema.ts", "buildEditorialEditFfmpegCommand.ts", "buildEditorialEditRenderPlan.ts",
      "buildEditorialMixAnalysisFfmpegCommand.ts", "buildEditorialMixAudioGraph.ts", "buildEditorialMixFfmpegCommand.ts",
      "buildEditorialMixRenderPlan.ts", "buildEditorialPlan.ts", "buildEditorialPlanV2.ts", "buildEditorialPlanV3.ts",
      "buildEditorialRoughCutRenderPlan.ts", "canonicalizeEditorialPlan.ts", "canonicalizeEditorialPlanV2.ts",
      "canonicalizeEditorialPlanV3.ts", "deriveEditorialAudioMix.ts", "deriveEditorialTimeline.ts",
      "editorialDecisions.schema.ts", "editorialEditRenderPreflight.ts", "editorialMixRenderPreflight.ts",
      "editorialPlan.schema.ts", "editorialPlanV2.schema.ts", "editorialPlanV3.schema.ts",
      "migrateEditorialPlan.ts", "migrateEditorialPlanV3.ts", "resolveEditorialAssetPath.ts",
      "resolveEditorialAssetPathV2.ts", "resolveExternalAudioAssetPath.ts", "validateAudioMixDecisions.ts",
      "validateEditorialDecisions.ts", "validateEditorialPlan.ts", "validateEditorialPlanAgainstSource.ts",
      "validateEditorialPlanV2.ts", "validateEditorialPlanV2AgainstSource.ts", "validateEditorialPlanV3.ts",
      "validateEditorialPlanV3AgainstSource.ts",
    ]);
    for (const path of editorial) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/node:fs|from\s+["']fs|child_process|process\.|dotenv|import\(|spawn|exec[A-Z(]/);
      for (const specifier of text.matchAll(/from\s+["']([^"']+)["']/g)) {
        expect(specifier[1], path).toMatch(/^(zod|node:crypto|node:path|\.\/[A-Za-z0-9.]+\.js|\.\.\/(schemas|composition)\/[A-Za-z.]+\.js)$/);
      }
      for (const specifier of text.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+["'](\.\.\/composition\/[^"']+)["']/g)) {
        expect(specifier[1], `${path} must import composition types only`).toBe("type ");
      }
    }
  });
});
