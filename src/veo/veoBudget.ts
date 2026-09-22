import type {
  VeoPolicy,
} from "../schemas/veoPolicy.schema.js";

export function calculateVeoExpectedCents(
  durationSeconds:
    number,

  policy:
    VeoPolicy,
): number {
  if (
    !Number.isSafeInteger(
      durationSeconds,
    ) ||
    durationSeconds <= 0
  ) {
    throw new Error(
      "Veo duration must be a positive integer.",
    );
  }

  return (
    durationSeconds *
    policy.generation
      .centsPerSecond
  );
}

export function assertVeoWithinBudget(
  durationSeconds:
    number,

  policy:
    VeoPolicy,
): number {
  const allowed =
    policy.generation
      .allowedDurationsSeconds
      .some(
        (allowedDuration) =>
          allowedDuration ===
          durationSeconds,
      );

  if (!allowed) {
    throw new Error(
      `Veo duration ${durationSeconds}s is not allowed by local policy.`,
    );
  }

  const expectedCents =
    calculateVeoExpectedCents(
      durationSeconds,
      policy,
    );

  if (
    expectedCents >
    policy.generation
      .maxCentsPerGeneration
  ) {
    throw new Error(
      `Veo expected cost ${expectedCents} cents exceeds the local ${policy.generation.maxCentsPerGeneration}-cent generation ceiling.`,
    );
  }

  return expectedCents;
}
