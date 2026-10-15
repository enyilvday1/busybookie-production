import { EpisodeManifestSchema } from "../schemas/episodeManifest.schema.js";
import type { EditorialPlan } from "./editorialPlan.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { assertEditorial, editorialDurationFrames, validateEditorialPlan } from "./validateEditorialPlan.js";
import { validateEditorialPlanAgainstSource, type EditorialPlanSourceInput } from "./validateEditorialPlanAgainstSource.js";

export type BuildEditorialPlanInput = EditorialPlanSourceInput;

export function buildEditorialPlan(input: BuildEditorialPlanInput): EditorialPlan {
  try {
    return projectEditorialPlan(input);
  } catch (cause) {
    throw new Error("Editorial plan construction failed.", { cause });
  }
}

function projectEditorialPlan(input: BuildEditorialPlanInput): EditorialPlan {
  const episode = EpisodeManifestSchema.parse(input.episode);
  const entries = episode.scenes.flatMap((scene) => scene.shots.map((shot) => ({ sceneId: scene.id, shot })))
    .sort((a, b) => a.shot.order - b.shot.order);
  const shots = entries.map(({ sceneId, shot }) => ({
    shotId: shot.id, sceneId, order: shot.order, title: shot.title,
    durationFrames: editorialDurationFrames(shot.durationSeconds), assetId: `normalized:${episode.episodeId}:${shot.id}`,
  }));
  const assets = shots.map((shot, index) => {
    const prepared = input.preparedComposition.shots[index];
    assertEditorial(prepared?.normalizedArtifact, "requires every normalized artifact");
    const { normalizationPlan: n, normalizedArtifact: artifact } = prepared;
    return {
      assetId: shot.assetId, kind: "NORMALIZED_SHOT", sha256: artifact.sha256, bytes: artifact.bytes,
      contentType: artifact.contentType,
      // Exact reconstruction is checked against the supplied artifact in source validation.
      mediaRootRelativePath: `cache/composition-normalized/${episode.episodeId}/${shot.shotId}/${episode.episodeId}_${shot.shotId}_${n.cacheKey}.mp4`,
      normalization: { schemaVersion: n.schemaVersion, profileId: n.profileId, cacheKey: n.cacheKey },
      generatedSource: {
        provider: prepared.provider, providerExecutionId: prepared.providerExecutionId,
        sourceSha256: prepared.sourceSha256, sourceBytes: prepared.sourceBytes, sourceContentType: prepared.sourceContentType,
      },
    };
  });
  let durationFrames = 0;
  const video = shots.map((shot) => {
    const clip = { clipId: `V1-${shot.shotId}`, shotId: shot.shotId, assetId: shot.assetId,
      timelineStartFrame: durationFrames, durationFrames: shot.durationFrames, sourceInFrame: 0, sourceOutFrame: shot.durationFrames };
    durationFrames += shot.durationFrames;
    return clip;
  });
  const audio = video.map((clip, index) => {
    const n = input.preparedComposition.shots[index]!.normalizationPlan;
    const evidence = n.schemaVersion === "1.0" ? { mode: n.audio.mode } : {
      mode: n.audio.mode, sourceAudioDisposition: n.audio.sourceAudioDisposition,
      dialoguePlanKey: n.audio.dialoguePlanKey, audioKey: n.audio.audioKey,
      lines: n.audio.lines.map((line) => ({ lineNumber: line.lineNumber, dialogueLineId: line.dialogueLineId,
        sourceSha256: line.sourceSha256, sourceBytes: line.sourceBytes, startSeconds: line.startSeconds, durationSeconds: line.durationSeconds })),
    };
    return { ...clip, clipId: `A1-${clip.shotId}`, linkedClipId: clip.clipId, audio: evidence };
  });
  const plan = validateEditorialPlan({
    schemaVersion: "1.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId: episode.episodeId, title: episode.title, manifestSha256: editorialSha256(canonicalEditorialJson(episode)) },
    profile: { profileId: "busybookie-master-v1", aspectRatio: "16:9", width: 1920, height: 1080,
      frameRate: { numerator: 25, denominator: 1 }, audioSampleRateHz: 48000, audioChannels: 2, audioChannelLayout: "stereo" },
    assemblyMode: "STRAIGHT_CUT", durationFrames, shots, assets,
    tracks: [{ trackId: "V1", kind: "VIDEO", clips: video }, { trackId: "A1", kind: "SHOT_AUDIO", clips: audio }],
  });
  validateEditorialPlanAgainstSource({ ...input, plan });
  return plan;
}
