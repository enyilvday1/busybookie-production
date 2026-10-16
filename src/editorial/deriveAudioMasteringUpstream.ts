import { posix, win32 } from "node:path";
import { z } from "zod";
import type { EpisodeRoughCutRenderPlan } from "../composition/buildEpisodeRoughCutRenderPlan.js";
import { buildEditorialEditFfmpegCommand } from "./buildEditorialEditFfmpegCommand.js";
import { E3RenderIdentityV1Schema, hashE3RenderIdentityV1, type EditorialEditRenderPlan } from "./buildEditorialEditRenderPlan.js";
import { E4_MIX_OUTPUT_LABEL } from "./buildEditorialMixAudioGraph.js";
import { buildEditorialMixFfmpegCommand, buildEditorialMixVideoGraph } from "./buildEditorialMixFfmpegCommand.js";
import {
  assertEditorialMixRenderPlanIntegrity, E4RenderIdentityV1Schema, hashE4RenderIdentityV1, planEditorialRenderV3,
  validateE4RenderIdentityV1, type EditorialMixRenderPlan,
} from "./buildEditorialMixRenderPlan.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { hashEditorialPlanV3 } from "./canonicalizeEditorialPlanV3.js";
import { EDITORIAL_SAMPLES_PER_FRAME, frameToSample } from "./deriveEditorialTimeline.js";
import type { EditorialEditRenderPreflightResult } from "./editorialEditRenderPreflight.js";
import type { EditorialReadonly } from "./editorialPlan.schema.js";
import { downgradeE2EquivalentEditorialPlanV2ToV1, isE2EquivalentEditorialPlanV2 } from "./migrateEditorialPlan.js";
import { downgradeEditorialPlanV3ToV2 } from "./migrateEditorialPlanV3.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";
import { validateEditorialPlanV3 } from "./validateEditorialPlanV3.js";

export const E2_ROUGH_CUT_RENDER_PROFILE_ID = "busybookie-episode-rough-cut-v1";
// E2 argv length relation (Step 1084 R4): 5 header tokens, 2 per input, 37 tail tokens. A structural aid only.
export const E2_ARGV_FIXED_TOKEN_COUNT = 42;

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const positive = z.number().refine((n) => Number.isSafeInteger(n) && n > 0, "Expected a positive safe integer.");

export const E5UpstreamRenderAuthorityV1Schema = z.discriminatedUnion("route", [
  z.object({
    route: z.literal("E2_ROUGH_CUT"), renderProfileId: z.literal(E2_ROUGH_CUT_RENDER_PROFILE_ID), renderKey: sha,
    renderIdentityParts: z.array(z.string()).min(10), timelineDurationSamples: positive,
  }).strict(),
  z.object({
    route: z.literal("E3_EDIT"), renderIdentity: E3RenderIdentityV1Schema, renderKey: sha, timelineDurationSamples: positive,
  }).strict(),
  z.object({
    route: z.literal("E4_MIX"), renderIdentity: E4RenderIdentityV1Schema, renderKey: sha, mixGraphSha256: sha,
    timelineDurationSamples: positive,
  }).strict(),
]);
export type E5UpstreamRenderAuthorityV1 = EditorialReadonly<z.infer<typeof E5UpstreamRenderAuthorityV1Schema>>;
export type E5UpstreamRoute = E5UpstreamRenderAuthorityV1["route"];

type DerivationCommon = Readonly<{
  editorialPlanSha256: string;
  episodeId: string;
  upstream: E5UpstreamRenderAuthorityV1;
  timelineDurationFrames: number;
  timelineDurationSamples: number;
  // -map operands of the upstream final argv, brackets included.
  videoTerminal: string;
  audioTerminal: string;
  outputPath: string;
  inputPaths: readonly string[];
}>;

export type E5UpstreamDerivation =
  | (DerivationCommon & Readonly<{ route: "E2_ROUGH_CUT"; renderPlan: EpisodeRoughCutRenderPlan }>)
  | (DerivationCommon & Readonly<{ route: "E3_EDIT"; renderPlan: EditorialEditRenderPlan }>)
  | (DerivationCommon & Readonly<{ route: "E4_MIX"; renderPlan: EditorialMixRenderPlan }>);

