import {
  join,
} from "node:path";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CreateExecutionCompletionResult,
} from "../src/execution/createExecutionCompletion.js";

import type {
  CreateExecutionReservationResult,
} from "../src/execution/createExecutionReservation.js";

import type {
  CreateExecutionSubmissionResult,
} from "../src/execution/createExecutionSubmission.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import type {
  ExecutionCompletionInput,
} from "../src/execution/executionCompletion.schema.js";

import type {
  ExecutionReservationInput,
} from "../src/execution/executionReservation.schema.js";

import type {
  ExecutionSubmissionInput,
} from "../src/execution/executionSubmission.schema.js";

import type {
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
} from "../src/execution/singleShotExecution.types.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

describe(
  "Busybookie single-shot durable lifecycle",
  () => {
    it(
      "persists SUBMITTED at provider acceptance and COMPLETED before returning success",
      async () => {
        const [
          episode,
          bible,
          rules,
          policy,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP90",
            ),

            loadCharacterBible(),

            loadProductionRules(),

            loadProviderRoutingPolicy(),
          ]);

        const mediaRoot =
          "D:/Busybookie/Production";

        const events:
          string[] = [];

        const createReservation =
          vi.fn(
            async (
              root:
                string,

              input:
                ExecutionReservationInput,
            ): Promise<
              CreateExecutionReservationResult
            > => {
              events.push(
                "reservation",
              );

              return {
                record: {
                  schemaVersion:
                    "1.0",

                  reservationId:
                    "11111111-1111-4111-8111-111111111111",

                  reservedAt:
                    "2026-09-24T20:30:00.000Z",

                  status:
                    "RESERVED",

                  episodeId:
                    input.episodeId,

                  shotId:
                    input.shotId,

                  provider:
                    input.provider,
                },

                reservationPath:
                  join(
                    root,
                    "generated-video",
                    input.episodeId,
                    input.shotId,
                    `${input.episodeId}_${input.shotId}.execution-reservation.json`,
                  ),
              };
            },
          );

        const createSubmission =
          vi.fn(
            async (
              root:
                string,

              input:
                ExecutionSubmissionInput,
            ): Promise<
              CreateExecutionSubmissionResult
            > => {
              events.push(
                "submission",
              );

              return {
                record: {
                  schemaVersion:
                    "1.0",

                  submittedAt:
                    "2026-09-24T20:31:00.000Z",

                  status:
                    "SUBMITTED",

                  reservationId:
                    input.reservationId,

                  episodeId:
                    input.episodeId,

                  shotId:
                    input.shotId,

                  provider:
                    input.provider,

                  providerExecutionId:
                    input.providerExecutionId,
                },

                submissionPath:
                  join(
                    root,
                    "generated-video",
                    input.episodeId,
                    input.shotId,
                    `${input.episodeId}_${input.shotId}.execution-submission.json`,
                  ),
              };
            },
          );

        const createCompletion =
          vi.fn(
            async (
              root:
                string,

              input:
                ExecutionCompletionInput,
            ): Promise<
              CreateExecutionCompletionResult
            > => {
              events.push(
                "completion",
              );

              return {
                record: {
                  schemaVersion:
                    "1.0",

                  completedAt:
                    "2026-09-24T20:32:00.000Z",

                  status:
                    "COMPLETED",

                  reservationId:
                    input.reservationId,

                  episodeId:
                    input.episodeId,

                  shotId:
                    input.shotId,

                  provider:
                    input.provider,

                  providerExecutionId:
                    input.providerExecutionId,

                  generationRecordPath:
                    input.generationRecordPath,
                },

                completionPath:
                  join(
                    root,
                    "generated-video",
                    input.episodeId,
                    input.shotId,
                    `${input.episodeId}_${input.shotId}.execution-completion.json`,
                  ),
              };
            },
          );

        const executeRunway =
          vi.fn(
            async (
              input:
                SingleShotProviderExecutionInput,
            ): Promise<
              SingleShotProviderExecutionResult
            > => {
              events.push(
                "provider-accepted",
              );

              const acceptanceHook =
                Reflect.get(
                  input,
                  "onSubmissionAccepted",
                );

              if (
                typeof acceptanceHook !==
                "function"
              ) {
                throw new Error(
                  "Provider acceptance hook is missing.",
                );
              }

              await acceptanceHook({
                provider:
                  "RUNWAY",

                providerExecutionId:
                  "mock-runway-task-1",

                providerEstimatedCredits:
                  60,

                recoveryMetadata: {
                  request: {
                    durationSeconds:
                      5,

                    ratio:
                      "1280:720",

                    outputFormat:
                      "mp4",

                    promptText:
                      "Busybookie durable recovery persistence test.",

                    sourceImagePath:
                      join(
                        input.mediaRoot,
                        "references",
                        "test-reference.png",
                      ),

                    assetStrategy:
                      "DATA_URI",
                  },

                  locallyExpectedCredits:
                    60,
                },
              });

              events.push(
                "provider-complete",
              );

              return {
                providerExecutionId:
                  "mock-runway-task-1",

                recordPath:
                  join(
                    input.mediaRoot,
                    "generated-video",
                    input.episode
                      .episodeId,
                    input.shot.id,
                    "EP90_S01_mock-runway-task-1.runway-generation.json",
                  ),
              };
            },
          );

        const executeVeo =
          vi.fn(
            async (
              _input:
                SingleShotProviderExecutionInput,
            ): Promise<
              SingleShotProviderExecutionResult
            > => {
              throw new Error(
                "Unexpected Veo dispatch.",
              );
            },
          );

        const dependencies = {
          createReservation,
          createSubmission,
          createCompletion,
          executeRunway,
          executeVeo,
        };

        const result =
          await executeSingleShot(
            {
              episode,

              shotId:
                "S01",

              bible,
              rules,
              policy,

              mediaRoot,

              sourceImagePath:
                join(
                  mediaRoot,
                  "references",
                  "test-reference.png",
                ),

              confirmPaidGeneration:
                true,
            },
            dependencies,
          );

        expect(
          events,
        ).toEqual([
          "reservation",
          "provider-accepted",
          "submission",
          "provider-complete",
          "completion",
        ]);

        expect(
          createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createSubmission,
        ).toHaveBeenCalledWith(
          mediaRoot,
          {
            reservationId:
              "11111111-1111-4111-8111-111111111111",

            episodeId:
              "EP90",

            shotId:
              "S01",

            provider:
              "RUNWAY",

            providerExecutionId:
              "mock-runway-task-1",

            providerEstimatedCredits:
              60,

            recoveryMetadata: {
              request: {
                durationSeconds:
                  5,

                ratio:
                  "1280:720",

                outputFormat:
                  "mp4",

                promptText:
                  "Busybookie durable recovery persistence test.",

                sourceImagePath:
                  join(
                    mediaRoot,
                    "references",
                    "test-reference.png",
                  ),

                assetStrategy:
                  "DATA_URI",
              },

              locallyExpectedCredits:
                60,
            },
          },
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createCompletion,
        ).toHaveBeenCalledWith(
          mediaRoot,
          {
            reservationId:
              "11111111-1111-4111-8111-111111111111",

            episodeId:
              "EP90",

            shotId:
              "S01",

            provider:
              "RUNWAY",

            providerExecutionId:
              "mock-runway-task-1",

            generationRecordPath:
              join(
                mediaRoot,
                "generated-video",
                "EP90",
                "S01",
                "EP90_S01_mock-runway-task-1.runway-generation.json",
              ),
          },
        );

        expect(
          Reflect.get(
            result,
            "submission",
          ),
        ).toBeDefined();

        expect(
          Reflect.get(
            result,
            "completion",
          ),
        ).toBeDefined();

        expect(
          executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeVeo,
        ).not.toHaveBeenCalled();
      },
    );
  },
);

