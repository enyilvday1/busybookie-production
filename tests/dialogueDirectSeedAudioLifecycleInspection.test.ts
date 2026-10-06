import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueCompletion,
} from "../src/dialogue/dialogueCompletion.schema.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import {
  inspectDialogueDirectSeedAudioLifecycle,
  type InspectDialogueDirectSeedAudioLifecycleDependencies,
} from "../src/dialogue/inspectDialogueDirectSeedAudioLifecycle.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmissionV3,
} from "../src/dialogue/dialogueSubmission.schema.js";

const mediaRoot =
  "D:/Busybookie/Production";

const identity =
  Object.freeze({
    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",

    planKey:
      "a".repeat(
        64,
      ),
  });

const reservation =
  Object.freeze({
    marker:
      "direct-seed-audio-reservation",
  }) as unknown as
    DialogueReservation;

const submission =
  Object.freeze({
    marker:
      "direct-seed-audio-submission",
  }) as unknown as
    DialogueSubmissionV3;

const completion =
  Object.freeze({
    marker:
      "direct-seed-audio-completion",
  }) as unknown as
    DialogueCompletion;

const classification =
  Object.freeze({
    state:
      "COMPLETED",

    reservation,
    submission,
    completion,
  }) as
    DialogueLifecycleClassification;

describe(
  "BusyBookie direct SeedAudio plan-scoped lifecycle inspection",
  () => {
    it(
      "reads all three records from the selected immutable plan scope and delegates classification",
      async () => {
        const readReservation =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readReservation"
            ]
          >(
            async () =>
              reservation,
          );

        const readSubmission =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readSubmission"
            ]
          >(
            async () =>
              submission,
          );

        const readCompletion =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readCompletion"
            ]
          >(
            async () =>
              completion,
          );

        const classifyLifecycle =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "classifyLifecycle"
            ]
          >(
            () =>
              classification,
          );

        const result =
          await inspectDialogueDirectSeedAudioLifecycle(
            mediaRoot,
            identity.episodeId,
            identity.sceneId,
            identity.shotId,
            identity.dialogueLineId,
            identity.planKey,
            {
              readReservation,
              readSubmission,
              readCompletion,
              classifyLifecycle,
            },
          );

        expect(
          readReservation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readReservation,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
          identity.planKey,
        );

        expect(
          readSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readSubmission,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
          identity.planKey,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledWith(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
          identity.planKey,
        );

        expect(
          classifyLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          classifyLifecycle,
        ).toHaveBeenCalledWith({
          reservation,
          submission,
          completion,
        });

        expect(
          result,
        ).toBe(
          classification,
        );
      },
    );

    it(
      "passes missing scoped records through to the classifier unchanged",
      async () => {
        const readReservation =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readReservation"
            ]
          >(
            async () =>
              null,
          );

        const readSubmission =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readSubmission"
            ]
          >(
            async () =>
              null,
          );

        const readCompletion =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readCompletion"
            ]
          >(
            async () =>
              null,
          );

        const expected =
          Object.freeze({
            state:
              "NOTHING" as const,
          });

        const classifyLifecycle =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "classifyLifecycle"
            ]
          >(
            () =>
              expected,
          );

        const result =
          await inspectDialogueDirectSeedAudioLifecycle(
            mediaRoot,
            identity.episodeId,
            identity.sceneId,
            identity.shotId,
            identity.dialogueLineId,
            identity.planKey,
            {
              readReservation,
              readSubmission,
              readCompletion,
              classifyLifecycle,
            },
          );

        expect(
          classifyLifecycle,
        ).toHaveBeenCalledWith({
          reservation:
            null,

          submission:
            null,

          completion:
            null,
        });

        expect(
          result,
        ).toBe(
          expected,
        );
      },
    );

    it(
      "never drops or substitutes the selected plan key when reading scoped lifecycle evidence",
      async () => {
        const alternatePlanKey =
          "b".repeat(
            64,
          );

        const readReservation =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readReservation"
            ]
          >(
            async (
              _mediaRoot,
              _episodeId,
              _sceneId,
              _shotId,
              _dialogueLineId,
              receivedPlanKey,
            ) => {
              expect(
                receivedPlanKey,
              ).toBe(
                alternatePlanKey,
              );

              return null;
            },
          );

        const readSubmission =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readSubmission"
            ]
          >(
            async (
              _mediaRoot,
              _episodeId,
              _sceneId,
              _shotId,
              _dialogueLineId,
              receivedPlanKey,
            ) => {
              expect(
                receivedPlanKey,
              ).toBe(
                alternatePlanKey,
              );

              return null;
            },
          );

        const readCompletion =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "readCompletion"
            ]
          >(
            async (
              _mediaRoot,
              _episodeId,
              _sceneId,
              _shotId,
              _dialogueLineId,
              receivedPlanKey,
            ) => {
              expect(
                receivedPlanKey,
              ).toBe(
                alternatePlanKey,
              );

              return null;
            },
          );

        const classifyLifecycle =
          vi.fn<
            InspectDialogueDirectSeedAudioLifecycleDependencies[
              "classifyLifecycle"
            ]
          >(
            () =>
              Object.freeze({
                state:
                  "NOTHING" as const,
              }),
          );

        await inspectDialogueDirectSeedAudioLifecycle(
          mediaRoot,
          identity.episodeId,
          identity.sceneId,
          identity.shotId,
          identity.dialogueLineId,
          alternatePlanKey,
          {
            readReservation,
            readSubmission,
            readCompletion,
            classifyLifecycle,
          },
        );

        expect(
          readReservation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
