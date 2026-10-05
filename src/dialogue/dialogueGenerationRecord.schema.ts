import {
  isAbsolute,
} from "node:path";

import {
  z,
} from "zod";

import {
  CharacterIdSchema,
  RunwayReferenceAudioAssetSchema,
} from "../schemas/character.schema.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const EPISODE_ID_PATTERN =
  /^EP[0-9]{2,3}$/;

const SCENE_ID_PATTERN =
  /^SC[0-9]{2,3}$/;

const SHOT_ID_PATTERN =
  /^S[0-9]{2,3}[A-Z]?$/;

const DIALOGUE_LINE_ID_PATTERN =
  /^EP[0-9]{2,3}_SC[0-9]{2,3}_S[0-9]{2,3}[A-Z]?_L[0-9]{2,3}$/;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

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
      SHA256_PATTERN,
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
          "Dialogue output path must be absolute.",
      },
    );

export const DialogueGenerationOutputRecordSchema =
  z.object({
    outputIndex:
      z.number()
        .int()
        .positive(),

    destinationPath:
      AbsoluteArtifactPathSchema,

    bytes:
      z.number()
        .int()
        .positive(),

    sha256:
      Sha256Schema,

    contentType:
      z.string()
        .trim()
        .min(1)
        .nullable(),
  })
    .strict();

const DialogueGenerationVoiceSnapshotSchema =
  z.object({
    provider:
      z.literal(
        "RUNWAY",
      ),

    voiceName:
      z.string()
        .trim()
        .min(1),

    deliveryTraits:
      z.array(
        z.string()
          .trim()
          .min(1),
      )
        .min(1),
  })
    .strict();

export const DialogueGenerationReferenceAudioVoiceSnapshotSchema =
  z.object({
    selectionStatus:
      z.literal(
        "LOCKED",
      ),

    provider:
      z.literal(
        "RUNWAY",
      ),

    voiceName:
      z.string()
        .trim()
        .min(1),

    deliveryTraits:
      z.array(
        z.string()
          .trim()
          .min(1),
      )
        .min(1),

    executionMode:
      z.literal(
        "RUNWAY_REFERENCE_AUDIO",
      ),

    referenceAudio:
      RunwayReferenceAudioAssetSchema,
  })
    .strict();

export const DialogueGenerationPlanSnapshotSchema =
  z.object({
    planKey:
      Sha256Schema,

    episodeId:
      z.string()
        .regex(
          EPISODE_ID_PATTERN,
        ),

    sceneId:
      z.string()
        .regex(
          SCENE_ID_PATTERN,
        ),

    shotId:
      z.string()
        .regex(
          SHOT_ID_PATTERN,
        ),

    dialogueLineId:
      z.string()
        .regex(
          DIALOGUE_LINE_ID_PATTERN,
        ),

    lineNumber:
      z.number()
        .int()
        .positive(),

    characterId:
      CharacterIdSchema,

    characterName:
      z.string()
        .trim()
        .min(1),

    text:
      z.string()
        .trim()
        .min(1),

    deliveryNotes:
      z.string()
        .trim()
        .min(1)
        .nullable(),

    voice:
      DialogueGenerationVoiceSnapshotSchema,
  })
    .strict()
    .superRefine(
      (
        plan,
        context,
      ) => {
        if (
          !plan.dialogueLineId.startsWith(
            `${plan.episodeId}_${plan.sceneId}_${plan.shotId}_`,
          )
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "dialogueLineId",
            ],

            message:
              "Dialogue line identity must match the recorded episode, scene, and shot identity.",
          });
        }

        const expectedLineSuffix =
          `_L${String(
            plan.lineNumber,
          ).padStart(
            2,
            "0",
          )}`;

        if (
          !plan.dialogueLineId.endsWith(
            expectedLineSuffix,
          )
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "dialogueLineId",
            ],

            message:
              "Dialogue line identity must match the recorded line number.",
          });
        }
      },
    );

