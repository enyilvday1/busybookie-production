import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  readFile,
} from "node:fs/promises";

const guardMocks =
  vi.hoisted(
    () => ({
      assertCheckedEpisodeAdmission:
        vi.fn(),

      checkedEpisodeExecutionData:
        vi.fn(),

      consumeEpisodeRecoveryDispatch:
        vi.fn(),
    }),
  );

vi.mock(
  "../src/execution/episodeExecutionGuard.js",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import(
          "../src/execution/episodeExecutionGuard.js"
        )
      >();

    return {
      ...actual,

      assertCheckedEpisodeAdmission:
        guardMocks
          .assertCheckedEpisodeAdmission,

      checkedEpisodeExecutionData:
        guardMocks
          .checkedEpisodeExecutionData,

      consumeEpisodeRecoveryDispatch:
        guardMocks
          .consumeEpisodeRecoveryDispatch,
    };
  },
);

import {
  runProductionVisualAttemptExecutionReconcile,
} from "../src/execution/cli/runProductionVisualAttemptExecutionReconcile.js";

const MEDIA_ROOT =
  "D:\\Busybookie\\Synthetic";

const EPISODE_ID =
  "EP02";

const SHOT_ID =
  "S01";

const ATTEMPT_NUMBER =
  2;

function checkedData(
  overrides:
    Readonly<Record<string, unknown>> = {},
) {
  const action = {
    kind:
      "VISUAL_ATTEMPT_RECONCILE",

    episodeId:
      EPISODE_ID,

    sceneId:
      "SC01",

    shotId:
      SHOT_ID,

    order:
      2,

    attemptNumber:
      ATTEMPT_NUMBER,

    ...(
      overrides.action &&
      typeof overrides.action ===
        "object"
        ? overrides.action
        : {}
    ),
  };

  return {
    invocation:
      overrides.invocation ??
      Object.freeze({
        marker:
          "zero-create-recovery-invocation",
      }),

    plan: {
      actions:
        [action],

      inputBinding: {
        runtimeIdentity: {
          mediaRoot:
            MEDIA_ROOT,
        },
      },
    },
  };
}

function harness(
  options:
    Readonly<{
      apiKey?:
        string | undefined;

      checked?:
        ReturnType<typeof checkedData>;

      consume?:
        () => void;
    }> = {},
) {
  const submittedRecovery =
    Object.freeze({
      marker:
        "submitted-recovery",
    });

  const reconcile =
    vi.fn(
      async (
        _input:
          Readonly<Record<string, unknown>>,

        _dependencies:
          Readonly<Record<string, unknown>>,
      ) =>
        undefined,
    );

  const createGoogleSubmittedRecovery =
    vi.fn(
      () =>
        submittedRecovery,
    );

  const loadEnvironment =
    vi.fn(
      () => ({
        GEMINI_API_KEY:
          options.apiKey ===
            undefined
            ? "synthetic-gemini-key"
            : options.apiKey,
      }),
    );

  const createDependencies =
    vi.fn(
      () => ({
        reconcileGoogleVisualAttemptLifecycle:
          reconcile,

        createGoogleSubmittedRecovery,

        loadEnvironment,
      }),
    );

  guardMocks
    .assertCheckedEpisodeAdmission
    .mockResolvedValue(
      undefined,
    );

  guardMocks
    .checkedEpisodeExecutionData
    .mockReturnValue(
      options.checked ??
        checkedData(),
    );

  guardMocks
    .consumeEpisodeRecoveryDispatch
    .mockImplementation(
      options.consume ??
        (() => undefined),
    );

  return {
    submittedRecovery,
    reconcile,
    createGoogleSubmittedRecovery,
    loadEnvironment,
    createDependencies,
  };
}

