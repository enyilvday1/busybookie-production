import {
  z,
} from "zod";

export const ExecutionReservationEpisodeIdSchema =
  z.string()
    .regex(
      /^EP[0-9]{2,3}$/,
      "episodeId must use the Busybookie EP## or EP### format.",
    );

export const ExecutionReservationShotIdSchema =
  z.string()
    .regex(
      /^S[0-9]{2,3}[A-Z]?$/,
      "shotId must use the Busybookie S##, S###, or suffixed shot format.",
    );

export const ExecutionReservationProviderSchema =
  z.enum([
    "RUNWAY",
    "VEO",
    "GOOGLE_GENAI",
  ]);

export const ExecutionReservationInputSchema =
  z.object({
    episodeId:
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionReservationProviderSchema,
  })
    .strict();

export const ExecutionReservationSchema =
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
      ExecutionReservationEpisodeIdSchema,

    shotId:
      ExecutionReservationShotIdSchema,

    provider:
      ExecutionReservationProviderSchema,
  })
    .strict();

export type ExecutionReservationInput =
  z.infer<
    typeof ExecutionReservationInputSchema
  >;

export type ExecutionReservation =
  z.infer<
    typeof ExecutionReservationSchema
  >;
