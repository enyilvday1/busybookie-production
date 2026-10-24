import {
  createHash,
} from "node:crypto";

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
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  GoogleGenAiGenerationRecordSchema,
} from "../src/googleGenai/audit/googleGenAiGenerationRecord.schema.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../src/googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  readGoogleGenAiGenerationRecord,
} from "../src/googleGenai/audit/readGoogleGenAiGenerationRecord.js";

const MEDIA_ROOT =
  resolve(
    "/busybookie-media-root",
  );

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

function sha256Hex(
  value:
    string,
): string {
  return createHash(
    "sha256",
  )
    .update(
      value,
      "utf8",
    )
    .digest(
      "hex",
    );
}

function validRecord(
  mediaRoot:
    string =
      MEDIA_ROOT,
) {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-24T12:05:00.000Z",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    provider:
      "GOOGLE_GENAI",

    episodeId:
      "EP92",

    shotId:
      "S01",

    providerExecutionId:
      INTERACTION_ID,

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          join(
            mediaRoot,
            "generated-video",
            "EP92",
            "S01",
            `EP92_S01_GOOGLE_GENAI_${sha256Hex(INTERACTION_ID)}_01.mp4`,
          ),

        bytes:
          58,

        sha256:
          "a".repeat(
            64,
          ),

        contentType:
          "video/mp4",
      },
    ],
  };
}

