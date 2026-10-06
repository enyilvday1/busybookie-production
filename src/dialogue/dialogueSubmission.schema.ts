import {
  z,
} from "zod";

import {
  DialogueGenerationDirectSeedAudioRequestRecordSchema,
  DialogueGenerationPlanSnapshotSchema,
  DialogueGenerationReferenceAudioPlanSnapshotSchema,
  DialogueGenerationReferenceAudioRequestRecordSchema,
  DialogueGenerationProviderCreditSchema,
  DialogueGenerationRoutingEvidenceSchema,
} from "./dialogueGenerationRecord.schema.js";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationPlanKeySchema,
  DialogueReservationProviderSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "./dialogueReservation.schema.js";

import {
  RunwayElevenV3RequestSchema,
} from "./runwayElevenV3Request.schema.js";

const DialogueSubmissionReservationIdSchema =
  z.string()
    .uuid();

const DialogueSubmissionProviderExecutionIdSchema =
  z.string()
    .trim()
    .min(
      1,
      "providerExecutionId is required.",
    );

const SafeNonnegativeIntegerSchema =
  z.number()
    .refine(
      Number.isSafeInteger,
      "Credit value must be a safe integer.",
    )
    .refine(
      (value) =>
        value >=
        0,
      "Credit value must be nonnegative.",
    );

export const DialogueGenerationRecoveryMetadataSchema =
  z.object({
    request:
      RunwayElevenV3RequestSchema,

    locallyExpectedCredits:
      SafeNonnegativeIntegerSchema,

    plan:
      DialogueGenerationPlanSnapshotSchema,
  })
    .strict()
    .superRefine(
      (
        recovery,
        context,
      ) => {
        if (
          recovery.request.promptText !==
          recovery.plan.text
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "request",
              "promptText",
            ],

            message:
              "Dialogue recovery request prompt text must match the immutable dialogue plan.",
          });
        }

        if (
          recovery.request.voice.presetId !==
          recovery.plan.voice.voiceName
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "request",
              "voice",
              "presetId",
            ],

            message:
              "Dialogue recovery request voice must match the immutable dialogue plan.",
          });
        }

        if (
          recovery.plan.voice.provider !==
          "RUNWAY"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "plan",
              "voice",
              "provider",
            ],

            message:
              "Dialogue recovery plan must use the Runway voice provider.",
          });
        }
      },
    );

export const DialogueReferenceAudioGenerationRecoveryMetadataSchema =
  z.object({
    request:
      DialogueGenerationReferenceAudioRequestRecordSchema,

    locallyExpectedCredits:
      SafeNonnegativeIntegerSchema,

    plan:
      DialogueGenerationReferenceAudioPlanSnapshotSchema,
  })
    .strict()
    .superRefine(
      (
        recovery,
        context,
      ) => {
        if (
          recovery.request
            .input
            .promptText !==
          recovery.plan.text
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "request",
              "input",
              "promptText",
            ],

            message:
              "Dialogue reference-audio recovery request prompt text must match the immutable dialogue plan.",
          });
        }

        if (
          recovery.plan.voice.provider !==
          "RUNWAY"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "plan",
              "voice",
              "provider",
            ],

            message:
              "Dialogue reference-audio recovery plan must use the Runway voice provider.",
          });
        }
      },
    );

export const DialogueDirectSeedAudioGenerationRecoveryMetadataSchema =
  z.object({
    request:
      DialogueGenerationDirectSeedAudioRequestRecordSchema,

    localCreditCeiling:
      DialogueGenerationProviderCreditSchema,

    plan:
      DialogueGenerationReferenceAudioPlanSnapshotSchema,
  })
    .strict()
    .superRefine(
      (
        recovery,
        context,
      ) => {
        if (
          recovery.request.promptText !==
          recovery.plan.text
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "request",
              "promptText",
            ],

            message:
              "Dialogue direct SeedAudio recovery request prompt text must match the immutable dialogue plan.",
          });
        }

        if (
          recovery.plan.voice.provider !==
          "RUNWAY"
        ) {
          context.addIssue({
            code:
              z.ZodIssueCode.custom,

            path: [
              "plan",
              "voice",
              "provider",
            ],

            message:
              "Dialogue direct SeedAudio recovery plan must use the Runway voice provider.",
          });
        }
      },
    );

const DialogueSubmissionIdentityFieldsSchema =
  z.object({
    reservationId:
      DialogueSubmissionReservationIdSchema,

    episodeId:
      DialogueReservationEpisodeIdSchema,

    sceneId:
      DialogueReservationSceneIdSchema,

    shotId:
      DialogueReservationShotIdSchema,

    dialogueLineId:
      DialogueReservationLineIdSchema,

    planKey:
      DialogueReservationPlanKeySchema,

    provider:
      DialogueReservationProviderSchema,

    providerExecutionId:
      DialogueSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      SafeNonnegativeIntegerSchema,

    recoveryMetadata:
      DialogueGenerationRecoveryMetadataSchema,
  })
    .strict();

