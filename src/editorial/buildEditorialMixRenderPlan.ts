import { posix, win32 } from "node:path";
import { z } from "zod";
import {
  E3RenderIdentityV1Schema, EDITORIAL_EDIT_OUTPUT_CONTRACT, planEditorialRenderV2, type EditorialRenderRoute,
} from "./buildEditorialEditRenderPlan.js";
import { buildEditorialMixAudioGraph, hashEditorialMixAudioGraph } from "./buildEditorialMixAudioGraph.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import {
  editorialTimelineDurationSamples, effectiveAudioAssetIds, effectiveAudioLayers, isEffectiveAudioMix,
} from "./deriveEditorialAudioMix.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { E4_MAX_LAYER_PLACEMENTS } from "./editorialPlanV3.schema.js";
import { downgradeEditorialPlanV3ToV2 } from "./migrateEditorialPlanV3.js";
import { editorialRoot } from "./resolveEditorialAssetPath.js";
import { resolveEditorialAssetPathV2 } from "./resolveEditorialAssetPathV2.js";
import { resolveExternalAudioAssetPath } from "./resolveExternalAudioAssetPath.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";
import { deriveEditorialPlanV2Timeline } from "./validateEditorialPlanV2.js";
import { validateEditorialPlanV3 } from "./validateEditorialPlanV3.js";

// Immutable render behaviour contract: any output-affecting change requires a new profile id.
export const E4_MIX_RENDER_PROFILE_ID = "busybookie-episode-mix-v1";
export const E4_FADE_LAW_ID = "LINEAR_AMPLITUDE_ENDPOINT_COMPLETE_V1";
export const E4_SUMMATION_LAW_ID = "UNITY_ORDERED_V1";

const count = z.number().refine((n) => Number.isSafeInteger(n) && n >= 0 && !Object.is(n, -0), "Expected a non-negative safe integer.");
const positive = count.refine((n) => n > 0, "Expected a positive integer.");
const fade = count.refine((n) => n === 0 || n >= 2, "Fades are 0 or at least 2 samples.");
const gain = z.number().refine((n) => Number.isSafeInteger(n) && !Object.is(n, -0) && n >= -9_600 && n <= 1_200,
  "Expected gain in -9600..1200 centi-dB.");
const sha = z.string().regex(/^[a-f0-9]{64}$/);

export const E4RenderIdentityV1Schema = z.object({
  identityType: z.literal("BUSYBOOKIE_E4_RENDER_IDENTITY"),
  identityVersion: z.literal("1"),
  renderProfileId: z.literal(E4_MIX_RENDER_PROFILE_ID),
  output: E3RenderIdentityV1Schema.shape.output,
  timelineDurationSamples: positive,
  inputs: z.array(z.discriminatedUnion("mediaKind", [
    z.object({ inputIndex: count, mediaKind: z.literal("NORMALIZED_SHOT"), sha256: sha }).strict(),
    z.object({
      inputIndex: count, mediaKind: z.literal("EXTERNAL_AUDIO"), sha256: sha, channelCount: z.union([z.literal(1), z.literal(2)]),
    }).strict(),
  ])).min(1),
  videoSegments: E3RenderIdentityV1Schema.shape.videoSegments,
  videoJoins: E3RenderIdentityV1Schema.shape.videoJoins,
  bed: z.object({
    segments: E3RenderIdentityV1Schema.shape.audioSegments,
    level: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("MUTED") }).strict(),
      z.object({ mode: z.literal("GAIN"), gainCentiDb: gain }).strict(),
    ]),
  }).strict(),
  layers: z.array(z.object({
    inputIndex: count, channelMap: z.enum(["MONO_DUPLICATE", "STEREO_PASSTHROUGH"]),
    sourceInSample: count, sourceOutSample: positive, timelineStartSample: count,
    gainCentiDb: gain, fadeInSamples: fade, fadeOutSamples: fade,
  }).strict()).max(E4_MAX_LAYER_PLACEMENTS),
  fadeLaw: z.literal(E4_FADE_LAW_ID),
  summationLaw: z.literal(E4_SUMMATION_LAW_ID),
}).strict();
export type E4RenderIdentityV1 = EditorialReadonly<z.infer<typeof E4RenderIdentityV1Schema>>;

// Exact integer arithmetic for identity durations: operands and result must be safe integers, so the exact result is
// never rounded and a forged identity cannot cancel unsafe intermediates back into a coherent-looking total.
function checkedAddSafeInteger(a: number, b: number, detail: string): number {
  const result = a + b;
  assertEditorial(Number.isSafeInteger(a) && Number.isSafeInteger(b) && Number.isSafeInteger(result),
    `${detail} exceeds the safe integer range`);
  return result;
}