describe(
  "Busybookie Google GenAI generation record",
  () => {
    describe(
      "schema strictness",
      () => {
        it(
          "accepts the exact output-evidence record",
          () => {
            expect(
              GoogleGenAiGenerationRecordSchema
                .parse(
                  validRecord(),
                ),
            ).toStrictEqual(
              validRecord(),
            );
          },
        );

        it.each([
          "promptText",
          "sourceImagePath",
          "policySnapshot",
          "recoveryMetadata",
          "request",
          "background",
          "store",
          "stream",
          "sourceKind",
          "alreadyPresent",
          "interactionId",
          "apiKey",
          "credentials",
          "status",
          "model",
        ])(
          "rejects forbidden top-level field %s",
          (field) => {
            expect(
              GoogleGenAiGenerationRecordSchema
                .safeParse({
                  ...validRecord(),

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
          "sourceKind",
          "alreadyPresent",
          "mimeType",
          "byteCount",
          "outputPath",
        ])(
          "rejects unknown output field %s",
          (field) => {
            const record =
              validRecord();

            expect(
              GoogleGenAiGenerationRecordSchema
                .safeParse({
                  ...record,

                  outputs: [
                    {
                      ...record.outputs[0],

                      [field]:
                        "forbidden",
                    },
                  ],
                })
                .success,
            ).toBe(
              false,
            );
          },
        );

        it.each([
          [
            "schemaVersion",
            "1.1",
          ],
          [
            "provider",
            "VEO",
          ],
          [
            "provider",
            "RUNWAY",
          ],
          [
            "reservationId",
            "not-a-uuid",
          ],
          [
            "episodeId",
            "../EP92",
          ],
          [
            "shotId",
            "S1",
          ],
          [
            "providerExecutionId",
            "   ",
          ],
          [
            "recordedAt",
            "yesterday",
          ],
        ])(
          "rejects invalid %s %j",
          (
            field,
            value,
          ) => {
            expect(
              GoogleGenAiGenerationRecordSchema
                .safeParse({
                  ...validRecord(),

                  [field]:
                    value,
                })
                .success,
            ).toBe(
              false,
            );
          },
        );

        it.each([
          [
            "outputIndex",
            2,
          ],
          [
            "outputIndex",
            0,
          ],
          [
            "bytes",
            0,
          ],
          [
            "bytes",
            1.5,
          ],
          [
            "sha256",
            "A".repeat(
              64,
            ),
          ],
          [
            "sha256",
            "abc",
          ],
          [
            "contentType",
            "video/webm",
          ],
          [
            "contentType",
            null,
          ],
          [
            "destinationPath",
            "relative/output.mp4",
          ],
        ])(
          "rejects invalid output %s %j",
          (
            field,
            value,
          ) => {
            const record =
              validRecord();

            expect(
              GoogleGenAiGenerationRecordSchema
                .safeParse({
                  ...record,

                  outputs: [
                    {
                      ...record.outputs[0],

                      [field]:
                        value,
                    },
                  ],
                })
                .success,
            ).toBe(
              false,
            );
          },
        );

        it(
          "requires exactly one output",
          () => {
            const record =
              validRecord();

            expect(
              GoogleGenAiGenerationRecordSchema
                .safeParse({
                  ...record,

                  outputs:
                    [],
                })
                .success,
            ).toBe(
              false,
            );

            expect(
              GoogleGenAiGenerationRecordSchema
                .safeParse({
                  ...record,

                  outputs: [
                    record.outputs[0],
                    record.outputs[0],
                  ],
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
      "canonical path",
      () => {
        it(
          "derives the canonical .google-genai-generation.json path from the providerExecutionId digest",
          () => {
            expect(
              createGoogleGenAiGenerationRecordPath(
                MEDIA_ROOT,
                "EP92",
                "S01",
                INTERACTION_ID,
              ),
            ).toBe(
              join(
                MEDIA_ROOT,
                "generated-video",
                "EP92",
                "S01",
                `EP92_S01_GOOGLE_GENAI_${sha256Hex(INTERACTION_ID)}.google-genai-generation.json`,
              ),
            );
          },
        );

        it(
          "never places the raw providerExecutionId in the path",
          () => {
            expect(
              createGoogleGenAiGenerationRecordPath(
                MEDIA_ROOT,
                "EP92",
                "S01",
                INTERACTION_ID,
              ),
            ).not.toContain(
              INTERACTION_ID,
            );
          },
        );

        it.each([
          "../../../../etc/passwd",
          "..\\..\\windows",
          "/absolute/escape",
          "a/../../b",
        ])(
          "keeps traversal-like providerExecutionId %j inside the shot directory",
          (providerExecutionId) => {
            const recordPath =
              createGoogleGenAiGenerationRecordPath(
                MEDIA_ROOT,
                "EP92",
                "S01",
                providerExecutionId,
              );

            expect(
              dirname(
                recordPath,
              ),
            ).toBe(
              join(
                MEDIA_ROOT,
                "generated-video",
                "EP92",
                "S01",
              ),
            );

            expect(
              basename(
                recordPath,
              ),
            ).toBe(
              `EP92_S01_GOOGLE_GENAI_${sha256Hex(providerExecutionId)}.google-genai-generation.json`,
            );
          },
        );

        it.each([
          [
            "relative media root",
            "relative/root",
            "EP92",
            "S01",
            INTERACTION_ID,
          ],
          [
            "episode traversal",
            MEDIA_ROOT,
            "../EP92",
            "S01",
            INTERACTION_ID,
          ],
          [
            "shot traversal",
            MEDIA_ROOT,
            "EP92",
            "../S01",
            INTERACTION_ID,
          ],
          [
            "blank providerExecutionId",
            MEDIA_ROOT,
            "EP92",
            "S01",
            "  ",
          ],
        ])(
          "rejects %s",
          (
            _label,
            mediaRoot,
            episodeId,
            shotId,
            providerExecutionId,
          ) => {
            expect(
              () =>
                createGoogleGenAiGenerationRecordPath(
                  mediaRoot,
                  episodeId,
                  shotId,
                  providerExecutionId,
                ),
            ).toThrow();
          },
        );
      },
    );

    describe(
      "reader",
      () => {
        async function makeMediaRoot():
        Promise<string> {
          const directory =
            await mkdtemp(
              join(
                tmpdir(),
                "busybookie-google-genai-generation-record-",
              ),
            );

          temporaryDirectories.push(
            directory,
          );

          return directory;
        }

        async function writeRecordFile(
          mediaRoot:
            string,
          contents:
            string,
        ): Promise<string> {
          const recordPath =
            createGoogleGenAiGenerationRecordPath(
              mediaRoot,
              "EP92",
              "S01",
              INTERACTION_ID,
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
            contents,
            "utf8",
          );

          return recordPath;
        }

        it(
          "returns null when no record exists",
          async () => {
            await expect(
              readGoogleGenAiGenerationRecord(
                await makeMediaRoot(),
                "EP92",
                "S01",
                INTERACTION_ID,
              ),
            ).resolves.toBeNull();
          },
        );

        it(
          "reads and strictly validates an existing record",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeRecordFile(
              mediaRoot,
              JSON.stringify(
                validRecord(
                  mediaRoot,
                ),
                null,
                2,
              ),
            );

            await expect(
              readGoogleGenAiGenerationRecord(
                mediaRoot,
                "EP92",
                "S01",
                INTERACTION_ID,
              ),
            ).resolves.toStrictEqual(
              validRecord(
                mediaRoot,
              ),
            );
          },
        );

        it(
          "fails closed on invalid JSON",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeRecordFile(
              mediaRoot,
              "{damaged",
            );

            await expect(
              readGoogleGenAiGenerationRecord(
                mediaRoot,
                "EP92",
                "S01",
                INTERACTION_ID,
              ),
            ).rejects.toThrow(
              /not valid JSON/,
            );
          },
        );

        it(
          "fails closed on a record carrying request material",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeRecordFile(
              mediaRoot,
              JSON.stringify({
                ...validRecord(
                  mediaRoot,
                ),

                promptText:
                  "leaked prompt",
              }),
            );

            await expect(
              readGoogleGenAiGenerationRecord(
                mediaRoot,
                "EP92",
                "S01",
                INTERACTION_ID,
              ),
            ).rejects.toThrow();
          },
        );
      },
    );
  },
);
