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
  createDialogueDirectSeedAudioCompletionPath,
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
  },
);