export const DialogueGenerationReferenceAudioPlanSnapshotSchema =
  z.object({
    planKey:
      Sha256Schema,

    episodeId:
      z.string()
        .regex(
          EPISODE_ID_PATTERN,
        ),

    sceneId:
      z.string()
        .regex(
          SCENE_ID_PATTERN,
        ),

    shotId:
      z.string()
        .regex(
          SHOT_ID_PATTERN,
        ),

    dialogueLineId:
      z.string()
        .regex(
          DIALOGUE_LINE_ID_PATTERN,
        ),

    lineNumber:
      z.number()
        .int()
        .positive(),

    characterId:
      CharacterIdSchema,

    characterName:
      z.string()
        .trim()
        .min(1),

    text:
      z.string()
        .trim()
        .min(1),

    deliveryNotes:
      z.string()
        .trim()
        .min(1)
        .nullable(),

    voice:
      DialogueGenerationReferenceAudioVoiceSnapshotSchema,
  })
    .strict()
    .superRefine(
      (
        plan,
        context,
      ) => {
        if (
          !plan.dialogueLineId.startsWith(
            `${plan.episodeId}_${plan.sceneId}_${plan.shotId}_`,
          )
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "dialogueLineId",
            ],

            message:
              "Dialogue line identity must match the recorded episode, scene, and shot identity.",
          });
        }

        const expectedLineSuffix =
          `_L${String(
            plan.lineNumber,
          ).padStart(
            2,
            "0",
          )}`;

        if (
          !plan.dialogueLineId.endsWith(
            expectedLineSuffix,
          )
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "dialogueLineId",
            ],

            message:
              "Dialogue line identity must match the recorded line number.",
          });
        }
      },
    );

export const DialogueGenerationRequestVoiceSchema =
  z.object({
    type:
      z.literal(
        "runway-preset",
      ),

    presetId:
      z.string()
        .trim()
        .min(1),
  })
    .strict();

export const DialogueGenerationRequestRecordSchema =
  z.object({
    model:
      z.string()
        .trim()
        .min(1),

    promptText:
      z.string()
        .trim()
        .min(1),

    voice:
      DialogueGenerationRequestVoiceSchema,

    applyTextNormalization:
      z.enum([
        "auto",
        "on",
        "off",
      ]),

    languageCode:
      z.string()
        .regex(
          /^[a-z]{2}$/,
          "Dialogue generation request languageCode must use a two-letter lowercase ISO 639-1 code.",
        ),

    seed:
      z.number()
        .int()
        .min(
          0,
        )
        .max(
          4_294_967_295,
        ),

    similarityBoost:
      z.number()
        .min(
          0,
        )
        .max(
          1,
        ),

    speed:
      z.number()
        .min(
          0.7,
        )
        .max(
          1.2,
        ),

    stability:
      z.number()
        .min(
          0,
        )
        .max(
          1,
        ),

    style:
      z.number()
        .min(
          0,
        )
        .max(
          1,
        ),

    useSpeakerBoost:
      z.boolean(),
  })
    .strict();

export const DialogueGenerationReferenceAudioRequestRecordSchema =
  z.object({
    configId:
      z.string()
        .trim()
        .min(1),

    input:
      z.object({
        type:
          z.literal(
            "speech",
          ),

        promptText:
          z.string()
            .trim()
            .min(1),

        voice:
          z.object({
            type:
              z.literal(
                "reference-audio",
              ),

            audioUri:
              z.string()
                .trim()
                .min(1)
                .refine(
                  (value) =>
                    value.startsWith(
                      "runway://",
                    ),
                  {
                    message:
                      "Runway reference-audio request must use a Runway upload URI.",
                  },
                ),
          })
            .strict(),
      })
        .strict(),
  })
    .strict();

export const DialogueGenerationDirectSeedAudioRequestRecordSchema =
  z.object({
    model:
      z.literal(
        "seed_audio",
      ),

    promptText:
      z.string()
        .trim()
        .min(1),

    loudnessRate:
      z.number()
        .refine(
          Number.isFinite,
          "Runway direct SeedAudio loudnessRate must be finite.",
        )
        .optional(),

    outputFormat:
      z.enum([
        "wav",
        "mp3",
        "ogg_opus",
      ])
        .optional(),

    pitchRate:
      z.number()
        .refine(
          Number.isFinite,
          "Runway direct SeedAudio pitchRate must be finite.",
        )
        .optional(),

    sampleRate:
      z.union([
        z.literal(8_000),
        z.literal(16_000),
        z.literal(24_000),
        z.literal(32_000),
        z.literal(44_100),
        z.literal(48_000),
      ])
        .optional(),

    speechRate:
      z.number()
        .refine(
          Number.isFinite,
          "Runway direct SeedAudio speechRate must be finite.",
        )
        .optional(),

    voice:
      z.object({
        type:
          z.literal(
            "reference-audio",
          ),

        audioUri:
          z.string()
            .trim()
            .min(1)
            .refine(
              (value) =>
                value.startsWith(
                  "runway://",
                ),
              {
                message:
                  "Runway direct SeedAudio reference-audio request must use a Runway upload URI.",
              },
            ),
      })
        .strict(),
  })
    .strict();

