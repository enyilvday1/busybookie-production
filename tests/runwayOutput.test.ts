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

import {
  downloadRunwayOutput,
} from "../src/runway/output/downloadRunwayOutput.js";

import {
  createRunwayVideoOutputPath,
} from "../src/runway/output/runwayOutputPath.js";

const temporaryDirectories:
  string[] = [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-output-",
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
  "Busybookie Runway output",
  () => {
    it(
      "creates a deterministic T7-style video path",
      () => {
        const result =
          createRunwayVideoOutputPath(
            "D:/Busybookie/Production",
            "EP02",
            "S01",
            "task-123",
            1,
          );

        expect(
          result.replaceAll(
            "\\",
            "/",
          ),
        ).toMatch(
          /D:\/Busybookie\/Production\/generated-video\/EP02\/S01\/EP02_S01_task-123_01\.mp4$/,
        );
      },
    );

    it(
      "downloads an HTTPS output and calculates its SHA-256 hash",
      async () => {
        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const body =
          Buffer.from(
            "mock-runway-video",
          );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                body,
                {
                  status: 200,
                  headers: {
                    "content-type":
                      "video/mp4",
                    "content-length":
                      String(
                        body.length,
                      ),
                  },
                },
              ),
          );

        const result =
          await downloadRunwayOutput(
            "https://example.test/output.mp4",
            destinationPath,
            fetchMock,
          );

        expect(
          result.bytes,
        ).toBe(
          body.length,
        );

        expect(
          result.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          result.contentType,
        ).toBe(
          "video/mp4",
        );

        expect(
          await readFile(
            destinationPath,
            "utf8",
          ),
        ).toBe(
          "mock-runway-video",
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "rejects a non-HTTPS source URL",
      async () => {
        const directory =
          await createTempDirectory();

        await expect(
          downloadRunwayOutput(
            "http://example.test/output.mp4",
            join(
              directory,
              "output.mp4",
            ),
            vi.fn(),
          ),
        ).rejects.toThrow(
          /must use HTTPS/,
        );
      },
    );

    it(
      "blocks an output that exceeds the configured byte limit",
      async () => {
        const directory =
          await createTempDirectory();

        const body =
          Buffer.from(
            "123456",
          );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                body,
                {
                  status: 200,
                  headers: {
                    "content-length":
                      String(
                        body.length,
                      ),
                  },
                },
              ),
          );

        await expect(
          downloadRunwayOutput(
            "https://example.test/output.mp4",
            join(
              directory,
              "output.mp4",
            ),
            fetchMock,
            5,
          ),
        ).rejects.toThrow(
          /download limit/,
        );
      },
    );
  },
);
