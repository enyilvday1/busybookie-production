import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwayDialogueProductionExecutor,
  prepareRunwayDialogueProductionExecutor,
} from "../src/dialogue/createRunwayDialogueProductionExecutor.js";

import {
  createRunwayClient,
} from "../src/runway/createRunwayClient.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

import {
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";

import {
  createDialogueSubmission,
} from "../src/dialogue/createDialogueSubmission.js";

import {
  recoverDialogueCompletion,
} from "../src/dialogue/recoverDialogueCompletion.js";

import {
  createRunwayDialogueProductionTransactionRunner,
} from "../src/dialogue/createRunwayDialogueProductionTransactionRunner.js";

import {
  executeDialogueLine,
  type ExecuteDialogueLineInput,
  type ExecuteDialogueLineResult,
} from "../src/dialogue/executeDialogueLine.js";

import {
  admitDialogueLineGeneration,
  type DialogueLineGenerationAdmission,
} from "../src/dialogue/admitDialogueLineGeneration.js";

type RunwayDialogueProductionExecutionInput =
  Omit<
    ExecuteDialogueLineInput,
    "policy"
  >;

type RunwayDialogueProductionExecutor =
  (
    input:
      RunwayDialogueProductionExecutionInput,
  ) =>
    Promise<
      ExecuteDialogueLineResult
    >;

type RunwayDialogueProductionExecutorDependencies =
  Readonly<{
    loadPolicy:
      typeof loadDialogueVoicePolicy;

    createClient:
      typeof createRunwayClient;

    createTransactionRunner:
      typeof createRunwayDialogueProductionTransactionRunner;

    createReservation:
      typeof createDialogueReservation;

    createSubmission:
      typeof createDialogueSubmission;

    recoverCompletion:
      typeof recoverDialogueCompletion;

    executeLifecycle:
      typeof executeDialogueLine;

    admitGeneration:
      typeof admitDialogueLineGeneration;
  }>;

function createProductionInput():
  RunwayDialogueProductionExecutionInput {
  return {
    plan: {
      schemaVersion:
        "1.0",

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      shotDurationSeconds:
        6,

      videoGeneration: {
        provider:
          "VEO",

        nativeAudio:
          true,
      },

      lines: [
        {
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",

          characterId:
            "OLLIE",

          characterName:
            "Ollie",

          text:
            "Look what I found!",

          deliveryNotes:
            "Curious, excited and gentle.",

          voice: {
            provider:
              "RUNWAY",

            voiceName:
              "Chad",

            deliveryTraits: [
              "young",
              "curious",
              "warm",
              "friendly",
              "natural",
            ],
          },
        },
      ],

      planKey:
        "a".repeat(
          64,
        ),
    },

    dialogueLineId:
      "EP02_SC01_S02_L01",

    mediaRoot:
      "D:/Busybookie/Production",

    confirmPaidGeneration:
      true,
  };
}

function createMocks() {
  const policy =
    Object.freeze({
      marker:
        "mock-dialogue-policy",
    }) as unknown as Awaited<
      ReturnType<
        typeof loadDialogueVoicePolicy
      >
    >;

  const client =
    Object.freeze({
      marker:
        "mock-runway-dialogue-client",
    }) as unknown as ReturnType<
      typeof createRunwayClient
    >;

  const runTransaction =
    vi.fn() as unknown as ReturnType<
      typeof createRunwayDialogueProductionTransactionRunner
    >;

  const expectedResult =
    Object.freeze({
      marker:
        "mock-dialogue-lifecycle-result",
    }) as unknown as ExecuteDialogueLineResult;

  const loadPolicy =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "loadPolicy"
      ]
    >(
      async () =>
        policy,
    );

  const createClient =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "createClient"
      ]
    >(
      () =>
        client,
    );

  const createTransactionRunner =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "createTransactionRunner"
      ]
    >(
      () =>
        runTransaction,
    );

  const createReservation =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "createReservation"
      ]
    >();

  const createSubmission =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "createSubmission"
      ]
    >();

  const recoverCompletion =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "recoverCompletion"
      ]
    >();

  const executeLifecycle =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "executeLifecycle"
      ]
    >(
      async (
        _input,
        _dependencies,
      ) =>
        expectedResult,
    );

  // C6a admission seam: injected so no ledger is read under a media root.
  const admitGeneration =
    vi.fn<
      RunwayDialogueProductionExecutorDependencies[
        "admitGeneration"
      ]
    >(
      async () =>
        Object.freeze({
          marker:
            "mock-dialogue-admission",
        }) as unknown as DialogueLineGenerationAdmission,
    );

  const dependencies = {
    loadPolicy,
    createClient,
    createTransactionRunner,
    createReservation,
    createSubmission,
    recoverCompletion,
    executeLifecycle,
    admitGeneration,
  } satisfies
    RunwayDialogueProductionExecutorDependencies;

  return {
    policy,
    client,
    runTransaction,
    expectedResult,
    dependencies,
    loadPolicy,
    createClient,
    createTransactionRunner,
    createReservation,
    createSubmission,
    recoverCompletion,
    executeLifecycle,
    admitGeneration,
  };
}

