import { EpisodeManifestSchema } from "../schemas/episodeManifest.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { hashEditorialDecisions } from "./canonicalizeEditorialPlanV2.js";
import { deriveEditorialTimeline, type EditorialTimelineEdgeInput } from "./deriveEditorialTimeline.js";
import type { EditorialPlanV2 } from "./editorialPlanV2.schema.js";
import { validateEditorialDecisionsAgainstSource } from "./validateEditorialDecisions.js";
import { assertEditorial, editorialDurationFrames } from "./validateEditorialPlan.js";
import type { EditorialPlanSourceInput } from "./validateEditorialPlanAgainstSource.js";
import { validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";
import { validateEditorialPlanV2AgainstSource } from "./validateEditorialPlanV2AgainstSource.js";

// Pure synchronous 2.0 projection from in-memory authority plus an optional decisions document (null = defaults).
// The returned plan is self-contained: rendering never needs the decisions document again.
export function buildEditorialPlanV2(source: EditorialPlanSourceInput, decisions: unknown): EditorialPlanV2 {
  const episode = EpisodeManifestSchema.parse(source.episode);
  const manifestSha256 = editorialSha256(canonicalEditorialJson(episode));
  const entries = episode.scenes.flatMap((scene) => scene.shots.map((shot) => ({ sceneId: scene.id, shot })))
    .sort((left, right) => left.shot.order - right.shot.order);
  const shots = entries.map(({ sceneId, shot }) => ({
    shotId: shot.id, sceneId, order: shot.order, title: shot.title, assetId: `normalized:${episode.episodeId}:${shot.id}`,
  }));
  const prepared = entries.map((_, index) => {
    const shot = source.preparedComposition.shots[index];
    assertEditorial(shot?.normalizedArtifact, "2.0 build requires every normalized artifact");
    return shot;
  });
  const assets = entries.map(({ shot }, index) => {
    const { normalizationPlan: n, normalizedArtifact: artifact } = prepared[index]!;
    const p = prepared[index]!;
    return {
      assetId: shots[index]!.assetId, kind: "NORMALIZED_SHOT" as const, sha256: artifact.sha256, bytes: artifact.bytes,
      contentType: artifact.contentType,
      mediaRootRelativePath: `cache/composition-normalized/${episode.episodeId}/${shot.id}/${episode.episodeId}_${shot.id}_${n.cacheKey}.mp4`,
      normalization: { schemaVersion: n.schemaVersion, profileId: n.profileId, cacheKey: n.cacheKey },
      generatedSource: {
        provider: p.provider, providerExecutionId: p.providerExecutionId, sourceSha256: p.sourceSha256,
        sourceBytes: p.sourceBytes, sourceContentType: p.sourceContentType,
      },
      assetDurationFrames: editorialDurationFrames(shot.durationSeconds),
    };
  });
  const resolved = decisions === null || decisions === undefined ? null : validateEditorialDecisionsAgainstSource(decisions, {
    episodeId: episode.episodeId, manifestSha256,
    shots: shots.map((shot, index) => ({ shotId: shot.shotId, normalizedAssetSha256: assets[index]!.sha256 })),
  });
  const ranges = shots.map((shot, index) => {
    const requested = resolved?.clips.find((clip) => clip.shotId === shot.shotId);
    return requested ? { sourceInFrame: requested.sourceInFrame, sourceOutFrame: requested.sourceOutFrame }
      : { sourceInFrame: 0, sourceOutFrame: assets[index]!.assetDurationFrames };
  });
  const edges: EditorialTimelineEdgeInput[] = shots.slice(1).map((incoming, index) => {
    const outgoing = shots[index]!;
    const requested = resolved?.transitions.find((t) => t.outgoingShotId === outgoing.shotId && t.incomingShotId === incoming.shotId);
    return requested && requested.type === "CROSS_DISSOLVE"
      ? { type: "CROSS_DISSOLVE", overlapFrames: requested.overlapFrames } : { type: "CUT" };
  });
  const timeline = deriveEditorialTimeline(ranges.map((range, index) => ({
    assetDurationFrames: assets[index]!.assetDurationFrames, ...range,
  })), edges);
  const videoClips = shots.map((shot, index) => ({
    clipId: `V1-${shot.shotId}`, shotId: shot.shotId, assetId: shot.assetId,
    sourceInFrame: ranges[index]!.sourceInFrame, sourceOutFrame: ranges[index]!.sourceOutFrame,
    timelineStartFrame: timeline.video[index]!.timelineStartFrame,
  }));
  const audioClips = shots.map((shot, index) => {
    const n = prepared[index]!.normalizationPlan;
    const evidence = n.schemaVersion === "1.0" ? { mode: n.audio.mode } : {
      mode: n.audio.mode, sourceAudioDisposition: n.audio.sourceAudioDisposition,
      dialoguePlanKey: n.audio.dialoguePlanKey, audioKey: n.audio.audioKey,
      lines: n.audio.lines.map((line) => ({
        lineNumber: line.lineNumber, dialogueLineId: line.dialogueLineId, sourceSha256: line.sourceSha256,
        sourceBytes: line.sourceBytes, startSeconds: line.startSeconds, durationSeconds: line.durationSeconds,
      })),
    };
    const derived = timeline.audio[index]!;
    return {
      clipId: `A1-${shot.shotId}`, shotId: shot.shotId, assetId: shot.assetId,
      sourceInFrame: derived.sourceInFrame, sourceOutFrame: derived.sourceOutFrame, timelineStartFrame: derived.timelineStartFrame,
      linkedClipId: `V1-${shot.shotId}`, audio: evidence,
    };
  });
  const plan = validateEditorialPlanV2({
    schemaVersion: "2.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId: episode.episodeId, title: episode.title, manifestSha256 },
    editorialDecisionsSha256: resolved ? hashEditorialDecisions(resolved) : null,
    profile: {
      profileId: "busybookie-master-v1", aspectRatio: "16:9", width: 1920, height: 1080,
      frameRate: { numerator: 25, denominator: 1 }, audioSampleRateHz: 48000, audioChannels: 2, audioChannelLayout: "stereo",
    },
    timelineDurationFrames: timeline.timelineDurationFrames,
    shots, assets,
    tracks: [{ trackId: "V1", kind: "VIDEO", clips: videoClips }, { trackId: "A1", kind: "SHOT_AUDIO", clips: audioClips }],
    transitions: edges.map((edge, index) => ({
      outgoingClipId: videoClips[index]!.clipId, incomingClipId: videoClips[index + 1]!.clipId, ...edge,
    })),
  });
  validateEditorialPlanV2AgainstSource({ plan, source, decisions: resolved });
  return plan;
}
