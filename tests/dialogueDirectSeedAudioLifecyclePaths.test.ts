import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueCompletionPath,
} from "../src/dialogue/dialogueCompletionPath.js";
import {
  createDialogueReservationPath,
} from "../src/dialogue/dialogueReservationPath.js";
import {
  createDialogueSubmissionPath,
} from "../src/dialogue/dialogueSubmissionPath.js";

import {
  readFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  createDialogueDirectSeedAudioCompletionPath,
  createDialogueDirectSeedAudioLineDirectory,
  createDialogueDirectSeedAudioReservationPath,
  createDialogueDirectSeedAudioSubmissionPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const EPISODE_ID =
  "EP02";

const SCENE_ID =
  "SC01";

const SHOT_ID =
  "S02";

const DIALOGUE_LINE_ID =
  "EP02_SC01_S02_L01";

const PLAN_KEY =
  "3f94f116370e8b91036ce01d1122ccafcdd3d7ba84379f9a4b36db7113356a57";

function normalize(
  value: string,
): string {
  return value.replaceAll(
    "\\",
    "/",
  );
}

describe(
  "BusyBookie direct SeedAudio plan-scoped lifecycle paths",
  () => {
    it(
      "places direct SeedAudio lifecycle receipts under an immutable plan-scoped namespace",
      () => {
        const lifecycleRoot =
          `${MEDIA_ROOT}/voices/${EPISODE_ID}/${SHOT_ID}/${DIALOGUE_LINE_ID}/direct-seed-audio/${PLAN_KEY}`;

        expect(
          normalize(
            createDialogueDirectSeedAudioReservationPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
              PLAN_KEY,
            ),
          ),
        ).toBe(
          `${lifecycleRoot}/${DIALOGUE_LINE_ID}.dialogue-reservation.json`,
        );

        expect(
          normalize(
            createDialogueDirectSeedAudioSubmissionPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
              PLAN_KEY,
            ),
          ),
        ).toBe(
          `${lifecycleRoot}/${DIALOGUE_LINE_ID}.dialogue-submission.json`,
        );

        expect(
          normalize(
            createDialogueDirectSeedAudioCompletionPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
              PLAN_KEY,
            ),
          ),
        ).toBe(
          `${lifecycleRoot}/${DIALOGUE_LINE_ID}.dialogue-completion.json`,
        );
      },
    );

    it(
      "does not collide with the historical singleton dialogue lifecycle paths",
      () => {
        const directReservation =
          normalize(
            createDialogueDirectSeedAudioReservationPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
              PLAN_KEY,
            ),
          );

        const directSubmission =
          normalize(
            createDialogueDirectSeedAudioSubmissionPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
              PLAN_KEY,
            ),
          );

        const directCompletion =
          normalize(
            createDialogueDirectSeedAudioCompletionPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
              PLAN_KEY,
            ),
          );

        const historicalReservation =
          normalize(
            createDialogueReservationPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
            ),
          );

        const historicalSubmission =
          normalize(
            createDialogueSubmissionPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
            ),
          );

        const historicalCompletion =
          normalize(
            createDialogueCompletionPath(
              MEDIA_ROOT,
              EPISODE_ID,
              SCENE_ID,
              SHOT_ID,
              DIALOGUE_LINE_ID,
            ),
          );

        expect(
          directReservation,
        ).not.toBe(
          historicalReservation,
        );

        expect(
          directSubmission,
        ).not.toBe(
          historicalSubmission,
        );

        expect(
          directCompletion,
        ).not.toBe(
          historicalCompletion,
        );

        expect(
          historicalReservation,
        ).toBe(
          `${MEDIA_ROOT}/voices/${EPISODE_ID}/${SHOT_ID}/${DIALOGUE_LINE_ID}/${DIALOGUE_LINE_ID}.dialogue-reservation.json`,
        );

        expect(
          historicalSubmission,
        ).toBe(
          `${MEDIA_ROOT}/voices/${EPISODE_ID}/${SHOT_ID}/${DIALOGUE_LINE_ID}/${DIALOGUE_LINE_ID}.dialogue-submission.json`,
        );

        expect(
          historicalCompletion,
        ).toBe(
          `${MEDIA_ROOT}/voices/${EPISODE_ID}/${SHOT_ID}/${DIALOGUE_LINE_ID}/${DIALOGUE_LINE_ID}.dialogue-completion.json`,
        );
      },
    );

    it(
      "resolves one line's direct SeedAudio directory without a planKey, as the parent of every plan directory",
      () => {
        const lineDirectory =
          createDialogueDirectSeedAudioLineDirectory(
            MEDIA_ROOT,
            EPISODE_ID,
            SCENE_ID,
            SHOT_ID,
            DIALOGUE_LINE_ID,
          );

        expect(
          normalize(
            lineDirectory,
          ),
        ).toBe(
          `${MEDIA_ROOT}/voices/${EPISODE_ID}/${SHOT_ID}/${DIALOGUE_LINE_ID}/direct-seed-audio`,
        );

        expect(
          dirname(
            dirname(
              createDialogueDirectSeedAudioReservationPath(
                MEDIA_ROOT,
                EPISODE_ID,
                SCENE_ID,
                SHOT_ID,
                DIALOGUE_LINE_ID,
                PLAN_KEY,
              ),
            ),
          ),
        ).toBe(
          lineDirectory,
        );

        expect(
          createDialogueDirectSeedAudioLineDirectory(
            `  ${MEDIA_ROOT}  `,
            EPISODE_ID,
            SCENE_ID,
            SHOT_ID,
            DIALOGUE_LINE_ID,
          ),
        ).toBe(
          lineDirectory,
        );
      },
    );

    it.each([
      [
        "empty media root",
        ["   ", EPISODE_ID, SCENE_ID, SHOT_ID, DIALOGUE_LINE_ID],
        /media root is required/,
      ],
      [
        "relative media root",
        ["relative/media", EPISODE_ID, SCENE_ID, SHOT_ID, DIALOGUE_LINE_ID],
        /media root must be absolute/,
      ],
      [
        "invalid episode id",
        [MEDIA_ROOT, "../EP02", SCENE_ID, SHOT_ID, DIALOGUE_LINE_ID],
        /episode id/,
      ],
      [
        "invalid scene id",
        [MEDIA_ROOT, EPISODE_ID, "SC1", SHOT_ID, DIALOGUE_LINE_ID],
        /scene id/,
      ],
      [
        "invalid shot id",
        [MEDIA_ROOT, EPISODE_ID, SCENE_ID, "..", DIALOGUE_LINE_ID],
        /shot id/,
      ],
      [
        "path-traversal line id",
        [MEDIA_ROOT, EPISODE_ID, SCENE_ID, SHOT_ID, "../EP02_SC01_S02_L01"],
        /line id/,
      ],
      [
        "line identity of another shot",
        [MEDIA_ROOT, EPISODE_ID, SCENE_ID, SHOT_ID, "EP02_SC01_S03_L01"],
        /line identity does not match/,
      ],
    ] as const)(
      "rejects a %s for the line directory",
      (
        _label,
        args,
        message,
      ) => {
        expect(
          () =>
            createDialogueDirectSeedAudioLineDirectory(
              args[0],
              args[1],
              args[2],
              args[3],
              args[4],
            ),
        ).toThrow(
          message,
        );
      },
    );

    it(
      "keeps the line directory helper free of filesystem access",
      async () => {
        const source =
          await readFile(
            new URL(
              "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.ts",
              import.meta.url,
            ),
            "utf8",
          );

        expect(
          source,
        ).not.toMatch(
          /node:fs|readdir|writeFile|mkdir|\bstat\(/,
        );
      },
    );
  },
);
