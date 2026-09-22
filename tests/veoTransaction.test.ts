import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
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

import {
  writeVeoGenerationRecord,
} from "../src/veo/audit/writeVeoGenerationRecord.js";

import {
  prepareVeoImageAsset,
} from "../src/veo/assets/prepareVeoImageAsset.js";

import {
  runVeoImageToVideoTransaction,
  type VeoOutputPersister,
} from "../src/veo/execution/runVeoImageToVideoTransaction.js";

import {
  persistVeoGeneratedVideo,
} from "../src/veo/output/persistVeoGeneratedVideo.js";

import {
  loadVeoPolicy,
} from "../src/validation/loadVeoPolicy.js";

const directories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-veo-transaction-",
      ),
    );

  directories.push(
    directory,
  );

  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories
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
});

describe(
  "Busybookie Veo image-to-video transaction",
  () => {
    it(
      "completes a fully mocked transaction with output integrity and audit metadata",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const sourceImagePath =
          join(
            mediaRoot,
            "reference.png",
          );

        await writeFile(
          sourceImagePath,
          Buffer.from([
            1,
            2,
            3,
            4,
          ]),
        );

        const policy =
          await loadVeoPolicy();

        const executeGeneration =
          vi.fn(
            async () => ({
              operationName:
                "operations/mock-veo-123",

              generatedVideos: [
                {
                  video: {
                    uri:
                      "https://example.test/generated.mp4",

                    mimeType:
                      "video/mp4",
                  },
                },
              ],

              raiMediaFilteredCount:
                0,

              raiMediaFilteredReasons:
                [],
            }),
          );

        const mockVideo =
          Buffer.from(
            "mock-busybookie-veo-video",
          );

        const downloadFile =
          vi.fn(
            async (
              params,
            ) => {
              await writeFile(
                params.downloadPath,
                mockVideo,
              );
            },
          );

        const persistGeneratedVideo:
          VeoOutputPersister =
          (
            generatedVideo,
            destinationPath,
            maxBytes,
          ) =>
            persistVeoGeneratedVideo(
              generatedVideo,
              destinationPath,
              downloadFile,
              maxBytes,
            );

        const result =
          await runVeoImageToVideoTransaction(
            {
              episodeId:
                "EP90",

              shotId:
                "S01",

              sourceImagePath,

              promptText:
                "Ollie stands calmly in Littleleaf Valley while the leaves move gently.",

              durationSeconds:
                4,

              mediaRoot,

              policy,
            },
            {
              prepareImageAsset:
                prepareVeoImageAsset,

              executeGeneration,

              persistGeneratedVideo,

              writeGenerationRecord:
                writeVeoGenerationRecord,

              now:
                () =>
                  "2026-09-22T19:00:00.000Z",
            },
          );

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          downloadFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record
            .operationName,
        ).toBe(
          "operations/mock-veo-123",
        );

        expect(
          result.record
            .costPolicy
            .locallyExpectedCents,
        ).toBe(
          40,
        );

        expect(
          result.record.outputs,
        ).toHaveLength(
          1,
        );

        const output =
          result.record
            .outputs[0];

        if (!output) {
          throw new Error(
            "Expected one Veo output.",
          );
        }

        expect(
          await readFile(
            output.destinationPath,
          ),
        ).toEqual(
          mockVideo,
        );

        const rawAudit =
          await readFile(
            result.recordPath,
            "utf8",
          );

        expect(
          rawAudit,
        ).not.toContain(
          "https://example.test/generated.mp4",
        );

        const audit =
          JSON.parse(
            rawAudit,
          ) as {
            operationName:
              string;

            outputs:
              Array<{
                sha256:
                  string;
              }>;
          };

        expect(
          audit.operationName,
        ).toBe(
          "operations/mock-veo-123",
        );

        expect(
          audit.outputs[0]
            ?.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      "blocks an unsupported duration before preparing assets or executing Veo",
      async () => {
        const policy =
          await loadVeoPolicy();

        const prepareImageAsset =
          vi.fn();

        const executeGeneration =
          vi.fn();

        const persistGeneratedVideo =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runVeoImageToVideoTransaction(
            {
              episodeId:
                "EP90",

              shotId:
                "S01",

              sourceImagePath:
                "D:/reference.png",

              promptText:
                "This must never reach Veo.",

              durationSeconds:
                5,

              mediaRoot:
                "D:/Busybookie/Production",

              policy,
            },
            {
              prepareImageAsset,
              executeGeneration,
              persistGeneratedVideo,
              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /not allowed/,
        );

        expect(
          prepareImageAsset,
        ).not.toHaveBeenCalled();

        expect(
          executeGeneration,
        ).not.toHaveBeenCalled();

        expect(
          persistGeneratedVideo,
        ).not.toHaveBeenCalled();

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when Veo returns an unexpected number of outputs",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const sourceImagePath =
          join(
            mediaRoot,
            "reference.png",
          );

        await writeFile(
          sourceImagePath,
          Buffer.from([
            1,
            2,
          ]),
        );

        const policy =
          await loadVeoPolicy();

        const persistGeneratedVideo =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runVeoImageToVideoTransaction(
            {
              episodeId:
                "EP90",

              shotId:
                "S01",

              sourceImagePath,

              promptText:
                "Test output-count validation.",

              durationSeconds:
                4,

              mediaRoot,

              policy,
            },
            {
              prepareImageAsset:
                prepareVeoImageAsset,

              executeGeneration:
                async () => ({
                  operationName:
                    "operations/output-count",

                  generatedVideos: [
                    {
                      video: {
                        videoBytes:
                          "AQID",

                        mimeType:
                          "video/mp4",
                      },
                    },
                    {
                      video: {
                        videoBytes:
                          "BAUG",

                        mimeType:
                          "video/mp4",
                      },
                    },
                  ],

                  raiMediaFilteredCount:
                    0,

                  raiMediaFilteredReasons:
                    [],
                }),

              persistGeneratedVideo,

              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /expected 1/,
        );

        expect(
          persistGeneratedVideo,
        ).not.toHaveBeenCalled();

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
