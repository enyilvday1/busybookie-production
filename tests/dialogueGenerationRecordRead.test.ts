import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
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
  readDialogueGenerationRecord,
} from "../src/dialogue/readDialogueGenerationRecord.js";

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
        "busybookie-dialogue-read-",
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
  "Busybookie dialogue generation record reading",
  () => {
    it(
      "reads and validates an existing durable dialogue generation record",
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

        const result =
          await readDialogueGenerationRecord(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-123",
          );

        expect(
          result,
        ).toEqual(
          record,
        );
      },
    );

    it(
      "returns null only when the canonical durable record is absent",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const result =
          await readDialogueGenerationRecord(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-missing",
          );

        expect(
          result,
        ).toBeNull();
      },
    );

    it(
      "fails closed when the durable record contains malformed JSON",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const recordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-malformed",
          );

        await mkdir(
          dirname(
            recordPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          recordPath,
          "{not-json",
          "utf8",
        );

        await expect(
          readDialogueGenerationRecord(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-malformed",
          ),
        ).rejects.toThrow(
          /JSON|malformed/i,
        );
      },
    );

    it(
      "fails closed when persisted JSON violates the durable record schema",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const recordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-invalid",
          );

        await mkdir(
          dirname(
            recordPath,
          ),
          {
            recursive:
              true,
          },
        );

        const invalidRecord = {
          ...createValidRecord(
            mediaRoot,
          ),

          providerExecutionId:
            "task-invalid",

          outputs: [
            {
              ...createValidRecord(
                mediaRoot,
              ).outputs[0],

              sha256:
                "invalid",
            },
          ],
        };

        await writeFile(
          recordPath,
          `${JSON.stringify(
            invalidRecord,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readDialogueGenerationRecord(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-invalid",
          ),
        ).rejects.toThrow(
          /sha256|64-character/i,
        );
      },
    );

    it(
      "fails closed when the persisted record identity does not match the canonical lookup identity",
      async () => {
        const mediaRoot =
          await createTempDirectory();

        const recordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-lookup",
          );

        await mkdir(
          dirname(
            recordPath,
          ),
          {
            recursive:
              true,
          },
        );

        const mismatchedRecord = {
          ...createValidRecord(
            mediaRoot,
          ),

          providerExecutionId:
            "task-different",
        };

        await writeFile(
          recordPath,
          `${JSON.stringify(
            mismatchedRecord,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readDialogueGenerationRecord(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            "task-lookup",
          ),
        ).rejects.toThrow(
          /identity.*match|does not match/i,
        );
      },
    );
  },
);
