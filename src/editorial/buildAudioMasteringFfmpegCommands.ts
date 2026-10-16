import { posix, win32 } from "node:path";
import { formatCentiDb } from "./buildEditorialMixAudioGraph.js";
import { canonicalEditorialJson, editorialSha256 } from "./canonicalizeEditorialPlan.js";
import type { E5UpstreamDerivation } from "./deriveAudioMasteringUpstream.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

export type AudioMasteringFfmpegCommand = Readonly<{ executable: string; args: readonly string[] }>;

// Fixed measurement filter: the targets never influence input_* statistics and the processed output is discarded.
export const E5_LOUDNORM_MEASUREMENT_FILTER = "loudnorm=I=-24:LRA=7:TP=-2:print_format=json";
export const E5_MASTERED_AUDIO_LABEL = "e5a";
export const E5_MEASUREMENT_AUDIO_LABEL = "e5m";
// Dynamics and clipping filters that may never appear in an E5 final graph (E5 v1 is static gain only).
export const E5_FORBIDDEN_FINAL_GRAPH_FILTERS = [
  "acompressor", "acrusher", "adeclip", "agate", "alimiter", "apsyclip", "asoftclip", "compand", "dynaudnorm",
  "loudnorm", "mcompand", "sidechaincompress", "sidechaingate", "speechnorm",
] as const;
export const E5_PROBE_SHOW_ENTRIES = "format=format_name,duration,size,bit_rate,nb_streams:" +
  "stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels," +
  "channel_layout,bit_rate,nb_read_frames";

function executableOf(value: string, detail: string): string {
  const executable = value.trim();
  assertEditorial(executable.length > 0, `${detail} requires an executable`);
  return executable;
}

function isAbsolutePath(value: string): boolean {
  return win32.isAbsolute(value) || posix.isAbsolute(value);
}

function requirePath(value: unknown, detail: string): string {
  assertEditorial(typeof value === "string" && value.length > 0 && value === value.trim() && isAbsolutePath(value),
    `${detail} requires an absolute path without surrounding whitespace`);
  return value;
}

// The -filter_complex value and the -i pairs of a validated upstream final argv (every route emits the same header).
export function upstreamFilterComplex(args: readonly string[]): string {
  const index = args.indexOf("-filter_complex");
  assertEditorial(index > 0 && args.lastIndexOf("-filter_complex") === index && index + 1 < args.length,
    "upstream argv requires exactly one -filter_complex");
  return args[index + 1]!;
}

export function upstreamInputPairs(args: readonly string[]): string[] {
  const end = args.indexOf("-filter_complex");
  const pairs = args.slice(5, end);
  assertEditorial(pairs.length >= 2 && pairs.length % 2 === 0 &&
    pairs.every((arg, index) => (index % 2 === 0 ? arg === "-i" : arg !== "-i")), "upstream argv input pairs are malformed");
  return pairs;
}

function assertNoReservedLabels(graph: string): void {
  assertEditorial(!graph.includes(`[${E5_MASTERED_AUDIO_LABEL}]`) && !graph.includes(`[${E5_MEASUREMENT_AUDIO_LABEL}]`),
    "upstream graph uses a reserved E5 label");
}

// Step 1082 R7 / Step 1084 R6: sample-domain window [0, T) before loudnorm; no output-level -t.
export function buildPreMasterMeasurementCommand(input: Readonly<{
  ffmpegExecutable: string; derivation: E5UpstreamDerivation; upstreamArgs: readonly string[];
}>): AudioMasteringFfmpegCommand {
  const executable = executableOf(input.ffmpegExecutable, "pre-master measurement");
  const graph = upstreamFilterComplex(input.upstreamArgs);
  assertNoReservedLabels(graph);
  const derivation = input.derivation;
  const samples = derivation.timelineDurationSamples;
  assertEditorial(Number.isSafeInteger(samples) && samples >= 1_920, "measurement window requires a positive safe-integer T");
  const measurementGraph = `${graph};${derivation.videoTerminal}nullsink;${derivation.audioTerminal}` +
    `atrim=start_sample=0:end_sample=${String(samples)},asetpts=PTS-STARTPTS,${E5_LOUDNORM_MEASUREMENT_FILTER}[${E5_MEASUREMENT_AUDIO_LABEL}]`;
  const args = [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info",
    ...upstreamInputPairs(input.upstreamArgs),
    "-filter_complex", measurementGraph,
    "-map", `[${E5_MEASUREMENT_AUDIO_LABEL}]`, "-f", "null", "-",
  ];
  return freezeEditorial({ executable, args });
}

