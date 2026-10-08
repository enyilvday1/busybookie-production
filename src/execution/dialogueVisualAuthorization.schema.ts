import {
  z,
} from "zod";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

export const DialogueVisualAuthorizationPurposeSchema =
  z.literal(
    "DIALOGUE_VISUAL_GENERATION",
  );

export const DialogueVisualAuthorizationProviderSchema =
  z.enum([
    "RUNWAY",
    "VEO",
  ]);

export const DialogueVisualAuthorizationNativeAudioDispositionSchema =
  z.literal(
    "DISCARD_AFTER_VISUAL_GENERATION",
  );

export const DialogueVisualAuthorizationDialogueAuthoritySchema =
  z.literal(
    "EXTERNAL_VERIFIED_DIALOGUE",
  );

export const DialogueVisualAuthorizationSourceSchema =
  z.literal(
    "HUMAN_OPERATOR",
  );

export const DialogueVisualAuthorizationInputSchema =
  z.object({
    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    purpose:
      DialogueVisualAuthorizationPurposeSchema,

    provider:
      DialogueVisualAuthorizationProviderSchema,

    nativeAudioDisposition:
      DialogueVisualAuthorizationNativeAudioDispositionSchema,

    dialogueAuthority:
      DialogueVisualAuthorizationDialogueAuthoritySchema,

    authorizationSource:
      DialogueVisualAuthorizationSourceSchema,
  })
    .strict();

export const DialogueVisualAuthorizationSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    authorizationId:
      z.string()
        .uuid(),

    authorizedAt:
      z.string()
        .datetime(),

    status:
      z.literal(
        "AUTHORIZED",
      ),

    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    purpose:
      DialogueVisualAuthorizationPurposeSchema,

    provider:
      DialogueVisualAuthorizationProviderSchema,

    nativeAudioDisposition:
      DialogueVisualAuthorizationNativeAudioDispositionSchema,

    dialogueAuthority:
      DialogueVisualAuthorizationDialogueAuthoritySchema,

    authorizationSource:
      DialogueVisualAuthorizationSourceSchema,
  })
    .strict();

export type DialogueVisualAuthorizationInput =
  z.infer<
    typeof DialogueVisualAuthorizationInputSchema
  >;

export type DialogueVisualAuthorization =
  z.infer<
    typeof DialogueVisualAuthorizationSchema
  >;
