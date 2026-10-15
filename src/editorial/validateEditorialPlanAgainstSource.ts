import { EpisodeManifestSchema, type EpisodeManifest } from "../schemas/episodeManifest.schema.js";
import type { ProductionRules } from "../schemas/productionRules.schema.js";
import type { PreparedEpisodeComposition } from "../composition/prepareEpisodeComposition.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { assertEditorial, editorialDurationFrames, validateEditorialPlan } from "./validateEditorialPlan.js";
import { editorialRoot, resolveEditorialAssetPath } from "./resolveEditorialAssetPath.js";

export type EditorialPlanSourceInput = Readonly<{
  episode: EpisodeManifest;
  preparedComposition: PreparedEpisodeComposition;
  postProduction: ProductionRules["postProduction"];
  mediaRoot: string;
}>;
export type ValidateEditorialPlanAgainstSourceInput = EditorialPlanSourceInput & Readonly<{ plan: unknown }>;

export function validateEditorialPlanAgainstSource(input: ValidateEditorialPlanAgainstSourceInput): void {
  try {
    validateSource(input);
  } catch (cause) {
    throw new Error("Editorial plan source-authority validation failed.", { cause });
  }
}

function validateSource(input: ValidateEditorialPlanAgainstSourceInput): void {
  const plan = validateEditorialPlan(input.plan);
  const episode = EpisodeManifestSchema.parse(input.episode);
  const prepared = input.preparedComposition;
  const post = input.postProduction;
  editorialRoot(input.mediaRoot);
  assertEditorial(plan.episode.episodeId === episode.episodeId && prepared.episodeId === episode.episodeId &&
    plan.episode.title === episode.title && prepared.title === episode.title &&
    plan.episode.manifestSha256 === editorialSha256(canonicalEditorialJson(episode)), "episode snapshot mismatch");
  const entries = episode.scenes.flatMap((scene) => scene.shots.map((shot) => ({ sceneId: scene.id, shot })))
    .sort((a, b) => a.shot.order - b.shot.order);
  assertEditorial(entries.length === plan.shots.length && prepared.shots.length === entries.length &&
    prepared.totalShots === entries.length, "source shot count mismatch");
  assertEditorial(post.aspectRatio === "16:9" && post.width === 1920 && post.height === 1080 &&
    post.timelineFps === 25 && post.audioSampleRateHz === 48000, "source master profile mismatch");
  let total = 0;
  for (const [index, { sceneId, shot }] of entries.entries()) {
    const p = prepared.shots[index]!;
    const s = plan.shots[index]!;
    const asset = plan.assets[index]!;
    const audio = plan.tracks[1].clips[index]!.audio;
    const n = p.normalizationPlan;
    const artifact = p.normalizedArtifact;
    assertEditorial(s.sceneId === sceneId && p.sceneId === sceneId && s.shotId === shot.id && p.shotId === shot.id &&
      s.order === shot.order && p.order === shot.order && s.title === shot.title && p.title === shot.title,
    "source shot identity/order/title mismatch");
    assertEditorial(s.durationFrames === editorialDurationFrames(shot.durationSeconds) &&
      p.durationSeconds === shot.durationSeconds && n.targetDurationSeconds === shot.durationSeconds,
    "source duration mismatch");
    total += shot.durationSeconds;
    assertEditorial(n.schemaVersion === asset.normalization.schemaVersion && n.profileId === asset.normalization.profileId &&
      n.cacheKey === asset.normalization.cacheKey && n.episodeId === episode.episodeId && n.shotId === shot.id &&
      (n.schemaVersion !== "2.0" || n.sceneId === sceneId), "normalization identity/profile mismatch");
    assertEditorial(n.container === "mp4" && n.durationMode === "MANIFEST_LOCKED" && n.video.codecName === "h264" &&
      n.video.width === 1920 && n.video.height === 1080 && n.video.frameRate === 25 && n.video.pixelFormat === "yuv420p" &&
      n.video.scaleMode === "FIT_PAD" && n.audio.codecName === "aac" && n.audio.sampleRateHz === 48000 &&
      n.audio.channels === 2 && n.audio.channelLayout === "stereo", "intrinsic normalized format mismatch");
    assertEditorial(n.nativeAudio === shot.generation.nativeAudio && p.nativeAudio === shot.generation.nativeAudio &&
      n.sourceSha256 === p.sourceSha256 && n.sourceVideoPath === p.sourceVideoPath, "normalization source mismatch");
    const generated = asset.generatedSource;
    assertEditorial(generated.provider === p.provider && generated.providerExecutionId === p.providerExecutionId &&
      generated.sourceSha256 === p.sourceSha256 && generated.sourceBytes === p.sourceBytes &&
      generated.sourceContentType === p.sourceContentType, "generated provenance mismatch");
    assertEditorial(artifact && artifact.sha256 === asset.sha256 && artifact.bytes === asset.bytes &&
      artifact.contentType === asset.contentType && artifact.outputPath === n.outputPath &&
      artifact.outputPath === resolveEditorialAssetPath(input.mediaRoot, asset), "normalized artifact binding mismatch");
    assertEditorial(Number.isFinite(artifact.durationSeconds) && artifact.durationSeconds > 0 &&
      Number.isFinite(artifact.durationToleranceSeconds) && artifact.durationToleranceSeconds > 0 &&
      Math.abs(artifact.durationSeconds - shot.durationSeconds) <= artifact.durationToleranceSeconds + 0.000001,
    "normalized duration outside admitted tolerance");
    const cacheFields = [n.profileId, episode.episodeId];
    if (n.schemaVersion === "2.0") cacheFields.push(sceneId);
    cacheFields.push(shot.id, p.sourceSha256, String(shot.durationSeconds));
    cacheFields.push(n.schemaVersion === "2.0" ? n.audio.audioKey : p.nativeAudio ? "preserve-native" : "synthetic-silence");
    cacheFields.push("1920x1080@25", "48000");
    assertEditorial(n.cacheKey === editorialSha256(cacheFields.join("\n")), "normalization cache key mismatch");
    assertEditorial((shot.dialogue.length > 0) === (n.schemaVersion === "2.0"), "dialogue normalization routing mismatch");
    if (n.schemaVersion === "1.0") {
      const mode = p.nativeAudio ? "PRESERVE_NATIVE" : "SYNTHETIC_SILENCE";
      assertEditorial(n.audio.mode === mode && audio.mode === mode, "native/silence intent mismatch");
    } else {
      assertEditorial(audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE" && n.audio.mode === "REPLACE_SOURCE_WITH_DIALOGUE" &&
        n.audio.mixNativeAudio === false, "requires baked dialogue without native mixing");
      assertEditorial(audio.sourceAudioDisposition === (p.nativeAudio ? "DISCARD_NATIVE_AUDIO" : "NO_SOURCE_AUDIO") &&
        audio.sourceAudioDisposition === n.audio.sourceAudioDisposition && audio.dialoguePlanKey === n.audio.dialoguePlanKey &&
        audio.audioKey === n.audio.audioKey && audio.lines.length === shot.dialogue.length &&
        n.audio.lines.length === shot.dialogue.length, "dialogue evidence/count mismatch");
      for (const [i, line] of audio.lines.entries()) {
        const source = n.audio.lines[i]!;
        assertEditorial(line.lineNumber === source.lineNumber && line.dialogueLineId === source.dialogueLineId &&
          line.sourceSha256 === source.sourceSha256 && line.sourceBytes === source.sourceBytes &&
          line.startSeconds === source.startSeconds && line.durationSeconds === source.durationSeconds &&
          source.endSeconds === Math.min(line.startSeconds + line.durationSeconds, shot.durationSeconds) &&
          typeof source.sourceAudioPath === "string" && source.sourceAudioPath.trim().length > 0,
        "dialogue line source binding mismatch");
      }
    }
  }
  assertEditorial(prepared.totalDurationSeconds === total, "source total must equal ordered seconds sum");
}
