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
  type RunDialogueGenerationCliDependencies,
} from "../src/dialogue/cli/runDialogueGenerationCli.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const FFPROBE_EXECUTABLE =
  "C:/tools/ffprobe.exe";

async function loadReferenceAudioBible() {
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

  if (
    !(
      "executionMode" in
        ollie.voice
    ) ||
    ollie.voice.executionMode !==
      "RUNWAY_REFERENCE_AUDIO"
  ) {
    throw new Error(
      "Expected canonical Ollie voice to be RUNWAY_REFERENCE_AUDIO.",
    );
  }

  return bible;
}

function createDependencies(
  createPresetExecutor:
    (
      credentialSource: {
        RUNWAYML_API_SECRET:
          string;
      },
    ) => (
      input:
        RunwayDialogueProductionExecutionInput,
    ) => Promise<never>,

  createSeedAudioExecutor:
    (
      credentialSource: {
        RUNWAYML_API_SECRET:
          string;
      },
    ) => (
      input:
        RunwayDirectSeedAudioProductionExecutionInput,
    ) => Promise<never>,

  confirmPaidGeneration:
    boolean,
) {
  const loadSeedAudioPolicy =
    vi.fn(
      loadDialogueSeedAudioPolicy,
    );

  const dependencies = {
    loadEnvironment:
      () => ({
        BUSYBOOKIE_MEDIA_ROOT:
          MEDIA_ROOT,

        BUSYBOOKIE_FFPROBE_PATH:
          FFPROBE_EXECUTABLE,

        ...(
          confirmPaidGeneration
            ? {
                RUNWAYML_API_SECRET:
                  "test-runway-secret",
              }
            : {}
        ),
      }),

    loadProductionRules,

    loadDialogueVoicePolicy,

    loadDialogueSeedAudioPolicy:
      loadSeedAudioPolicy,

    loadCharacterBible:
      loadReferenceAudioBible,

    loadEpisodeManifest,

    validateMediaRoot:
      async () =>
        MEDIA_ROOT,

    validateEpisodeProduction:
      vi.fn(),

    createExecutor:
      createPresetExecutor,

    createSeedAudioExecutor,
  };

  return {
    dependencies:
      dependencies as unknown as
        RunDialogueGenerationCliDependencies,

    loadSeedAudioPolicy,
  };
}

describe(
  "BusyBookie dialogue generation CLI direct SeedAudio routing",
  () => {
    it(
      "performs reference-audio dry-run preflight as seed_audio without creating either paid executor",
      async () => {
        const createPresetExecutor =
          vi.fn(
            () =>
              async (
                _input:
                  RunwayDialogueProductionExecutionInput,
              ): Promise<never> => {
                throw new Error(
                  "Preset executor must not run for reference-audio dry-run.",
                );
              },
          );

        const createSeedAudioExecutor =
          vi.fn(
            () =>
              async (
                _input:
                  RunwayDirectSeedAudioProductionExecutionInput,
              ): Promise<never> => {
                throw new Error(
                  "SeedAudio executor must not run during dry-run.",
                );
              },
          );

        const {
          dependencies,
          loadSeedAudioPolicy,
        } =
          createDependencies(
            createPresetExecutor,
            createSeedAudioExecutor,
            false,
          );

        const log =
          vi.spyOn(
            console,
            "log",
          )
            .mockImplementation(
              () =>
                undefined,
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
              dependencies,
            ),
          ).resolves.toBeUndefined();

          expect(
            loadSeedAudioPolicy,
          ).toHaveBeenCalledTimes(
            1,
          );

          expect(
            createPresetExecutor,
          ).not.toHaveBeenCalled();

          expect(
            createSeedAudioExecutor,
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
            "seed_audio",
          );

          expect(
            output,
          ).toContain(
            "30",
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
      "routes confirmed reference-audio generation only to the direct SeedAudio executor with canonical runtime policy inputs",
      async () => {
        let capturedInput:
          RunwayDirectSeedAudioProductionExecutionInput |
          undefined;

        const createPresetExecutor =
          vi.fn(
            () =>
              async (
                _input:
                  RunwayDialogueProductionExecutionInput,
              ): Promise<never> => {
                throw new Error(
                  "Historical Eleven executor must not be selected for RUNWAY_REFERENCE_AUDIO.",
                );
              },
          );

        const createSeedAudioExecutor =
          vi.fn(
            (
              _credentialSource: {
                RUNWAYML_API_SECRET:
                  string;
              },
            ) =>
              async (
                input:
                  RunwayDirectSeedAudioProductionExecutionInput,
              ): Promise<never> => {
                capturedInput =
                  input;

                throw new Error(
                  "STOP_AFTER_SEEDAUDIO_EXECUTOR_CALL",
                );
              },
          );

        const {
          dependencies,
          loadSeedAudioPolicy,
        } =
          createDependencies(
            createPresetExecutor,
            createSeedAudioExecutor,
            true,
          );

        const log =
          vi.spyOn(
            console,
            "log",
          )
            .mockImplementation(
              () =>
                undefined,
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
              dependencies,
            ),
          ).rejects.toThrow(
            "STOP_AFTER_SEEDAUDIO_EXECUTOR_CALL",
          );

          expect(
            loadSeedAudioPolicy,
          ).toHaveBeenCalledTimes(
            1,
          );

          expect(
            createPresetExecutor,
          ).not.toHaveBeenCalled();

          expect(
            createSeedAudioExecutor,
          ).toHaveBeenCalledTimes(
            1,
          );

          expect(
            createSeedAudioExecutor,
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

            ffprobeExecutable:
              FFPROBE_EXECUTABLE,

            localCreditCeiling:
              30,

            waitTimeoutMs:
              600_000,

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
              selectionStatus:
                "LOCKED",

              provider:
                "RUNWAY",

              executionMode:
                "RUNWAY_REFERENCE_AUDIO",

              referenceAudio: {
                assetId:
                  "OLLIE_VOICE_REFERENCE_V1",
              },
            },
          });
        } finally {
          log.mockRestore();
        }
      },
    );
  },
);
