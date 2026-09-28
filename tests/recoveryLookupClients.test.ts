import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createRunwayTaskLookupClient,
} from "../src/runway/execution/createRunwayTaskLookupClient.js";

import {
  createVeoOperationLookupClient,
} from "../src/veo/execution/createVeoOperationLookupClient.js";

import {
  createVeoFileDownloadClient,
} from "../src/veo/output/createVeoFileDownloadClient.js";

describe(
  "Busybookie recovery-only provider clients",
  () => {
    it(
      "exposes only Runway task retrieval capability",
      () => {
        const client =
          createRunwayTaskLookupClient({
            RUNWAYML_API_SECRET:
              "test-runway-secret",
          });

        expect(
          Object.keys(
            client,
          ),
        ).toEqual([
          "tasks",
        ]);

        expect(
          Object.keys(
            client.tasks,
          ),
        ).toEqual([
          "retrieve",
        ]);

        expect(
          typeof client.tasks
            .retrieve,
        ).toBe(
          "function",
        );

        expect(
          "imageToVideo" in
            client,
        ).toBe(
          false,
        );
      },
    );

    it(
      "exposes only Veo operation lookup capability",
      () => {
        const client =
          createVeoOperationLookupClient(
            "test-gemini-key",
          );

        expect(
          Object.keys(
            client,
          ),
        ).toEqual([
          "operations",
        ]);

        expect(
          Object.keys(
            client.operations,
          ),
        ).toEqual([
          "getVideosOperation",
        ]);

        expect(
          typeof client
            .operations
            .getVideosOperation,
        ).toBe(
          "function",
        );

        expect(
          "models" in
            client,
        ).toBe(
          false,
        );
      },
    );

    it(
      "exposes only Veo file download capability",
      () => {
        const client =
          createVeoFileDownloadClient(
            "test-gemini-key",
          );

        expect(
          Object.keys(
            client,
          ),
        ).toEqual([
          "files",
        ]);

        expect(
          Object.keys(
            client.files,
          ),
        ).toEqual([
          "download",
        ]);

        expect(
          typeof client
            .files
            .download,
        ).toBe(
          "function",
        );

        expect(
          "models" in
            client,
        ).toBe(
          false,
        );

        expect(
          "operations" in
            client,
        ).toBe(
          false,
        );
      },
    );
  },
);
