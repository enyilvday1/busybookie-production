import { posix, win32 } from "node:path";
import { z } from "zod";
import type { EpisodeRoughCutRenderPlan } from "../composition/buildEpisodeRoughCutRenderPlan.js";
import { buildEditorialRoughCutRenderPlan } from "./buildEditorialRoughCutRenderPlan.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { downgradeE2EquivalentEditorialPlanV2ToV1, isE2EquivalentEditorialPlanV2 } from "./migrateEditorialPlan.js";
import { editorialRoot } from "./resolveEditorialAssetPath.js";
import { resolveEditorialAssetPathV2 } from "./resolveEditorialAssetPathV2.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";
import { deriveEditorialPlanV2Timeline, validateEditorialPlanV2 } from "./validateEditorialPlanV2.js";

// Immutable render behaviour contract: any output-affecting change requires a new profile id.
export const EDITORIAL_EDIT_RENDER_PROFILE_ID = "busybookie-episode-edit-v1";

export const EDITORIAL_EDIT_OUTPUT_CONTRACT = freezeEditorial({
  container: "mp4",
  video: { codecName: "h264", profile: "High", width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 }, pixelFormat: "yuv420p" },
  audio: { codecName: "aac", sampleRateHz: 48000, channels: 2, channelLayout: "stereo" },
});
// Common contract for every video join operand and every audio segment (canonical frames are unaffected).
export const EDITORIAL_EDIT_VIDEO_JOIN_INPUT = freezeEditorial({
  width: 1920, height: 1080, pixelFormat: "yuv420p", frameRate: { numerator: 25, denominator: 1 },
  timeBase: { numerator: 1, denominator: 25 }, ptsOrigin: 0,
});
export const EDITORIAL_EDIT_AUDIO_SEGMENT_INPUT = freezeEditorial({
  sampleRateHz: 48000, timeBase: { numerator: 1, denominator: 48000 }, ptsOrigin: 0,
});

const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0), "Expected a non-negative safe integer.");
const positive = count.refine((n) => n > 0, "Expected a positive integer.");
const name = z.string().min(1);
const sha = z.string().regex(/^[a-f0-9]{64}$/);

export const E3RenderIdentityV1Schema = z.object({
  identityType: z.literal("BUSYBOOKIE_E3_RENDER_IDENTITY"),
  identityVersion: z.literal("1"),
  renderProfileId: name,
  output: z.object({
    container: name,
    video: z.object({
      codecName: name, profile: name, width: positive, height: positive,
      frameRate: z.object({ numerator: positive, denominator: positive }).strict(), pixelFormat: name,
    }).strict(),
    audio: z.object({ codecName: name, sampleRateHz: positive, channels: positive, channelLayout: name }).strict(),
  }).strict(),
  inputs: z.array(z.object({ sha256: sha }).strict()).min(1),
  videoSegments: z.array(z.object({ inputIndex: count, sourceInFrame: count, sourceOutFrame: count }).strict()).min(1),
  videoJoins: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("CUT") }).strict(),
    z.object({ type: z.literal("CROSS_DISSOLVE"), overlapFrames: positive }).strict(),
  ])),
  audioSegments: z.array(z.object({ inputIndex: count, sourceInSample: count, sourceOutSample: count }).strict()).min(1),
}).strict();
export type E3RenderIdentityV1 = z.infer<typeof E3RenderIdentityV1Schema>;

// renderKey is render-effective only: no decisions provenance, manifest hash, titles, ids, paths or tool version.
export function hashE3RenderIdentityV1(identity: unknown): string {
  const parsed = E3RenderIdentityV1Schema.safeParse(identity);
  assertEditorial(parsed.success, `E3 render identity is invalid: ${parsed.error?.message ?? ""}`);
  const value = parsed.data;
  for (const segment of [...value.videoSegments, ...value.audioSegments]) {
    assertEditorial(segment.inputIndex < value.inputs.length, "E3 render identity segment references a missing input");
  }
  assertEditorial(value.videoJoins.length === value.videoSegments.length - 1, "E3 render identity requires one join per adjacent segment pair");
  return editorialSha256(canonicalEditorialJson(value));
}

export type EditorialEditVideoJoin = Readonly<
  { type: "CUT"; incomingStartFrame: number } | { type: "CROSS_DISSOLVE"; incomingStartFrame: number; overlapFrames: number }
>;

export type EditorialEditRenderPlan = Readonly<{
  profileId: typeof EDITORIAL_EDIT_RENDER_PROFILE_ID;
  episodeId: string;
  title: string;
  output: typeof EDITORIAL_EDIT_OUTPUT_CONTRACT;
  videoJoinInput: typeof EDITORIAL_EDIT_VIDEO_JOIN_INPUT;
  audioSegmentInput: typeof EDITORIAL_EDIT_AUDIO_SEGMENT_INPUT;
  timelineDurationFrames: number;
  inputs: readonly Readonly<{ inputIndex: number; assetId: string; sha256: string; assetDurationFrames: number; sourceVideoPath: string }>[];
  videoSegments: readonly Readonly<{ inputIndex: number; sourceInFrame: number; sourceOutFrame: number; timelineStartFrame: number }>[];
  videoJoins: readonly EditorialEditVideoJoin[];
  audioSegments: readonly Readonly<{ inputIndex: number; sourceInSample: number; sourceOutSample: number; timelineStartFrame: number }>[];
  renderIdentity: E3RenderIdentityV1;
  renderKey: string;
  outputPath: string;
}>;

