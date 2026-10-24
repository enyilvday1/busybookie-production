import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  GoogleGenAiExecutionCompletionSchema,
} from "../src/execution/googleGenAiExecutionCompletion.schema.js";

import {
  readExecutionCompletion,
} from "../src/execution/readExecutionCompletion.js";

import {
  readGoogleGenAiExecutionCompletion,
} from "../src/execution/readGoogleGenAiExecutionCompletion.js";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const temporaryDirectories:
  string[] = [];

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

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-completion-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function validCompletion(
  generationRecordPath:
    string =
      "/busybookie/generated-video/EP92/S01/EP92_S01_GOOGLE_GENAI_record.google-genai-generation.json",
) {
  return {
    schemaVersion:
      "1.1",

    completedAt:
      "2026-10-24T12:06:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    episodeId:
      "EP92",

    shotId:
      "S01",

    provider:
      "GOOGLE_GENAI",

    providerExecutionId:
      INTERACTION_ID,

    generationRecordPath,
  };
}

function legacyRunwayCompletion() {
  return {
    schemaVersion:
      "1.0",

    completedAt:
      "2026-10-24T12:06:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    episodeId:
      "EP92",

    shotId:
      "S01",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-runway-123",

    generationRecordPath:
      "/busybookie/generated-video/EP92/S01/EP92_S01_task.runway-generation.json",
  };
}

async function writeCompletionFile(
  mediaRoot:
    string,
  contents:
    string,
): Promise<void> {
  const completionPath =
    createExecutionCompletionPath(
      mediaRoot,
      "EP92",
      "S01",
    );

  await mkdir(
    dirname(
      completionPath,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    completionPath,
    contents,
    "utf8",
  );
}

describe(
  "Busybookie Google GenAI execution completion 1.1",
  () => {
    describe(
      "schema strictness",
      () => {
        it(
          "accepts the exact Google 1.1 completion",
          () => {
            expect(
              GoogleGenAiExecutionCompletionSchema
                .parse(
                  validCompletion(),
                ),
            ).toStrictEqual(
              validCompletion(),
            );
          },
        );

        it(
          "rejects shared completion 1.0 documents",
          () => {
            expect(
              GoogleGenAiExecutionCompletionSchema
                .safeParse(
                  legacyRunwayCompletion(),
                )
                .success,
            ).toBe(
              false,
            );

            expect(
              GoogleGenAiExecutionCompletionSchema
                .safeParse({
                  ...validCompletion(),

                  schemaVersion:
                    "1.0",
                })
                .success,
            ).toBe(
              false,
            );
          },
        );

        it.each([
          "RUNWAY",
          "VEO",
          "MANUAL",
        ])(
          "rejects provider %s",
          (provider) => {
            expect(
              GoogleGenAiExecutionCompletionSchema
                .safeParse({
                  ...validCompletion(),
                  provider,
                })
                .success,
            ).toBe(
              false,
            );
          },
        );

        it.each([
          "outputPath",
          "bytes",
          "byteCount",
          "sha256",
          "mimeType",
          "contentType",
          "sourceKind",
          "alreadyPresent",
          "interactionId",
          "promptText",
          "sourceImagePath",
          "recoveryMetadata",
          "policySnapshot",
        ])(
          "rejects duplicated or forbidden field %s",
          (field) => {
            expect(
              GoogleGenAiExecutionCompletionSchema
                .safeParse({
                  ...validCompletion(),

                  [field]:
                    "forbidden",
                })
                .success,
            ).toBe(
              false,
            );
          },
        );

        it.each([
          [
            "status",
            "FAILED",
          ],
          [
            "completedAt",
            "now",
          ],
          [
            "reservationId",
            "nope",
          ],
          [
            "providerExecutionId",
            " ",
          ],
          [
            "generationRecordPath",
            "",
          ],
        ])(
          "rejects invalid %s %j",
          (
            field,
            value,
          ) => {
            expect(
              GoogleGenAiExecutionCompletionSchema
                .safeParse({
                  ...validCompletion(),

                  [field]:
                    value,
                })
                .success,
            ).toBe(
              false,
            );
          },
        );
      },
    );

    describe(
      "Google-specific reader at the shared canonical completion path",
      () => {
        it(
          "returns null when no completion exists",
          async () => {
            await expect(
              readGoogleGenAiExecutionCompletion(
                await makeMediaRoot(),
                "EP92",
                "S01",
              ),
            ).resolves.toBeNull();
          },
        );

        it(
          "reads a Google 1.1 completion that the shared reader rejects",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeCompletionFile(
              mediaRoot,
              JSON.stringify(
                validCompletion(),
                null,
                2,
              ),
            );

            await expect(
              readGoogleGenAiExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).resolves.toStrictEqual(
              validCompletion(),
            );

            await expect(
              readExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).rejects.toThrow();
          },
        );

        it(
          "rejects a shared Runway 1.0 completion that the shared reader accepts",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeCompletionFile(
              mediaRoot,
              JSON.stringify(
                legacyRunwayCompletion(),
              ),
            );

            await expect(
              readExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).resolves.toStrictEqual(
              legacyRunwayCompletion(),
            );

            await expect(
              readGoogleGenAiExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).rejects.toThrow();
          },
        );

        it(
          "fails closed on invalid JSON",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeCompletionFile(
              mediaRoot,
              "{damaged",
            );

            await expect(
              readGoogleGenAiExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).rejects.toThrow(
              /not valid JSON/,
            );
          },
        );
      },
    );
  },
);
