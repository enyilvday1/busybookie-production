import {
  mkdtemp,
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
} from "vitest";

import {
  prepareVeoImageAsset,
} from "../src/veo/assets/prepareVeoImageAsset.js";

const directories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-veo-image-",
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
              recursive: true,
              force: true,
            },
          ),
      ),
  );
});

describe(
  "Busybookie Veo image assets",
  () => {
    it(
      "converts a PNG into the SDK inline-image shape",
      async () => {
        const directory =
          await makeTempDirectory();

        const filePath =
          join(
            directory,
            "reference.png",
          );

        const bytes =
          Buffer.from([
            1,
            2,
            3,
            4,
          ]);

        await writeFile(
          filePath,
          bytes,
        );

        const asset =
          await prepareVeoImageAsset(
            filePath,
            1_000_000,
          );

        expect(
          asset.sourceBytes,
        ).toBe(4);

        expect(
          asset.image.mimeType,
        ).toBe(
          "image/png",
        );

        expect(
          asset.image.imageBytes,
        ).toBe(
          bytes.toString(
            "base64",
          ),
        );
      },
    );

    it(
      "maps JPEG extensions correctly",
      async () => {
        const directory =
          await makeTempDirectory();

        const filePath =
          join(
            directory,
            "reference.jpg",
          );

        await writeFile(
          filePath,
          Buffer.from([
            5,
            6,
          ]),
        );

        const asset =
          await prepareVeoImageAsset(
            filePath,
            1_000_000,
          );

        expect(
          asset.image.mimeType,
        ).toBe(
          "image/jpeg",
        );
      },
    );

    it(
      "rejects relative paths",
      async () => {
        await expect(
          prepareVeoImageAsset(
            "relative.png",
            1_000_000,
          ),
        ).rejects.toThrow(
          /absolute/,
        );
      },
    );

    it(
      "enforces the local source-size ceiling",
      async () => {
        const directory =
          await makeTempDirectory();

        const filePath =
          join(
            directory,
            "reference.webp",
          );

        await writeFile(
          filePath,
          Buffer.alloc(
            20,
          ),
        );

        await expect(
          prepareVeoImageAsset(
            filePath,
            10,
          ),
        ).rejects.toThrow(
          /source limit/,
        );
      },
    );
  },
);
