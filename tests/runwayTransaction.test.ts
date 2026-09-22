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
  writeRunwayGenerationRecord,
} from "../src/runway/audit/writeRunwayGenerationRecord.js";

import {
  resolveRunwayImageAsset,
} from "../src/runway/assets/resolveRunwayImageAsset.js";

import {
  runRunwayGen45Transaction,
} from "../src/runway/execution/runRunwayGen45Transaction.js";

import {
  downloadRunwayOutput,
} from "../src/runway/output/downloadRunwayOutput.js";

import {
  loadRunwayPolicy,
} from "../src/validation/loadRunwayPolicy.js";

const temporaryDirectories:
  string[] = [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-transaction-",
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
      .splice(0)
      .map(
        (directory) =>
          rm(
            directory,
            {
              recursive: true,
              force: true,
            },
          ),
      ),
  );
});

describe(
  "Busybookie Runway generation transaction",
  () => {
    it(
      "completes a fully mocked Gen-4.5 transaction and writes durable local metadata",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const sourceImagePath =
          join(
            mediaRoot,
            "littleleaf-reference.png",
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
          await loadRunwayPolicy();

        const ephemeralUploader =
          vi.fn(
            async () =>
              "runway://not-needed",
          );

        const resolveImage =
          (
            filePath: string,
          ) =>
            resolveRunwayImageAsset(
              filePath,
              ephemeralUploader,
            );

        const executeGeneration =
          vi.fn(
            async () => ({
              taskId:
                "mock-task-123",

              estimatedCredits:
                60,

              finalCredits:
                60,

              outputUrls: [
                "https://example.test/generated.mp4",
              ],
            }),
          );

        const mockVideo =
          Buffer.from(
            "mock-busybookie-video",
          );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                mockVideo,
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "video/mp4",

                    "content-length":
                      String(
                        mockVideo.length,
                      ),
                  },
                },
              ),
          );

        const downloadOutput =
          (
            sourceUrl: string,
            destinationPath: string,
          ) =>
            downloadRunwayOutput(
              sourceUrl,
              destinationPath,
              fetchMock,
            );

        const result =
          await runRunwayGen45Transaction(
            {
              episodeId:
                "EP02",

              shotId:
                "S01",

              sourceImagePath,

              promptText:
                "A gentle morning breeze moves through Littleleaf Valley while sunlight sparkles softly.",

              durationSeconds:
                5,

              mediaRoot,

              policy,
            },
            {
              resolveImageAsset:
                resolveImage,

              executeGeneration,

              downloadOutput,

              writeGenerationRecord:
                writeRunwayGenerationRecord,

              now: () =>
                "2026-09-22T16:30:00.000Z",
            },
          );

        expect(
          ephemeralUploader,
        ).not.toHaveBeenCalled();

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record.taskId,
        ).toBe(
          "mock-task-123",
        );

        expect(
          result.record.credits,
        ).toEqual({
          locallyExpected:
            60,

          providerEstimated:
            60,

          providerFinal:
            60,
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
            "Expected one local output.",
          );
        }

        expect(
          await readFile(
            localOutput.destinationPath,
          ),
        ).toEqual(
          mockVideo,
        );

        const storedMetadata =
          JSON.parse(
            await readFile(
              result.recordPath,
              "utf8",
            ),
          ) as {
            taskId: string;
            outputs: Array<{
              sha256: string;
            }>;
          };

        expect(
          storedMetadata.taskId,
        ).toBe(
          "mock-task-123",
        );

        expect(
          storedMetadata.outputs[0]?.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        const rawMetadata =
          await readFile(
            result.recordPath,
            "utf8",
          );

        expect(
          rawMetadata,
        ).not.toContain(
          "https://example.test/generated.mp4",
        );
      },
    );

    it(
      "blocks an over-limit generation before resolving assets or executing Runway",
      async () => {
        const policy =
          await loadRunwayPolicy();

        const resolveImageAsset =
          vi.fn();

        const executeGeneration =
          vi.fn();

        const downloadOutput =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runRunwayGen45Transaction(
            {
              episodeId:
                "EP02",

              shotId:
                "S01",

              sourceImagePath:
                "D:/Busybookie/Production/reference.png",

              promptText:
                "This request must never reach Runway.",

              durationSeconds:
                6,

              mediaRoot:
                "D:/Busybookie/Production",

              policy,
            },
            {
              resolveImageAsset,
              executeGeneration,
              downloadOutput,
              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /exceeds the local 5s/,
        );

        expect(
          resolveImageAsset,
        ).not.toHaveBeenCalled();

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
