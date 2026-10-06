import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  runDialogueReconcileCli,
  type RunDialogueReconcileCliDependencies,
} from "../src/dialogue/cli/runDialogueReconcileCli.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const PLAN_KEY =
  "a".repeat(
    64,
  );

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

type CanonicalDialogueLine =
  Readonly<{
    dialogueLineId:
      string;

    voice:
      Readonly<{
        executionMode:
          string;
      }>;
  }>;

type CanonicalDialoguePlan =
  Readonly<{
    planKey:
      string;

    lines:
      readonly CanonicalDialogueLine[];
  }>;

type FutureReconcileCliDependencies =
  Readonly<{
    loadEnvironment:
      () =>
        Readonly<{
          BUSYBOOKIE_MEDIA_ROOT:
            string;

          RUNWAYML_API_SECRET?:
            string;
        }>;

    loadProductionRules:
      () =>
        Promise<unknown>;

    resolveMediaRoot:
      (
        env:
          unknown,

        rules:
          unknown,
      ) =>
        string;

    loadCharacterBible:
      () =>
        Promise<unknown>;

    loadEpisodeManifest:
      (
        episodeId:
          string,
      ) =>
        Promise<unknown>;

    validateEpisodeProduction:
      (
        episode:
          unknown,

        bible:
          unknown,

        rules:
          unknown,
      ) =>
        void;

    buildShotDialoguePlan:
      (
        input:
          unknown,
      ) =>
        CanonicalDialoguePlan;

    createReconciler:
      (
        credentialSource:
          Readonly<{
            RUNWAYML_API_SECRET?:
              string;
          }>,
      ) =>
        (
          input:
            Readonly<{
              mediaRoot:
                string;

              episodeId:
                string;

              sceneId:
                string;

              shotId:
                string;

              dialogueLineId:
                string;
            }>,
        ) =>
          Promise<never>;

    createDirectSeedAudioReconciler:
      (
        credentialSource:
          Readonly<{
            RUNWAYML_API_SECRET?:
              string;
          }>,
      ) =>
        (
          input:
            Readonly<{
              mediaRoot:
                string;

              episodeId:
                string;

              sceneId:
                string;

              shotId:
                string;

              dialogueLineId:
                string;

              planKey:
                string;
            }>,
        ) =>
          Promise<never>;
  }>;

function createEpisodeFixture() {
  return Object.freeze({
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
  });
}

function createHarness(
  plan:
    CanonicalDialoguePlan,
) {
  const env =
    Object.freeze({
      BUSYBOOKIE_MEDIA_ROOT:
        MEDIA_ROOT,

      RUNWAYML_API_SECRET:
        "test-runway-secret",
    });

  const rules =
    Object.freeze({
      marker:
        "production-rules",
    });

  const bible =
    Object.freeze({
      marker:
        "character-bible",
    });

  const episode =
    createEpisodeFixture();

  const loadEnvironment =
    vi.fn(
      () =>
        env,
    );

  const loadProductionRules =
    vi.fn(
      async () =>
        rules,
    );

  const resolveMediaRoot =
    vi.fn(
      (
        _env:
          unknown,

        _rules:
          unknown,
      ) =>
        MEDIA_ROOT,
    );

  const loadCharacterBible =
    vi.fn(
      async () =>
        bible,
    );

  const loadEpisodeManifest =
    vi.fn(
      async (
        episodeId:
          string,
      ) => {
        expect(
          episodeId,
        ).toBe(
          "EP02",
        );

        return episode;
      },
    );

  const validateEpisodeProduction =
    vi.fn(
      (
        receivedEpisode:
          unknown,

        receivedBible:
          unknown,

        receivedRules:
          unknown,
      ) => {
        expect(
          receivedEpisode,
        ).toBe(
          episode,
        );

        expect(
          receivedBible,
        ).toBe(
          bible,
        );

        expect(
          receivedRules,
        ).toBe(
          rules,
        );
      },
    );

  const buildShotDialoguePlan =
    vi.fn(
      (
        _input:
          unknown,
      ) =>
        plan,
    );

  let legacyInput:
    unknown;

  let directInput:
    unknown;

  const createReconciler =
    vi.fn(
      (
        _credentialSource:
          Readonly<{
            RUNWAYML_API_SECRET?:
              string;
          }>,
      ) =>
        async (
          input:
            Readonly<{
              mediaRoot:
                string;

              episodeId:
                string;

              sceneId:
                string;

              shotId:
                string;

              dialogueLineId:
                string;
            }>,
        ): Promise<never> => {
          legacyInput =
            input;

          throw new Error(
            "STOP_AFTER_LEGACY_RECONCILE_CALL",
          );
        },
    );

  const createDirectSeedAudioReconciler =
    vi.fn(
      (
        _credentialSource:
          Readonly<{
            RUNWAYML_API_SECRET?:
              string;
          }>,
      ) =>
        async (
          input:
            Readonly<{
              mediaRoot:
                string;

              episodeId:
                string;

              sceneId:
                string;

              shotId:
                string;

              dialogueLineId:
                string;

              planKey:
                string;
            }>,
        ): Promise<never> => {
          directInput =
            input;

          throw new Error(
            "STOP_AFTER_DIRECT_RECONCILE_CALL",
          );
        },
    );

  const dependencies:
    FutureReconcileCliDependencies =
      Object.freeze({
        loadEnvironment,
        loadProductionRules,
        resolveMediaRoot,
        loadCharacterBible,
        loadEpisodeManifest,
        validateEpisodeProduction,
        buildShotDialoguePlan,
        createReconciler,
        createDirectSeedAudioReconciler,
      });

  return {
    dependencies:
      dependencies as unknown as
        RunDialogueReconcileCliDependencies,

    loadCharacterBible,
    loadEpisodeManifest,
    validateEpisodeProduction,
    buildShotDialoguePlan,
    createReconciler,
    createDirectSeedAudioReconciler,

    getLegacyInput:
      () =>
        legacyInput,

    getDirectInput:
      () =>
        directInput,
  };
}

