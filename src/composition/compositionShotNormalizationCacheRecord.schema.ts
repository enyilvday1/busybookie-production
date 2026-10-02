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

const SCENE_ID_PATTERN =
  /^SC[0-9]{2,3}$/;

const DIALOGUE_LINE_ID_PATTERN =
  /^EP[0-9]{2,3}_SC[0-9]{2,3}_S[0-9]{2,3}[A-Z]?_L[0-9]{2,}$/;

const NUMERIC_EPSILON_SECONDS =
  0.000001;

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

const NormalizationVideoSnapshotSchema =
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
    .strict();

const CompositionShotNormalizationPlanV1SnapshotSchema =
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
      NormalizationVideoSnapshotSchema,

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
          z.literal(
            2,
          ),

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

const DialogueNormalizationLineSnapshotSchema =
  z.object({
    lineNumber:
      z.number()
        .int()
        .positive(),

    dialogueLineId:
      z.string()
        .regex(
          DIALOGUE_LINE_ID_PATTERN,
          "dialogueLineId must use the canonical episode_scene_shot_line form.",
        ),

    sourceAudioPath:
      AbsoluteArtifactPathSchema,

    sourceBytes:
      z.number()
        .int()
        .positive(),

    sourceSha256:
      Sha256Schema,

    startSeconds:
      z.number()
        .finite()
        .nonnegative(),

    durationSeconds:
      z.number()
        .finite()
        .positive(),

    endSeconds:
      z.number()
        .finite()
        .positive(),
  })
    .strict();

const CompositionShotNormalizationPlanV2SnapshotSchema =
  z.object({
    schemaVersion:
      z.literal(
        "2.0",
      ),

    profileId:
      z.literal(
        "busybookie-master-normalization-v2-dialogue",
      ),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    sceneId:
      z.string()
        .regex(
          SCENE_ID_PATTERN,
          "sceneId must use the form SC01.",
        ),

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
      NormalizationVideoSnapshotSchema,

    audio:
      z.object({
        mode:
          z.literal(
            "REPLACE_SOURCE_WITH_DIALOGUE",
          ),

        mixNativeAudio:
          z.literal(
            false,
          ),

        sourceAudioDisposition:
          z.enum([
            "DISCARD_NATIVE_AUDIO",
            "NO_SOURCE_AUDIO",
          ]),

        dialoguePlanKey:
          Sha256Schema,

        audioKey:
          Sha256Schema,

        lines:
          z.array(
            DialogueNormalizationLineSnapshotSchema,
          )
            .min(
              1,
            ),

        codecName:
          z.literal(
            "aac",
          ),

        sampleRateHz:
          z.number()
            .int()
            .positive(),

        channels:
          z.literal(
            2,
          ),

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
    .strict()
    .superRefine(
      (
        plan,
        context,
      ) => {
        const expectedDisposition =
          plan.nativeAudio
            ? "DISCARD_NATIVE_AUDIO"
            : "NO_SOURCE_AUDIO";

        if (
          plan.audio.sourceAudioDisposition !==
          expectedDisposition
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "audio",
              "sourceAudioDisposition",
            ],

            message:
              "Dialogue normalization source-audio disposition must match the native-audio state.",
          });
        }

        let previousEndSeconds:
          number | null =
            null;

        const seenDialogueLineIds =
          new Set<string>();

        for (
          let index =
            0;
          index <
            plan.audio.lines.length;
          index +=
            1
        ) {
          const line =
            plan.audio.lines[
              index
            ];

          if (!line) {
            continue;
          }

          const expectedLineNumber =
            index +
            1;

          if (
            line.lineNumber !==
            expectedLineNumber
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "audio",
                "lines",
                index,
                "lineNumber",
              ],

              message:
                `Dialogue normalization line order must be continuous; expected line ${expectedLineNumber}.`,
            });
          }

          if (
            seenDialogueLineIds.has(
              line.dialogueLineId,
            )
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "audio",
                "lines",
                index,
                "dialogueLineId",
              ],

              message:
                "Dialogue normalization line identities must be unique.",
            });
          }

          seenDialogueLineIds.add(
            line.dialogueLineId,
          );

          const calculatedEndSeconds =
            line.startSeconds +
            line.durationSeconds;

          if (
            Math.abs(
              calculatedEndSeconds -
              line.endSeconds,
            ) >
            plan.durationToleranceSeconds +
              NUMERIC_EPSILON_SECONDS
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "audio",
                "lines",
                index,
                "endSeconds",
              ],

              message:
                "Dialogue normalization line end must match start plus duration within tolerance.",
            });
          }

          if (
            line.endSeconds >
            plan.targetDurationSeconds +
              plan.durationToleranceSeconds +
              NUMERIC_EPSILON_SECONDS
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "audio",
                "lines",
                index,
                "endSeconds",
              ],

              message:
                "Dialogue normalization line must not end beyond the shot duration tolerance.",
            });
          }

          if (
            previousEndSeconds !==
              null &&
            line.startSeconds <
              previousEndSeconds
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "audio",
                "lines",
                index,
                "startSeconds",
              ],

              message:
                "Dialogue normalization lines must not overlap.",
            });
          }

          previousEndSeconds =
            line.endSeconds;
        }
      },
    );

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

const CompositionShotNormalizationCacheRecordV1Schema =
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
      CompositionShotNormalizationPlanV1SnapshotSchema,

    artifact:
      CompositionShotNormalizationArtifactSchema,
  })
    .strict();

const CompositionShotNormalizationCacheRecordV2Schema =
  z.object({
    schemaVersion:
      z.literal(
        "2.0",
      ),

    recordedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "NORMALIZED",
      ),

    plan:
      CompositionShotNormalizationPlanV2SnapshotSchema,

    artifact:
      CompositionShotNormalizationArtifactSchema,
  })
    .strict();

export const CompositionShotNormalizationCacheRecordSchema =
  z.discriminatedUnion(
    "schemaVersion",
    [
      CompositionShotNormalizationCacheRecordV1Schema,
      CompositionShotNormalizationCacheRecordV2Schema,
    ],
  )
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
