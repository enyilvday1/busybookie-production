import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadDialogueSeedAudioPolicy,
} from "../src/validation/loadDialogueSeedAudioPolicy.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import type {
  RunwayDialogueProductionExecutionInput,
} from "../src/dialogue/createRunwayDialogueProductionExecutor.js";

import type {
  RunwayDirectSeedAudioProductionExecutionInput,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionExecutor.js";

import {
  runDialogueGenerationCli,
} from "../src/dialogue/cli/runDialogueGenerationCli.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

async function loadApprovedDialogueTestBible() {
  const bible =
    structuredClone(
      await loadCharacterBible(),
    );

  const ollie =
    bible.characters.find(
      (character) =>
        character.id ===
        "OLLIE",
    );

  if (!ollie) {
    throw new Error(
      "Expected Ollie in Character Bible.",
    );
  }

  ollie.voice = {
    selectionStatus:
      "LOCKED",

    provider:
      "RUNWAY",

    voiceName:
      "Chad",

    deliveryTraits: [
      ...ollie.voice
        .deliveryTraits,
    ],
  };

  return bible;
}

function baseDependencies(
  createExecutor:
    (
      credentialSource: {
        RUNWAYML_API_SECRET:
          string;
      },
    ) => (
      input:
        RunwayDialogueProductionExecutionInput,
    ) => Promise<never>,

  runwayApiSecret?:
    string,
) {
  return {
    loadEnvironment:
      () => ({
        BUSYBOOKIE_MEDIA_ROOT:
          MEDIA_ROOT,

        ...(
          runwayApiSecret
            ? {
                RUNWAYML_API_SECRET:
                  runwayApiSecret,
              }
            : {}
        ),
      }),

    loadProductionRules,

    loadDialogueVoicePolicy,

    loadDialogueSeedAudioPolicy,

    loadCharacterBible:
      loadApprovedDialogueTestBible,

    loadEpisodeManifest,

    validateMediaRoot:
      async () =>
        MEDIA_ROOT,

    validateEpisodeProduction:
      vi.fn(),

    createExecutor,

    createSeedAudioExecutor:
      () =>
        async (
          _input:
            RunwayDirectSeedAudioProductionExecutionInput,
        ): Promise<never> => {
          throw new Error(
            "Direct SeedAudio executor must not be selected by historical preset-voice CLI tests.",
          );
        },
  };
}

describe(
  "Busybookie dialogue generation CLI",
  () => {
    it(
      "performs a complete dry-run preflight without requiring credentials or creating a production executor",
      async () => {
        const createExecutor =
          vi.fn(
            () =>
              async (
                _input:
                  RunwayDialogueProductionExecutionInput,
              ): Promise<never> => {
                throw new Error(
                  "Dry run must not execute paid dialogue generation.",
                );
              },
          );

        const log =
          vi.spyOn(
            console,
            "log",
          )
            .mockImplementation(
              () => undefined,
            );

        try {
          await expect(
            runDialogueGenerationCli(
              [
                "--episode",
                "EP02",

                "--scene",
                "SC01",

                "--shot",
                "S02",

                "--line",
                "EP02_SC01_S02_L01",
              ],
              baseDependencies(
                createExecutor,
              ),
            ),
          ).resolves.toBeUndefined();

          expect(
            createExecutor,
          ).not.toHaveBeenCalled();

          const output =
            log.mock.calls
              .flat()
              .join(
                "\n",
              );

          expect(
            output,
          ).toContain(
            "EP02_SC01_S02_L01",
          );

          expect(
            output,
          ).toContain(
            "Look what I found!",
          );

          expect(
            output,
          ).toContain(
            "RUNWAY",
          );

          expect(
            output,
          ).toContain(
            "eleven_v3",
          );

          expect(
            output,
          ).toMatch(
            /DRY RUN ONLY/i,
          );
        } finally {
          log.mockRestore();
        }
      },
    );

    it(
      "creates the paid executor only after explicit confirmation and forwards the canonical plan identity",
      async () => {
        let capturedInput:
          RunwayDialogueProductionExecutionInput |
          undefined;

        const createExecutor =
          vi.fn(
            (
              _credentialSource: {
                RUNWAYML_API_SECRET:
                  string;
              },
            ) =>
              async (
                input:
                  RunwayDialogueProductionExecutionInput,
              ): Promise<never> => {
                capturedInput =
                  input;

                throw new Error(
                  "STOP_AFTER_EXECUTOR_CALL",
                );
              },
          );

        const log =
          vi.spyOn(
            console,
            "log",
          )
            .mockImplementation(
              () => undefined,
            );

        try {
          await expect(
            runDialogueGenerationCli(
              [
                "--episode",
                "EP02",

                "--scene",
                "SC01",

                "--shot",
                "S02",

                "--line",
                "EP02_SC01_S02_L01",

                "--confirm-paid-generation",
              ],
              baseDependencies(
                createExecutor,
                "test-runway-secret",
              ),
            ),
          ).rejects.toThrow(
            "STOP_AFTER_EXECUTOR_CALL",
          );

          expect(
            createExecutor,
          ).toHaveBeenCalledTimes(
            1,
          );

          expect(
            createExecutor,
          ).toHaveBeenCalledWith({
            RUNWAYML_API_SECRET:
              "test-runway-secret",
          });

          expect(
            capturedInput,
          ).toBeDefined();

          expect(
            capturedInput,
          ).toMatchObject({
            mediaRoot:
              MEDIA_ROOT,

            dialogueLineId:
              "EP02_SC01_S02_L01",

            confirmPaidGeneration:
              true,

            plan: {
              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",
            },
          });

          expect(
            capturedInput
              ?.plan
              .lines,
          ).toHaveLength(
            1,
          );

          expect(
            capturedInput
              ?.plan
              .lines[0],
          ).toMatchObject({
            dialogueLineId:
              "EP02_SC01_S02_L01",

            characterId:
              "OLLIE",

            text:
              "Look what I found!",

            voice: {
              provider:
                "RUNWAY",

              voiceName:
                "Chad",
            },
          });
        } finally {
          log.mockRestore();
        }
      },
    );

    it(
      "blocks paid execution when the Runway credential is absent without creating an executor",
      async () => {
        const createExecutor =
          vi.fn(
            () =>
              async (
                _input:
                  RunwayDialogueProductionExecutionInput,
              ): Promise<never> => {
                throw new Error(
                  "Executor must not be created without credentials.",
                );
              },
          );

        const log =
          vi.spyOn(
            console,
            "log",
          )
            .mockImplementation(
              () => undefined,
            );

        try {
          await expect(
            runDialogueGenerationCli(
              [
                "--episode",
                "EP02",

                "--scene",
                "SC01",

                "--shot",
                "S02",

                "--line",
                "EP02_SC01_S02_L01",

                "--confirm-paid-generation",
              ],
              baseDependencies(
                createExecutor,
              ),
            ),
          ).rejects.toThrow(
            /RUNWAYML_API_SECRET.*not configured/i,
          );

          expect(
            createExecutor,
          ).not.toHaveBeenCalled();
        } finally {
          log.mockRestore();
        }
      },
    );
  },
);
