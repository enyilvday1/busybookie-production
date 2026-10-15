import { posix, win32 } from "node:path";
import { EDITORIAL_EDIT_RENDER_PROFILE_ID, type EditorialEditRenderPlan } from "./buildEditorialEditRenderPlan.js";
import type { EditorialEditRenderPreflightResult } from "./editorialEditRenderPreflight.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

// Frozen busybookie-episode-edit-v1 filter and encoder behaviour.
export const EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION = "fps=25,format=yuv420p,settb=1/25,setpts=PTS-STARTPTS";
export const EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION = "asettb=1/48000,asetpts=PTS-STARTPTS";

export type EditorialEditFfmpegCommand = Readonly<{ executable: string; args: readonly string[] }>;

// Exact 25 fps decimal seconds from an integer frame count: n = 4f is exact (power-of-two scaling),
// whole = floor(n / 100), remainder = n mod 100; no float accumulation and no exponent notation.
export function formatFrameSeconds25(frames: number): string {
  assertEditorial(Number.isSafeInteger(frames) && frames >= 0, "frame time formatting requires a non-negative safe-integer frame count");
  const scaled = frames * 4;
  const whole = Math.floor(scaled / 100);
  const remainder = scaled % 100;
  if (remainder === 0) return String(whole);
  return `${String(whole)}.${String(remainder).padStart(2, "0").replace(/0+$/, "")}`;
}

function isAbsolutePath(value: string): boolean {
  return win32.isAbsolute(value) || posix.isAbsolute(value);
}

// Builds arguments only for genuine E3 edit renders; E2-equivalent plans use the legacy rough-cut route.
export function buildEditorialEditFfmpegCommand(input: Readonly<{
  ffmpegExecutable: string; renderPlan: EditorialEditRenderPlan; preflight: EditorialEditRenderPreflightResult; outputPath: string;
}>): EditorialEditFfmpegCommand {
  const plan = input.renderPlan;
  const executable = input.ffmpegExecutable.trim();
  assertEditorial(executable.length > 0, "edit command requires an FFmpeg executable");
  assertEditorial(plan.profileId === EDITORIAL_EDIT_RENDER_PROFILE_ID, "edit command supports only busybookie-episode-edit-v1");
  assertEditorial(input.preflight.renderKey === plan.renderKey, "edit command requires a passed preflight for this render plan");
  const outputPath = input.outputPath.trim();
  assertEditorial(outputPath.length > 0 && isAbsolutePath(outputPath), "edit command requires an absolute output path");
  assertEditorial(plan.inputs.every((entry) => entry.sourceVideoPath !== outputPath), "edit command output must differ from every input");
  const segments = plan.videoSegments.length;
  assertEditorial(segments >= 1 && plan.audioSegments.length === segments && plan.inputs.length === segments &&
    plan.videoJoins.length === segments - 1, "edit render plan segment, join and input counts are inconsistent");
  const filters: string[] = [];
  for (const [index, segment] of plan.videoSegments.entries()) {
    filters.push(`[${segment.inputIndex}:v:0]trim=start_frame=${segment.sourceInFrame}:end_frame=${segment.sourceOutFrame},` +
      `${EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION}[v${index}]`);
  }
  let video = "v0";
  for (const [index, join] of plan.videoJoins.entries()) {
    const label = index === plan.videoJoins.length - 1 ? "vout" : `vj${index}`;
    const operation = join.type === "CUT" ? "concat=n=2:v=1:a=0"
      : `xfade=transition=fade:duration=${formatFrameSeconds25(join.overlapFrames)}:offset=${formatFrameSeconds25(join.incomingStartFrame)}`;
    filters.push(`[${video}][v${index + 1}]${operation},${EDITORIAL_EDIT_VIDEO_JOIN_NORMALIZATION}[${label}]`);
    video = label;
  }
  for (const [index, segment] of plan.audioSegments.entries()) {
    filters.push(`[${segment.inputIndex}:a:0]atrim=start_sample=${segment.sourceInSample}:end_sample=${segment.sourceOutSample},` +
      `${EDITORIAL_EDIT_AUDIO_SEGMENT_NORMALIZATION}[a${index}]`);
  }
  let audio = "a0";
  if (segments > 1) {
    filters.push(`${plan.audioSegments.map((_, index) => `[a${index}]`).join("")}concat=n=${segments}:v=0:a=1[aout]`);
    audio = "aout";
  }
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    ...plan.inputs.flatMap((entry) => ["-i", entry.sourceVideoPath]),
    "-filter_complex", filters.join(";"),
    "-map", `[${video}]`, "-map", `[${audio}]`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high", "-pix_fmt", "yuv420p", "-r", "25",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-t", formatFrameSeconds25(plan.timelineDurationFrames),
    "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", "-f", "mp4",
    outputPath,
  ];
  return freezeEditorial({ executable, args });
}
