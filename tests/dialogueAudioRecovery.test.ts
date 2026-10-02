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
  vi,
} from "vitest";

import {
  inspectDialogueAudioOutput,
  recoverDialogueAudioOutput,
} from "../src/dialogue/recoverDialogueAudioOutput.js";

const temporaryDirectories:
  string[] =
    [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-audio-recovery-",
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
  "Busybookie dialogue audio recovery",
  () => {
    it(
      "inspects an existing dialogue audio artifact and returns cryptographic evidence",
      async () => {
        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "dialogue.audio",
          );

        const body =
          Buffer.from(
            "existing-dialogue-audio",
          );

        await writeFile(
          destinationPath,
          body,
        );

        const result =
          await inspectDialogueAudioOutput(
            destinationPath,
          );

        expect(
          result,
        ).toEqual({
          bytes:
            body.length,

          sha256:
            createHash(
              "sha256",
            )
              .update(
                body,
              )
              .digest(
                "hex",
              ),
        });
      },
    );

    it(
      "downloads the provider artifact when no local dialogue audio exists",
      async () => {
        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "dialogue.audio",
          );

        const body =
          Buffer.from(
            "provider-dialogue-audio",
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
                      "audio/mpeg",
                  },
                },
              ),
          );

        const result =
          await recoverDialogueAudioOutput(
            "https://example.test/dialogue-output",
            destinationPath,
            fetchMock,
          );

        expect(
          result,
        ).toMatchObject({
          destinationPath,

          bytes:
            body.length,

          contentType:
            "audio/mpeg",
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
      "reuses an existing artifact only after independently verifying it against the provider output",
      async () => {
        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "dialogue.audio",
          );

        const body =
          Buffer.from(
            "matching-dialogue-audio",
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
                      "audio/wav",
                  },
                },
              ),
          );

        const result =
          await recoverDialogueAudioOutput(
            "https://example.test/dialogue-output",
            destinationPath,
            fetchMock,
          );

        expect(
          result.destinationPath,
        ).toBe(
          destinationPath,
        );

        expect(
          result.bytes,
        ).toBe(
          body.length,
        );

        expect(
          result.sha256,
        ).toBe(
          createHash(
            "sha256",
          )
            .update(
              body,
            )
            .digest(
              "hex",
            ),
        );

        expect(
          result.contentType,
        ).toBe(
          "audio/wav",
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          await readdir(
            directory,
          ),
        ).toEqual([
          "dialogue.audio",
        ]);
      },
    );

    it(
      "fails closed when an existing local artifact does not match the provider artifact",
      async () => {
        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "dialogue.audio",
          );

        const existingBody =
          Buffer.from(
            "existing-dialogue-audio",
          );

        await writeFile(
          destinationPath,
          existingBody,
        );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                Buffer.from(
                  "different-provider-audio",
                ),
                {
                  status:
                    200,

                  headers: {
                    "content-type":
                      "audio/mpeg",
                  },
                },
              ),
          );

        await expect(
          recoverDialogueAudioOutput(
            "https://example.test/dialogue-output",
            destinationPath,
            fetchMock,
          ),
        ).rejects.toThrow(
          /does not match the provider output/i,
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
          "dialogue.audio",
        ]);
      },
    );

    it(
      "fails closed when an existing artifact exceeds the configured dialogue audio ceiling",
      async () => {
        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "dialogue.audio",
          );

        await writeFile(
          destinationPath,
          Buffer.from(
            "123456",
          ),
        );

        await expect(
          inspectDialogueAudioOutput(
            destinationPath,
            5,
          ),
        ).rejects.toThrow(
          /local limit/i,
        );
      },
    );
  },
);
