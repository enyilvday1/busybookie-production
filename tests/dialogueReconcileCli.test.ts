import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import type {
  RunwayCredentialSource,
} from "../src/runway/runway.types.js";

import type {
  RunwayDialogueProductionReconciliationInput,
  RunwayDialogueProductionReconciler,
} from "../src/dialogue/createRunwayDialogueProductionReconciler.js";

import {
  runDialogueReconcileCli,
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

describe(
  "Busybookie dialogue reconciliation CLI",
  () => {
    it(
      "does not require a Runway credential at the CLI boundary and forwards only durable identity plus media root",
      async () => {
        let capturedCredentialSource:
          RunwayCredentialSource |
          undefined;

        let capturedInput:
          RunwayDialogueProductionReconciliationInput |
          undefined;

        const createReconciler =
          vi.fn(
            (
              credentialSource:
                RunwayCredentialSource,
            ): RunwayDialogueProductionReconciler => {
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
            {
              loadEnvironment:
                () => ({
                  BUSYBOOKIE_MEDIA_ROOT:
                    MEDIA_ROOT,
                }),

              loadProductionRules,

              resolveMediaRoot:
                () =>
                  MEDIA_ROOT,

              createReconciler,
            },
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
      "passes the configured Runway credential source through unchanged for same-task recovery",
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
          vi.fn(
            (
              suppliedCredentialSource:
                RunwayCredentialSource,
            ): RunwayDialogueProductionReconciler => {
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
            {
              loadEnvironment:
                () =>
                  credentialSource,

              loadProductionRules,

              resolveMediaRoot:
                () =>
                  MEDIA_ROOT,

              createReconciler,
            },
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
          vi.fn(
            (
              _credentialSource:
                RunwayCredentialSource,
            ): RunwayDialogueProductionReconciler =>
              async () => {
                throw new Error(
                  "Reconciler must not run.",
                );
              },
          );

        await expect(
          runDialogueReconcileCli(
            CLI_ARGS,
            {
              loadEnvironment:
                () => ({
                  BUSYBOOKIE_MEDIA_ROOT:
                    MEDIA_ROOT,
                }),

              loadProductionRules,

              resolveMediaRoot:
                () => {
                  throw new Error(
                    "INVALID_MEDIA_ROOT",
                  );
                },

              createReconciler,
            },
          ),
        ).rejects.toThrow(
          "INVALID_MEDIA_ROOT",
        );

        expect(
          createReconciler,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
