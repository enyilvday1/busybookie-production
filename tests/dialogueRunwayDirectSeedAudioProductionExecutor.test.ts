import type RunwayML from "@runwayml/sdk";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  createRunwayDirectSeedAudioProductionTransactionRunner,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionTransactionRunner.js";

import {
  executeDialogueDirectSeedAudioLine,
  type DialogueDirectSeedAudioLineTransactionRunner,
  type ExecuteDialogueDirectSeedAudioLineResult,
} from "../src/dialogue/executeDialogueDirectSeedAudioLine.js";

import {
  createRunwayDirectSeedAudioProductionExecutor,
  type RunwayDirectSeedAudioProductionExecutionInput,
  type RunwayDirectSeedAudioProductionExecutorDependencies,
} from "../src/dialogue/createRunwayDirectSeedAudioProductionExecutor.js";

import {
  recoverDialogueDirectSeedAudioCompletion,
} from "../src/dialogue/recoverDialogueDirectSeedAudioCompletion.js";

import {
  createRunwayClient,
} from "../src/runway/createRunwayClient.js";

import type {
  RunwayCredentialSource,
} from "../src/runway/runway.types.js";

describe(
  "BusyBookie direct SeedAudio production executor",
  () => {
    it(
      "lazily binds one Runway client and one direct SeedAudio transaction runner to the parallel v3 lifecycle",
      async () => {
        const credentialSource = {
          RUNWAYML_API_SECRET:
            "test-runway-secret",
        } satisfies
          RunwayCredentialSource;

        const client =
          {} as RunwayML;

        const transactionRunner =
          vi.fn() as unknown as
            DialogueDirectSeedAudioLineTransactionRunner;

        const input =
          Object.freeze({
            marker:
              "direct-seed-audio-production-input",
          }) as unknown as
            RunwayDirectSeedAudioProductionExecutionInput;

        const lifecycleResult =
          Object.freeze({
            marker:
              "direct-seed-audio-production-result",
          }) as unknown as
            ExecuteDialogueDirectSeedAudioLineResult;

        const createClient =
          vi.fn(
            (
              receivedCredentialSource:
                RunwayCredentialSource,
            ) => {
              expect(
                receivedCredentialSource,
              ).toBe(
                credentialSource,
              );

              return client;
            },
          );

        const createTransactionRunner =
          vi.fn(
            (
              receivedClient:
                RunwayML,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              return transactionRunner;
            },
          );

        const createReservation =
          vi.fn();

        const createSubmission =
          vi.fn();

        const recoverCompletion =
          vi.fn();

        const executeLifecycle =
          vi.fn(
            async (
              receivedInput,
              receivedDependencies,
            ) => {
              expect(
                receivedInput,
              ).toBe(
                input,
              );

              expect(
                receivedDependencies
                  .createReservation,
              ).toBe(
                createReservation,
              );

              expect(
                receivedDependencies
                  .createSubmission,
              ).toBe(
                createSubmission,
              );

              expect(
                receivedDependencies
                  .runTransaction,
              ).toBe(
                transactionRunner,
              );

              expect(
                receivedDependencies
                  .recoverCompletion,
              ).toBe(
                recoverCompletion,
              );

              return lifecycleResult;
            },
          );

        const dependencies = {
          createClient,
          createTransactionRunner,

          createReservation:
            createReservation as
              typeof createDialogueDirectSeedAudioReservation,

          createSubmission:
            createSubmission as
              typeof createDialogueDirectSeedAudioSubmission,

          recoverCompletion:
            recoverCompletion as
              typeof recoverDialogueDirectSeedAudioCompletion,

          executeLifecycle:
            executeLifecycle as
              typeof executeDialogueDirectSeedAudioLine,
        } satisfies
          RunwayDirectSeedAudioProductionExecutorDependencies;

        const executor =
          createRunwayDirectSeedAudioProductionExecutor(
            credentialSource,
            dependencies,
          );

        expect(
          createClient,
        ).not.toHaveBeenCalled();

        expect(
          createTransactionRunner,
        ).not.toHaveBeenCalled();

        await expect(
          executor(
            input,
          ),
        ).resolves.toBe(
          lifecycleResult,
        );

        await expect(
          executor(
            input,
          ),
        ).resolves.toBe(
          lifecycleResult,
        );

        expect(
          createClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createTransactionRunner,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeLifecycle,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );

    it(
      "uses only the direct SeedAudio production surfaces",
      () => {
        expect(
          createRunwayClient,
        ).not.toBeUndefined();

        expect(
          createRunwayDirectSeedAudioProductionTransactionRunner,
        ).not.toBeUndefined();

        expect(
          executeDialogueDirectSeedAudioLine,
        ).not.toBeUndefined();

        expect(
          createDialogueDirectSeedAudioSubmission,
        ).not.toBeUndefined();
      },
    );
  },
);