export const DialogueGenerationProviderCreditSchema =
  z.number()
    .refine(
      Number.isFinite,
      "Provider credit value must be finite.",
    )
    .refine(
      (value) =>
        value >=
        0,
      "Provider credit value must be nonnegative.",
    );

const DialogueGenerationRoutingCreditsSchema =
  z.object({
    credits:
      DialogueGenerationProviderCreditSchema,
  })
    .strict();

export const DialogueGenerationRoutingEvidenceSchema =
  z.object({
    configId:
      z.string()
        .trim()
        .min(1),

    model:
      z.string()
        .trim()
        .min(1),

    provider:
      z.string()
        .trim()
        .min(1),

    estimatedCost:
      DialogueGenerationRoutingCreditsSchema,

    resolvedInput:
      z.object({
        type:
          z.literal(
            "speech",
          ),

        voice:
          z.literal(
            "reference-audio",
          ),
      })
        .strict(),

    resolvedSettings:
      z.object({
        optimizeFor:
          z.enum([
            "cost",
            "latency",
            "quality",
          ]),

        priceCeiling:
          z.number()
            .nonnegative()
            .nullable(),
      })
        .strict(),

    capacityFallback:
      z.object({
        allExhausted:
          z.boolean(),

        skipped:
          z.array(
            z.string()
              .trim()
              .min(1),
          ),
      })
        .strict()
        .optional(),
  })
    .strict();

export const DialogueGenerationCreditsSchema =
  z.object({
    locallyExpected:
      z.number()
        .int()
        .nonnegative(),

    providerEstimated:
      z.number()
        .int()
        .nonnegative(),

    providerFinal:
      z.number()
        .int()
        .nonnegative(),
  })
    .strict();

const DialogueGenerationReferenceAudioCreditsSchema =
  z.object({
    locallyExpected:
      z.number()
        .int()
        .nonnegative(),

    providerEstimated:
      DialogueGenerationProviderCreditSchema,

    providerFinal:
      DialogueGenerationProviderCreditSchema,
  })
    .strict();

export const DialogueGenerationRecordV1Schema =
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
        "SUCCEEDED",
      ),

    provider:
      z.literal(
        "RUNWAY",
      ),

    providerExecutionId:
      z.string()
        .trim()
        .min(1),

    providerModel:
      z.string()
        .trim()
        .min(1),

    providerCreatedAt:
      z.string()
        .datetime(),

    request:
      DialogueGenerationRequestRecordSchema,

    credits:
      DialogueGenerationCreditsSchema,

    plan:
      DialogueGenerationPlanSnapshotSchema,

    outputs:
      z.array(
        DialogueGenerationOutputRecordSchema,
      )
        .min(1),
  })
    .strict()
    .superRefine(
      (
        record,
        context,
      ) => {
        if (
          record.plan.voice.provider !==
          record.provider
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "plan",
              "voice",
              "provider",
            ],

            message:
              "Dialogue generation record provider must match the locked voice provider.",
          });
        }

        if (
          record.request.model !==
          record.providerModel
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "request",
              "model",
            ],

            message:
              "Dialogue generation request model must match the recorded provider model.",
          });
        }

        if (
          record.request.promptText !==
          record.plan.text
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "request",
              "promptText",
            ],

            message:
              "Dialogue generation request prompt text must match the planned dialogue text.",
          });
        }

        if (
          record.request.voice.presetId !==
          record.plan.voice.voiceName
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "request",
              "voice",
              "presetId",
            ],

            message:
              "Dialogue generation request preset voice must match the locked planned voice.",
          });
        }
      },
    );

