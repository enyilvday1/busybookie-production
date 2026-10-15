import { EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION, formatFrameSeconds25 } from "./buildEditorialEditFfmpegCommand.js";
import { E4_MIX_OUTPUT_LABEL } from "./buildEditorialMixAudioGraph.js";
import {
  assertEditorialMixRenderPlanIntegrity, type E4RenderIdentityV1, type EditorialMixRenderPlan,
} from "./buildEditorialMixRenderPlan.js";
import { assertEditorialMixOutputPath, parseEditorialMixPreflightReceipt } from "./editorialMixRenderPreflight.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

export type EditorialMixFfmpegCommand = Readonly<{ executable: string; args: readonly string[] }>;

// The frozen edit-v1 video law (verbatim E3 text and labels) for E2-equivalent and E3 bases alike.
export function buildEditorialMixVideoGraph(identity: E4RenderIdentityV1): Readonly<{ graph: string; terminal: string }> {
  const filters: string[] = [];
  for (const [index, segment] of identity.videoSegments.entries()) {
    filters.push(`[${segment.inputIndex}:v:0]trim=start_frame=${segment.sourceInFrame}:end_frame=${segment.sourceOutFrame},` +
      `${EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION}[v${index}]`);
  }
  let video = "v0";
  let start = 0;
  for (const [index, join] of identity.videoJoins.entries()) {
    const outgoing = identity.videoSegments[index]!;
    const overlap = join.type === "CROSS_DISSOLVE" ? join.overlapFrames : 0;
    const incomingStartFrame = start + (outgoing.sourceOutFrame - outgoing.sourceInFrame) - overlap;
    start = incomingStartFrame;
    const label = index === identity.videoJoins.length - 1 ? "vout" : `vj${index}`;
    const operation = join.type === "CUT" ? "concat=n=2:v=1:a=0"
      : `xfade=transition=fade:duration=${formatFrameSeconds25(join.overlapFrames)}:offset=${formatFrameSeconds25(incomingStartFrame)}`;
    filters.push(`[${video}][v${index + 1}]${operation},${EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION}[${label}]`);
    video = label;
  }
  return freezeEditorial({ graph: filters.join(";"), terminal: video });
}

// Argv only. Acceptance depends solely on explicit values: the receipt checksum and its bindings to this render
// plan's renderKey, mixGraphSha256 and the exact requested output path. No hidden or process-local state.
export function buildEditorialMixFfmpegCommand(input: Readonly<{
  ffmpegExecutable: string; renderPlan: EditorialMixRenderPlan; receipt: unknown; outputPath: string;
}>): EditorialMixFfmpegCommand {
  const plan = input.renderPlan;
  const executable = input.ffmpegExecutable.trim();
  assertEditorial(executable.length > 0, "mix command requires an FFmpeg executable");
  assertEditorialMixRenderPlanIntegrity(plan);
  const receipt = parseEditorialMixPreflightReceipt(input.receipt);
  assertEditorial(receipt.renderKey === plan.renderKey, "mix command receipt belongs to a different render key");
  assertEditorial(receipt.mixGraphSha256 === plan.mixGraphSha256, "mix command receipt belongs to a different mix graph");
  assertEditorial(receipt.outputPath === input.outputPath, "mix command receipt is bound to a different output path");
  const outputPath = assertEditorialMixOutputPath(plan, input.outputPath, "mix command output path");
  const video = buildEditorialMixVideoGraph(plan.renderIdentity);
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    ...plan.inputs.flatMap((entry) => ["-i", entry.path]),
    "-filter_complex", `${video.graph};${plan.audioGraph}`,
    "-map", `[${video.terminal}]`, "-map", `[${E4_MIX_OUTPUT_LABEL}]`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", formatFrameSeconds25(plan.timelineDurationFrames),
    "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-f", "mp4",
    outputPath,
  ];
  return freezeEditorial({ executable, args });
}