function checkedSubtractSafeInteger(a: number, b: number, detail: string): number {
  const result = a - b;
  assertEditorial(Number.isSafeInteger(a) && Number.isSafeInteger(b) && Number.isSafeInteger(result) && result >= 0,
    `${detail} is negative or exceeds the safe integer range`);
  return result;
}

// Strict parse plus topology checks; the result is the only value the audio graph builder consumes.
export function validateE4RenderIdentityV1(identity: unknown): E4RenderIdentityV1 {
  const parsed = E4RenderIdentityV1Schema.safeParse(identity);
  assertEditorial(parsed.success, `E4 render identity is invalid: ${parsed.error?.message ?? ""}`);
  const value = parsed.data;
  value.inputs.forEach((entry, index) => assertEditorial(entry.inputIndex === index, "E4 render identity inputs must be dense and ordered"));
  const kindOf = (inputIndex: number) => value.inputs[inputIndex]?.mediaKind;
  const shots = value.inputs.filter((entry) => entry.mediaKind === "NORMALIZED_SHOT").length;
  assertEditorial(value.inputs.slice(0, shots).every((entry) => entry.mediaKind === "NORMALIZED_SHOT"),
    "E4 render identity lists normalized-shot inputs before external audio inputs");
  assertEditorial(value.videoSegments.length === shots && value.bed.segments.length === shots,
    "E4 render identity requires one video and one bed segment per base input");
  assertEditorial(value.videoJoins.length === value.videoSegments.length - 1, "E4 render identity requires one join per adjacent segment pair");
  for (const segment of [...value.videoSegments, ...value.bed.segments]) {
    assertEditorial(kindOf(segment.inputIndex) === "NORMALIZED_SHOT", "E4 render identity base segment references a non-shot input");
  }
  // Internal duration consistency (E3 timeline law): whole 25 fps frames; V1 = first segment + each next segment minus
  // its incoming dissolve overlap (checked, never via unsafe totals); the atomic A1 bed covers exactly the timeline.
  // A recomputed renderKey never makes a contradiction acceptable.
  assertEditorial(value.timelineDurationSamples % 1_920 === 0,
    "E4 render identity timelineDurationSamples is not a whole number of 25 fps frames");
  const lengths = value.videoSegments.map((segment) => {
    assertEditorial(segment.sourceInFrame < segment.sourceOutFrame, "E4 render identity video segments must be non-empty");
    return checkedSubtractSafeInteger(segment.sourceOutFrame, segment.sourceInFrame, "E4 render identity video segment length");
  });
  const overlaps = value.videoJoins.map((join) => (join.type === "CROSS_DISSOLVE" ? join.overlapFrames : 0));
  // Frozen E3 dissolve law: incoming + outgoing overlap leaves at least one independent frame in every segment.
  for (const [index, length] of lengths.entries()) {
    const consumed = checkedAddSafeInteger(index > 0 ? overlaps[index - 1]! : 0, index < overlaps.length ? overlaps[index]! : 0,
      "E4 render identity dissolve overlap");
    assertEditorial(consumed <= length - 1, "E4 render identity dissolve overlaps must leave at least one independent frame per video segment");
  }
  let videoFrames = lengths[0]!;
  for (const [index, overlap] of overlaps.entries()) {
    videoFrames = checkedAddSafeInteger(videoFrames,
      checkedSubtractSafeInteger(lengths[index + 1]!, overlap, "E4 render identity video join contribution"), "E4 render identity video timeline duration");
  }
  assertEditorial(videoFrames === value.timelineDurationSamples / 1_920,
    "E4 render identity video timeline duration contradicts timelineDurationSamples");
  let bedSamples = 0;
  for (const segment of value.bed.segments) {
    assertEditorial(segment.sourceInSample < segment.sourceOutSample, "E4 render identity bed segments must be non-empty");
    bedSamples = checkedAddSafeInteger(bedSamples,
      checkedSubtractSafeInteger(segment.sourceOutSample, segment.sourceInSample, "E4 render identity bed segment length"),
      "E4 render identity A1 bed duration");
  }
  assertEditorial(bedSamples === value.timelineDurationSamples,
    "E4 render identity A1 bed duration contradicts timelineDurationSamples");
  for (const layer of value.layers) {
    const input = value.inputs[layer.inputIndex];
    assertEditorial(input?.mediaKind === "EXTERNAL_AUDIO", "E4 render identity layer references a non-external input");
    assertEditorial(layer.channelMap === (input.channelCount === 1 ? "MONO_DUPLICATE" : "STEREO_PASSTHROUGH"),
      "E4 render identity channel map contradicts the input channel count");
    assertEditorial(layer.sourceInSample < layer.sourceOutSample &&
      layer.timelineStartSample + (layer.sourceOutSample - layer.sourceInSample) <= value.timelineDurationSamples &&
      layer.fadeInSamples + layer.fadeOutSamples <= layer.sourceOutSample - layer.sourceInSample,
    "E4 render identity layer range, placement or fades are inconsistent");
  }
  for (const entry of value.inputs.slice(shots)) {
    assertEditorial(value.layers.some((layer) => layer.inputIndex === entry.inputIndex), "E4 render identity external input is unused");
  }
  assertEditorial(value.bed.level.mode === "MUTED" || value.bed.level.gainCentiDb !== 0 || value.layers.length > 0,
    "E4 render identity requires an effective mix");
  return freezeEditorial(value);
}

