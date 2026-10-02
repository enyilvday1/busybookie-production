import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueGenerationRecordPath,
  sanitizeDialogueProviderExecutionId,
} from "../src/dialogue/dialogueGenerationRecordPath.js";

describe(
  "Busybookie dialogue generation record paths",
  () => {
    it(
      "creates a deterministic voice-record path under the external voices namespace",
      () => {
        const result =
          createDialogueGenerationRecordPath(
            "D:/Busybookie/Production",
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-123",
          );

        expect(
          result.replaceAll(
            "\\",
            "/",
          ),
        ).toMatch(
          /D:\/Busybookie\/Production\/voices\/EP02\/S02\/EP02_SC01_S02_L01\/EP02_SC01_S02_L01_RUNWAY_task-123\.dialogue-generation\.json$/,
        );
      },
    );

    it(
      "sanitizes a provider execution id deterministically without allowing path structure",
      () => {
        expect(
          sanitizeDialogueProviderExecutionId(
            " tasks/task:123?attempt=1 ",
          ),
        ).toBe(
          "tasks_task_123_attempt_1",
        );
      },
    );

    it(
      "fails closed when the media root is not absolute",
      () => {
        expect(
          () =>
            createDialogueGenerationRecordPath(
              "relative/media",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01",
              "RUNWAY",
              "task-123",
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
            createDialogueGenerationRecordPath(
              "D:/Busybookie/Production",
              "EP02",
              "S02",
              "EP02_SC01_S03_L01",
              "RUNWAY",
              "task-123",
            ),
        ).toThrow(
          /dialogue line.*identity/i,
        );
      },
    );

    it(
      "fails closed when the provider execution id cannot produce a safe identifier",
      () => {
        expect(
          () =>
            sanitizeDialogueProviderExecutionId(
              "***",
            ),
        ).toThrow(
          /safe.*identifier|empty/i,
        );
      },
    );
  },
);