function addDialogueSubmissionIdentityValidation(
  value:
    z.infer<
      typeof DialogueSubmissionIdentityFieldsSchema
    >,

  context:
    z.RefinementCtx,
): void {
  if (
    !dialogueReservationIdentityMatches(
      value.episodeId,
      value.sceneId,
      value.shotId,
      value.dialogueLineId,
    )
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "dialogueLineId",
      ],

      message:
        "Dialogue submission line identity does not match the selected episode, scene, and shot.",
    });
  }

  const recoveryPlan =
    value.recoveryMetadata.plan;

  if (
    recoveryPlan.episodeId !==
      value.episodeId ||
    recoveryPlan.sceneId !==
      value.sceneId ||
    recoveryPlan.shotId !==
      value.shotId ||
    recoveryPlan.dialogueLineId !==
      value.dialogueLineId
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
      ],

      message:
        "Dialogue recovery plan identity does not match the submission identity.",
    });
  }

  if (
    recoveryPlan.planKey !==
    value.planKey
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
        "planKey",
      ],

      message:
        "Dialogue recovery planKey does not match the submission planKey.",
    });
  }

  if (
    recoveryPlan.voice.provider !==
    value.provider
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
        "voice",
        "provider",
      ],

      message:
        "Dialogue recovery voice provider does not match the submission provider.",
    });
  }
}

export const DialogueSubmissionInputSchema =
  DialogueSubmissionIdentityFieldsSchema
    .superRefine(
      addDialogueSubmissionIdentityValidation,
    );

const DialogueSubmissionBaseSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    submittedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "SUBMITTED",
      ),

    reservationId:
      DialogueSubmissionReservationIdSchema,

    episodeId:
      DialogueReservationEpisodeIdSchema,

    sceneId:
      DialogueReservationSceneIdSchema,

    shotId:
      DialogueReservationShotIdSchema,

    dialogueLineId:
      DialogueReservationLineIdSchema,

    planKey:
      DialogueReservationPlanKeySchema,

    provider:
      DialogueReservationProviderSchema,

    providerExecutionId:
      DialogueSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      SafeNonnegativeIntegerSchema,

    recoveryMetadata:
      DialogueGenerationRecoveryMetadataSchema,
  })
    .strict();

const DialogueSubmissionV1Schema =
  DialogueSubmissionBaseSchema
    .superRefine(
      addDialogueSubmissionIdentityValidation,
    );

const DialogueSubmissionV2IdentityFieldsSchema =
  z.object({
    reservationId:
      DialogueSubmissionReservationIdSchema,

    episodeId:
      DialogueReservationEpisodeIdSchema,

    sceneId:
      DialogueReservationSceneIdSchema,

    shotId:
      DialogueReservationShotIdSchema,

    dialogueLineId:
      DialogueReservationLineIdSchema,

    planKey:
      DialogueReservationPlanKeySchema,

    provider:
      DialogueReservationProviderSchema,

    providerExecutionId:
      DialogueSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      DialogueGenerationProviderCreditSchema,

    routing:
      DialogueGenerationRoutingEvidenceSchema,

    recoveryMetadata:
      DialogueReferenceAudioGenerationRecoveryMetadataSchema,
  })
    .strict();

const DialogueSubmissionV2BaseSchema =
  DialogueSubmissionV2IdentityFieldsSchema
    .extend({
      schemaVersion:
        z.literal(
          "2.0",
        ),

      submittedAt:
        z.string()
          .datetime(),

      status:
        z.literal(
          "SUBMITTED",
        ),
    });

function addDialogueSubmissionV2IdentityValidation(
  value:
    z.infer<
      typeof DialogueSubmissionV2IdentityFieldsSchema
    >,

  context:
    z.RefinementCtx,
): void {
  if (
    !dialogueReservationIdentityMatches(
      value.episodeId,
      value.sceneId,
      value.shotId,
      value.dialogueLineId,
    )
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "dialogueLineId",
      ],

      message:
        "Dialogue submission line identity does not match the selected episode, scene, and shot.",
    });
  }

  const recoveryPlan =
    value.recoveryMetadata.plan;

  if (
    recoveryPlan.episodeId !==
      value.episodeId ||
    recoveryPlan.sceneId !==
      value.sceneId ||
    recoveryPlan.shotId !==
      value.shotId ||
    recoveryPlan.dialogueLineId !==
      value.dialogueLineId
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
      ],

      message:
        "Dialogue recovery plan identity does not match the submission identity.",
    });
  }

  if (
    recoveryPlan.planKey !==
    value.planKey
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
        "planKey",
      ],

      message:
        "Dialogue recovery planKey does not match the submission planKey.",
    });
  }

  if (
    recoveryPlan.voice.provider !==
    value.provider
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
        "voice",
        "provider",
      ],

      message:
        "Dialogue recovery voice provider does not match the submission provider.",
    });
  }

  if (
    value.routing.configId !==
    value.recoveryMetadata
      .request
      .configId
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "routing",
        "configId",
      ],

      message:
        "Dialogue reference-audio submission routing configId must match the immutable recovery request.",
    });
  }

  if (
    value.providerEstimatedCredits !==
    value.routing
      .estimatedCost
      .credits
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "providerEstimatedCredits",
      ],

      message:
        "Dialogue reference-audio submission provider estimate must match accepted router evidence.",
    });
  }
}

