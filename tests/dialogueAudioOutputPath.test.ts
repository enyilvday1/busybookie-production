import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueAudioOutputPath,
} from "../src/dialogue/dialogueAudioOutputPath.js";

describe(
  "Busybookie dialogue audio output paths",
  () => {
    it(
      "creates a deterministic opaque audio artifact path under the voices namespace",
      () => {
        const result =
          createDialogueAudioOutputPath(
            "D:/Busybookie/Production",
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-123",
            1,
          );

        expect(
          result.replaceAll(
            "\\",
            "/",
          ),
        ).toMatch(
          /D:\/Busybookie\/Production\/voices\/EP02\/S02\/EP02_SC01_S02_L01\/EP02_SC01_S02_L01_RUNWAY_task-123_01\.audio$/,
        );
      },
    );

    it(
      "sanitizes provider execution identity without allowing path structure",
      () => {
        const result =
          createDialogueAudioOutputPath(
            "D:/Busybookie/Production",
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            " tasks/task:123?attempt=1 ",
            2,
          );

        expect(
          result.replaceAll(
            "\\",
            "/",
          ),
        ).toMatch(
          /EP02_SC01_S02_L01_RUNWAY_tasks_task_123_attempt_1_02\.audio$/,
        );
      },
    );

    it(
      "fails closed when the media root is not absolute",
      () => {
        expect(
          () =>
            createDialogueAudioOutputPath(
              "relative/media",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01",
              "RUNWAY",
              "task-123",
              1,
            ),
        ).toThrow(
          /media root.*absolute/i,
        );
      },
    );

    it(
      "fails closed when the dialogue line identity belongs to a different shot",
      () => {
        expect(
          () =>
            createDialogueAudioOutputPath(
              "D:/Busybookie/Production",
              "EP02",
              "S02",
              "EP02_SC01_S03_L01",
              "RUNWAY",
              "task-123",
              1,
            ),
        ).toThrow(
          /dialogue line.*identity/i,
        );
      },
    );

    it(
      "rejects a non-positive output index",
      () => {
        expect(
          () =>
            createDialogueAudioOutputPath(
              "D:/Busybookie/Production",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01",
              "RUNWAY",
              "task-123",
              0,
            ),
        ).toThrow(
          /output index.*positive/i,
        );
      },
    );

    it(
      "rejects an unsafe integer output index",
      () => {
        expect(
          () =>
            createDialogueAudioOutputPath(
              "D:/Busybookie/Production",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01",
              "RUNWAY",
              "task-123",
              Number.MAX_SAFE_INTEGER + 1,
            ),
        ).toThrow(
          /output index.*safe integer/i,
        );
      },
    );
  },
);
