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
  vi,
} from "vitest";

import {
  resolveRunwayImageAsset,
} from "../src/runway/assets/resolveRunwayImageAsset.js";

const temporaryDirectories:
  string[] = [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-resolve-",
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
  "Busybookie Runway asset resolution",
  () => {
    it(
      "uses a data URI without calling the uploader for a small image",
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

        const uploader =
          vi.fn();

        const resolved =
          await resolveRunwayImageAsset(
            filePath,
            uploader,
          );

        expect(
          resolved.strategy,
        ).toBe(
          "DATA_URI",
        );

        expect(
          resolved.uri,
        ).toMatch(
          /^data:image\/png;base64,/,
        );

        expect(
          uploader,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "uses the ephemeral uploader for a large image",
      async () => {
        const directory =
          await createTempDirectory();

        const filePath =
          join(
            directory,
            "large-reference.png",
          );

        await writeFile(
          filePath,
          Buffer.alloc(
            3_800_000,
          ),
        );

        const uploader =
          vi.fn(
            async () =>
              "runway://temporary-reference",
          );

        const resolved =
          await resolveRunwayImageAsset(
            filePath,
            uploader,
          );

        expect(
          resolved.strategy,
        ).toBe(
          "EPHEMERAL_UPLOAD",
        );

        expect(
          resolved.uri,
        ).toBe(
          "runway://temporary-reference",
        );

        expect(
          uploader,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "rejects an invalid ephemeral-upload URI",
      async () => {
        const directory =
          await createTempDirectory();

        const filePath =
          join(
            directory,
            "large-reference.png",
          );

        await writeFile(
          filePath,
          Buffer.alloc(
            3_800_000,
          ),
        );

        await expect(
          resolveRunwayImageAsset(
            filePath,
            async () =>
              "https://unexpected.example/file",
          ),
        ).rejects.toThrow(
          /invalid URI/,
        );
      },
    );
  },
);
