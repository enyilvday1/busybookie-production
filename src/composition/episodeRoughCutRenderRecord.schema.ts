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

const NUMERIC_EPSILON =
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
    .min(
      1,
    )
    .refine(
      isPortableAbsolutePath,
      {
        message:
          "path must be absolute.",
      },
    );

const EpisodeRoughCutRenderPlanShotSnapshotSchema =
  z.object({
    sceneId:
      z.string()
        .trim()
        .min(
          1,
        ),

    shotId:
      ExecutionReservationShotIdSchema,

    order:
      z.number()
        .int()
        .positive(),

    title:
      z.string()
        .trim()
        .min(
          1,
        ),

    durationSeconds:
      z.number()
        .positive(),

    sourceVideoPath:
      AbsoluteArtifactPathSchema,

    sourceBytes:
      z.number()
        .int()
        .positive(),

    sourceSha256:
      Sha256Schema,
  })
    .strict();

const EpisodeRoughCutRenderPlanSnapshotSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    profileId:
      z.literal(
        "busybookie-episode-rough-cut-v1",
      ),

    assemblyMode:
      z.literal(
        "STRAIGHT_CUT",
      ),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    title:
      z.string()
        .trim()
        .min(
          1,
        ),

    totalShots:
      z.number()
        .int()
        .positive(),

    totalDurationSeconds:
      z.number()
        .positive(),

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

        profile:
          z.literal(
            "High",
          ),

        width:
          z.literal(
            1920,
          ),

        height:
          z.literal(
            1080,
          ),

        frameRate:
          z.literal(
            25,
          ),

        pixelFormat:
          z.literal(
            "yuv420p",
          ),
      })
        .strict(),

    audio:
      z.object({
        codecName:
          z.literal(
            "aac",
          ),

        sampleRateHz:
          z.literal(
            48000,
          ),

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

    renderKey:
      Sha256Schema,

    outputPath:
      AbsoluteArtifactPathSchema,

    shots:
      z.array(
        EpisodeRoughCutRenderPlanShotSnapshotSchema,
      )
        .min(
          1,
        ),
  })
    .strict()
    .superRefine(
      (
        plan,
        context,
      ) => {
        if (
          plan.totalShots !==
          plan.shots.length
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "totalShots",
            ],

            message:
              "Episode rough-cut render record totalShots must match the shot list length.",
          });
        }

        const shotIds =
          new Set<
            string
          >();

        let calculatedDurationSeconds =
          0;

        for (
          let index =
            0;
          index <
            plan.shots.length;
          index +=
            1
        ) {
          const shot =
            plan.shots[
              index
            ];

          if (
            shot ===
            undefined
          ) {
            continue;
          }

          const expectedOrder =
            index +
            1;

          if (
            shot.order !==
            expectedOrder
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "shots",
                index,
                "order",
              ],

              message:
                `Episode rough-cut render record shot order must be continuous. Expected ${expectedOrder}.`,
            });
          }

          if (
            shotIds.has(
              shot.shotId,
            )
          ) {
            context.addIssue({
              code:
                "custom",

              path: [
                "shots",
                index,
                "shotId",
              ],

              message:
                "Episode rough-cut render record shot IDs must be unique.",
            });
          }

          shotIds.add(
            shot.shotId,
          );

          calculatedDurationSeconds +=
            shot.durationSeconds;
        }

        if (
          Math.abs(
            calculatedDurationSeconds -
            plan.totalDurationSeconds,
          ) >
          NUMERIC_EPSILON
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "totalDurationSeconds",
            ],

            message:
              "Episode rough-cut render record total duration must match the ordered shot durations.",
          });
        }
      },
    );

const EpisodeRoughCutArtifactSchema =
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

export const EpisodeRoughCutRenderRecordSchema =
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
        "RENDERED",
      ),

    plan:
      EpisodeRoughCutRenderPlanSnapshotSchema,

    artifact:
      EpisodeRoughCutArtifactSchema,
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
              "Episode rough-cut render record artifact output path must match the render plan output path.",
          });
        }

        const durationDifferenceSeconds =
          Math.abs(
            record.artifact.durationSeconds -
            record.plan.totalDurationSeconds,
          );

        if (
          durationDifferenceSeconds >
          record.artifact.durationToleranceSeconds +
            NUMERIC_EPSILON
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "artifact",
              "durationSeconds",
            ],

            message:
              "Episode rough-cut render record artifact duration exceeds its recorded tolerance from the render plan.",
          });
        }
      },
    );

export type EpisodeRoughCutRenderRecord =
  z.infer<
    typeof EpisodeRoughCutRenderRecordSchema
  >;
