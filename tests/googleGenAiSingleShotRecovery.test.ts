import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  readExecutionSubmission,
} from "../src/execution/readExecutionSubmission.js";

import {
  recoverGoogleGenAiSingleShot,
  type GoogleGenAiInteractionGetter,
  type GoogleGenAiSingleShotRecoveryInput,
} from "../src/execution/providers/recoverGoogleGenAiSingleShot.js";

import {
  GOOGLE_GENAI_INTERACTION_STATUSES,
  classifyGoogleGenAiInteractionStatus,
} from "../src/googleGenai/googleGenAiInteractionContract.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const RECOVERY_SOURCE =
  "src/execution/providers/recoverGoogleGenAiSingleShot.ts";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const reservationDependencies = {
  now: () =>
    "2026-10-24T12:00:00.000Z",

  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
};

const submissionDependencies = {
  now: () =>
    "2026-10-24T12:01:00.000Z",
};

const temporaryDirectories:
  string[] = [];

let policySnapshot:
  GoogleGenAiPolicy;

beforeAll(
  async () => {
    policySnapshot =
      await loadGoogleGenAiPolicy();
  },
);

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(
          (directory) =>
            rm(
              directory,
              {
                recursive:
                  true,

                force:
                  true,
              },
            ),
        ),
    );
  },
);

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-recovery-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function persistGoogleSubmission(
  mediaRoot:
    string,
  providerExecutionId:
    string =
      INTERACTION_ID,
): Promise<void> {
  const reservation =
    await createExecutionReservation(
      mediaRoot,
      {
        episodeId:
          "EP92",

        shotId:
          "S01",

        provider:
          "GOOGLE_GENAI",
      },
      reservationDependencies,
    );

  await createExecutionSubmission(
    mediaRoot,
    {
      reservationId:
        reservation.record
          .reservationId,

      episodeId:
        "EP92",

      shotId:
        "S01",

      provider:
        "GOOGLE_GENAI",

      providerExecutionId,

      recoveryMetadata: {
        request: {
          model:
            "gemini-omni-1.1-flash",

          background:
            true,

          store:
            true,

          stream:
            false,

          promptText:
            "Busybookie Google GenAI recovery test.",

          sourceImagePath:
            join(
              mediaRoot,
              "references",
              "EP92",
              "S01",
              "reference.png",
            ),
        },

        policySnapshot,
      },
    },
    submissionDependencies,
  );
}

async function persistRunwaySubmission(
  mediaRoot:
    string,
): Promise<void> {
  const reservation =
    await createExecutionReservation(
      mediaRoot,
      {
        episodeId:
          "EP92",

        shotId:
          "S01",

        provider:
          "RUNWAY",
      },
      reservationDependencies,
    );

  await createExecutionSubmission(
    mediaRoot,
    {
      reservationId:
        reservation.record
          .reservationId,

      episodeId:
        "EP92",

      shotId:
        "S01",

      provider:
        "RUNWAY",

      providerExecutionId:
        "task-runway-recovery",

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
            "Busybookie Runway submission for Google recovery test.",

          sourceImagePath:
            "D:/Busybookie/Production/references/EP92/S01/reference.png",

          assetStrategy:
            "DATA_URI",
        },

        locallyExpectedCredits:
          60,
      },
    },
    submissionDependencies,
  );
}

function recoveryInput(
  mediaRoot:
    string,
): GoogleGenAiSingleShotRecoveryInput {
  return {
    mediaRoot,

    episodeId:
      "EP92",

    shotId:
      "S01",
  };
}

function getterReturning(
  result:
    Readonly<{
      id:
        unknown;

      status:
        unknown;
    }>,
) {
  return vi.fn<GoogleGenAiInteractionGetter>(
    async () =>
      result,
  );
}

function getterEchoing(
  status:
    unknown,
) {
  return vi.fn<GoogleGenAiInteractionGetter>(
    async (providerExecutionId) => ({
      id:
        providerExecutionId,

      status,
    }),
  );
}