export type BuildEditorialEditRenderPlanInput = Readonly<{ plan: unknown; mediaRoot: string }>;

export function buildEditorialEditRenderPlan(input: BuildEditorialEditRenderPlanInput): EditorialEditRenderPlan {
  const plan = validateEditorialPlanV2(input.plan);
  assertEditorial(!isE2EquivalentEditorialPlanV2(plan), "E2-equivalent 2.0 plans must use the E2 rough-cut compatibility route");
  const { root, windows } = editorialRoot(input.mediaRoot);
  const timeline = deriveEditorialPlanV2Timeline(plan);
  // One logical input per clip, in clip order; equal-content inputs are never merged.
  const inputs = plan.assets.map((asset, inputIndex) => ({
    inputIndex, assetId: asset.assetId, sha256: asset.sha256, assetDurationFrames: asset.assetDurationFrames,
    sourceVideoPath: resolveEditorialAssetPathV2(root, asset),
  }));
  const videoSegments = timeline.video.map((clip, inputIndex) => ({
    inputIndex, sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame, timelineStartFrame: clip.timelineStartFrame,
  }));
  const videoJoins: EditorialEditVideoJoin[] = timeline.edges.map((edge) => (edge.type === "CROSS_DISSOLVE"
    ? { type: "CROSS_DISSOLVE", incomingStartFrame: edge.incomingStartFrame, overlapFrames: edge.overlapFrames }
    : { type: "CUT", incomingStartFrame: edge.incomingStartFrame }));
  const audioSegments = timeline.audio.map((clip, inputIndex) => ({
    inputIndex, sourceInSample: clip.sourceInSample, sourceOutSample: clip.sourceOutSample, timelineStartFrame: clip.timelineStartFrame,
  }));
  const renderIdentity: E3RenderIdentityV1 = {
    identityType: "BUSYBOOKIE_E3_RENDER_IDENTITY", identityVersion: "1", renderProfileId: EDITORIAL_EDIT_RENDER_PROFILE_ID,
    output: structuredClone(EDITORIAL_EDIT_OUTPUT_CONTRACT),
    inputs: inputs.map((entry) => ({ sha256: entry.sha256 })),
    videoSegments: videoSegments.map((s) => ({ inputIndex: s.inputIndex, sourceInFrame: s.sourceInFrame, sourceOutFrame: s.sourceOutFrame })),
    videoJoins: videoJoins.map((join) => (join.type === "CROSS_DISSOLVE" ? { type: "CROSS_DISSOLVE", overlapFrames: join.overlapFrames } : { type: "CUT" })),
    audioSegments: audioSegments.map((s) => ({ inputIndex: s.inputIndex, sourceInSample: s.sourceInSample, sourceOutSample: s.sourceOutSample })),
  };
  const renderKey = hashE3RenderIdentityV1(renderIdentity);
  const episodeId = plan.episode.episodeId;
  return freezeEditorial({
    profileId: EDITORIAL_EDIT_RENDER_PROFILE_ID, episodeId, title: plan.episode.title,
    output: EDITORIAL_EDIT_OUTPUT_CONTRACT, videoJoinInput: EDITORIAL_EDIT_VIDEO_JOIN_INPUT,
    audioSegmentInput: EDITORIAL_EDIT_AUDIO_SEGMENT_INPUT, timelineDurationFrames: timeline.timelineDurationFrames,
    inputs, videoSegments, videoJoins, audioSegments, renderIdentity, renderKey,
    outputPath: (windows ? win32 : posix).resolve(root, "exports", episodeId, "edit", `${episodeId}_edit_${renderKey}.mp4`),
  });
}

export type EditorialRenderRoute =
  | Readonly<{ route: "E2_ROUGH_CUT"; renderPlan: EpisodeRoughCutRenderPlan }>
  | Readonly<{ route: "E3_EDIT"; renderPlan: EditorialEditRenderPlan }>;

// E2-equivalent plans return the exact legacy rough-cut plan; the caller applies the existing E2 command builder.
export function planEditorialRenderV2(input: BuildEditorialEditRenderPlanInput): EditorialRenderRoute {
  const plan = validateEditorialPlanV2(input.plan);
  if (isE2EquivalentEditorialPlanV2(plan)) {
    return freezeEditorial({
      route: "E2_ROUGH_CUT",
      renderPlan: buildEditorialRoughCutRenderPlan({ plan: downgradeE2EquivalentEditorialPlanV2ToV1(plan), mediaRoot: input.mediaRoot }),
    });
  }
  return freezeEditorial({ route: "E3_EDIT", renderPlan: buildEditorialEditRenderPlan({ plan, mediaRoot: input.mediaRoot }) });
}