// renderKey is render-effective only: no decisions/base provenance, ids, roles, locators, paths or tool version.
export function hashE4RenderIdentityV1(identity: unknown): string {
  return editorialSha256(canonicalEditorialJson(validateE4RenderIdentityV1(identity)));
}

export type EditorialMixRenderInput = Readonly<
  | { inputIndex: number; mediaKind: "NORMALIZED_SHOT"; assetId: string; sha256: string; bytes: number; assetDurationFrames: number; path: string }
  | { inputIndex: number; mediaKind: "EXTERNAL_AUDIO"; assetId: string; sha256: string; bytes: number; channelCount: 1 | 2;
    assetDurationSamples: number; path: string }
>;

export type EditorialMixRenderPlan = Readonly<{
  profileId: typeof E4_MIX_RENDER_PROFILE_ID;
  episodeId: string;
  title: string;
  output: typeof EDITORIAL_EDIT_OUTPUT_CONTRACT;
  timelineDurationFrames: number;
  timelineDurationSamples: number;
  // Physical input slots: base shots in base order, then external assets by first effective reference.
  inputs: readonly EditorialMixRenderInput[];
  renderIdentity: E4RenderIdentityV1;
  renderKey: string;
  audioGraph: string;
  mixGraphSha256: string;
  outputPath: string;
}>;

export type BuildEditorialMixRenderPlanInput = Readonly<{ plan: unknown; mediaRoot: string }>;

export function buildEditorialMixRenderPlan(input: BuildEditorialMixRenderPlanInput): EditorialMixRenderPlan {
  const plan = validateEditorialPlanV3(input.plan);
  assertEditorial(isEffectiveAudioMix(plan.audioMix), "3.0 plans without an effective audio mix must use the 2.0 route");
  const { root, windows } = editorialRoot(input.mediaRoot);
  const base = plan.basePlan;
  // Both E2-equivalent and trimmed/dissolved bases use the exact E3 timeline law; nothing is reinterpreted.
  const timeline = deriveEditorialPlanV2Timeline(base);
  const timelineDurationSamples = editorialTimelineDurationSamples(timeline.timelineDurationFrames);
  const baseInputs: EditorialMixRenderInput[] = base.assets.map((asset, inputIndex) => ({
    inputIndex, mediaKind: "NORMALIZED_SHOT", assetId: asset.assetId, sha256: asset.sha256, bytes: asset.bytes,
    assetDurationFrames: asset.assetDurationFrames, path: resolveEditorialAssetPathV2(root, asset),
  }));
  // One slot per logical asset (equal content is never merged); muted-only references allocate nothing.
  const externalInputs = effectiveAudioAssetIds(plan.audioMix.layers).map((assetId, index) => {
    const asset = plan.audioMix.externalAudioAssets.find((candidate) => candidate.assetId === assetId)!;
    return {
      inputIndex: baseInputs.length + index, mediaKind: "EXTERNAL_AUDIO" as const, assetId, sha256: asset.sha256, bytes: asset.bytes,
      channelCount: asset.channelCount, assetDurationSamples: asset.assetDurationSamples,
      path: resolveExternalAudioAssetPath(root, asset),
    };
  });
  const slots = new Map(externalInputs.map((entry) => [entry.assetId, entry]));
  const bed = plan.audioMix.bed;
  const renderIdentity = validateE4RenderIdentityV1({
    identityType: "BUSYBOOKIE_E4_RENDER_IDENTITY", identityVersion: "1", renderProfileId: E4_MIX_RENDER_PROFILE_ID,
    output: structuredClone(EDITORIAL_EDIT_OUTPUT_CONTRACT),
    timelineDurationSamples,
    inputs: [
      ...baseInputs.map((entry) => ({ inputIndex: entry.inputIndex, mediaKind: "NORMALIZED_SHOT", sha256: entry.sha256 })),
      ...externalInputs.map((entry) => ({
        inputIndex: entry.inputIndex, mediaKind: "EXTERNAL_AUDIO", sha256: entry.sha256, channelCount: entry.channelCount,
      })),
    ],
    videoSegments: timeline.video.map((clip, inputIndex) => ({ inputIndex, sourceInFrame: clip.sourceInFrame, sourceOutFrame: clip.sourceOutFrame })),
    videoJoins: timeline.edges.map((edge) => (edge.type === "CROSS_DISSOLVE"
      ? { type: "CROSS_DISSOLVE", overlapFrames: edge.overlapFrames } : { type: "CUT" })),
    bed: {
      segments: timeline.audio.map((clip, inputIndex) => ({ inputIndex, sourceInSample: clip.sourceInSample, sourceOutSample: clip.sourceOutSample })),
      level: bed.bedMuted ? { mode: "MUTED" } : { mode: "GAIN", gainCentiDb: bed.bedGainCentiDb },
    },
    layers: effectiveAudioLayers(plan.audioMix.layers).map((layer) => {
      const slot = slots.get(layer.assetId)!;
      return {
        inputIndex: slot.inputIndex, channelMap: slot.channelCount === 1 ? "MONO_DUPLICATE" : "STEREO_PASSTHROUGH",
        sourceInSample: layer.sourceInSample, sourceOutSample: layer.sourceOutSample, timelineStartSample: layer.timelineStartSample,
        gainCentiDb: layer.gainCentiDb, fadeInSamples: layer.fadeInSamples, fadeOutSamples: layer.fadeOutSamples,
      };
    }),
    fadeLaw: E4_FADE_LAW_ID, summationLaw: E4_SUMMATION_LAW_ID,
  });
  const renderKey = hashE4RenderIdentityV1(renderIdentity);
  const audioGraph = buildEditorialMixAudioGraph(renderIdentity);
  const episodeId = base.episode.episodeId;
  return freezeEditorial({
    profileId: E4_MIX_RENDER_PROFILE_ID, episodeId, title: base.episode.title, output: EDITORIAL_EDIT_OUTPUT_CONTRACT,
    timelineDurationFrames: timeline.timelineDurationFrames, timelineDurationSamples,
    inputs: [...baseInputs, ...externalInputs], renderIdentity, renderKey,
    audioGraph, mixGraphSha256: hashEditorialMixAudioGraph(audioGraph),
    outputPath: (windows ? win32 : posix).resolve(root, "exports", episodeId, "mix", `${episodeId}_mix_${renderKey}.mp4`),
  });
}

