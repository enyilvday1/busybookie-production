import {
  classifyExecutionLifecycle,
} from "./classifyExecutionLifecycle.js";

import type {
  ExecutionLifecycleClassification,
} from "./classifyExecutionLifecycle.js";

import {
  readExecutionCompletion,
} from "./readExecutionCompletion.js";

import {
  readExecutionReservation,
} from "./readExecutionReservation.js";

import {
  readExecutionSubmission,
} from "./readExecutionSubmission.js";

import {
  inspectGoogleGenAiExecutionLifecycle,
} from "./inspectGoogleGenAiExecutionLifecycle.js";

export async function inspectExecutionLifecycle(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,
): Promise<ExecutionLifecycleClassification> {
  const reservation =
    await readExecutionReservation(
      mediaRoot,
      episodeId,
      shotId,
    );

  // B5C-R1: the strict, exclusive durable reservation owns every later
  // record, so its provider decides the reader before any completion is
  // parsed. A Google lifecycle is read only by the existing Google inspector
  // (no manifest, version or exception-based guessing); its durable records
  // are carried through unchanged. The shared completion reader stays closed
  // to Google, and inspection never contacts a provider.
  if (
    reservation?.provider ===
    "GOOGLE_GENAI"
  ) {
    const google =
      await inspectGoogleGenAiExecutionLifecycle(
        mediaRoot,
        episodeId,
        shotId,
      );

    switch (google.state) {
      case "RESERVED_ONLY":
        return Object.freeze({
          state:
            "RESERVED_ONLY",

          reservation:
            google.reservation,
        });

      case "SUBMITTED":
        return Object.freeze({
          state:
            "SUBMITTED",

          reservation:
            google.reservation,

          submission:
            google.submission,
        });

      case "COMPLETED":
        return Object.freeze({
          state:
            "COMPLETED",

          reservation:
            google.reservation,

          submission:
            google.submission,

          completion:
            google.completion,
        });
    }
  }

  const submission =
    await readExecutionSubmission(
      mediaRoot,
      episodeId,
      shotId,
    );

  const completion =
    await readExecutionCompletion(
      mediaRoot,
      episodeId,
      shotId,
    );

  return classifyExecutionLifecycle({
    reservation,
    submission,
    completion,
  });
}
