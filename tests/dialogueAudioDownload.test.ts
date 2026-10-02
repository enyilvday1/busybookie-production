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
  DIALOGUE_MAX_AUDIO_OUTPUT_BYTES,
  downloadDialogueAudioOutput,
} from "../src/dialogue/downloadDialogueAudioOutput.js";

const temporaryDirectories:
  string[] =
    [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-audio-",
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
  "Busybookie dialogue audio download",
  () => {
    it(
      "downloads an HTTPS audio artifact with bounded integrity evidence",
      async () => {
        expect(
          DIALOGUE_MAX_AUDIO_OUTPUT_BYTES,
        ).toBe(
          25_000_000,
        );

        const directory =
          await createTempDirectory();

        const destinationPath =
          join(
            directory,
            "dialogue.audio",
          );

        const body =
          Buffer.from(
            "mock-busybookie-dialogue-audio",
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

                    "content-length":
                      String(
                        body.length,
                      ),
                  },
                },
              ),
          );

        const result =
          await downloadDialogueAudioOutput(
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
          result.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          await readFile(
            destinationPath,
          ),
        ).toEqual(
          body,
        );
      },
    );

    it(
      "rejects a non-HTTPS provider output URL before fetching",
      async () => {
        const directory =
          await createTempDirectory();

        const fetchMock =
          vi.fn();

        await expect(
          downloadDialogueAudioOutput(
            "http://example.test/dialogue-output",
            join(
              directory,
              "dialogue.audio",
            ),
            fetchMock,
          ),
        ).rejects.toThrow(
          /must use HTTPS/i,
        );

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a declared provider output larger than the configured byte ceiling",
      async () => {
        const directory =
          await createTempDirectory();

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                Buffer.from(
                  "ignored",
                ),
                {
                  status:
                    200,

                  headers: {
                    "content-length":
                      "6",
                  },
                },
              ),
          );

        await expect(
          downloadDialogueAudioOutput(
            "https://example.test/dialogue-output",
            join(
              directory,
              "dialogue.audio",
            ),
            fetchMock,
            5,
          ),
        ).rejects.toThrow(
          /download limit/i,
        );
      },
    );

    it(
      "enforces the byte ceiling while streaming even without a content-length header",
      async () => {
        const directory =
          await createTempDirectory();

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                Buffer.from(
                  "123456",
                ),
                {
                  status:
                    200,
                },
              ),
          );

        await expect(
          downloadDialogueAudioOutput(
            "https://example.test/dialogue-output",
            join(
              directory,
              "dialogue.audio",
            ),
            fetchMock,
            5,
          ),
        ).rejects.toThrow(
          /while streaming/i,
        );

        expect(
          await readdir(
            directory,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "fails closed when the provider response contains no body",
      async () => {
        const directory =
          await createTempDirectory();

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                null,
                {
                  status:
                    200,
                },
              ),
          );

        await expect(
          downloadDialogueAudioOutput(
            "https://example.test/dialogue-output",
            join(
              directory,
              "dialogue.audio",
            ),
            fetchMock,
          ),
        ).rejects.toThrow(
          /no body/i,
        );
      },
    );

    it(
      "refuses to overwrite an existing dialogue audio artifact",
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
            "existing-dialogue-audio",
          ),
        );

        const fetchMock =
          vi.fn(
            async () =>
              new Response(
                Buffer.from(
                  "replacement-dialogue-audio",
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
          downloadDialogueAudioOutput(
            "https://example.test/dialogue-output",
            destinationPath,
            fetchMock,
          ),
        ).rejects.toMatchObject({
          code:
            "EEXIST",
        });

        expect(
          await readFile(
            destinationPath,
            "utf8",
          ),
        ).toBe(
          "existing-dialogue-audio",
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
  },
);
