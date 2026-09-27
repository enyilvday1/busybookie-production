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
  recoverRunwayOutput,
} from "../src/runway/output/recoverRunwayOutput.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-runway-output-recovery-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function sha256(
  value: Buffer,
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
      temporaryDirectories
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
  "Busybookie Runway output recovery",
  () => {
    it(
      "downloads the already-generated provider output when the deterministic destination is absent",
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
            "recovered-runway-video",
          );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                body,
                {
                  status:
                    200,

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
          await recoverRunwayOutput(
            "https://example.test/output.mp4",
            destinationPath,
            fetchMock,
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
          fetchMock,
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
            "already-persisted-runway-video",
          );

        await writeFile(
          destinationPath,
          body,
        );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                body,
                {
                  status:
                    200,

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
          await recoverRunwayOutput(
            "https://example.test/output.mp4",
            destinationPath,
            fetchMock,
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
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
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
            "original-local-video",
          );

        const mutatedBody =
          Buffer.from(
            "mutated-local-video",
          );

        await writeFile(
          destinationPath,
          originalBody,
        );

        const fetchMock =
          vi.fn(
            async () => {
              await writeFile(
                destinationPath,
                mutatedBody,
              );

              return new Response(
                originalBody,
                {
                  status:
                    200,

                  headers: {
                    "content-type":
                      "video/mp4",

                    "content-length":
                      String(
                        originalBody.length,
                      ),
                  },
                },
              );
            },
          );

        await expect(
          recoverRunwayOutput(
            "https://example.test/output.mp4",
            destinationPath,
            fetchMock,
          ),
        ).rejects.toThrow(
          /existing Runway output changed during provider verification/i,
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

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
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
            "existing-local-video",
          );

        const providerBody =
          Buffer.from(
            "different-provider-video",
          );

        await writeFile(
          destinationPath,
          existingBody,
        );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                providerBody,
                {
                  status:
                    200,

                  headers: {
                    "content-type":
                      "video/mp4",

                    "content-length":
                      String(
                        providerBody.length,
                      ),
                  },
                },
              ),
          );

        await expect(
          recoverRunwayOutput(
            "https://example.test/output.mp4",
            destinationPath,
            fetchMock,
          ),
        ).rejects.toThrow(
          /existing Runway output does not match the provider output/i,
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

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