describe(
  "Busybookie dormant Google GenAI same-ID recovery",
  () => {
    describe(
      "durable authority",
      () => {
        it(
          "fails before any lookup when no durable submission exists",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const getInteraction =
              getterEchoing(
                "queued",
              );

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction,
                },
              ),
            ).rejects.toThrow(
              /requires a durable execution submission/i,
            );

            expect(
              getInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "fails before any lookup for a non-Google durable submission",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistRunwaySubmission(
              mediaRoot,
            );

            const getInteraction =
              getterEchoing(
                "queued",
              );

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction,
                },
              ),
            ).rejects.toThrow(
              /requires a GOOGLE_GENAI execution submission; received RUNWAY/,
            );

            expect(
              getInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "fails before any lookup when the durable submission is malformed",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const submissionPath =
              createExecutionSubmissionPath(
                mediaRoot,
                "EP92",
                "S01",
              );

            await mkdir(
              dirname(
                submissionPath,
              ),
              {
                recursive:
                  true,
              },
            );

            await writeFile(
              submissionPath,
              "{damaged",
              "utf8",
            );

            const getInteraction =
              getterEchoing(
                "queued",
              );

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction,
                },
              ),
            ).rejects.toThrow(
              /not valid JSON/i,
            );

            expect(
              getInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "fails before any lookup when the durable record carries a separate interactionId",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const submissionPath =
              createExecutionSubmissionPath(
                mediaRoot,
                "EP92",
                "S01",
              );

            const stored:
              unknown =
              JSON.parse(
                await readFile(
                  submissionPath,
                  "utf8",
                ),
              );

            await writeFile(
              submissionPath,
              JSON.stringify({
                ...(
                  typeof stored === "object" &&
                  stored !== null
                    ? stored
                    : {}
                ),

                interactionId:
                  INTERACTION_ID,
              }),
              "utf8",
            );

            const getInteraction =
              getterEchoing(
                "queued",
              );

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction,
                },
              ),
            ).rejects.toThrow();

            expect(
              getInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "looks up exactly the persisted providerExecutionId once",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const persisted =
              await readExecutionSubmission(
                mediaRoot,
                "EP92",
                "S01",
              );

            expect(
              persisted?.providerExecutionId,
            ).toBe(
              INTERACTION_ID,
            );

            const getInteraction =
              getterEchoing(
                "in_progress",
              );

            await recoverGoogleGenAiSingleShot(
              recoveryInput(
                mediaRoot,
              ),
              {
                getInteraction,
              },
            );

            expect(
              getInteraction,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              getInteraction,
            ).toHaveBeenCalledWith(
              INTERACTION_ID,
            );
          },
        );

        it.each([
          "providerExecutionId",
          "interactionId",
        ])(
          "rejects a caller-supplied replacement %s before reading or looking up",
          async (field) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const getInteraction =
              getterEchoing(
                "queued",
              );

            const widenedInput = {
              ...recoveryInput(
                mediaRoot,
              ),

              [field]:
                "v1_replacement-interaction",
            };

            await expect(
              recoverGoogleGenAiSingleShot(
                widenedInput,
                {
                  getInteraction,
                },
              ),
            ).rejects.toThrow(
              /does not accept a caller-supplied/i,
            );

            expect(
              getInteraction,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    describe(
      "returned interaction id integrity",
      () => {
        it.each([
          [
            "undefined",
            undefined,
          ],
          [
            "null",
            null,
          ],
          [
            "numeric",
            12345,
          ],
          [
            "blank",
            "   ",
          ],
          [
            "different",
            "v1_some-other-interaction",
          ],
          [
            "whitespace-padded",
            `  ${INTERACTION_ID}  `,
          ],
        ])(
          "fails closed on a %s returned id",
          async (
            _label,
            id,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const getInteraction =
              getterReturning({
                id,

                status:
                  "completed",
              });

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction,
                },
              ),
            ).rejects.toThrow(
              /interaction id|does not match durable providerExecutionId/i,
            );

            expect(
              getInteraction,
            ).toHaveBeenCalledTimes(
              1,
            );
          },
        );

        it(
          "accepts a returned id exactly equal to the persisted providerExecutionId",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const result =
              await recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction:
                    getterReturning({
                      id:
                        INTERACTION_ID,

                      status:
                        "queued",
                    }),
                },
              );

            expect(
              result.providerExecutionId,
            ).toBe(
              INTERACTION_ID,
            );
          },
        );
      },
    );

    describe(
      "lifecycle classification",
      () => {
        it.each([
          [
            "queued",
            "PENDING",
          ],
          [
            "in_progress",
            "PENDING",
          ],
          [
            "completed",
            "SUCCESS",
          ],
          [
            "failed",
            "TERMINAL_FAILURE",
          ],
          [
            "cancelled",
            "TERMINAL_FAILURE",
          ],
          [
            "incomplete",
            "TERMINAL_FAILURE",
          ],
          [
            "budget_exceeded",
            "TERMINAL_FAILURE",
          ],
        ])(
          "returns %s as %s in a narrow frozen result",
          async (
            status,
            lifecycleClass,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const result =
              await recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction:
                    vi.fn<GoogleGenAiInteractionGetter>(
                      async (providerExecutionId) => ({
                        id:
                          providerExecutionId,

                        status,

                        outputs: [
                          {
                            type:
                              "video",
                          },
                        ],
                      }),
                    ),
                },
              );

            expect(
              lifecycleClass,
            ).toBe(
              classifyGoogleGenAiInteractionStatus(
                status,
              ),
            );

            expect(
              result,
            ).toStrictEqual({
              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                INTERACTION_ID,

              remoteStatus:
                status,

              lifecycleClass,
            });

            expect(
              Object.isFrozen(
                result,
              ),
            ).toBe(
              true,
            );
          },
        );

        it(
          "covers every pinned Google interaction status",
          () => {
            expect(
              [
                ...GOOGLE_GENAI_INTERACTION_STATUSES,
              ].sort(),
            ).toEqual([
              "budget_exceeded",
              "cancelled",
              "completed",
              "failed",
              "in_progress",
              "incomplete",
              "queued",
              "requires_action",
            ]);
          },
        );

        it(
          "fails closed on requires_action",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            expect(
              classifyGoogleGenAiInteractionStatus(
                "requires_action",
              ),
            ).toBe(
              "ACTION_REQUIRED_UNSUPPORTED",
            );

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction:
                    getterEchoing(
                      "requires_action",
                    ),
                },
              ),
            ).rejects.toThrow(
              /requires client action/i,
            );
          },
        );

        it.each([
          [
            "unknown string",
            "succeeded",
          ],
          [
            "blank string",
            "",
          ],
          [
            "uppercase variant",
            "COMPLETED",
          ],
          [
            "number",
            1,
          ],
          [
            "null",
            null,
          ],
          [
            "undefined",
            undefined,
          ],
        ])(
          "fails closed on %s status through the existing classifier",
          async (
            _label,
            status,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            expect(
              () =>
                classifyGoogleGenAiInteractionStatus(
                  status,
                ),
            ).toThrow();

            await expect(
              recoverGoogleGenAiSingleShot(
                recoveryInput(
                  mediaRoot,
                ),
                {
                  getInteraction:
                    getterEchoing(
                      status,
                    ),
                },
              ),
            ).rejects.toThrow(
              /Google GenAI interaction status/,
            );
          },
        );
      },
    );

    describe(
      "no side effects",
      () => {
        it(
          "writes nothing durably for a remote success",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistGoogleSubmission(
              mediaRoot,
            );

            const submissionPath =
              createExecutionSubmissionPath(
                mediaRoot,
                "EP92",
                "S01",
              );

            const before =
              await readFile(
                submissionPath,
              );

            await recoverGoogleGenAiSingleShot(
              recoveryInput(
                mediaRoot,
              ),
              {
                getInteraction:
                  getterEchoing(
                    "completed",
                  ),
              },
            );

            expect(
              (
                await readFile(
                  submissionPath,
                )
              ).equals(
                before,
              ),
            ).toBe(
              true,
            );

            const { readdir } =
              await import(
                "node:fs/promises"
              );

            expect(
              (
                await readdir(
                  dirname(
                    submissionPath,
                  ),
                )
              ).sort(),
            ).toEqual([
              "EP92_S01.execution-reservation.json",
              "EP92_S01.execution-submission.json",
            ]);
          },
        );

        it(
          "keeps the recovery source free of SDK, creator, completion, reconciliation, routing, and create machinery",
          async () => {
            const source =
              (
                await readFile(
                  join(
                    process.cwd(),
                    RECOVERY_SOURCE,
                  ),
                  "utf8",
                )
              )
                .replace(
                  /\/\*[\s\S]*?\*\//g,
                  "",
                )
                .replace(
                  /\/\/.*$/gm,
                  "",
                );

            expect(
              source,
            ).not.toMatch(
              /@google\/genai|createGoogleGenAiSingleShotProductionInteraction|createInteraction|submitGoogleGenAiSingleShot|createExecutionSubmission|createExecutionCompletion|reconcileExecutionLifecycle|evaluateShotProvider|assessPreReservationProviderOptimization|executeSingleShot|\.create\(|\.cancel\(|\.delete\(|writeFile|process\.env|setTimeout|\bwhile\s*\(/,
            );
          },
        );
      },
    );
  },
);