type LifecycleFailureStage =
  | "SUBMISSION"
  | "COMPLETION";

function makeLifecycleFailureDependencies(
  events: string[],
  failureStage:
    LifecycleFailureStage,
) {
  const createReservation =
    vi.fn(
      async (
        mediaRoot: string,
        input:
          ExecutionReservationInput,
      ): Promise<
        CreateExecutionReservationResult
      > => {
        events.push(
          "reservation",
        );

        return {
          record: {
            schemaVersion:
              "1.0",

            reservationId:
              "22222222-2222-4222-8222-222222222222",

            reservedAt:
              "2026-09-24T21:35:00.000Z",

            status:
              "RESERVED",

            episodeId:
              input.episodeId,

            shotId:
              input.shotId,

            provider:
              input.provider,
          },

          reservationPath:
            join(
              mediaRoot,
              "generated-video",
              input.episodeId,
              input.shotId,
              `${input.episodeId}_${input.shotId}.execution-reservation.json`,
            ),
        };
      },
    );

  const createSubmission =
    vi.fn(
      async (
        mediaRoot: string,
        input:
          ExecutionSubmissionInput,
      ): Promise<
        CreateExecutionSubmissionResult
      > => {
        events.push(
          "submission",
        );

        if (
          failureStage ===
          "SUBMISSION"
        ) {
          throw new Error(
            "Mock submission persistence failure.",
          );
        }

        return {
          record: {
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-09-24T21:36:00.000Z",

            status:
              "SUBMITTED",

            reservationId:
              input.reservationId,

            episodeId:
              input.episodeId,

            shotId:
              input.shotId,

            provider:
              input.provider,

            providerExecutionId:
              input.providerExecutionId,
          },

          submissionPath:
            join(
              mediaRoot,
              "generated-video",
              input.episodeId,
              input.shotId,
              `${input.episodeId}_${input.shotId}.execution-submission.json`,
            ),
        };
      },
    );

  const createCompletion =
    vi.fn(
      async (
        mediaRoot: string,
        input:
          ExecutionCompletionInput,
      ): Promise<
        CreateExecutionCompletionResult
      > => {
        events.push(
          "completion",
        );

        if (
          failureStage ===
          "COMPLETION"
        ) {
          throw new Error(
            "Mock completion persistence failure.",
          );
        }

        return {
          record: {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-09-24T21:37:00.000Z",

            status:
              "COMPLETED",

            reservationId:
              input.reservationId,

            episodeId:
              input.episodeId,

            shotId:
              input.shotId,

            provider:
              input.provider,

            providerExecutionId:
              input.providerExecutionId,

            generationRecordPath:
              input.generationRecordPath,
          },

          completionPath:
            join(
              mediaRoot,
              "generated-video",
              input.episodeId,
              input.shotId,
              `${input.episodeId}_${input.shotId}.execution-completion.json`,
            ),
        };
      },
    );

  const executeRunway =
    vi.fn(
      async (
        input:
          SingleShotProviderExecutionInput,
      ): Promise<
        SingleShotProviderExecutionResult
      > => {
        const providerExecutionId =
          failureStage ===
          "SUBMISSION"
            ? "mock-runway-task-submission-failure"
            : "mock-runway-task-completion-failure";

        events.push(
          "provider-accepted",
        );

        await input
          .onSubmissionAccepted({
            provider:
              "RUNWAY",

            providerExecutionId,

            providerEstimatedCredits:
              60,

            recoveryMetadata: {
              request: {
                durationSeconds:
                  5,

                ratio:
                  "1280:720",

                outputFormat:
                  "mp4",

                promptText:
                  "Busybookie single-shot lifecycle failure recovery test.",

                sourceImagePath:
                  join(
                    input.mediaRoot,
                    "references",
                    "test-reference.png",
                  ),

                assetStrategy:
                  "DATA_URI",
              },

              locallyExpectedCredits:
                60,
            },
          });

        events.push(
          "provider-complete",
        );

        return {
          providerExecutionId,

          recordPath:
            join(
              input.mediaRoot,
              "generated-video",
              input.episode
                .episodeId,
              input.shot.id,
              `${input.episode.episodeId}_${input.shot.id}_${providerExecutionId}.runway-generation.json`,
            ),
        };
      },
    );

  const executeVeo =
    vi.fn(
      async (
        _input:
          SingleShotProviderExecutionInput,
      ): Promise<
        SingleShotProviderExecutionResult
      > => {
        throw new Error(
          "Unexpected Veo dispatch.",
        );
      },
    );

  return {
    dependencies: {
      createReservation,
      createSubmission,
      createCompletion,
      executeRunway,
      executeVeo,
    },

    createReservation,
    createSubmission,
    createCompletion,
    executeRunway,
    executeVeo,
  };
}

