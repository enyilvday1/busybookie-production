import type {
  RunwayPolicy,
} from "../schemas/runwayPolicy.schema.js";

export function calculateGen45Credits(
  durationSeconds: number,
  policy: RunwayPolicy,
): number {
  if (
    !Number.isInteger(
      durationSeconds,
    ) ||
    durationSeconds < 2 ||
    durationSeconds > 10
  ) {
    throw new Error(
      "Gen-4.5 duration must be an integer from 2 to 10 seconds.",
    );
  }

  return (
    durationSeconds *
    policy.gen45.creditsPerSecond
  );
}

export function assertGen45WithinBudget(
  durationSeconds: number,
  policy: RunwayPolicy,
): number {
  if (
    durationSeconds >
    policy.gen45.maxDurationSeconds
  ) {
    throw new Error(
      `Runway generation blocked: requested ${durationSeconds}s exceeds the local ${policy.gen45.maxDurationSeconds}s Gen-4.5 duration limit.`,
    );
  }

  const expectedCredits =
    calculateGen45Credits(
      durationSeconds,
      policy,
    );

  if (
    expectedCredits >
    policy.gen45.maxCreditsPerGeneration
  ) {
    throw new Error(
      `Runway generation blocked: locally calculated cost is ${expectedCredits} credits, exceeding the ${policy.gen45.maxCreditsPerGeneration}-credit limit.`,
    );
  }

  return expectedCredits;
}
