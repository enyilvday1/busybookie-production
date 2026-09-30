import {
  isAbsolute,
} from "node:path";

import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../execution/executionReservation.schema.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

function isPortableAbsolutePath(
  value:
    string,
): boolean {
  return (
    isAbsolute(
      value,
    ) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(
      value,
    )
  );
}

const Sha256Schema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "sha256 must be a lowercase 64-character hexadecimal digest.",
    );

const AbsoluteArtifactPathSchema =
  z.string()
    .trim()
    .min(1)
    .refine(
      isPortableAbsolutePath,
      {
        message:
          "path must be absolute.",
      },
    );

const CompositionShotNormalizationPlanSnapshotSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    profileId:
      z.literal(
        "busybookie-master-normalization-v1",
      ),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    sourceVideoPath:
      AbsoluteArtifactPathSchema,

    sourceSha256:
      Sha256Schema,

    sourceDurationSeconds:
      z.number()
        .positive(),

    targetDurationSeconds:
      z.number()
        .positive(),

    durationToleranceSeconds:
      z.number()
        .positive(),

    durationMode:
      z.literal(
        "MANIFEST_LOCKED",
      ),

    nativeAudio:
      z.boolean(),

    container:
      z.literal(
        "mp4",
      ),

    video:
      z.object({
        codecName:
          z.literal(
            "h264",
          ),

        width:
          z.number()
            .int()
            .positive(),

        height:
          z.number()
            .int()
            .positive(),

        frameRate:
          z.number()
            .positive(),

        pixelFormat:
          z.literal(
            "yuv420p",
          ),

        scaleMode:
          z.literal(
            "FIT_PAD",
          ),
      })
        .strict(),

    audio:
      z.object({
        mode:
          z.enum([
            "PRESERVE_NATIVE",
            "SYNTHETIC_SILENCE",
          ]),

        codecName:
          z.literal(
            "aac",
          ),

        sampleRateHz:
          z.number()
            .int()
            .positive(),

        channels:
          z.literal(2),

        channelLayout:
          z.literal(
            "stereo",
          ),
      })
        .strict(),

    cacheKey:
      Sha256Schema,

    outputPath:
      AbsoluteArtifactPathSchema,
  })
    .strict();

const CompositionShotNormalizationArtifactSchema =
  z.object({
    outputPath:
      AbsoluteArtifactPathSchema,

    bytes:
      z.number()
        .int()
        .positive(),

    sha256:
      Sha256Schema,

    contentType:
      z.literal(
        "video/mp4",
      ),

    durationSeconds:
      z.number()
        .positive(),

    durationToleranceSeconds:
      z.number()
        .positive(),
  })
    .strict();

export const CompositionShotNormalizationCacheRecordSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    recordedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "NORMALIZED",
      ),

    plan:
      CompositionShotNormalizationPlanSnapshotSchema,

    artifact:
      CompositionShotNormalizationArtifactSchema,
  })
    .strict()
    .superRefine(
      (
        record,
        context,
      ) => {
        if (
          record.artifact.outputPath !==
          record.plan.outputPath
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "artifact",
              "outputPath",
            ],

            message:
              "Composition normalization cache record artifact output path must match the normalization plan output path.",
          });
        }
      },
    );

export type CompositionShotNormalizationCacheRecord =
  z.infer<
    typeof CompositionShotNormalizationCacheRecordSchema
  >;