describe(
  "runProductionVisualAttemptExecutionReconcile authority boundary",
  () => {
    beforeEach(
      () => {
        vi.clearAllMocks();
      },
    );

    it(
      "requires a checked execution context before any recovery work",
      async () => {
        const h =
          harness();

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            {
              episodeId:
                EPISODE_ID,

              shotId:
                SHOT_ID,

              attemptNumber:
                ATTEMPT_NUMBER,
            },
            {
              createDependencies:
                h.createDependencies,
            } as never,
          ),
        ).rejects.toMatchObject({
          name:
            "BoundEpisodeError",

          code:
            "OPERATING_CONDITION_UNESTABLISHED",
        });

        expect(
          guardMocks
            .checkedEpisodeExecutionData,
        ).not.toHaveBeenCalled();

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).not.toHaveBeenCalled();

        expect(
          h.reconcile,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      [
        "episode",
        {
          episodeId:
            "EP99",
        },
      ],

      [
        "shot",
        {
          shotId:
            "S99",
        },
      ],

      [
        "attempt",
        {
          attemptNumber:
            3,
        },
      ],
    ] as const)(
      "rejects %s transport drift before admission or recovery dispatch",
      async (
        _label,
        patch,
      ) => {
        const h =
          harness();

        const context =
          Object.freeze({
            marker:
              "checked-context",
          });

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            {
              episodeId:
                EPISODE_ID,

              shotId:
                SHOT_ID,

              attemptNumber:
                ATTEMPT_NUMBER,

              ...patch,
            },
            {
              createDependencies:
                h.createDependencies,
            } as never,
            context as never,
          ),
        ).rejects.toMatchObject({
          name:
            "BoundEpisodeError",

          code:
            "INPUT_BINDING_DRIFT",
        });

        expect(
          guardMocks
            .assertCheckedEpisodeAdmission,
        ).not.toHaveBeenCalled();

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).not.toHaveBeenCalled();

        expect(
          h.reconcile,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a non-attempt-reconcile reviewed action before recovery authority",
      async () => {
        const h =
          harness({
            checked:
              checkedData({
                action: {
                  kind:
                    "VISUAL_ATTEMPT_GENERATE",
                },
              }),
          });

        const context =
          Object.freeze({
            marker:
              "checked-context",
          });

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            {
              episodeId:
                EPISODE_ID,

              shotId:
                SHOT_ID,

              attemptNumber:
                ATTEMPT_NUMBER,
            },
            {
              createDependencies:
                h.createDependencies,
            } as never,
            context as never,
          ),
        ).rejects.toMatchObject({
          code:
            "INPUT_BINDING_DRIFT",
        });

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).not.toHaveBeenCalled();

        expect(
          h.reconcile,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "revalidates checked admission, consumes exactly one recovery dispatch, then delegates exact attempt identity",
      async () => {
        const checked =
          checkedData();

        const h =
          harness({
            checked,
          });

        const context =
          Object.freeze({
            marker:
              "checked-context",
          });

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            {
              episodeId:
                EPISODE_ID,

              shotId:
                SHOT_ID,

              attemptNumber:
                ATTEMPT_NUMBER,
            },
            {
              createDependencies:
                h.createDependencies,
            } as never,
            context as never,
          ),
        ).resolves.toBeUndefined();

        expect(
          guardMocks
            .assertCheckedEpisodeAdmission,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          guardMocks
            .assertCheckedEpisodeAdmission,
        ).toHaveBeenNthCalledWith(
          1,
          context,
        );

        expect(
          guardMocks
            .assertCheckedEpisodeAdmission,
        ).toHaveBeenNthCalledWith(
          2,
          context,
        );

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).toHaveBeenCalledWith(
          checked.invocation,
        );

        expect(
          h.createGoogleSubmittedRecovery,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          h.createGoogleSubmittedRecovery,
        ).toHaveBeenCalledWith(
          "synthetic-gemini-key",
        );

        expect(
          h.reconcile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          h.reconcile,
        ).toHaveBeenCalledWith(
          {
            mediaRoot:
              MEDIA_ROOT,

            episodeId:
              EPISODE_ID,

            shotId:
              SHOT_ID,

            attemptNumber:
              ATTEMPT_NUMBER,
          },
          {
            submittedRecovery:
              h.submittedRecovery,
          },
        );

        const secondAdmissionOrder =
          guardMocks
            .assertCheckedEpisodeAdmission
            .mock
            .invocationCallOrder[1]!;

        const consumeOrder =
          guardMocks
            .consumeEpisodeRecoveryDispatch
            .mock
            .invocationCallOrder[0]!;

        const reconcileOrder =
          h.reconcile
            .mock
            .invocationCallOrder[0]!;

        expect(
          secondAdmissionOrder,
        ).toBeLessThan(
          consumeOrder,
        );

        expect(
          consumeOrder,
        ).toBeLessThan(
          reconcileOrder,
        );
      },
    );

    it(
      "does not forward caller-owned durable or provider identity fields",
      async () => {
        const h =
          harness();

        const context =
          Object.freeze({
            marker:
              "checked-context",
          });

        const input = {
          episodeId:
            EPISODE_ID,

          shotId:
            SHOT_ID,

          attemptNumber:
            ATTEMPT_NUMBER,

          provider:
            "RUNWAY",

          providerExecutionId:
            "caller-owned-provider-id",

          reservationId:
            "caller-owned-reservation",

          reservationSha256:
            "a".repeat(
              64,
            ),

          submissionSha256:
            "b".repeat(
              64,
            ),

          generationRecordPath:
            "caller-owned-generation-record",

          outputPath:
            "caller-owned-output",
        };

        await runProductionVisualAttemptExecutionReconcile(
          input as never,
          {
            createDependencies:
              h.createDependencies,
          } as never,
          context as never,
        );

        expect(
          h.reconcile,
        ).toHaveBeenCalledWith(
          {
            mediaRoot:
              MEDIA_ROOT,

            episodeId:
              EPISODE_ID,

            shotId:
              SHOT_ID,

            attemptNumber:
              ATTEMPT_NUMBER,
          },
          {
            submittedRecovery:
              h.submittedRecovery,
          },
        );

        const delegated =
          h.reconcile.mock
            .calls[0]![0] as
            Record<
              string,
              unknown
            >;

        for (
          const forbidden
          of [
            "provider",
            "providerExecutionId",
            "reservationId",
            "reservationSha256",
            "submissionSha256",
            "generationRecordPath",
            "outputPath",
          ]
        ) {
          expect(
            forbidden in
              delegated,
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "fails for a missing Gemini key before consuming recovery authority",
      async () => {
        const h =
          harness({
            apiKey:
              "",
          });

        const context =
          Object.freeze({
            marker:
              "checked-context",
          });

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            {
              episodeId:
                EPISODE_ID,

              shotId:
                SHOT_ID,

              attemptNumber:
                ATTEMPT_NUMBER,
            },
            {
              createDependencies:
                h.createDependencies,
            } as never,
            context as never,
          ),
        ).rejects.toMatchObject({
          code:
            "OPERATING_CONDITION_UNESTABLISHED",
        });

        expect(
          guardMocks
            .assertCheckedEpisodeAdmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).not.toHaveBeenCalled();

        expect(
          h.reconcile,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "a rejected second recovery dispatch cannot produce a second reconciliation",
      async () => {
        let consumed =
          false;

        const h =
          harness({
            consume:
              () => {
                if (
                  consumed
                ) {
                  throw new Error(
                    "Synthetic recovery dispatch already consumed.",
                  );
                }

                consumed =
                  true;
              },
          });

        const context =
          Object.freeze({
            marker:
              "checked-context",
          });

        const input = {
          episodeId:
            EPISODE_ID,

          shotId:
            SHOT_ID,

          attemptNumber:
            ATTEMPT_NUMBER,
        } as const;

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            input,
            {
              createDependencies:
                h.createDependencies,
            } as never,
            context as never,
          ),
        ).resolves.toBeUndefined();

        await expect(
          runProductionVisualAttemptExecutionReconcile(
            input,
            {
              createDependencies:
                h.createDependencies,
            } as never,
            context as never,
          ),
        ).rejects.toThrow(
          /already consumed/,
        );

        expect(
          guardMocks
            .consumeEpisodeRecoveryDispatch,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          h.reconcile,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "contains no generic-reconcile, generation, create or submit authority",
      async () => {
        const source =
          await readFile(
            "src/execution/cli/runProductionVisualAttemptExecutionReconcile.ts",
            "utf8",
          );

        for (
          const forbidden
          of [
            "runProductionExecutionReconcileCli",
            "runSingleShotExecutionCli",
            "consumeEpisodeGenerationAllowance",
            "executeProductionVisualAttemptSingleShot",
            "executeGoogleGenAiVisualAttemptSingleShot",
            "createVisualAttemptExecutionReservation",
            "createVisualAttemptExecutionSubmission",
            "interactions.create",
            "createInteraction",
          ]
        ) {
          expect(
            source,
          ).not.toContain(
            forbidden,
          );
        }

        expect(
          source,
        ).toContain(
          "consumeEpisodeRecoveryDispatch",
        );

        expect(
          source,
        ).toContain(
          "reconcileGoogleVisualAttemptLifecycle",
        );
      },
    );
  },
);
