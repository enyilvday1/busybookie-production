import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  downloadDialogueAudioOutput,
} from "../src/dialogue/downloadDialogueAudioOutput.js";

import {
  runRunwayElevenV3DialogueTransaction,
} from "../src/dialogue/runRunwayElevenV3Transaction.js";

import {
  writeDialogueGenerationRecord,
} from "../src/dialogue/writeDialogueGenerationRecord.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

const temporaryDirectories:
  string[] = [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-transaction-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(
        0,
      )
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
});

function createPlan(
  text:
    string =
      "Look what I found!",
): ShotDialoguePlan {
  return {
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

        text,

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
  };
}

describe(
  "Busybookie Runway Eleven v3 dialogue transaction",
  () => {
    it(
      "completes a fully mocked dialogue transaction and writes durable local provenance",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const policy =
          await loadDialogueVoicePolicy();

        const executeGeneration =
          vi.fn(
            async () => ({
              taskId:
                "task-dialogue-123",

              providerCreatedAt:
                "2026-10-01T15:00:00.000Z",

              estimatedCredits:
                1,

              finalCredits:
                1,

              outputUrls: [
                "https://example.test/dialogue-output",
              ],
            }),
          );

        const mockAudio =
          Buffer.from(
            "mock-busybookie-dialogue-audio",
          );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                mockAudio,
                {
                  status:
                    200,

                  headers: {
                    "content-type":
                      "audio/mpeg",

                    "content-length":
                      String(
                        mockAudio.length,
                      ),
                  },
                },
              ),
          );

        const downloadOutput =
          (
            sourceUrl:
              string,

            destinationPath:
              string,
          ) =>
            downloadDialogueAudioOutput(
              sourceUrl,
              destinationPath,
              fetchMock,
            );

        const plan =
          createPlan();

        const result =
          await runRunwayElevenV3DialogueTransaction(
            {
              plan,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot,

              policy,
            },
            {
              executeGeneration,

              downloadOutput,

              writeGenerationRecord:
                writeDialogueGenerationRecord,

              now:
                () =>
                  "2026-10-01T15:01:00.000Z",
            },
          );

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeGeneration,
        ).toHaveBeenCalledWith(
          {
            model:
              "eleven_v3",

            promptText:
              "Look what I found!",

            voice: {
              type:
                "runway-preset",

              presetId:
                "Chad",
            },

            applyTextNormalization:
              "auto",

            languageCode:
              "en",

            seed:
              0,

            similarityBoost:
              0.75,

            speed:
              1,

            stability:
              0.5,

            style:
              0,

            useSpeakerBoost:
              true,
          },
          policy.task.waitTimeoutMs,
          {
            request: {
              model:
                "eleven_v3",

              promptText:
                "Look what I found!",

              voice: {
                type:
                  "runway-preset",

                presetId:
                  "Chad",
              },

              applyTextNormalization:
                "auto",

              languageCode:
                "en",

              seed:
                0,

              similarityBoost:
                0.75,

              speed:
                1,

              stability:
                0.5,

              style:
                0,

              useSpeakerBoost:
                true,
            },

            locallyExpectedCredits:
              1,

            plan: {
              planKey:
                "a".repeat(
                  64,
                ),

              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialogueLineId:
                "EP02_SC01_S02_L01",

              lineNumber:
                1,

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
          },
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record,
        ).toMatchObject({
          schemaVersion:
            "1.0",

          recordedAt:
            "2026-10-01T15:01:00.000Z",

          status:
            "SUCCEEDED",

          provider:
            "RUNWAY",

          providerExecutionId:
            "task-dialogue-123",

          providerModel:
            "eleven_v3",

          providerCreatedAt:
            "2026-10-01T15:00:00.000Z",

          credits: {
            locallyExpected:
              1,

            providerEstimated:
              1,

            providerFinal:
              1,
          },

          plan: {
            dialogueLineId:
              "EP02_SC01_S02_L01",

            text:
              "Look what I found!",

            voice: {
              provider:
                "RUNWAY",

              voiceName:
                "Chad",
            },
          },
        });

        expect(
          result.record.outputs,
        ).toHaveLength(
          1,
        );

        const localOutput =
          result.record.outputs[0];

        if (!localOutput) {
          throw new Error(
            "Expected one durable dialogue output.",
          );
        }

        expect(
          localOutput.destinationPath,
        ).toMatch(
          /EP02_SC01_S02_L01_RUNWAY_task-dialogue-123_01\.audio$/,
        );

        expect(
          await readFile(
            localOutput.destinationPath,
          ),
        ).toEqual(
          mockAudio,
        );

        expect(
          localOutput.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        const rawRecord =
          await readFile(
            result.recordPath,
            "utf8",
          );

        expect(
          rawRecord,
        ).not.toContain(
          "https://example.test/dialogue-output",
        );
      },
    );

    it(
      "blocks an over-limit dialogue before execution, download, or record writing",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const executeGeneration =
          vi.fn();

        const downloadOutput =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runRunwayElevenV3DialogueTransaction(
            {
              plan:
                createPlan(
                  "x".repeat(
                    501,
                  ),
                ),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                "D:/Busybookie/Production",

              policy,
            },
            {
              executeGeneration,

              downloadOutput,

              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /500-character limit|exceed/i,
        );

        expect(
          executeGeneration,
        ).not.toHaveBeenCalled();

        expect(
          downloadOutput,
        ).not.toHaveBeenCalled();

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when the requested dialogue line does not belong to the canonical plan",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const executeGeneration =
          vi.fn();

        const downloadOutput =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runRunwayElevenV3DialogueTransaction(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L02",

              mediaRoot:
                "D:/Busybookie/Production",

              policy,
            },
            {
              executeGeneration,

              downloadOutput,

              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /dialogue line.*plan|plan.*dialogue line/i,
        );

        expect(
          executeGeneration,
        ).not.toHaveBeenCalled();

        expect(
          downloadOutput,
        ).not.toHaveBeenCalled();

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