// E4 RENDER_EFFECTIVE_ARGV_V1 masking: -i operands by slot. The executable is never part of the hash.
export function measurementArgvSha256(args: readonly string[]): string {
  let slot = 0;
  const masked = args.map((arg, index) => (index > 0 && args[index - 1] === "-i" ? `<INPUT_PATH:${String(slot++)}>` : arg));
  return editorialSha256(canonicalEditorialJson(masked));
}

export function upstreamFilterComplexSha256(args: readonly string[]): string {
  return editorialSha256(upstreamFilterComplex(args));
}

// Literal gain filter: formatCentiDb emits the dB suffix itself; always emitted, including "volume=0dB:precision=float".
export function buildMasteringGainFilter(gainCentiDb: number): string {
  return `volume=${formatCentiDb(gainCentiDb)}:precision=float`;
}

// Final argv law (UPSTREAM_GRAPH_PREFIX): exactly three edits of the validated upstream final argv.
// Every other argument (encoder options, -t, -n) stays byte-identical.
export function applyMasteringRewriteLaw(input: Readonly<{
  upstreamArgs: readonly string[]; audioTerminal: string; gainCentiDb: number; candidatePath: string;
}>): string[] {
  const args = [...input.upstreamArgs];
  const graph = upstreamFilterComplex(args);
  assertNoReservedLabels(graph);
  const fcIndex = args.indexOf("-filter_complex") + 1;
  const audioMaps = args.flatMap((arg, index) => (arg === "-map" && args[index + 1] === input.audioTerminal ? [index + 1] : []));
  assertEditorial(audioMaps.length === 1, "upstream argv must map the audio terminal exactly once");
  const finalGraph = `${graph};${input.audioTerminal}${buildMasteringGainFilter(input.gainCentiDb)}[${E5_MASTERED_AUDIO_LABEL}]`;
  for (const name of E5_FORBIDDEN_FINAL_GRAPH_FILTERS) {
    assertEditorial(!new RegExp(`(^|[\\],;])${name}(=|,|;|\\[|$)`).test(finalGraph), `E5 final graph must not contain ${name}`);
  }
  args[fcIndex] = finalGraph;
  args[audioMaps[0]!] = `[${E5_MASTERED_AUDIO_LABEL}]`;
  args[args.length - 1] = requirePath(input.candidatePath, "E5 candidate");
  return args;
}

// Post-encode QC commands (Step 1080 measurement contract). Paths are runtime-only and masked in attempt hashes.
export function buildPostEncodeProbeCommand(input: Readonly<{ ffprobeExecutable: string; mediaPath: string }>): AudioMasteringFfmpegCommand {
  const executable = executableOf(input.ffprobeExecutable, "post-encode probe");
  const mediaPath = requirePath(input.mediaPath, "post-encode probe media");
  return freezeEditorial({ executable, args: [
    "-v", "error", "-count_frames", "-show_optional_fields", "always", "-show_entries", E5_PROBE_SHOW_ENTRIES, "-of", "json", mediaPath,
  ] });
}

export function buildPostEncodeDecodeCommand(input: Readonly<{
  ffmpegExecutable: string; mediaPath: string; qcPcmPath: string;
}>): AudioMasteringFfmpegCommand {
  const executable = executableOf(input.ffmpegExecutable, "post-encode decode");
  const mediaPath = requirePath(input.mediaPath, "post-encode decode media");
  const qcPcmPath = requirePath(input.qcPcmPath, "post-encode decode PCM output");
  assertEditorial(qcPcmPath !== mediaPath, "post-encode decode output must differ from the media");
  return freezeEditorial({ executable, args: [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-n", "-i", mediaPath, "-map", "0:a:0", "-c:a", "pcm_f32le", "-f", "f32le", qcPcmPath,
  ] });
}

export function buildPostEncodeLoudnessCommand(input: Readonly<{ ffmpegExecutable: string; mediaPath: string }>): AudioMasteringFfmpegCommand {
  const executable = executableOf(input.ffmpegExecutable, "post-encode loudness");
  const mediaPath = requirePath(input.mediaPath, "post-encode loudness media");
  return freezeEditorial({ executable, args: [
    "-hide_banner", "-nostdin", "-nostats", "-loglevel", "info", "-i", mediaPath, "-map", "0:a:0",
    "-af", E5_LOUDNORM_MEASUREMENT_FILTER, "-f", "null", "-",
  ] });
}

// Attempt argv hash: media operand -> "<MEDIA_PATH>", decode PCM output -> "<QC_PCM_PATH>"; executable excluded.
export function qcAttemptArgvSha256(args: readonly string[], mediaPath: string, qcPcmPath?: string): string {
  const masked = args.map((arg) => (arg === mediaPath ? "<MEDIA_PATH>" : qcPcmPath !== undefined && arg === qcPcmPath ? "<QC_PCM_PATH>" : arg));
  return editorialSha256(canonicalEditorialJson(masked));
}