describe(
  "Busybookie single-shot lifecycle failure contracts",
  () => {
    it(
      "fails closed before provider continuation when SUBMITTED persistence fails",
      async () => {
        const [
          episode,
          bible,
          rules,
          policy,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP90",
            ),

            loadCharacterBible(),

            loadProductionRules(),

            loadProviderRoutingPolicy(),
          ]);

        const events:
          string[] = [];

        const mocks =
          makeLifecycleFailureDependencies(
            events,
            "SUBMISSION",
          );

        const mediaRoot =
          "D:/Busybookie/Production";

        await expect(
          executeSingleShot(
            {
              episode,

              shotId:
                "S01",

              bible,
              rules,
              policy,

              mediaRoot,

              sourceImagePath:
                join(
                  mediaRoot,
                  "references",
                  "test-reference.png",
                ),

              confirmPaidGeneration:
                true,
            },

            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /submission persistence failure/i,
        );

        expect(
          events,
        ).toEqual([
          "reservation",
          "provider-accepted",
          "submission",
        ]);

        expect(
          mocks.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createCompletion,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed after provider completion when COMPLETED persistence fails",
      async () => {
        const [
          episode,
          bible,
          rules,
          policy,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP90",
            ),

            loadCharacterBible(),

            loadProductionRules(),

            loadProviderRoutingPolicy(),
          ]);

        const events:
          string[] = [];

        const mocks =
          makeLifecycleFailureDependencies(
            events,
            "COMPLETION",
          );

        const mediaRoot =
          "D:/Busybookie/Production";

        await expect(
          executeSingleShot(
            {
              episode,

              shotId:
                "S01",

              bible,
              rules,
              policy,

              mediaRoot,

              sourceImagePath:
                join(
                  mediaRoot,
                  "references",
                  "test-reference.png",
                ),

              confirmPaidGeneration:
                true,
            },

            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /completion persistence failure/i,
        );

        expect(
          events,
        ).toEqual([
          "reservation",
          "provider-accepted",
          "submission",
          "provider-complete",
          "completion",
        ]);

        expect(
          mocks.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeRunway,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
