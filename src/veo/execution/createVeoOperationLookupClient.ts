import {
  createVeoClient,
} from "../createVeoClient.js";

import type {
  VeoOperationLookupClient,
} from "./resumeVeoOperation.js";

export function createVeoOperationLookupClient(
  apiKey:
    string,
): VeoOperationLookupClient {
  const client =
    createVeoClient(
      apiKey,
    );

  return Object.freeze({
    operations:
      Object.freeze({
        getVideosOperation:
          client.operations
            .getVideosOperation
            .bind(
              client.operations,
            ),
      }),
  });
}