export const DialogueGenerationRecordV2Schema =
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
        "SUCCEEDED",
      ),

    provider:
      z.literal(
        "RUNWAY",
      ),

    providerExecutionId:
      z.string()
        .trim()
        .min(1),

    providerModel:
      z.string()
        .trim()
        .min(1),

    providerCreatedAt:
      z.string()
        .datetime(),

    request:
      DialogueGenerationReferenceAudioRequestRecordSchema,

    routing:
      DialogueGenerationRoutingEvidenceSchema,

    credits:
      DialogueGenerationReferenceAudioCreditsSchema,

    plan:
      DialogueGenerationReferenceAudioPlanSnapshotSchema,

    outputs:
      z.array(
        DialogueGenerationOutputRecordSchema,
      )
        .min(1),
  })
    .strict()
    .superRefine(
      (
        record,
        context,
      ) => {
        if (
          record.plan.voice.provider !==
          record.provider
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "plan",
              "voice",
              "provider",
            ],

            message:
              "Dialogue generation record provider must match the locked voice provider.",
          });
        }

        if (
          record.request
            .input
            .promptText !==
          record.plan.text
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "request",
              "input",
              "promptText",
            ],

            message:
              "Dialogue reference-audio request prompt text must match the planned dialogue text.",
          });
        }

        if (
          record.request.configId !==
          record.routing.configId
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "routing",
              "configId",
            ],

            message:
              "Dialogue reference-audio routing configId must match the immutable request configId.",
          });
        }

        if (
          record.providerModel !==
          record.routing.model
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "providerModel",
            ],

            message:
              "Dialogue reference-audio provider model must match the accepted router model.",
          });
        }

        if (
          record.credits
            .providerEstimated !==
          record.routing
            .estimatedCost
            .credits
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "credits",
              "providerEstimated",
            ],

            message:
              "Dialogue reference-audio provider-estimated credits must match the accepted router estimate.",
          });
        }
      },
    );

export const DialogueGenerationRecordV3Schema =
  z.object({
    schemaVersion:
      z.literal(
        "3.0",
      ),

    recordedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "SUCCEEDED",
      ),

    provider:
      z.literal(
        "RUNWAY",
      ),

    providerExecutionId:
      z.string()
        .trim()
        .min(1),

    providerModel:
      z.literal(
        "seed_audio",
      ),

    providerCreatedAt:
      z.string()
        .datetime(),

    request:
      DialogueGenerationDirectSeedAudioRequestRecordSchema,

    credits:
      DialogueGenerationReferenceAudioCreditsSchema,

    plan:
      DialogueGenerationReferenceAudioPlanSnapshotSchema,

    outputs:
      z.array(
        DialogueGenerationOutputRecordSchema,
      )
        .min(1),
  })
    .strict()
    .superRefine(
      (
        record,
        context,
      ) => {
        if (
          record.plan.voice.provider !==
          record.provider
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "plan",
              "voice",
              "provider",
            ],

            message:
              "Dialogue direct SeedAudio generation record provider must match the locked voice provider.",
          });
        }

        if (
          record.request.model !==
          record.providerModel
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "request",
              "model",
            ],

            message:
              "Dialogue direct SeedAudio request model must match the recorded provider model.",
          });
        }

        if (
          record.request.promptText !==
          record.plan.text
        ) {
          context.addIssue({
            code:
              "custom",

            path: [
              "request",
              "promptText",
            ],

            message:
              "Dialogue direct SeedAudio request prompt text must match the planned dialogue text.",
          });
        }
      },
    );

export const DialogueGenerationRecordSchema =
  z.discriminatedUnion(
    "schemaVersion",
    [
      DialogueGenerationRecordV1Schema,
      DialogueGenerationRecordV2Schema,
      DialogueGenerationRecordV3Schema,
    ],
  );

export type DialogueGenerationOutputRecord =
  z.infer<
    typeof DialogueGenerationOutputRecordSchema
  >;

export type DialogueGenerationRequestRecord =
  z.infer<
    typeof DialogueGenerationRequestRecordSchema
  >;

export type DialogueGenerationCredits =
  z.infer<
    typeof DialogueGenerationCreditsSchema
  >;

export type DialogueGenerationRecordV1 =
  z.infer<
    typeof DialogueGenerationRecordV1Schema
  >;

export type DialogueGenerationRecordV3 =
  z.infer<
    typeof DialogueGenerationRecordV3Schema
  >;

export type DialogueGenerationRecord =
  z.infer<
    typeof DialogueGenerationRecordSchema
  >;