describe(
  "BusyBookie dialogue reconciliation CLI canonical-plan dispatch",
  () => {
    it(
      "derives the current planKey and routes RUNWAY_REFERENCE_AUDIO exclusively to the direct SeedAudio reconciler",
      async () => {
        const harness =
          createHarness(
            Object.freeze({
              planKey:
                PLAN_KEY,

              lines:
                Object.freeze([
                  Object.freeze({
                    dialogueLineId:
                      identity.dialogueLineId,

                    voice:
                      Object.freeze({
                        executionMode:
                          "RUNWAY_REFERENCE_AUDIO",
                      }),
                  }),
                ]),
            }),
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            harness.dependencies,
          ),
        ).rejects.toThrow(
          "STOP_AFTER_DIRECT_RECONCILE_CALL",
        );

        expect(
          harness.loadCharacterBible,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.loadEpisodeManifest,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.validateEpisodeProduction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.buildShotDialoguePlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.createDirectSeedAudioReconciler,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.createReconciler,
        ).not.toHaveBeenCalled();

        expect(
          harness.getDirectInput(),
        ).toEqual({
          mediaRoot:
            MEDIA_ROOT,

          ...identity,

          planKey:
            PLAN_KEY,
        });

        expect(
          harness.getLegacyInput(),
        ).toBeUndefined();
      },
    );

    it(
      "retains legacy reconciliation for a canonical non-reference-audio line and does not pass a planKey into the legacy reconciler",
      async () => {
        const harness =
          createHarness(
            Object.freeze({
              planKey:
                PLAN_KEY,

              lines:
                Object.freeze([
                  Object.freeze({
                    dialogueLineId:
                      identity.dialogueLineId,

                    voice:
                      Object.freeze({
                        executionMode:
                          "RUNWAY_ELEVEN_V3",
                      }),
                  }),
                ]),
            }),
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            harness.dependencies,
          ),
        ).rejects.toThrow(
          "STOP_AFTER_LEGACY_RECONCILE_CALL",
        );

        expect(
          harness.loadCharacterBible,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.loadEpisodeManifest,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.validateEpisodeProduction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.buildShotDialoguePlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.createReconciler,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.createDirectSeedAudioReconciler,
        ).not.toHaveBeenCalled();

        expect(
          harness.getLegacyInput(),
        ).toEqual({
          mediaRoot:
            MEDIA_ROOT,

          ...identity,
        });

        expect(
          harness.getDirectInput(),
        ).toBeUndefined();
      },
    );

    it(
      "fails closed before constructing either reconciler when the requested line is absent from the rebuilt canonical plan",
      async () => {
        const harness =
          createHarness(
            Object.freeze({
              planKey:
                PLAN_KEY,

              lines:
                Object.freeze([]),
            }),
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /dialogue line.*canonical.*plan|canonical.*dialogue line|line.*not found/i,
        );

        expect(
          harness.buildShotDialoguePlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.createReconciler,
        ).not.toHaveBeenCalled();

        expect(
          harness.createDirectSeedAudioReconciler,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed before constructing either reconciler when the rebuilt canonical plan contains the requested line more than once",
      async () => {
        const duplicatedLine =
          Object.freeze({
            dialogueLineId:
              identity.dialogueLineId,

            voice:
              Object.freeze({
                executionMode:
                  "RUNWAY_REFERENCE_AUDIO",
              }),
          });

        const harness =
          createHarness(
            Object.freeze({
              planKey:
                PLAN_KEY,

              lines:
                Object.freeze([
                  duplicatedLine,
                  duplicatedLine,
                ]),
            }),
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /canonical dialogue plan.*exactly one dialogue line.*found 2|multiple.*dialogue line/i,
        );

        expect(
          harness.createReconciler,
        ).not.toHaveBeenCalled();

        expect(
          harness.createDirectSeedAudioReconciler,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