// A render plan is accepted downstream only if its key and graph are exactly re-derivable from its identity.
export function assertEditorialMixRenderPlanIntegrity(renderPlan: EditorialMixRenderPlan): void {
  assertEditorial(renderPlan.profileId === E4_MIX_RENDER_PROFILE_ID, "mix command supports only busybookie-episode-mix-v1");
  const identity = validateE4RenderIdentityV1(renderPlan.renderIdentity);
  assertEditorial(hashE4RenderIdentityV1(identity) === renderPlan.renderKey, "mix render plan renderKey does not match its identity");
  const graph = buildEditorialMixAudioGraph(identity);
  assertEditorial(graph === renderPlan.audioGraph && hashEditorialMixAudioGraph(graph) === renderPlan.mixGraphSha256,
    "mix render plan audio graph does not match its identity");
  assertEditorial(identity.timelineDurationSamples === renderPlan.timelineDurationSamples &&
    renderPlan.timelineDurationSamples === renderPlan.timelineDurationFrames * 1_920, "mix render plan duration is inconsistent");
  assertEditorial(renderPlan.inputs.length === identity.inputs.length && renderPlan.inputs.every((entry, index) => {
    const slot = identity.inputs[index]!;
    return entry.inputIndex === index && entry.mediaKind === slot.mediaKind && entry.sha256 === slot.sha256 &&
      (entry.mediaKind === "NORMALIZED_SHOT" || (slot.mediaKind === "EXTERNAL_AUDIO" && entry.channelCount === slot.channelCount));
  }), "mix render plan inputs do not match its identity");
}

export type EditorialRenderRouteV3 =EditorialRenderRoute | Readonly<{ route: "E4_MIX"; renderPlan: EditorialMixRenderPlan }>;

// No effective mix: pure downgrade to the unchanged 2.0 route (exact E2/E3 parity). Otherwise mix-v1.
export function planEditorialRenderV3(input: BuildEditorialMixRenderPlanInput): EditorialRenderRouteV3 {
  const plan = validateEditorialPlanV3(input.plan);
  if (!isEffectiveAudioMix(plan.audioMix)) {
    return planEditorialRenderV2({ plan: downgradeEditorialPlanV3ToV2(plan), mediaRoot: input.mediaRoot });
  }
  return freezeEditorial({ route: "E4_MIX", renderPlan: buildEditorialMixRenderPlan({ plan, mediaRoot: input.mediaRoot }) });
}
