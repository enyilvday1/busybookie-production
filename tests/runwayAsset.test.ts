import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyRunwayImageAsset,
  estimateBase64Length,
  prepareRunwayImageAsset,
} from "../src/runway/assets/runwayImageAsset.js";

const temporaryDirectories:
  string[] = [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-runway-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(
      0,
    ).map(
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
  "Busybookie Runway image assets",
  () => {
    it(
      "calculates base64 expansion correctly",
      () => {
        expect(
          estimateBase64Length(
            3,
          ),
        ).toBe(4);

        expect(
          estimateBase64Length(
            4,
          ),
        ).toBe(8);
      },
    );

    it(
      "classifies a small PNG for data-URI transport",
      async () => {
        const directory =
          await createTempDirectory();

        const filePath =
          join(
            directory,
            "reference.png",
          );

        await writeFile(
          filePath,
          Buffer.from([
            137,
            80,
            78,
            71,
            1,
            2,
            3,
          ]),
        );

        const asset =
          await classifyRunwayImageAsset(
            filePath,
          );

        expect(
          asset.strategy,
        ).toBe(
          "DATA_URI",
        );

        expect(
          asset.mimeType,
        ).toBe(
          "image/png",
        );
      },
    );

    it(
      "creates a data URI for a small supported image",
      async () => {
        const directory =
          await createTempDirectory();

        const filePath =
          join(
            directory,
            "reference.png",
          );

        await writeFile(
          filePath,
          Buffer.from([
            1,
            2,
            3,
          ]),
        );

        const prepared =
          await prepareRunwayImageAsset(
            filePath,
          );

        expect(
          prepared.strategy,
        ).toBe(
          "DATA_URI",
        );

        if (
          prepared.strategy ===
          "DATA_URI"
        ) {
          expect(
            prepared.uri.startsWith(
              "data:image/png;base64,",
            ),
          ).toBe(true);
        }
      },
    );

    it(
      "rejects unsupported image extensions",
      async () => {
        const directory =
          await createTempDirectory();

        const filePath =
          join(
            directory,
            "reference.bmp",
          );

        await writeFile(
          filePath,
          "not-used",
        );

        await expect(
          classifyRunwayImageAsset(
            filePath,
          ),
        ).rejects.toThrow(
          /Unsupported Runway image type/,
        );
      },
    );

    it(
      "rejects relative asset paths",
      async () => {
        await expect(
          classifyRunwayImageAsset(
            "reference.png",
          ),
        ).rejects.toThrow(
          /must be absolute/,
        );
      },
    );
  },
);