export type E5UpstreamDerivationResult =
  | Readonly<{ ok: true; derivation: E5UpstreamDerivation }>
  | Readonly<{ ok: false; reasons: readonly ["NOT_MASTERABLE_UPSTREAM"] }>;

// Step 1084 R2: the only accumulation form for E2 frame authority. Returns null on any unsafe transition.
export function checkedAddFrames(accumulator: number, frames: number): number | null {
  if (!Number.isSafeInteger(accumulator) || accumulator < 0) return null;
  if (!Number.isSafeInteger(frames) || frames < 1) return null;
  if (frames > Number.MAX_SAFE_INTEGER - accumulator) return null;
  const result = accumulator + frames;
  return Number.isSafeInteger(result) ? result : null;
}

// T = frameToSample(F) with F >= 1 and T >= 1920; an unsafe product is rejected before the existing helper runs.
export function checkedFramesToSamples(frames: number): number | null {
  if (!Number.isSafeInteger(frames) || frames < 1) return null;
  if (frames > Math.floor(Number.MAX_SAFE_INTEGER / EDITORIAL_SAMPLES_PER_FRAME)) return null;
  const samples = frameToSample(frames);
  return Number.isSafeInteger(samples) && samples >= EDITORIAL_SAMPLES_PER_FRAME ? samples : null;
}

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/;

function isTrimInvariantAbsolute(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim() &&
    (WINDOWS_DRIVE_PATH.test(value) || posix.isAbsolute(value) || win32.isAbsolute(value));
}

// The E2 builder's own output/source collision comparison (drive paths: win32.normalize + lower case).
function e2ComparablePath(value: string): string {
  return WINDOWS_DRIVE_PATH.test(value) ? win32.normalize(value).toLowerCase() : value;
}

export function recomputeE2RenderIdentityParts(plan: EpisodeRoughCutRenderPlan): string[] {
  const parts = [plan.profileId, plan.episodeId, String(plan.shots.length), String(plan.totalDurationSeconds),
    `${String(plan.video.width)}x${String(plan.video.height)}@${String(plan.video.frameRate)}`, String(plan.audio.sampleRateHz)];
  for (const shot of plan.shots) parts.push(shot.shotId, String(shot.order), String(shot.durationSeconds), shot.sourceSha256);
  return parts;
}

