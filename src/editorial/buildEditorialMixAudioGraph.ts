import { EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION } from "./buildEditorialEditFfmpegCommand.js";
import type { E4RenderIdentityV1 } from "./buildEditorialMixRenderPlan.js";
import { editorialSha256 } from "./canonicalizeEditorialPlan.js";
import { assertEditorial } from "./validateEditorialPlan.js";

// Frozen busybookie-episode-mix-v1 audio adapter text (Step 1066 / Step 1068).
export const E4_MIX_FLOAT_DOMAIN = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo";
export const E4_MONO_CHANNEL_MAP = "pan=stereo|c0=c0|c1=c0";
export const E4_STEREO_CHANNEL_MAP = "pan=stereo|c0=c0|c1=c1";
export const E4_BED_MUTE = "volume=0:precision=float";
export const E4_MIX_OUTPUT_LABEL = "mout";

function sampleText(value: number): string {
  assertEditorial(Number.isSafeInteger(value) && value >= 0, "mix graph sample values must be non-negative safe integers");
  return String(value);
}

// Exact decimal dB text from integer centi-dB using integer arithmetic only (no float conversion, exponent or locale).
export function formatCentiDb(gainCentiDb: number): string {
  assertEditorial(Number.isSafeInteger(gainCentiDb) && gainCentiDb >= -9_600 && gainCentiDb <= 1_200,
    "gain formatting requires an integer in -9600..1200 centi-dB");
  if (gainCentiDb === 0) return "0dB";
  const sign = gainCentiDb < 0 ? "-" : "";
  const magnitude = Math.abs(gainCentiDb);
  const whole = Math.floor(magnitude / 100);
  const fraction = magnitude % 100;
  if (fraction === 0) return `${sign}${String(whole)}dB`;
  return `${sign}${String(whole)}.${String(fraction).padStart(2, "0").replace(/0+$/, "")}dB`;
}

function gainFilter(gainCentiDb: number): readonly string[] {
  return gainCentiDb === 0 ? [] : [`volume=${formatCentiDb(gainCentiDb)}:precision=float`];
}

// The E3 A1 bed terminal label: concat output for several segments, the single segment otherwise.
export function e3AudioTerminalLabel(segmentCount: number): string {
  return segmentCount > 1 ? "aout" : "a0";
}

// Canonical audio sub-graph: a pure function of the render identity. Labels are numeric topology or reserved
// names only (a<k>, aout from E3; mb, mi<x>s<j>, ml<k>, mout for E4); no logical id ever reaches the text.
export function buildEditorialMixAudioGraph(identity: E4RenderIdentityV1): string {
  const statements: string[] = [];
  const segments = identity.bed.segments;
  for (const [index, segment] of segments.entries()) {
    statements.push(`[${segment.inputIndex}:a:0]atrim=start_sample=${sampleText(segment.sourceInSample)}:` +
      `end_sample=${sampleText(segment.sourceOutSample)},${EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION}[a${index}]`);
  }
  if (segments.length > 1) {
    statements.push(`${segments.map((_, index) => `[a${index}]`).join("")}concat=n=${segments.length}:v=0:a=1[aout]`);
  }
  const level = identity.bed.level;
  const bedFilters = [E4_MIX_FLOAT_DOMAIN, ...(level.mode === "MUTED" ? [E4_BED_MUTE] : gainFilter(level.gainCentiDb))];
  statements.push(`[${e3AudioTerminalLabel(segments.length)}]${bedFilters.join(",")}[mb]`);
  const uses = new Map<number, number>();
  for (const layer of identity.layers) uses.set(layer.inputIndex, (uses.get(layer.inputIndex) ?? 0) + 1);
  for (const [inputIndex, total] of [...uses.entries()].sort((left, right) => left[0] - right[0])) {
    if (total < 2) continue;
    const outputs = Array.from({ length: total }, (_, j) => `[mi${inputIndex}s${j}]`).join("");
    statements.push(`[${inputIndex}:a:0]asplit=${total}${outputs}`);
  }
  const taken = new Map<number, number>();
  for (const [ordinal, layer] of identity.layers.entries()) {
    const used = taken.get(layer.inputIndex) ?? 0;
    taken.set(layer.inputIndex, used + 1);
    const source = (uses.get(layer.inputIndex) ?? 0) > 1 ? `[mi${layer.inputIndex}s${used}]` : `[${layer.inputIndex}:a:0]`;
    const length = layer.sourceOutSample - layer.sourceInSample;
    const filters = [
      `atrim=start_sample=${sampleText(layer.sourceInSample)}:end_sample=${sampleText(layer.sourceOutSample)}`,
      EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION,
      layer.channelMap === "MONO_DUPLICATE" ? E4_MONO_CHANNEL_MAP : E4_STEREO_CHANNEL_MAP,
      E4_MIX_FLOAT_DOMAIN,
      ...gainFilter(layer.gainCentiDb),
      ...(layer.fadeInSamples === 0 ? [] : [`afade=t=in:ss=0:ns=${sampleText(layer.fadeInSamples - 1)}:curve=tri`]),
      ...(layer.fadeOutSamples === 0 ? [] : [
        `afade=t=out:ss=${sampleText(length - layer.fadeOutSamples)}:ns=${sampleText(layer.fadeOutSamples - 1)}:curve=tri`]),
      `adelay=delays=${sampleText(layer.timelineStartSample)}S:all=1`,
    ];
    statements.push(`${source}${filters.join(",")}[ml${ordinal}]`);
  }
  const end = `atrim=end_sample=${sampleText(identity.timelineDurationSamples)},asetpts=PTS-STARTPTS[${E4_MIX_OUTPUT_LABEL}]`;
  if (identity.layers.length === 0) {
    statements.push(`[mb]${end}`);
  } else {
    const inputs = ["[mb]", ...identity.layers.map((_, ordinal) => `[ml${ordinal}]`)].join("");
    statements.push(`${inputs}amix=inputs=${identity.layers.length + 1}:duration=first:dropout_transition=0:normalize=0,${end}`);
  }
  return statements.join(";");
}

// mixGraphSha256: SHA-256 over the exact UTF-8 audio sub-graph text.
export function hashEditorialMixAudioGraph(graph: string): string {
  return editorialSha256(graph);
}
