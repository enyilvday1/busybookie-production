import { describe, expect, it } from "vitest";
import { sep } from "node:path";
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

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).reverse()
      .map((key) => [key, reverseKeys((value as Record<string, unknown>)[key])]));
  }
  return value;
}
function renderKeyOf(input: BuildEditorialPlanInput, plan = buildEditorialPlan(input)): string {
  return buildEditorialRoughCutRenderPlan({ plan, mediaRoot: input.mediaRoot }).renderKey;
}

describe("EditorialPlan canonical JSON and full-record identity", () => {
  it("T17 canonical JSON sorts keys by code unit, keeps array order and rejects non-JSON values", () => {
    expect(canonicalEditorialJson({ b: 1, a: [3, 1, 2], "10": true, "9": null, Z: "x\"y" }))
      .toBe("{\"10\":true,\"9\":null,\"Z\":\"x\\\"y\",\"a\":[3,1,2],\"b\":1}");
    expect(canonicalEditorialJson({ "\u00e9": 1, z: 2 })).toBe("{\"z\":2,\"\u00e9\":1}");
    expect(canonicalEditorialJson([0.1 + 0.2, 1e21, 5e-324])).toBe("[0.30000000000000004,1e+21,5e-324]");
    for (const bad of [-0, NaN, Infinity, -Infinity, undefined, new Date(0), new Map(), () => 1,
      { nested: undefined }, [1, undefined], { value: -0 }]) {
      expect(() => canonicalEditorialJson(bad)).toThrow(/Editorial plan/);
    }
  });

  it("T17 repeated builds and key permutations yield identical canonical JSON and hash", () => {
    const specs = [{}, { dialogue: true }, { native: true, scene: "SC02" }] as const;
    const first = buildEditorialPlan(fixture(specs));
    const second = buildEditorialPlan(fixture(specs));
    const canonical = canonicalizeEditorialPlan(first);
    expect(canonicalizeEditorialPlan(second)).toBe(canonical);
    expect(canonicalizeEditorialPlan(reverseKeys(first))).toBe(canonical);
    expect(hashEditorialPlan(reverseKeys(first))).toBe(hashEditorialPlan(first));
    expect(hashEditorialPlan(first)).toBe(editorialSha256(canonical));
    expect(hashEditorialPlan(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonical).not.toMatch(/[\r\n\t]/);
    expect(canonicalEditorialJson(JSON.parse(canonical))).toBe(canonical);
    // The hash is computed outside the record and never stored inside it.
    expect(canonical).not.toContain(hashEditorialPlan(first));
  });

  it("T17 manifest hash is canonical parsed data, independent of key order and text line endings", () => {
    const input = fixture([{}, { dialogue: true }]);
    const plan = buildEditorialPlan(input);
    expect(plan.episode.manifestSha256)
      .toBe(editorialSha256(canonicalEditorialJson(EpisodeManifestSchema.parse(input.episode))));
    const reordered = buildEditorialPlan({ ...input, episode: reverseKeys(input.episode) as typeof input.episode });
    expect(reordered.episode.manifestSha256).toBe(plan.episode.manifestSha256);
    const crlfText = JSON.stringify(input.episode, null, 2).replace(/\n/g, "\r\n");
    const fromText = EpisodeManifestSchema.parse(JSON.parse(crlfText));
    expect(editorialSha256(canonicalEditorialJson(fromText))).toBe(plan.episode.manifestSha256);
  });

  it("T17 golden values pin the canonical record identity", () => {
    const plan = buildEditorialPlan(fixture([{ seconds: 0.28 }, { dialogue: true, seconds: 1.12 }, { native: true, seconds: 2.2 }]));
    expect(plan.episode.manifestSha256).toBe("67a635f60bcfc1bd9535a15ac3e654aa0bbc696ed8cdb45eabbf46044be6b2eb");
    expect(hashEditorialPlan(plan)).toBe("b4c833330da2532594a1f6677aa5d269c2ce9263e815d02cad5e74ff84013590");
    expect(editorialSha256(canonicalizeEditorialPlan(plan))).toBe("b4c833330da2532594a1f6677aa5d269c2ce9263e815d02cad5e74ff84013590");
  });

  it("T18 rendering changes alter both the plan hash and renderKey", () => {
    const base = fixture([{ seconds: 4 }, { seconds: 5 }]);
    const baseHash = hashEditorialPlan(buildEditorialPlan(base));
    const baseKey = renderKeyOf(base);
    const changedDuration = fixture([{ seconds: 4.04 }, { seconds: 5 }]);
    const changedContent = mutable(base);
    changedContent.preparedComposition.shots[1]!.normalizedArtifact.sha256 = "e".repeat(64);
    const changedCount = fixture([{ seconds: 4 }, { seconds: 5 }, { seconds: 1 }]);
    for (const variant of [changedDuration, changedContent, changedCount]) {
      expect(hashEditorialPlan(buildEditorialPlan(variant))).not.toBe(baseHash);
      expect(renderKeyOf(variant)).not.toBe(baseKey);
    }
  });

  it("T18 non-rendering title, provenance, evidence and intent changes alter the plan hash only", () => {
    const base = fixture([{}, { dialogue: true }]);
    const baseHash = hashEditorialPlan(buildEditorialPlan(base));
    const baseKey = renderKeyOf(base);
    const title = mutable(base);
    title.episode.title = "Renamed episode";
    title.preparedComposition.title = "Renamed episode";
    const shotTitle = mutable(base);
    shotTitle.episode.scenes[0]!.shots.find((shot) => shot.id === "S01")!.title = "Renamed shot";
    shotTitle.preparedComposition.shots[0]!.title = "Renamed shot";
    const provenance = mutable(base);
    provenance.preparedComposition.shots[0]!.providerExecutionId = "another-task";
    const evidence = mutable(base);
    const audio = evidence.preparedComposition.shots[1]!.normalizationPlan.audio;
    if (audio.mode !== "REPLACE_SOURCE_WITH_DIALOGUE") throw new Error("fixture");
    audio.lines[0]!.startSeconds = 0.5;
    audio.lines[0]!.endSeconds = audio.lines[0]!.startSeconds + audio.lines[0]!.durationSeconds;
    const intent = mutable(base);
    intent.episode.scenes[0]!.shots[0]!.audio.ambience = "Different non-rendering intent";
    for (const variant of [title, shotTitle, provenance, evidence, intent]) {
      expect(hashEditorialPlan(buildEditorialPlan(variant))).not.toBe(baseHash);
      expect(renderKeyOf(variant)).toBe(baseKey);
    }
  });

  it("T29 relocating the media root preserves the canonical record and renderKey but not runtime paths", () => {
    const specs = [{}, { dialogue: true }, { native: true }] as const;
    const roots = [
      "D:/Busybookie/Production", "D:\\Busybookie\\Production", "E:/Relocated/Media", "F:\\Elsewhere\\Root\\",
      "  G:/Trimmed/Root/  ", ...(windowsHost ? [] : ["/srv/busybookie/production", "/mnt/relocated/media/"]),
    ];
    const baseline = buildEditorialPlan(fixture(specs, roots[0]));
    const canonical = canonicalizeEditorialPlan(baseline);
    const key = renderKeyOf(fixture(specs, roots[0]), baseline);
    for (const root of roots) {
      const input = fixture(specs, root);
      const plan = buildEditorialPlan(input);
      expect(canonicalizeEditorialPlan(plan)).toBe(canonical);
      expect(hashEditorialPlan(plan)).toBe(hashEditorialPlan(baseline));
      const renderPlan = buildEditorialRoughCutRenderPlan({ plan, mediaRoot: root });
      expect(renderPlan.renderKey).toBe(key);
      expect(renderPlan).toStrictEqual(buildEpisodeRoughCutRenderPlan(input));
      const rootStart = root.trim().replace(/[\\/]+$/, "").slice(0, 8);
      expect(renderPlan.outputPath.replace(/\\/g, "/").startsWith(rootStart.replace(/\\/g, "/"))).toBe(true);
      expect(canonical).not.toContain(rootStart.replace(/\\/g, "\\\\"));
    }
  });
});
