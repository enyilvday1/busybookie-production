import { posix, win32 } from "node:path";
import type { EpisodeRoughCutRenderPlan } from "../composition/buildEpisodeRoughCutRenderPlan.js";
import type { EditorialPlan } from "./editorialPlan.schema.js";
import { editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { freezeEditorial, validateEditorialPlan } from "./validateEditorialPlan.js";
import { editorialRoot, resolveEditorialAssetPath } from "./resolveEditorialAssetPath.js";

export type BuildEditorialRoughCutRenderPlanInput = Readonly<{ plan: EditorialPlan; mediaRoot: string }>;

export function buildEditorialRoughCutRenderPlan(input: BuildEditorialRoughCutRenderPlanInput): EpisodeRoughCutRenderPlan {
  const plan = validateEditorialPlan(input.plan);
  const { root, windows } = editorialRoot(input.mediaRoot);
  const shots = plan.shots.map((shot, i) => ({
    sceneId: shot.sceneId, shotId: shot.shotId, order: shot.order, title: shot.title,
    durationSeconds: shot.durationFrames / 25, sourceVideoPath: resolveEditorialAssetPath(root, plan.assets[i]!),
    sourceBytes: plan.assets[i]!.bytes, sourceSha256: plan.assets[i]!.sha256,
  }));
  const totalDurationSeconds = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0);
  const profileId = "busybookie-episode-rough-cut-v1";
  const fields = [profileId, plan.episode.episodeId, String(shots.length), String(totalDurationSeconds), "1920x1080@25", "48000"];
  for (const shot of shots) fields.push(shot.shotId, String(shot.order), String(shot.durationSeconds), shot.sourceSha256);
  const renderKey = editorialSha256(fields.join("\n"));
  return freezeEditorial({
    schemaVersion: "1.0", profileId, assemblyMode: "STRAIGHT_CUT", episodeId: plan.episode.episodeId, title: plan.episode.title,
    totalShots: shots.length, totalDurationSeconds, container: "mp4",
    video: { codecName: "h264", profile: "High", width: 1920, height: 1080, frameRate: 25, pixelFormat: "yuv420p" },
    audio: { codecName: "aac", sampleRateHz: 48000, channels: 2, channelLayout: "stereo" },
    renderKey, outputPath: (windows ? win32 : posix).resolve(root, "exports", plan.episode.episodeId, "rough-cut",
      `${plan.episode.episodeId}_rough-cut_${renderKey}.mp4`), shots,
  });
}
