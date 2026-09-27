import {
  VEO31_FAST_MODEL,
} from "../veo.types.js";

import {
  VeoGenerationRecordSchema,
  type VeoGenerationRecord,
} from "./veoGenerationRecord.schema.js";

export type BuildVeoGenerationRecordInput =
  Readonly<{
    recordedAt:
      VeoGenerationRecord["recordedAt"];

    episodeId:
      VeoGenerationRecord["episodeId"];

    shotId:
      VeoGenerationRecord["shotId"];

    operationName:
      VeoGenerationRecord["operationName"];

    request:
      VeoGenerationRecord["request"];

    costPolicy:
      VeoGenerationRecord["costPolicy"];

    safety:
      VeoGenerationRecord["safety"];

    outputs:
      VeoGenerationRecord["outputs"];
  }>;

export function buildVeoGenerationRecord(
  input:
    BuildVeoGenerationRecordInput,
): VeoGenerationRecord {
  return VeoGenerationRecordSchema
    .parse({
      schemaVersion:
        "1.0",

      recordedAt:
        input.recordedAt,

      provider:
        "VEO",

      model:
        VEO31_FAST_MODEL,

      status:
        "SUCCEEDED",

      episodeId:
        input.episodeId,

      shotId:
        input.shotId,

      operationName:
        input.operationName,

      request:
        input.request,

      costPolicy:
        input.costPolicy,

      safety:
        input.safety,

      outputs:
        input.outputs,
    });
}
