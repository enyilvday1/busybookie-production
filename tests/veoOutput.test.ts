import {
  createHash,
} from "node:crypto";

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
  persistVeoGeneratedVideo,
} from "../src/veo/output/persistVeoGeneratedVideo.js";

import {
  createVeoVideoOutputPath,
} from "../src/veo/output/veoOutputPath.js";

const directories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-veo-output-",
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
  "Busybookie Veo output persistence",
  () => {
    it(
      "creates a deterministic T7-style output path",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const outputPath =
          createVeoVideoOutputPath(
            mediaRoot,
            "EP90",
            "S01",
            "operations/abc-123",
            1,
          );

        expect(
          outputPath,
        ).toContain(
          join(
            "generated-video",
            "EP90",
            "S01",
            "EP90_S01_abc-123_01.mp4",
          ),
        );
      },
    );

    it(
      "persists a URI-backed SDK video and calculates SHA-256",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const mockVideo =
          Buffer.from(
            "mock-veo-video",
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

        const result =
          await persistVeoGeneratedVideo(
            {
              video: {
                uri:
                  "https://example.test/video.mp4",

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          );

        expect(
          downloadFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          mockVideo,
        );

        expect(
          result.bytes,
        ).toBe(
          mockVideo.length,
        );

        expect(
          result.sha256,
        ).toBe(
          createHash(
            "sha256",
          )
            .update(
              mockVideo,
            )
            .digest(
              "hex",
            ),
        );
      },
    );

    it(
      "persists inline video bytes without invoking the SDK downloader",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "inline.mp4",
          );

        const mockVideo =
          Buffer.from(
            "inline-veo-video",
          );

        const downloadFile =
          vi.fn();

        const result =
          await persistVeoGeneratedVideo(
            {
              video: {
                videoBytes:
                  mockVideo
                    .toString(
                      "base64",
                    ),

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          );

        expect(
          downloadFile,
        ).not.toHaveBeenCalled();

        expect(
          result.bytes,
        ).toBe(
          mockVideo.length,
        );

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          mockVideo,
        );
      },
    );

    it(
      "refuses to overwrite an existing final output",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "protected.mp4",
          );

        await writeFile(
          destinationPath,
          Buffer.from(
            "existing",
          ),
        );

        const mockVideo =
          Buffer.from(
            "replacement",
          );

        await expect(
          persistVeoGeneratedVideo(
            {
              video: {
                videoBytes:
                  mockVideo
                    .toString(
                      "base64",
                    ),

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            vi.fn(),
          ),
        ).rejects.toThrow(
          /already exists/,
        );

        expect(
          await readFile(
            destinationPath,
            "utf8",
          ),
        ).toBe(
          "existing",
        );
      },
    );
  },
);
