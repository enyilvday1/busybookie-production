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
  portableReleasePathExists,
} from "../src/deployment/portableReleaseFilesystem.js";

const roots:
  string[] =
  [];

async function root(): Promise<string> {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-filesystem-",
      ),
    );

  roots.push(
    value,
  );

  return value;
}

afterEach(
  async () => {
    await Promise.all(
      roots.splice(
        0,
      ).map(
        value =>
          rm(
            value,
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

describe(
  "portable release filesystem",
  () => {
    it(
      "reports an existing directory",
      async () => {
        const directory =
          await root();

        await expect(
          portableReleasePathExists(
            directory,
          ),
        ).resolves.toBe(
          true,
        );
      },
    );

    it(
      "reports an existing regular file",
      async () => {
        const directory =
          await root();

        const file =
          join(
            directory,
            "file.txt",
          );

        await writeFile(
          file,
          "busybookie",
          "utf8",
        );

        await expect(
          portableReleasePathExists(
            file,
          ),
        ).resolves.toBe(
          true,
        );
      },
    );

    it(
      "reports a missing path as false",
      async () => {
        const directory =
          await root();

        await expect(
          portableReleasePathExists(
            join(
              directory,
              "missing",
            ),
          ),
        ).resolves.toBe(
          false,
        );
      },
    );

    it(
      "does not convert unrelated filesystem failures into missing paths",
      async () => {
        await expect(
          portableReleasePathExists(
            "\0",
          ),
        ).rejects.toThrow();
      },
    );
  },
);
