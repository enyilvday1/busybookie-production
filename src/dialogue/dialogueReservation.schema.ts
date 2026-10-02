import {
  z,
} from "zod";

export const DialogueReservationEpisodeIdSchema =
  z.string()
    .regex(
      /^EP[0-9]{2,3}$/,
      "Invalid dialogue reservation episode id.",
    );

export const DialogueReservationSceneIdSchema =
  z.string()
    .regex(
      /^SC[0-9]{2,3}$/,
      "Invalid dialogue reservation scene id.",
    );

export const DialogueReservationShotIdSchema =
  z.string()
    .regex(
      /^S[0-9]{2,3}[A-Z]?$/,
      "Invalid dialogue reservation shot id.",
    );

export const DialogueReservationLineIdSchema =
  z.string()
    .regex(
      /^EP[0-9]{2,3}_SC[0-9]{2,3}_S[0-9]{2,3}[A-Z]?_L[0-9]{2,3}$/,
      "Invalid dialogue reservation line id.",
    );

export const DialogueReservationPlanKeySchema =
  z.string()
    .regex(
      /^[a-f0-9]{64}$/,
      "Dialogue reservation planKey must be a lowercase SHA-256 digest.",
    );

export const DialogueReservationProviderSchema =
  z.literal(
    "RUNWAY",
  );

export function dialogueReservationIdentityMatches(
  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,
): boolean {
  return dialogueLineId.startsWith(
    `${episodeId}_${sceneId}_${shotId}_L`,
  );
}

function addIdentityValidation(
  value:
    Readonly<{
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialogueLineId: string;
    }>,

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
        "Dialogue line identity does not match the selected episode, scene, and shot.",
    });
  }
}

const DialogueReservationInputBaseSchema =
  z.object({
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
  })
    .strict();

export const DialogueReservationInputSchema =
  DialogueReservationInputBaseSchema
    .superRefine(
      addIdentityValidation,
    );

const DialogueReservationBaseSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    reservationId:
      z.string()
        .uuid(),

    reservedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "RESERVED",
      ),

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
  })
    .strict();

export const DialogueReservationSchema =
  DialogueReservationBaseSchema
    .superRefine(
      addIdentityValidation,
    );

export type DialogueReservationInput =
  z.infer<
    typeof DialogueReservationInputSchema
  >;

export type DialogueReservation =
  z.infer<
    typeof DialogueReservationSchema
  >;
