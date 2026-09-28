import {
  createRunwayClient,
} from "../createRunwayClient.js";

import type {
  RunwayCredentialSource,
} from "../runway.types.js";

import type {
  RunwayTaskLookupClient,
} from "./resumeRunwayGen45Task.js";

export function createRunwayTaskLookupClient(
  source:
    RunwayCredentialSource,
): RunwayTaskLookupClient {
  const client =
    createRunwayClient(
      source,
    );

  return Object.freeze({
    tasks:
      Object.freeze({
        retrieve:
          client.tasks
            .retrieve
            .bind(
              client.tasks,
            ),
      }),
  });
}
