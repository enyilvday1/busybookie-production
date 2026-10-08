import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  createDialogueVisualAuthorization,
} from "../src/execution/createDialogueVisualAuthorization.js";

import {
  readDialogueVisualAuthorization,
} from "../src/execution/readDialogueVisualAuthorization.js";

import {
  executeSingleShot,
} from "../src/execution/executeSingleShot.js";

import type {
  SingleShotExecutionDependencies,
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
} from "../src/execution/singleShotExecution.types.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

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

const temporaryDirectories:
  string[] = [];

afterEach(
  async () => {
    while (
      temporaryDirectories.length >
      0
    ) {
      const directory =
        temporaryDirectories.pop();

      if (!directory) {
        continue;
      }

      await rm(
        directory,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-visual-execution-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function loadExecutionContext() {
  const [
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  return {
    bible,
    rules,
    policy,
  };
}

type ExecutionContext =
  Awaited<
    ReturnType<
      typeof loadExecutionContext
    >
  >;

function requireShot(
  episode:
    EpisodeManifest,
  shotId:
    string,
): Shot {
  for (
    const scene
    of episode.scenes
  ) {
    const shot =
      scene.shots.find(
        (candidate) =>
          candidate.id ===
          shotId,
      );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Expected shot ${shotId}.`,
  );
}

function lockOllieVoice(
  context:
    ExecutionContext,
): ExecutionContext {
  const bible =
    structuredClone(
      context.bible,
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

  return {
    ...context,
    bible,
  };
}

function makeS02Ready(
  sourceEpisode:
    EpisodeManifest,
): EpisodeManifest {
  const episode =
    structuredClone(
      sourceEpisode,
    );

  episode.status =
    "READY_FOR_GENERATION";

  episode.approvals.script =
    "APPROVED";

  episode.approvals.storyboard =
    "APPROVED";

  episode.approvals.references =
    "APPROVED";

  const shot =
    requireShot(
      episode,
      "S02",
    );

  shot.references = {
    required:
      true,

    assetIds: [
      "OLLIE_CHARACTER_MASTER_REFERENCE_V1",
    ],

    approvalStatus:
      "APPROVED",
  };

  shot.generation.provider =
    "VEO";

  shot.generation.nativeAudio =
    true;

  shot.generation.status =
    "APPROVED_FOR_GENERATION";

  return episode;
}

function makeRequest(
  episode:
    EpisodeManifest,
  context:
    ExecutionContext,
  mediaRoot:
    string,
  confirmPaidGeneration =
    true,
) {
  return {
    episode,
    shotId:
      "S02",
    bible:
      context.bible,
    rules:
      context.rules,
    policy:
      context.policy,
    mediaRoot,
    sourceImagePath:
      join(
        mediaRoot,
        "references",
        "ollie-master-character-reference-v1.png",
      ),
    confirmPaidGeneration,
  };
}

function makeDependencies(
  events:
    string[] = [],
) {
  const createReservation =
    vi.fn<
      SingleShotExecutionDependencies[
        "createReservation"
      ]
    >(
      async (
        mediaRoot,
        input,
      ) => {
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
              "2026-10-07T20:30:00.000Z",
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
    vi.fn<
      SingleShotExecutionDependencies[
        "createSubmission"
      ]
    >(
      async (
        mediaRoot,
        input,
      ) => {
        events.push(
          "submission",
        );

        return {
          record: {
            schemaVersion:
              "1.0",
            submittedAt:
              "2026-10-07T20:31:00.000Z",
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
            recoveryMetadata:
              input.recoveryMetadata,
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
    vi.fn<
      SingleShotExecutionDependencies[
        "createCompletion"
      ]
    >(
      async (
        mediaRoot,
        input,
      ) => {
        events.push(
          "completion",
        );

        return {
          record: {
            schemaVersion:
              "1.0",
            completedAt:
              "2026-10-07T20:32:00.000Z",
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
        _input:
          SingleShotProviderExecutionInput,
      ): Promise<
        SingleShotProviderExecutionResult
      > => {
        events.push(
          "runway",
        );

        throw new Error(
          "Runway must not execute for the authorized S02 Veo visual leg.",
        );
      },
    );

  const executeVeo =
    vi.fn(
      async (
        input:
          SingleShotProviderExecutionInput,
      ): Promise<
        SingleShotProviderExecutionResult
      > => {
        events.push(
          "veo",
        );

        await input
          .onSubmissionAccepted({
            provider:
              "VEO",

            providerExecutionId:
              "operations/mock-dialogue-visual-veo-1",

            recoveryMetadata: {
              request: {
                durationSeconds:
                  6,

                aspectRatio:
                  "16:9",

                resolution:
                  "720p",

                numberOfVideos:
                  1,

                nativeAudioExpected:
                  true,

                expectedOutputFps:
                  24,

                promptText:
                  "Mock authorized dialogue visual generation.",

                sourceImagePath:
                  input.sourceImagePath,

                imageMimeType:
                  "image/png",
              },

              costPolicy: {
                pricingReviewedOn:
                  "2026-09-22",

                centsPerSecond:
                  10,

                locallyExpectedCents:
                  60,
              },
            },
          });

        return {
          providerExecutionId:
            "operations/mock-dialogue-visual-veo-1",

          recordPath:
            join(
              input.mediaRoot,
              "mock-dialogue-visual-veo-record.json",
            ),
        };
      },
    );

  const readAuthorization =
    vi.fn(
      async (
        mediaRoot:
          string,
        episodeId:
          string,
        shotId:
          string,
      ) =>
        readDialogueVisualAuthorization(
          mediaRoot,
          episodeId,
          shotId,
        ),
    );

  const dependencies = {
    createReservation,
    createSubmission,
    createCompletion,
    executeRunway,
    executeVeo,

    readDialogueVisualAuthorization:
      readAuthorization,
  };

  return {
    dependencies,
    createReservation,
    executeRunway,
    executeVeo,
    readAuthorization,
  };
}

async function authorize(
  mediaRoot:
    string,
  provider:
    "RUNWAY" | "VEO" =
      "VEO",
): Promise<void> {
  await createDialogueVisualAuthorization(
    mediaRoot,
    {
      episodeId:
        "EP02",

      shotId:
        "S02",

      purpose:
        "DIALOGUE_VISUAL_GENERATION",

      provider,

      nativeAudioDisposition:
        "DISCARD_AFTER_VISUAL_GENERATION",

      dialogueAuthority:
        "EXTERNAL_VERIFIED_DIALOGUE",

      authorizationSource:
        "HUMAN_OPERATOR",
    },
    {
      now:
        () =>
          "2026-10-07T20:29:00.000Z",

      createAuthorizationId:
        () =>
          "33333333-3333-4333-8333-333333333333",
    },
  );
}

describe(
  "Busybookie dialogue-visual authorization execution integration",
  () => {
    it(
      "resolves dialogue MANUAL_REVIEW to the exact authorized VEO visual provider only after normal readiness guards pass",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const [
          sourceEpisode,
          sourceContext,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),
            loadExecutionContext(),
          ]);

        const episode =
          makeS02Ready(
            sourceEpisode,
          );

        const context =
          lockOllieVoice(
            sourceContext,
          );

        await authorize(
          mediaRoot,
          "VEO",
        );

        const events:
          string[] = [];

        const mocks =
          makeDependencies(
            events,
          );

        const result =
          await executeSingleShot(
            makeRequest(
              episode,
              context,
              mediaRoot,
            ),
            mocks.dependencies,
          );

        expect(
          result.provider,
        ).toBe(
          "VEO",
        );

        expect(
          result.readiness.disposition,
        ).toBe(
          "EXECUTABLE",
        );

        expect(
          result.readiness.executionProvider,
        ).toBe(
          "VEO",
        );

        expect(
          result.readiness.routing.disposition,
        ).toBe(
          "MANUAL_REVIEW",
        );

        expect(
          events,
        ).toEqual([
          "reservation",
          "veo",
          "submission",
          "completion",
        ]);

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "keeps dialogue MANUAL_REVIEW fail-closed when no durable authorization exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const [
          sourceEpisode,
          sourceContext,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),
            loadExecutionContext(),
          ]);

        const episode =
          makeS02Ready(
            sourceEpisode,
          );

        const context =
          lockOllieVoice(
            sourceContext,
          );

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              context,
              mediaRoot,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /MANUAL_REVIEW/,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects durable authorization whose provider differs from the shot generation provider",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const [
          sourceEpisode,
          sourceContext,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),
            loadExecutionContext(),
          ]);

        const episode =
          makeS02Ready(
            sourceEpisode,
          );

        const context =
          lockOllieVoice(
            sourceContext,
          );

        await authorize(
          mediaRoot,
          "RUNWAY",
        );

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              context,
              mediaRoot,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /authorization|provider|MANUAL_REVIEW/i,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not let durable authorization bypass ordinary shot readiness guards",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const [
          sourceEpisode,
          sourceContext,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),
            loadExecutionContext(),
          ]);

        const episode =
          makeS02Ready(
            sourceEpisode,
          );

        const shot =
          requireShot(
            episode,
            "S02",
          );

        shot.references = {
          required:
            true,

          assetIds:
            [],

          approvalStatus:
            "PENDING",
        };

        const context =
          lockOllieVoice(
            sourceContext,
          );

        await authorize(
          mediaRoot,
          "VEO",
        );

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              context,
              mediaRoot,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /NOT_READY/,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not let durable authorization bypass explicit paid-generation confirmation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const [
          sourceEpisode,
          sourceContext,
        ] =
          await Promise.all([
            loadEpisodeManifest(
              "EP02",
            ),
            loadExecutionContext(),
          ]);

        const episode =
          makeS02Ready(
            sourceEpisode,
          );

        const context =
          lockOllieVoice(
            sourceContext,
          );

        await authorize(
          mediaRoot,
          "VEO",
        );

        const mocks =
          makeDependencies();

        await expect(
          executeSingleShot(
            makeRequest(
              episode,
              context,
              mediaRoot,
              false,
            ),
            mocks.dependencies,
          ),
        ).rejects.toThrow(
          /paid.*confirmation/i,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeRunway,
        ).not.toHaveBeenCalled();

        expect(
          mocks.executeVeo,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