export const DialogueReferenceAudioSubmissionInputSchema =
  DialogueSubmissionV2IdentityFieldsSchema
    .superRefine(
      addDialogueSubmissionV2IdentityValidation,
    );

export const DialogueSubmissionV2Schema =
  DialogueSubmissionV2BaseSchema
    .superRefine(
      addDialogueSubmissionV2IdentityValidation,
    );

const DialogueSubmissionV3IdentityFieldsSchema =
  z.object({
    reservationId:
      DialogueSubmissionReservationIdSchema,

    episodeId:
      DialogueReservationEpisodeIdSchema,

    sceneId:
      DialogueReservationSceneIdSchema,

    shotId:
      DialogueReservationShotIdSchema,

    dialogueLineId:
      DialogueReservationLineIdSchema,

    planKey:
      DialogueReservationPlanKeySchema,

    provider:
      DialogueReservationProviderSchema,

    providerExecutionId:
      DialogueSubmissionProviderExecutionIdSchema,

    providerEstimatedCredits:
      DialogueGenerationProviderCreditSchema,

    recoveryMetadata:
      DialogueDirectSeedAudioGenerationRecoveryMetadataSchema,
  })
    .strict();

function addDialogueSubmissionV3IdentityValidation(
  value:
    z.infer<
      typeof DialogueSubmissionV3IdentityFieldsSchema
    >,

  context:
    z.RefinementCtx,
): void {
  if (
    !dialogueReservationIdentityMatches(
      value.episodeId,
      value.sceneId,
      value.shotId,
      value.dialogueLineId,
    )
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "dialogueLineId",
      ],

      message:
        "Dialogue submission line identity does not match the selected episode, scene, and shot.",
    });
  }

  const recoveryPlan =
    value.recoveryMetadata.plan;

  if (
    recoveryPlan.episodeId !==
      value.episodeId ||
    recoveryPlan.sceneId !==
      value.sceneId ||
    recoveryPlan.shotId !==
      value.shotId ||
    recoveryPlan.dialogueLineId !==
      value.dialogueLineId
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
      ],

      message:
        "Dialogue recovery plan identity does not match the submission identity.",
    });
  }

  if (
    recoveryPlan.planKey !==
    value.planKey
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
        "planKey",
      ],

      message:
        "Dialogue recovery planKey does not match the submission planKey.",
    });
  }

  if (
    recoveryPlan.voice.provider !==
    value.provider
  ) {
    context.addIssue({
      code:
        z.ZodIssueCode.custom,

      path: [
        "recoveryMetadata",
        "plan",
        "voice",
        "provider",
      ],

      message:
        "Dialogue recovery voice provider does not match the submission provider.",
    });
  }
}

export const DialogueDirectSeedAudioSubmissionInputSchema =
  DialogueSubmissionV3IdentityFieldsSchema
    .superRefine(
      addDialogueSubmissionV3IdentityValidation,
    );

const DialogueSubmissionV3BaseSchema =
  DialogueSubmissionV3IdentityFieldsSchema
    .extend({
      schemaVersion:
        z.literal(
          "3.0",
        ),

      submittedAt:
        z.string()
          .datetime(),

      status:
        z.literal(
          "SUBMITTED",
        ),
    });

export const DialogueSubmissionV3Schema =
  DialogueSubmissionV3BaseSchema
    .superRefine(
      addDialogueSubmissionV3IdentityValidation,
    );

export const DialogueSubmissionSchema =
  z.discriminatedUnion(
    "schemaVersion",
    [
      DialogueSubmissionV1Schema,
      DialogueSubmissionV2Schema,
      DialogueSubmissionV3Schema,
    ],
  );

export type DialogueSubmissionInput =
  z.infer<
    typeof DialogueSubmissionInputSchema
  >;

export type DialogueSubmissionV1 =
  z.infer<
    typeof DialogueSubmissionV1Schema
  >;

export type DialogueReferenceAudioSubmissionInput =
  z.infer<
    typeof DialogueReferenceAudioSubmissionInputSchema
  >;

export type DialogueSubmissionV2 =
  z.infer<
    typeof DialogueSubmissionV2Schema
  >;

export type DialogueDirectSeedAudioSubmissionInput =
  z.infer<
    typeof DialogueDirectSeedAudioSubmissionInputSchema
  >;

export type DialogueSubmissionV3 =
  z.infer<
    typeof DialogueSubmissionV3Schema
  >;

export type DialogueSubmission =
  z.infer<
    typeof DialogueSubmissionSchema
  >;
