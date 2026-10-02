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
  inspectDialogueLifecycle,
  type InspectDialogueLifecycleDependencies,
} from "../src/dialogue/inspectDialogueLifecycle.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmission,
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
  });

const reservation =
  Object.freeze({
    marker:
      "reservation",
  }) as unknown as
    DialogueReservation;

const submission =
  Object.freeze({
    marker:
      "submission",
  }) as unknown as
    DialogueSubmission;

const completion =
  Object.freeze({
    marker:
      "completion",
  }) as unknown as
    DialogueCompletion;

const classification =
  Object.freeze({
    state:
      "COMPLETED",

    reservation,

    submission,

    completion,
  }) as DialogueLifecycleClassification;

describe(
  "Busybookie dialogue lifecycle inspection",
  () => {
    it(
      "reads all three deterministic lifecycle records and delegates classification",
      async () => {
        const readReservation =
          vi.fn<
            InspectDialogueLifecycleDependencies[
              "readReservation"
            ]
          >(
            async () =>
              reservation,
          );

        const readSubmission =
          vi.fn<
            InspectDialogueLifecycleDependencies[
              "readSubmission"
            ]
          >(
            async () =>
              submission,
          );

        const readCompletion =
          vi.fn<
            InspectDialogueLifecycleDependencies[
              "readCompletion"
            ]
          >(
            async () =>
              completion,
          );

        const classifyLifecycle =
          vi.fn<
            InspectDialogueLifecycleDependencies[
              "classifyLifecycle"
            ]
          >(
            () =>
              classification,
          );

        const result =
          await inspectDialogueLifecycle(
            mediaRoot,
            identity.episodeId,
            identity.sceneId,
            identity.shotId,
            identity.dialogueLineId,
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
      "passes missing durable records through to the classifier unchanged",
      async () => {
        const readReservation =
          vi.fn<
            InspectDialogueLifecycleDependencies[
              "readReservation"
            ]
          >(
            async () =>
              null,
          );

        const readSubmission =
          vi.fn<
            InspectDialogueLifecycleDependencies[
              "readSubmission"
            ]
          >(
            async () =>
              null,
          );

        const readCompletion =
          vi.fn<
            InspectDialogueLifecycleDependencies[
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
            InspectDialogueLifecycleDependencies[
              "classifyLifecycle"
            ]
          >(
            () =>
              expected,
          );

        const result =
          await inspectDialogueLifecycle(
            mediaRoot,
            identity.episodeId,
            identity.sceneId,
            identity.shotId,
            identity.dialogueLineId,
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
  },
);