// Exact E2 structural law bound to the E5-derived plan (Step 1082 R4 as amended by Step 1084 R4).
export function expectedE2UpstreamArgs(plan: EpisodeRoughCutRenderPlan): string[] {
  const inputs = plan.shots.flatMap((shot) => ["-i", shot.sourceVideoPath]);
  const labels = plan.shots.map((_, index) => `[${String(index)}:v:0][${String(index)}:a:0]`).join("");
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n", ...inputs,
    "-filter_complex", `${labels}concat=n=${String(plan.shots.length)}:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", String(plan.totalDurationSeconds),
    "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-f", "mp4",
    plan.outputPath,
  ];
  assertEditorial(args.length === E2_ARGV_FIXED_TOKEN_COUNT + 2 * plan.shots.length, "E2 structural law length is not 5 + 2N + 37");
  return args;
}

function deriveE2(plan: ReturnType<typeof validateEditorialPlanV3>, renderPlan: EpisodeRoughCutRenderPlan):
  Readonly<{ upstream: E5UpstreamRenderAuthorityV1; frames: number; samples: number }> | null {
  const v2 = downgradeEditorialPlanV3ToV2(plan);
  if (!isE2EquivalentEditorialPlanV2(v2)) return null;
  const v1 = downgradeE2EquivalentEditorialPlanV2ToV1(v2);
  const count = v1.shots.length;
  if (count < 1 || renderPlan.shots.length !== count || renderPlan.totalShots !== count) return null;
  // Integer media timing authority: checked sum of EditorialPlan 1.0 shots[k].durationFrames.
  let frames = 0;
  for (const shot of v1.shots) {
    const next = checkedAddFrames(frames, shot.durationFrames);
    if (next === null) return null;
    frames = next;
  }
  if (frames < 1 || frames !== v1.durationFrames || frames !== v2.timelineDurationFrames) return null;
  // Construction-parity replay (Step 1084 R3): binds each render-plan shot to its frames; never timing authority.
  for (const [index, shot] of renderPlan.shots.entries()) {
    const source = v1.shots[index]!;
    if (shot.shotId !== source.shotId || shot.order !== source.order || !Object.is(shot.durationSeconds, source.durationFrames / 25)) return null;
  }
  if (renderPlan.profileId !== E2_ROUGH_CUT_RENDER_PROFILE_ID || renderPlan.video.frameRate !== 25 ||
    renderPlan.audio.sampleRateHz !== 48000 || renderPlan.video.width !== 1920 || renderPlan.video.height !== 1080) return null;
  if (!isTrimInvariantAbsolute(renderPlan.outputPath)) return null;
  const output = e2ComparablePath(renderPlan.outputPath);
  for (const shot of renderPlan.shots) {
    if (!isTrimInvariantAbsolute(shot.sourceVideoPath) || e2ComparablePath(shot.sourceVideoPath) === output) return null;
  }
  const parts = recomputeE2RenderIdentityParts(renderPlan);
  if (editorialSha256(parts.join("\n")) !== renderPlan.renderKey) return null;
  const samples = checkedFramesToSamples(frames);
  if (samples === null) return null;
  return {
    frames, samples,
    upstream: { route: "E2_ROUGH_CUT", renderProfileId: E2_ROUGH_CUT_RENDER_PROFILE_ID, renderKey: renderPlan.renderKey,
      renderIdentityParts: parts, timelineDurationSamples: samples },
  };
}

function deriveE3(renderPlan: EditorialEditRenderPlan):
  Readonly<{ upstream: E5UpstreamRenderAuthorityV1; frames: number; samples: number }> | null {
  if (hashE3RenderIdentityV1(renderPlan.renderIdentity) !== renderPlan.renderKey) return null;
  // Step 1082 R5: checked sum of the hashed audioSegments lengths === timelineDurationFrames * 1920.
  let samples = 0;
  for (const segment of renderPlan.renderIdentity.audioSegments) {
    const length = segment.sourceOutSample - segment.sourceInSample;
    if (!Number.isSafeInteger(length) || length < 1) return null;
    if (length > Number.MAX_SAFE_INTEGER - samples) return null;
    samples += length;
  }
  const frames = renderPlan.timelineDurationFrames;
  const expected = checkedFramesToSamples(frames);
  if (expected === null || samples !== expected) return null;
  return {
    frames, samples,
    upstream: { route: "E3_EDIT", renderIdentity: structuredClone(renderPlan.renderIdentity), renderKey: renderPlan.renderKey,
      timelineDurationSamples: samples },
  };
}

function deriveE4(renderPlan: EditorialMixRenderPlan):
  Readonly<{ upstream: E5UpstreamRenderAuthorityV1; frames: number; samples: number }> | null {
  assertEditorialMixRenderPlanIntegrity(renderPlan);
  const identity = validateE4RenderIdentityV1(renderPlan.renderIdentity);
  if (hashE4RenderIdentityV1(identity) !== renderPlan.renderKey) return null;
  // Step 1082 R6: identity T === plan T === frames * 1920 (existing E4 authority, unchanged).
  const samples = identity.timelineDurationSamples;
  const expected = checkedFramesToSamples(renderPlan.timelineDurationFrames);
  if (expected === null || samples !== renderPlan.timelineDurationSamples || samples !== expected) return null;
  return {
    frames: renderPlan.timelineDurationFrames, samples,
    upstream: { route: "E4_MIX", renderIdentity: structuredClone(identity), renderKey: renderPlan.renderKey,
      mixGraphSha256: renderPlan.mixGraphSha256, timelineDurationSamples: samples },
  };
}

const NOT_MASTERABLE: E5UpstreamDerivationResult = freezeEditorial({ ok: false, reasons: ["NOT_MASTERABLE_UPSTREAM"] as const });

// Pure derivation from EditorialPlan 3.0 through the existing route planner. A malformed plan throws; a plan whose
// upstream authority is not exactly re-derivable is NOT_MASTERABLE_UPSTREAM.
export function deriveAudioMasteringUpstream(input: Readonly<{ plan: unknown; mediaRoot: string }>): E5UpstreamDerivationResult {
  const plan = validateEditorialPlanV3(input.plan);
  const editorialPlanSha256 = hashEditorialPlanV3(plan);
  const route = planEditorialRenderV3({ plan, mediaRoot: input.mediaRoot });
  if (route.route === "E2_ROUGH_CUT") {
    const derived = deriveE2(plan, route.renderPlan);
    if (derived === null) return NOT_MASTERABLE;
    return freezeEditorial({ ok: true, derivation: {
      route: "E2_ROUGH_CUT", renderPlan: route.renderPlan, editorialPlanSha256, episodeId: route.renderPlan.episodeId,
      upstream: derived.upstream, timelineDurationFrames: derived.frames, timelineDurationSamples: derived.samples,
      videoTerminal: "[v]", audioTerminal: "[a]", outputPath: route.renderPlan.outputPath,
      inputPaths: route.renderPlan.shots.map((shot) => shot.sourceVideoPath),
    } });
  }
  if (route.route === "E3_EDIT") {
    const derived = deriveE3(route.renderPlan);
    if (derived === null) return NOT_MASTERABLE;
    const renderPlan = route.renderPlan;
    return freezeEditorial({ ok: true, derivation: {
      route: "E3_EDIT", renderPlan, editorialPlanSha256, episodeId: renderPlan.episodeId,
      upstream: derived.upstream, timelineDurationFrames: derived.frames, timelineDurationSamples: derived.samples,
      videoTerminal: renderPlan.videoJoins.length > 0 ? "[vout]" : "[v0]",
      audioTerminal: renderPlan.audioSegments.length > 1 ? "[aout]" : "[a0]",
      outputPath: renderPlan.outputPath, inputPaths: renderPlan.inputs.map((entry) => entry.sourceVideoPath),
    } });
  }
  const derived = deriveE4(route.renderPlan);
  if (derived === null) return NOT_MASTERABLE;
  const renderPlan = route.renderPlan;
  return freezeEditorial({ ok: true, derivation: {
    route: "E4_MIX", renderPlan, editorialPlanSha256, episodeId: renderPlan.episodeId,
    upstream: derived.upstream, timelineDurationFrames: derived.frames, timelineDurationSamples: derived.samples,
    videoTerminal: `[${buildEditorialMixVideoGraph(renderPlan.renderIdentity).terminal}]`, audioTerminal: `[${E4_MIX_OUTPUT_LABEL}]`,
    outputPath: renderPlan.outputPath, inputPaths: renderPlan.inputs.map((entry) => entry.path),
  } });
}

// Strict parse plus self-consistency of a stored member; full acceptance also requires equality with a fresh derivation.
export function validateE5UpstreamRenderAuthorityV1(input: unknown): E5UpstreamRenderAuthorityV1 {
  const parsed = E5UpstreamRenderAuthorityV1Schema.safeParse(input);
  assertEditorial(parsed.success, `E5 upstream authority is invalid: ${parsed.error?.message ?? ""}`);
  const member = parsed.data;
  assertEditorial(member.timelineDurationSamples % EDITORIAL_SAMPLES_PER_FRAME === 0, "E5 upstream T is not a whole number of frames");
  if (member.route === "E2_ROUGH_CUT") {
    assertEditorial(editorialSha256(member.renderIdentityParts.join("\n")) === member.renderKey, "E2 renderIdentityParts do not hash to renderKey");
  } else if (member.route === "E3_EDIT") {
    assertEditorial(hashE3RenderIdentityV1(member.renderIdentity) === member.renderKey, "E3 identity does not hash to renderKey");
  } else {
    assertEditorial(hashE4RenderIdentityV1(member.renderIdentity) === member.renderKey, "E4 identity does not hash to renderKey");
    assertEditorial(member.renderIdentity.timelineDurationSamples === member.timelineDurationSamples, "E4 member T differs from its identity");
  }
  return freezeEditorial(member);
}

// Stored members are never trusted alone: canonical equality with the current derivation is required.
export function upstreamMatchesDerivation(member: unknown, derivation: E5UpstreamDerivation): boolean {
  const parsed = E5UpstreamRenderAuthorityV1Schema.safeParse(member);
  return parsed.success && canonicalEditorialJson(parsed.data) === canonicalEditorialJson(derivation.upstream);
}

export type UpstreamArgvCheck =
  | Readonly<{ ok: true; args: readonly string[] }>
  | Readonly<{ ok: false; reasons: readonly ["UPSTREAM_ARGV_MISMATCH"] }>;

function sameArgs(actual: readonly unknown[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((arg, index) => arg === expected[index]);
}

// Caller-supplied upstream final argv (executable excluded). E3/E4: literal rebuild through the authoritative builders at
// the derived upstream outputPath, so their gates are never bypassed. E2: the frozen structural law, element-wise.
export function checkAudioMasteringUpstreamArgv(input: Readonly<{
  derivation: E5UpstreamDerivation; args: readonly unknown[];
  e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown;
}>): UpstreamArgvCheck {
  assertEditorial(Array.isArray(input.args), "upstream argv must be an array");
  const derivation = input.derivation;
  let expected: readonly string[];
  if (derivation.route === "E2_ROUGH_CUT") {
    expected = expectedE2UpstreamArgs(derivation.renderPlan);
  } else if (derivation.route === "E3_EDIT") {
    assertEditorial(input.e3Preflight !== undefined, "E3 upstream argv validation requires the E3 preflight result");
    expected = buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: derivation.renderPlan,
      preflight: input.e3Preflight, outputPath: derivation.outputPath }).args;
  } else {
    assertEditorial(input.e4Receipt !== undefined, "E4 upstream argv validation requires the E4 preflight receipt");
    expected = buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: derivation.renderPlan,
      receipt: input.e4Receipt, outputPath: derivation.outputPath }).args;
  }
  if (!sameArgs(input.args, expected)) return freezeEditorial({ ok: false, reasons: ["UPSTREAM_ARGV_MISMATCH"] as const });
  return freezeEditorial({ ok: true, args: [...expected] });
}

// MEASURE_ONLY upstream record binding (Step 1082 R13). The runner extracts the attestation from a RENDERED E2 record.
export const E2UpstreamRenderAttestationV1Schema = z.object({
  route: z.literal("E2_ROUGH_CUT"), renderKey: sha, artifactSha256: sha, artifactBytes: positive,
}).strict();

export type UpstreamRecordBinding = "E2_RENDER_RECORD_VERIFIED" | "NO_UPSTREAM_RECORD_LIFECYCLE";
export type UpstreamRecordBindingCheck =
  | Readonly<{ ok: true; binding: UpstreamRecordBinding }>
  | Readonly<{ ok: false; reasons: readonly ["UPSTREAM_RECORD_MISSING"] | readonly ["UPSTREAM_RECORD_MISMATCH"] }>;

export function checkUpstreamRecordBinding(input: Readonly<{
  derivation: E5UpstreamDerivation; attestation: unknown; measuredMediaSha256: string; measuredMediaBytes: number;
}>): UpstreamRecordBindingCheck {
  assertEditorial(sha.safeParse(input.measuredMediaSha256).success && Number.isSafeInteger(input.measuredMediaBytes) &&
    input.measuredMediaBytes > 0, "measured media identity is malformed");
  if (input.derivation.route !== "E2_ROUGH_CUT") {
    assertEditorial(input.attestation === null || input.attestation === undefined, "E3/E4 routes have no upstream record lifecycle");
    return freezeEditorial({ ok: true, binding: "NO_UPSTREAM_RECORD_LIFECYCLE" });
  }
  if (input.attestation === null || input.attestation === undefined) {
    return freezeEditorial({ ok: false, reasons: ["UPSTREAM_RECORD_MISSING"] as const });
  }
  const parsed = E2UpstreamRenderAttestationV1Schema.safeParse(input.attestation);
  if (!parsed.success || parsed.data.renderKey !== input.derivation.upstream.renderKey ||
    parsed.data.artifactSha256 !== input.measuredMediaSha256 || parsed.data.artifactBytes !== input.measuredMediaBytes) {
    return freezeEditorial({ ok: false, reasons: ["UPSTREAM_RECORD_MISMATCH"] as const });
  }
  return freezeEditorial({ ok: true, binding: "E2_RENDER_RECORD_VERIFIED" });
}
