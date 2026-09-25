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
