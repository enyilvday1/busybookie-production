import { z } from "zod";

export const VisualAttemptNumberSchema =
  z.number()
    .int()
    .positive()
    .refine(
      Number.isSafeInteger,
      "Visual attempt number must be a safe positive integer.",
    );

export const VisualReplacementAttemptNumberSchema =
  VisualAttemptNumberSchema
    .refine(
      (value) => value >= 2,
      "Replacement visual attempt number must be at least 2 because attempt 1 is the immutable legacy canonical execution.",
    );

export type VisualAttemptNumber =
  z.infer<
    typeof VisualAttemptNumberSchema
  >;

export type VisualReplacementAttemptNumber =
  z.infer<
    typeof VisualReplacementAttemptNumberSchema
  >;
