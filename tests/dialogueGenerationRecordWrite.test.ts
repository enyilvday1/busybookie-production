import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  join,
  resolve,
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

import type {
  DialogueGenerationRecord,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import {
  createDialogueGenerationRecordPath,
} from "../src/dialogue/dialogueGenerationRecordPath.js";

import {
  writeDialogueGenerationRecord,
} from "../src/dialogue/writeDialogueGenerationRecord.js";

const temporaryDirectories:
  string[] =
    [];

async function createTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-record-",
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

function createValidRecord(
  mediaRoot:
    string,
): DialogueGenerationRecord {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-01T12:30:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-123",

    providerModel:
      "eleven_v3",

    providerCreatedAt:
      "2026-10-01T12:29:50.000Z",

    request: {
      model:
        "eleven_v3",

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset",

        presetId:
          "Chad",
      },

      applyTextNormalization:
        "auto",

      languageCode:
        "en",

      seed:
        0,

      similarityBoost:
        0.75,

      speed:
        1,

      stability:
        0.5,

      style:
        0,

      useSpeakerBoost:
        true,
    },

    credits: {
      locallyExpected:
        1,

      providerEstimated:
        1,

      providerFinal:
        1,
    },

    plan: {
      planKey:
        "a".repeat(
          64,
        ),

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

      lineNumber:
        1,

      characterId:
        "OLLIE",

      characterName:
        "Ollie",

      text:
        "Look what I found!",

      deliveryNotes:
        "Curious, excited and gentle.",

      voice: {
        provider:
          "RUNWAY",

        voiceName:
          "Chad",

        deliveryTraits: [
          "young",
          "curious",
          "warm",
          "friendly",
          "natural",
        ],
      },
    },

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          resolve(
            mediaRoot,
            "voices",
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "provider-output.audio",
          ),

        bytes:
          12345,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      },
    ],
  };
}

describe(
  "Busybookie dialogue generation record writing",
  () => {
    it(
      "writes the validated record to its deterministic voices namespace",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const record =
          createValidRecord(
            mediaRoot,
          );

        const writtenPath =
          await writeDialogueGenerationRecord(
            mediaRoot,
            record,
          );

        const expectedPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-123",
          );

        expect(
          writtenPath,
        ).toBe(
          expectedPath,
        );

        const persisted =
          JSON.parse(
            await readFile(
              writtenPath,
              "utf8",
            ),
          );

        expect(
          persisted,
        ).toEqual(
          record,
        );
      },
    );

    it(
      "refuses to silently overwrite an existing durable dialogue record",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const record =
          createValidRecord(
            mediaRoot,
          );

        await writeDialogueGenerationRecord(
          mediaRoot,
          record,
        );

        await expect(
          writeDialogueGenerationRecord(
            mediaRoot,
            record,
          ),
        ).rejects.toThrow(
          /already exists/i,
        );
      },
    );

    it(
      "validates the durable record before creating its destination",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const invalidRecord =
          {
            ...createValidRecord(
              mediaRoot,
            ),

            outputs: [
              {
                ...createValidRecord(
                  mediaRoot,
                ).outputs[0],

                sha256:
                  "invalid",
              },
            ],
          } as unknown as DialogueGenerationRecord;

        const expectedPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-123",
          );

        await expect(
          writeDialogueGenerationRecord(
            mediaRoot,
            invalidRecord,
          ),
        ).rejects.toThrow(
          /sha256|64-character/i,
        );

        await expect(
          readFile(
            expectedPath,
            "utf8",
          ),
        ).rejects.toMatchObject({
          code:
            "ENOENT",
        });
      },
    );

    it(
      "allows exactly one winner when concurrent writers target the same durable identity",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const record =
          createValidRecord(
            mediaRoot,
          );

        const results =
          await Promise.allSettled([
            writeDialogueGenerationRecord(
              mediaRoot,
              record,
            ),

            writeDialogueGenerationRecord(
              mediaRoot,
              record,
            ),
          ]);

        const fulfilled =
          results.filter(
            (
              result,
            ): result is PromiseFulfilledResult<string> =>
              result.status ===
              "fulfilled",
          );

        const rejected =
          results.filter(
            (
              result,
            ): result is PromiseRejectedResult =>
              result.status ===
              "rejected",
          );

        expect(
          fulfilled,
        ).toHaveLength(
          1,
        );

        expect(
          rejected,
        ).toHaveLength(
          1,
        );

        expect(
          String(
            rejected[0]!
              .reason,
          ),
        ).toMatch(
          /already exists/i,
        );
      },
    );
  },
);
