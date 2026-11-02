import {
  describe,
  expect,
  it,
} from "vitest";

import {
  resolve,
} from "node:path";

import {
  createVisualAttemptExecutionCompletionFileName,
  createVisualAttemptExecutionCompletionPath,
  createVisualAttemptExecutionReservationFileName,
  createVisualAttemptExecutionReservationPath,
  createVisualAttemptExecutionSubmissionFileName,
  createVisualAttemptExecutionSubmissionPath,
} from "../src/execution/visualAttemptExecutionPaths.js";

describe(
  "visual attempt execution paths",
  () => {
    const mediaRoot =
      "D:/Busybookie/Production";

    it(
      "builds deterministic attempt-2 lifecycle file names",
      () => {
        expect(
          createVisualAttemptExecutionReservationFileName(
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          "EP93_S01_a2.execution-reservation.json",
        );

        expect(
          createVisualAttemptExecutionSubmissionFileName(
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          "EP93_S01_a2.execution-submission.json",
        );

        expect(
          createVisualAttemptExecutionCompletionFileName(
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          "EP93_S01_a2.execution-completion.json",
        );
      },
    );

    it(
      "builds all attempt lifecycle paths inside the canonical shot directory",
      () => {
        expect(
          createVisualAttemptExecutionReservationPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          resolve(
            mediaRoot,
            "generated-video",
            "EP93",
            "S01",
            "EP93_S01_a2.execution-reservation.json",
          ),
        );

        expect(
          createVisualAttemptExecutionSubmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          resolve(
            mediaRoot,
            "generated-video",
            "EP93",
            "S01",
            "EP93_S01_a2.execution-submission.json",
          ),
        );

        expect(
          createVisualAttemptExecutionCompletionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          resolve(
            mediaRoot,
            "generated-video",
            "EP93",
            "S01",
            "EP93_S01_a2.execution-completion.json",
          ),
        );
      },
    );

    it(
      "rejects attempt 1 because the legacy canonical execution is immutable",
      () => {
        expect(
          () =>
            createVisualAttemptExecutionReservationFileName(
              "EP93",
              "S01",
              1,
            ),
        ).toThrow(
          "Replacement visual attempt number must be at least 2",
        );

        expect(
          () =>
            createVisualAttemptExecutionSubmissionPath(
              mediaRoot,
              "EP93",
              "S01",
              1,
            ),
        ).toThrow(
          "Replacement visual attempt number must be at least 2",
        );
      },
    );

    it(
      "rejects noncanonical episode and shot identities",
      () => {
        expect(
          () =>
            createVisualAttemptExecutionReservationFileName(
              "episode93",
              "S01",
              2,
            ),
        ).toThrow();

        expect(
          () =>
            createVisualAttemptExecutionCompletionFileName(
              "EP93",
              "shot1",
              2,
            ),
        ).toThrow();
      },
    );

    it(
      "rejects a relative media root through the shared visual-attempt directory contract",
      () => {
        expect(
          () =>
            createVisualAttemptExecutionReservationPath(
              "relative/root",
              "EP93",
              "S01",
              2,
            ),
        ).toThrow(
          "Visual attempt media root must be absolute.",
        );
      },
    );
  },
);
