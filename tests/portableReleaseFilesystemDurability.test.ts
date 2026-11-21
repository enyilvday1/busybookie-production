import {
  mkdtemp,
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
} from "vitest";

import {
  syncPortableReleaseDirectory,
} from "../src/deployment/portableReleaseFilesystemDurability.js";

const roots:
  string[] =
  [];

async function root(): Promise<string> {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-directory-durability-",
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
  "portable release filesystem durability",
  () => {
    it(
      "syncs an existing directory without changing its contents",
      async () => {
        const directory =
          await root();

        await expect(
          syncPortableReleaseDirectory(
            directory,
          ),
        ).resolves.toBeUndefined();
      },
    );

    it(
      "fails closed when the directory does not exist",
      async () => {
        const directory =
          await root();

        const missing =
          join(
            directory,
            "missing",
          );

        await expect(
          syncPortableReleaseDirectory(
            missing,
          ),
        ).rejects.toThrow();
      },
    );
  },
);
