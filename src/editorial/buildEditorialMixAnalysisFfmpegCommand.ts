import { E4_MIX_OUTPUT_LABEL } from "./buildEditorialMixAudioGraph.js";
import { assertEditorialMixRenderPlanIntegrity, type EditorialMixRenderPlan } from "./buildEditorialMixRenderPlan.js";
import { assertEditorialMixOutputPath } from "./editorialMixRenderPreflight.js";
import { assertEditorial, freezeEditorial } from "./validateEditorialPlan.js";

export type EditorialMixAnalysisFfmpegCommand = Readonly<{ executable: string; args: readonly string[] }>;

// Argv only: the same inputs and byte-identical audio sub-graph as the final command, terminating in raw f32le.
// Running it and measuring the sample peak happen outside src/editorial.
export function buildEditorialMixAnalysisFfmpegCommand(input: Readonly<{
  ffmpegExecutable: string; renderPlan: EditorialMixRenderPlan; analysisOutputPath: string;
}>): EditorialMixAnalysisFfmpegCommand {
  const plan = input.renderPlan;
  const executable = input.ffmpegExecutable.trim();
  assertEditorial(executable.length > 0, "analysis command requires an FFmpeg executable");
  assertEditorialMixRenderPlanIntegrity(plan);
  const analysisOutputPath = assertEditorialMixOutputPath(plan, input.analysisOutputPath, "analysis output path");
  assertEditorial(analysisOutputPath !== plan.outputPath, "analysis output path must differ from the final output");
  const args = [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-n",
    ...plan.inputs.flatMap((entry) => ["-i", entry.path]),
    "-filter_complex", plan.audioGraph,
    "-map", `[${E4_MIX_OUTPUT_LABEL}]`,
    "-c:a", "pcm_f32le", "-f", "f32le",
    analysisOutputPath,
  ];
  return freezeEditorial({ executable, args });
}
