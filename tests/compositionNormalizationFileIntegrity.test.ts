import {
  createHash,
} from "node:crypto";

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
  inspectCompositionNormalizationFile,
} from "../src/composition/inspectCompositionNormalizationFile.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-composition-file-integrity-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(
          0,
        )
        .map(
          (
            directory,
          ) =>
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
  },
);

describe(
  "Busybookie composition normalization file integrity",
  () => {
    it(
      "returns frozen byte and SHA-256 evidence for a stable non-empty file",
      async () => {
        const root =
          await makeTempDirectory();

        const filePath =
          join(
            root,
            "normalized.mp4",
          );

        const payload =
          Buffer.from(
            "busybookie-normalized-artifact",
            "utf8",
          );

        await writeFile(
          filePath,
          payload,
        );

        const inspected =
          await inspectCompositionNormalizationFile(
            filePath,
            1_000,
          );

        expect(
          inspected,
        ).toEqual({
          bytes:
            payload.length,

          sha256:
            createHash(
              "sha256",
            )
              .update(
                payload,
              )
              .digest(
                "hex",
              ),
        });

        expect(
          Object.isFrozen(
            inspected,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "fails closed when the file contains no data",
      async () => {
        const root =
          await makeTempDirectory();

        const filePath =
          join(
            root,
            "empty.mp4",
          );

        await writeFile(
          filePath,
          Buffer.alloc(
            0,
          ),
        );

        await expect(
          inspectCompositionNormalizationFile(
            filePath,
            1_000,
          ),
        ).rejects.toThrow(
          /contained no data|empty/i,
        );
      },
    );

    it(
      "fails closed when the file exceeds the configured byte limit",
      async () => {
        const root =
          await makeTempDirectory();

        const filePath =
          join(
            root,
            "oversized.mp4",
          );

        await writeFile(
          filePath,
          Buffer.from(
            "12345",
            "utf8",
          ),
        );

        await expect(
          inspectCompositionNormalizationFile(
            filePath,
            4,
          ),
        ).rejects.toThrow(
          /exceed.*4.*byte|4.*byte.*limit/i,
        );
      },
    );

    it(
      "rejects a non-positive maximum byte limit",
      async () => {
        const root =
          await makeTempDirectory();

        const filePath =
          join(
            root,
            "normalized.mp4",
          );

        await writeFile(
          filePath,
          "payload",
          "utf8",
        );

        await expect(
          inspectCompositionNormalizationFile(
            filePath,
            0,
          ),
        ).rejects.toThrow(
          /maximum.*positive.*integer|positive.*safe integer/i,
        );
      },
    );
  },
);
