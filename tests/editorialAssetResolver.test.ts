import { describe, expect, it } from "vitest";
import { posix, sep, win32 } from "node:path";
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

type Row = Readonly<{ id: string; posixHost: boolean; root: string; dialogue: boolean; expected: (locator: string) => string }>;
const backslashed = (locator: string) => locator.replace(/\//g, "\\");
// Step1034 section 8 path parity matrix. P05-P10 need a native POSIX path runtime: DEFERRED on Windows.
const positiveRows: readonly Row[] = [
  { id: "P01", posixHost: false, root: "D:/Busybookie/Production", dialogue: false, expected: (l) => `D:\\Busybookie\\Production\\${backslashed(l)}` },
  { id: "P02", posixHost: false, root: "D:/Busybookie/Production", dialogue: true, expected: (l) => `D:/Busybookie/Production/${l}` },
  { id: "P03", posixHost: false, root: "D:\\Busybookie\\Production", dialogue: false, expected: (l) => `D:\\Busybookie\\Production\\${backslashed(l)}` },
  { id: "P04", posixHost: false, root: "D:\\Busybookie\\Production", dialogue: true, expected: (l) => `D:\\Busybookie\\Production\\${backslashed(l)}` },
  { id: "P05", posixHost: true, root: "D:/Busybookie/Production", dialogue: false, expected: (l) => `D:\\Busybookie\\Production\\${backslashed(l)}` },
  { id: "P06", posixHost: true, root: "D:/Busybookie/Production", dialogue: true, expected: (l) => `D:/Busybookie/Production/${l}` },
  { id: "P07", posixHost: true, root: "D:\\Busybookie\\Production", dialogue: false, expected: (l) => `D:\\Busybookie\\Production\\${backslashed(l)}` },
  { id: "P08", posixHost: true, root: "D:\\Busybookie\\Production", dialogue: true, expected: (l) => `D:\\Busybookie\\Production\\${backslashed(l)}` },
  { id: "P09", posixHost: true, root: "/srv/busybookie/production", dialogue: false, expected: (l) => `/srv/busybookie/production/${l}` },
  { id: "P10", posixHost: true, root: "/srv/busybookie/production", dialogue: true, expected: (l) => `/srv/busybookie/production/${l}` },
];
const variantsOf = (root: string): readonly string[] => {
  const separator = root.includes("\\") ? "\\" : "/";
  return [root, `${root}${separator}`, `  ${root}  `, `\t${root}${separator}${separator}\n`];
};

function rowCase(row: Row) {
  for (const root of variantsOf(row.root)) {
    const input = fixture([{ dialogue: row.dialogue }], root);
    const plan = buildEditorialPlan(input);
    const asset = plan.assets[0]!;
    const locator = asset.mediaRootRelativePath;
    expect(locator).toBe(`cache/composition-normalized/EP02/S01/EP02_S01_${asset.normalization.cacheKey}.mp4`);
    expect(asset.normalization.schemaVersion).toBe(row.dialogue ? "2.0" : "1.0");
    const resolved = resolveEditorialAssetPath(root, asset);
    const artifactPath = input.preparedComposition.shots[0]!.normalizedArtifact.outputPath;
    expect(resolved).toBe(row.expected(locator));
    expect(resolved).toBe(artifactPath);
    const { oldPlan, newPlan } = assertParity(input);
    expect(newPlan.shots[0]!.sourceVideoPath).toBe(resolved);
    expect(oldPlan.shots[0]!.sourceVideoPath).toBe(resolved);
  }
}

describe("Editorial asset resolver path parity matrix", () => {
  for (const row of positiveRows) {
    const label = row.posixHost ? `${row.id} POSIX host (DEFERRED POSIX-HOST VERIFICATION on Windows)` : `${row.id} Windows host`;
    it.skipIf(row.posixHost === windowsHost)(`T20 ${label}: ${row.dialogue ? "v2" : "v1"} root ${row.root}`, () => rowCase(row));
  }

  it.skipIf(!windowsHost)("T20 P11/P12 Windows host refuses POSIX roots before either v1 or v2 resolution", () => {
    for (const dialogue of [false, true]) {
      const plan = buildEditorialPlan(fixture([{ dialogue }]));
      const input = fixture([{ dialogue }]);
      for (const root of ["/srv/busybookie/production", "/srv/busybookie/production/"]) {
        expect(() => resolveEditorialAssetPath(root, plan.assets[0]!)).toThrow(/unsupported or ambiguous media root/);
        expect(() => buildEditorialRoughCutRenderPlan({ plan, mediaRoot: root })).toThrow(/Editorial plan/);
        expect(() => validateEditorialPlanAgainstSource({ ...input, plan, mediaRoot: root })).toThrow(/Editorial plan/);
      }
    }
  });

  it.each([
    "", "   ", "relative/root", "./media", "D:", "D:relative\\root", "D:/", "D:\\",
    "\\\\server\\share\\media", "//server/share/media", "\\\\?\\D:\\media",
    "D:/Busybookie\\Production", "D:/Busybookie/../Production", "D:/Busybookie/./Production",
    "D:/Busybookie//Production", "D:\\Busybookie\\\\Production", "D:/Busy|bookie", "D:/Busy\u0000bookie",
    ...(windowsHost ? ["/srv/busybookie/production"] : ["/", "/srv//media", "/srv/../media", "/srv\\media"]),
  ])("T12 rejects unsupported or ambiguous root %j", (root) => {
    const plan = buildEditorialPlan(fixture([{}, { dialogue: true }]));
    for (const asset of plan.assets) expect(() => resolveEditorialAssetPath(root, asset)).toThrow(/Editorial plan/);
    expect(() => buildEditorialRoughCutRenderPlan({ plan, mediaRoot: root })).toThrow(/Editorial plan/);
  });

  it("T12 rejects malformed, escaping or identity-mismatched locators", () => {
    const plan = buildEditorialPlan(fixture([{}, { dialogue: true }]));
    const asset = plan.assets[0]!;
    const other = plan.assets[1]!;
    const locator = asset.mediaRootRelativePath;
    for (const mediaRootRelativePath of [
      `/${locator}`, `D:/${locator}`, locator.replace(/\//g, "\\"), `./${locator}`, `cache/../${locator}`,
      locator.replace("composition-normalized", "composition-normalized/.."), locator.replace("EP02/S01", "EP02/S02"),
      locator.replace("EP02_S01", "EP02_S02"), locator.replace(asset.normalization.cacheKey, "f".repeat(64)),
      other.mediaRootRelativePath, `${locator}.tmp`, locator.toUpperCase(), "",
    ]) {
      expect(() => resolveEditorialAssetPath("D:/Busybookie/Production", { ...asset, mediaRootRelativePath }))
        .toThrow(/Editorial plan/);
    }
    expect(() => resolveEditorialAssetPath("D:/Busybookie/Production", { ...asset, assetId: "normalized:EP02:S02" }))
      .toThrow(/Editorial plan/);
    expect(() => resolveEditorialAssetPath("D:/Busybookie/Production", { ...asset, unexpected: true } as typeof asset))
      .toThrow(/Editorial plan/);
  });

  it("T12 resolution is lexical and does not depend on the current directory or environment", () => {
    const plan = buildEditorialPlan(fixture([{}, { dialogue: true }]));
    const before = plan.assets.map((asset) => resolveEditorialAssetPath("Q:/Not/A/Real/Root", asset));
    expect(before[0]).toBe(`Q:\\Not\\A\\Real\\Root\\${backslashed(plan.assets[0]!.mediaRootRelativePath)}`);
    expect(before[1]).toBe(`Q:/Not/A/Real/Root/${plan.assets[1]!.mediaRootRelativePath}`);
    expect(posix.isAbsolute(plan.assets[0]!.mediaRootRelativePath)).toBe(false);
    expect(win32.isAbsolute(plan.assets[0]!.mediaRootRelativePath)).toBe(false);
  });
});
