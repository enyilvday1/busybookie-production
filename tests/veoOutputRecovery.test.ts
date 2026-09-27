import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  readFile,
  readdir,
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
  recoverVeoOutput,
} from "../src/veo/output/recoverVeoOutput.js";

const directories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-veo-output-recovery-",
      ),
    );

  directories.push(
    directory,
  );

  return directory;
}

function sha256(
  value:
    Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

afterEach(
  async () => {
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
  },
);

describe(
  "Busybookie Veo output recovery",
  () => {
    it(
      "persists the already-generated provider output when the deterministic destination is absent",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const body =
          Buffer.from(
            "recovered-veo-video",
          );

        const downloadFile =
          vi.fn(
            async (
              params:
                Readonly<{
                  downloadPath:
                    string;
                }>,
            ) => {
              await writeFile(
                params.downloadPath,
                body,
              );
            },
          );

        const result =
          await recoverVeoOutput(
            {
              video: {
                uri:
                  "https://example.test/veo-output.mp4",

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          );

        expect(
          result,
        ).toEqual({
          destinationPath,

          bytes:
            body.length,

          sha256:
            sha256(
              body,
            ),

          contentType:
            "video/mp4",
        });

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          body,
        );

        expect(
          downloadFile,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "reuses an existing deterministic output only after independently verifying identical provider bytes",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const body =
          Buffer.from(
            "already-persisted-veo-video",
          );

        await writeFile(
          destinationPath,
          body,
        );

        const downloadFile =
          vi.fn(
            async (
              params:
                Readonly<{
                  downloadPath:
                    string;
                }>,
            ) => {
              await writeFile(
                params.downloadPath,
                body,
              );
            },
          );

        const result =
          await recoverVeoOutput(
            {
              video: {
                uri:
                  "https://example.test/veo-output.mp4",

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          );

        expect(
          result,
        ).toEqual({
          destinationPath,

          bytes:
            body.length,

          sha256:
            sha256(
              body,
            ),

          contentType:
            "video/mp4",
        });

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          body,
        );

        expect(
          await readdir(
            directory,
          ),
        ).toEqual([
          "output.mp4",
        ]);

        expect(
          downloadFile,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "reuses a matching concurrent winner when create-once persistence loses the race",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const body =
          Buffer.from(
            "concurrent-veo-video",
          );

        const downloadFile =
          vi.fn(
            async (
              params:
                Readonly<{
                  downloadPath:
                    string;
                }>,
            ) => {
              await writeFile(
                params.downloadPath,
                body,
              );

              if (
                downloadFile.mock
                  .calls.length ===
                  1
              ) {
                await writeFile(
                  destinationPath,
                  body,
                );
              }
            },
          );

        const result =
          await recoverVeoOutput(
            {
              video: {
                uri:
                  "https://example.test/veo-output.mp4",

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          );

        expect(
          result,
        ).toEqual({
          destinationPath,

          bytes:
            body.length,

          sha256:
            sha256(
              body,
            ),

          contentType:
            "video/mp4",
        });

        expect(
          downloadFile,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          body,
        );

        expect(
          await readdir(
            directory,
          ),
        ).toEqual([
          "output.mp4",
        ]);
      },
    );

    it(
      "fails closed without overwriting when an existing deterministic output differs from the provider output",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const existingBody =
          Buffer.from(
            "existing-local-veo-video",
          );

        const providerBody =
          Buffer.from(
            "different-provider-veo-video",
          );

        await writeFile(
          destinationPath,
          existingBody,
        );

        const downloadFile =
          vi.fn(
            async (
              params:
                Readonly<{
                  downloadPath:
                    string;
                }>,
            ) => {
              await writeFile(
                params.downloadPath,
                providerBody,
              );
            },
          );

        await expect(
          recoverVeoOutput(
            {
              video: {
                uri:
                  "https://example.test/veo-output.mp4",

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          ),
        ).rejects.toThrow(
          /existing Veo output does not match the provider output/i,
        );

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          existingBody,
        );

        expect(
          await readdir(
            directory,
          ),
        ).toEqual([
          "output.mp4",
        ]);
      },
    );

    it(
      "fails closed when an existing deterministic output changes during provider verification",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "output.mp4",
          );

        const originalBody =
          Buffer.from(
            "original-local-veo-video",
          );

        const mutatedBody =
          Buffer.from(
            "mutated-local-veo-video",
          );

        await writeFile(
          destinationPath,
          originalBody,
        );

        const downloadFile =
          vi.fn(
            async (
              params:
                Readonly<{
                  downloadPath:
                    string;
                }>,
            ) => {
              await writeFile(
                destinationPath,
                mutatedBody,
              );

              await writeFile(
                params.downloadPath,
                originalBody,
              );
            },
          );

        await expect(
          recoverVeoOutput(
            {
              video: {
                uri:
                  "https://example.test/veo-output.mp4",

                mimeType:
                  "video/mp4",
              },
            },
            destinationPath,
            downloadFile,
          ),
        ).rejects.toThrow(
          /existing Veo output changed during provider verification/i,
        );

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          mutatedBody,
        );

        expect(
          await readdir(
            directory,
          ),
        ).toEqual([
          "output.mp4",
        ]);
      },
    );

    it(
      "reuses an existing deterministic output after independently verifying matching inline video bytes",
      async () => {
        const directory =
          await makeTempDirectory();

        const destinationPath =
          join(
            directory,
            "inline.mp4",
          );

        const body =
          Buffer.from(
            "existing-inline-veo-video",
          );

        await writeFile(
          destinationPath,
          body,
        );

        const downloadFile =
          vi.fn();

        const result =
          await recoverVeoOutput(
            {
              video: {
                videoBytes:
                  body
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
          result,
        ).toEqual({
          destinationPath,

          bytes:
            body.length,

          sha256:
            sha256(
              body,
            ),

          contentType:
            "video/mp4",
        });

        expect(
          downloadFile,
        ).not.toHaveBeenCalled();

        expect(
          await readdir(
            directory,
          ),
        ).toEqual([
          "inline.mp4",
        ]);
      },
    );
  },
);
