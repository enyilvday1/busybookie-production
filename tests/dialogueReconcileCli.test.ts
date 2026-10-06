import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  RunwayCredentialSource,
} from "../src/runway/runway.types.js";

import type {
  RunwayDialogueProductionReconciliationInput,
  RunwayDialogueProductionReconciler,
} from "../src/dialogue/createRunwayDialogueProductionReconciler.js";

import type {
  RunwayDirectSeedAudioProductionReconciler,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionReconciler.js";

import {
  runDialogueReconcileCli,
  type RunDialogueReconcileCliDependencies,
} from "../src/dialogue/cli/runDialogueReconcileCli.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const CLI_ARGS = [
  "--episode",
  "EP02",

  "--scene",
  "SC01",

  "--shot",
  "S02",

  "--line",
  "EP02_SC01_S02_L01",
] as const;

const canonicalEpisode =
  Object.freeze({
    episodeId:
      "EP02",

    scenes:
      Object.freeze([
        Object.freeze({
          id:
            "SC01",

          shots:
            Object.freeze([
              Object.freeze({
                id:
                  "S02",
              }),
            ]),
        }),
      ]),
  }) as unknown as
    Awaited<
      ReturnType<
        RunDialogueReconcileCliDependencies[
          "loadEpisodeManifest"
        ]
      >
    >;

const canonicalBible =
  Object.freeze({
    marker:
      "character-bible",
  }) as unknown as
    Awaited<
      ReturnType<
        RunDialogueReconcileCliDependencies[
          "loadCharacterBible"
        ]
      >
    >;

const canonicalRules =
  Object.freeze({
    marker:
      "production-rules",
  }) as unknown as
    Awaited<
      ReturnType<
        RunDialogueReconcileCliDependencies[
          "loadProductionRules"
        ]
      >
    >;

const canonicalPlan =
  Object.freeze({
    planKey:
      "a".repeat(
        64,
      ),

    lines:
      Object.freeze([
        Object.freeze({
          dialogueLineId:
            "EP02_SC01_S02_L01",

          voice:
            Object.freeze({
              provider:
                "RUNWAY",

              voiceName:
                "Legacy Test Voice",

              deliveryTraits:
                Object.freeze([]),
            }),
        }),
      ]),
  }) as unknown as
    ReturnType<
      RunDialogueReconcileCliDependencies[
        "buildShotDialoguePlan"
      ]
    >;

function createBaseDependencies(
  overrides:
    Partial<
      RunDialogueReconcileCliDependencies
    > = {},
): RunDialogueReconcileCliDependencies {
  const createDirectSeedAudioReconciler =
    vi.fn<
      RunDialogueReconcileCliDependencies[
        "createDirectSeedAudioReconciler"
      ]
    >(
      (
        _credentialSource:
          RunwayCredentialSource,
      ):
        RunwayDirectSeedAudioProductionReconciler =>
          async () => {
            throw new Error(
              "Direct SeedAudio reconciler must not run for the legacy fixture.",
            );
          },
    );

  return {
    loadEnvironment:
      () => ({
        BUSYBOOKIE_MEDIA_ROOT:
          MEDIA_ROOT,
      }),

    loadProductionRules:
      async () =>
        canonicalRules,

    loadCharacterBible:
      async () =>
        canonicalBible,

    loadEpisodeManifest:
      async () =>
        canonicalEpisode,

    validateEpisodeProduction:
      () => undefined,

    resolveMediaRoot:
      () =>
        MEDIA_ROOT,

    buildShotDialoguePlan:
      () =>
        canonicalPlan,

    createReconciler:
      (
        _credentialSource:
          RunwayCredentialSource,
      ):
        RunwayDialogueProductionReconciler =>
          async () => {
            throw new Error(
              "Legacy reconciler fixture was not overridden.",
            );
          },

    createDirectSeedAudioReconciler,

    ...overrides,
  };
}

describe(
  "Busybookie dialogue reconciliation CLI",
  () => {
    it(
      "does not require a Runway credential at the CLI boundary and forwards only canonical durable identity plus media root to the legacy reconciler",
      async () => {
        let capturedCredentialSource:
          RunwayCredentialSource |
          undefined;

        let capturedInput:
          RunwayDialogueProductionReconciliationInput |
          undefined;

        const createReconciler =
          vi.fn<
            RunDialogueReconcileCliDependencies[
              "createReconciler"
            ]
          >(
            (
              credentialSource:
                RunwayCredentialSource,
            ):
              RunwayDialogueProductionReconciler => {
              capturedCredentialSource =
                credentialSource;

              return async (
                input,
              ) => {
                capturedInput =
                  input;

                throw new Error(
                  "STOP_AFTER_RECONCILE_CALL",
                );
              };
            },
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            createBaseDependencies({
              createReconciler,
            }),
          ),
        ).rejects.toThrow(
          "STOP_AFTER_RECONCILE_CALL",
        );

        expect(
          createReconciler,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          capturedCredentialSource,
        ).toEqual({});

        expect(
          capturedCredentialSource
            ?.RUNWAYML_API_SECRET,
        ).toBeUndefined();

        expect(
          capturedInput,
        ).toEqual({
          mediaRoot:
            MEDIA_ROOT,

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialogueLineId:
            "EP02_SC01_S02_L01",
        });
      },
    );

    it(
      "passes the configured Runway credential source through unchanged for same-task legacy recovery",
      async () => {
        const credentialSource =
          Object.freeze({
            BUSYBOOKIE_MEDIA_ROOT:
              MEDIA_ROOT,

            RUNWAYML_API_SECRET:
              "test-runway-secret",
          });

        let capturedCredentialSource:
          RunwayCredentialSource |
          undefined;

        const createReconciler =
          vi.fn<
            RunDialogueReconcileCliDependencies[
              "createReconciler"
            ]
          >(
            (
              suppliedCredentialSource:
                RunwayCredentialSource,
            ):
              RunwayDialogueProductionReconciler => {
              capturedCredentialSource =
                suppliedCredentialSource;

              return async () => {
                throw new Error(
                  "STOP_AFTER_RECONCILE_CALL",
                );
              };
            },
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            createBaseDependencies({
              loadEnvironment:
                () =>
                  credentialSource,

              createReconciler,
            }),
          ),
        ).rejects.toThrow(
          "STOP_AFTER_RECONCILE_CALL",
        );

        expect(
          capturedCredentialSource
            ?.RUNWAYML_API_SECRET,
        ).toBe(
          "test-runway-secret",
        );
      },
    );

    it(
      "fails before preparing reconciliation capability when media-root validation fails",
      async () => {
        const createReconciler =
          vi.fn<
            RunDialogueReconcileCliDependencies[
              "createReconciler"
            ]
          >(
            (
              _credentialSource:
                RunwayCredentialSource,
            ):
              RunwayDialogueProductionReconciler =>
                async () => {
                  throw new Error(
                    "Reconciler must not run.",
                  );
                },
          );

        const createDirectSeedAudioReconciler =
          vi.fn<
            RunDialogueReconcileCliDependencies[
              "createDirectSeedAudioReconciler"
            ]
          >();

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            createBaseDependencies({
              resolveMediaRoot:
                () => {
                  throw new Error(
                    "INVALID_MEDIA_ROOT",
                  );
                },

              createReconciler,

              createDirectSeedAudioReconciler,
            }),
          ),
        ).rejects.toThrow(
          "INVALID_MEDIA_ROOT",
        );

        expect(
          createReconciler,
        ).not.toHaveBeenCalled();

        expect(
          createDirectSeedAudioReconciler,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