describe(
  "Busybookie Runway dialogue production executor",
  () => {
    it(
      "prepares policy, client, and transaction runner before returning the executable dialogue lifecycle",
      async () => {
        const credentialSource =
          Object.freeze({
            RUNWAYML_API_SECRET:
              "test-runway-dialogue-secret",
          });

        const input =
          createProductionInput();

        const mocks =
          createMocks();

        const executor =
          await prepareRunwayDialogueProductionExecutor(
            credentialSource,
            mocks.dependencies,
          ) as RunwayDialogueProductionExecutor;

        expect(
          mocks.loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createClient,
        ).toHaveBeenCalledWith(
          credentialSource,
        );

        expect(
          mocks.createTransactionRunner,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createTransactionRunner,
        ).toHaveBeenCalledWith(
          mocks.client,
        );

        expect(
          mocks.executeLifecycle,
        ).not.toHaveBeenCalled();

        const result =
          await executor(
            input,
          );

        expect(
          mocks.executeLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeLifecycle,
        ).toHaveBeenCalledWith(
          {
            ...input,

            policy:
              mocks.policy,
          },
          {
            createReservation:
              mocks.createReservation,

            createSubmission:
              mocks.createSubmission,

            runTransaction:
              mocks.runTransaction,

            recoverCompletion:
              mocks.recoverCompletion,
          },
        );

        expect(
          result,
        ).toBe(
          mocks.expectedResult,
        );

        expect(
          mocks.admitGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.admitGeneration,
        ).toHaveBeenCalledWith({
          mediaRoot:
            input.mediaRoot,
          plan:
            input.plan,
          dialogueLineId:
            input.dialogueLineId,
          generationNamespace:
            "LINE_SCOPED",
          confirmPaidGeneration:
            input.confirmPaidGeneration,
        });

        expect(
          mocks.admitGeneration.mock.invocationCallOrder[0]!,
        ).toBeLessThan(
          mocks.executeLifecycle.mock.invocationCallOrder[0]!,
        );
      },
    );

    it(
      "lazily prepares the production dialogue executor once and reuses it",
      async () => {
        const credentialSource =
          Object.freeze({
            RUNWAYML_API_SECRET:
              "test-runway-dialogue-secret",
          });

        const input =
          createProductionInput();

        const mocks =
          createMocks();

        const executor =
          createRunwayDialogueProductionExecutor(
            credentialSource,
            mocks.dependencies,
          ) as RunwayDialogueProductionExecutor;

        expect(
          mocks.loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          mocks.createClient,
        ).not.toHaveBeenCalled();

        expect(
          mocks.createTransactionRunner,
        ).not.toHaveBeenCalled();

        await executor(
          input,
        );

        await executor(
          input,
        );

        expect(
          mocks.loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.createTransactionRunner,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          mocks.executeLifecycle,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );
  },
);
