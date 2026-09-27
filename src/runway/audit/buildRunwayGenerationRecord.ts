import {
  RunwayGenerationRecordSchema,
  type RunwayGenerationRecord,
} from "./runwayGenerationRecord.schema.js";

export type BuildRunwayGenerationRecordInput =
  Readonly<{
    recordedAt:
      RunwayGenerationRecord["recordedAt"];

    episodeId:
      RunwayGenerationRecord["episodeId"];

    shotId:
      RunwayGenerationRecord["shotId"];

    taskId:
      RunwayGenerationRecord["taskId"];

    request:
      RunwayGenerationRecord["request"];

    credits:
      RunwayGenerationRecord["credits"];

    outputs:
      RunwayGenerationRecord["outputs"];
  }>;

export function buildRunwayGenerationRecord(
  input:
    BuildRunwayGenerationRecordInput,
): RunwayGenerationRecord {
  return RunwayGenerationRecordSchema
    .parse({
      schemaVersion:
        "1.0",

      recordedAt:
        input.recordedAt,

      provider:
        "RUNWAY",

      model:
        "gen4.5",

      status:
        "SUCCEEDED",

      episodeId:
        input.episodeId,

      shotId:
        input.shotId,

      taskId:
        input.taskId,

      request:
        input.request,

      credits:
        input.credits,

      outputs:
        input.outputs,
    });
}
