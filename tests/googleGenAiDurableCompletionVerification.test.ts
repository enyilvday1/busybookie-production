import {
  createHash,
} from "node:crypto";

import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
  relative,
} from "node:path";

import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputRetriever,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  persistGoogleGenAiSingleShotCompletion,
} from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";

import {
  verifyGoogleGenAiDurableCompletion,
} from "../src/execution/verifyGoogleGenAiDurableCompletion.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../src/googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const VERIFIER_SOURCE =
  "src/execution/verifyGoogleGenAiDurableCompletion.ts";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const temporaryDirectories:
  string[] = [];

let policySnapshot:
  GoogleGenAiPolicy;

beforeAll(
  async () => {
    policySnapshot =
      await loadGoogleGenAiPolicy();
  },
);

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

function makeMp4(): Buffer {
  const payload =
    Buffer.from(
      "busybookie-google-verifier-output",
      "utf8",
    );

  const mdat =
    Buffer.alloc(
      8,
    );

  mdat.writeUInt32BE(
    8 + payload.byteLength,
    0,
  );

  mdat.write(
    "mdat",
    4,
    "latin1",
  );

  return Buffer.concat([
    Buffer.from([
      0x00,
      0x00,
      0x00,
      0x18,
    ]),
    Buffer.from(
      "ftypisom",
      "latin1",
    ),
    Buffer.from([
      0x00,
      0x00,
      0x02,
      0x00,
    ]),
    Buffer.from(
      "isommp41",
      "latin1",
    ),
    mdat,
    payload,
  ]);
}

const OUTPUT_BYTES =
  makeMp4();

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-verifier-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function completeGoogle():
Promise<string> {
  const mediaRoot =
    await makeMediaRoot();

  await createExecutionReservation(
    mediaRoot,
    {
      episodeId:
        "EP92",

      shotId:
        "S01",

      provider:
        "GOOGLE_GENAI",
    },
    {
      now: () =>
        "2026-10-24T12:00:00.000Z",

      createReservationId: () =>
        RESERVATION_ID,
    },
  );

  await createExecutionSubmission(
    mediaRoot,
    {
      reservationId:
        RESERVATION_ID,

      episodeId:
        "EP92",

      shotId:
        "S01",

      provider:
        "GOOGLE_GENAI",

      providerExecutionId:
        INTERACTION_ID,

      recoveryMetadata: {
        request: {
          model:
            "gemini-omni-1.1-flash",

          background:
            true,

          store:
            true,

          stream:
            false,

          promptText:
            "Busybookie Google verifier test.",

          sourceImagePath:
            join(
              mediaRoot,
              "references",
              "EP92",
              "S01",
              "reference.png",
            ),
        },

        policySnapshot,
      },
    },
    {
      now: () =>
        "2026-10-24T12:01:00.000Z",
    },
  );

  const materializedOutput =
    await materializeGoogleGenAiSingleShotOutput(
      {
        mediaRoot,

        episodeId:
          "EP92",

        shotId:
          "S01",

        maxOutputBytes:
          4096,
      },
      {
        retrieveOutput:
          vi.fn<GoogleGenAiOutputRetriever>(
            async (providerExecutionId) => ({
              id:
                providerExecutionId,

              status:
                "completed",

              outputVideo: {
                type:
                  "video",

                mime_type:
                  "video/mp4",

                data:
                  OUTPUT_BYTES.toString(
                    "base64",
                  ),
              },
            }),
          ),

        downloadUri:
          async () => {
            throw new Error(
              "URI downloader must not be called.",
            );
          },
      },
    );

  await persistGoogleGenAiSingleShotCompletion(
    {
      mediaRoot,

      episodeId:
        "EP92",

      shotId:
        "S01",

      materializedOutput,
    },
    {
      now: () =>
        "2026-10-24T12:10:00.000Z",
    },
  );

  return mediaRoot;
}

function recordPath(
  mediaRoot:
    string,
): string {
  return createGoogleGenAiGenerationRecordPath(
    mediaRoot,
    "EP92",
    "S01",
    INTERACTION_ID,
  );
}

function outputPath(
  mediaRoot:
    string,
): string {
  return createGoogleGenAiVideoOutputPath(
    mediaRoot,
    "EP92",
    "S01",
    INTERACTION_ID,
  );
}

function completionPath(
  mediaRoot:
    string,
): string {
  return createExecutionCompletionPath(
    mediaRoot,
    "EP92",
    "S01",
  );
}

async function readJsonObject(
  path:
    string,
): Promise<Record<string, unknown>> {
  const parsed:
    unknown =
    JSON.parse(
      await readFile(
        path,
        "utf8",
      ),
    );

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Expected a JSON object.",
    );
  }

  return Object.fromEntries(
    Object.entries(
      parsed,
    ),
  );
}

async function replaceFile(
  path:
    string,
  contents:
    string | Buffer,
): Promise<void> {
  await unlink(
    path,
  );

  await writeFile(
    path,
    contents,
  );
}

async function rewriteJson(
  path:
    string,
  changes:
    Record<string, unknown>,
): Promise<void> {
  await replaceFile(
    path,
    JSON.stringify({
      ...(await readJsonObject(
        path,
      )),
      ...changes,
    }),
  );
}

async function rewriteOutput(
  mediaRoot:
    string,
  changes:
    Record<string, unknown>,
): Promise<void> {
  const record =
    await readJsonObject(
      recordPath(
        mediaRoot,
      ),
    );

  const outputs =
    record.outputs;

  const first =
    Array.isArray(outputs) &&
    typeof outputs[0] === "object" &&
    outputs[0] !== null
      ? Object.fromEntries(
          Object.entries(
            outputs[0],
          ),
        )
      : {};

  await replaceFile(
    recordPath(
      mediaRoot,
    ),
    JSON.stringify({
      ...record,

      outputs: [
        {
          ...first,
          ...changes,
        },
      ],
    }),
  );
}

async function snapshot(
  root:
    string,
): Promise<Record<string, string>> {
  const result:
    Record<string, string> = {};

  for (
    const entry of await readdir(
      root,
      {
        recursive:
          true,

        withFileTypes:
          true,
      },
    )
  ) {
    const absolute =
      join(
        entry.parentPath,
        entry.name,
      );

    const key =
      relative(
        root,
        absolute,
      );

    result[key] =
      entry.isFile()
        ? createHash(
            "sha256",
          )
            .update(
              await readFile(
                absolute,
              ),
            )
            .digest(
              "hex",
            )
        : `dir:${(await stat(absolute)).isDirectory()}`;
  }

  return result;
}

function verify(
  mediaRoot:
    string,
) {
  return verifyGoogleGenAiDurableCompletion(
    mediaRoot,
    "EP92",
    "S01",
  );
}

describe(
  "Busybookie Google GenAI durable completion verification",
  () => {
    it(
      "B14 verifies a valid durable completion and returns the exact frozen evidence",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const verification =
          await verify(
            mediaRoot,
          );

        expect(
          verification,
        ).toStrictEqual({
          provider:
            "GOOGLE_GENAI",

          providerExecutionId:
            INTERACTION_ID,

          reservationId:
            RESERVATION_ID,

          episodeId:
            "EP92",

          shotId:
            "S01",

          completionPath:
            completionPath(
              mediaRoot,
            ),

          completion:
            await readJsonObject(
              completionPath(
                mediaRoot,
              ),
            ),

          generationRecordPath:
            recordPath(
              mediaRoot,
            ),

          generationRecord:
            await readJsonObject(
              recordPath(
                mediaRoot,
              ),
            ),

          outputPath:
            outputPath(
              mediaRoot,
            ),

          bytes:
            OUTPUT_BYTES.byteLength,

          sha256:
            createHash(
              "sha256",
            )
              .update(
                OUTPUT_BYTES,
              )
              .digest(
                "hex",
              ),
        });

        expect(
          Object.isFrozen(
            verification,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "B15 reads the completion only from the canonical shared completion path",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await rename(
          completionPath(
            mediaRoot,
          ),
          join(
            dirname(
              completionPath(
                mediaRoot,
              ),
            ),
            "elsewhere.execution-completion.json",
          ),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          "Google GenAI durable completion verification requires COMPLETED lifecycle; received SUBMITTED.",
        );
      },
    );

    it(
      "B16 rejects a non-canonical generationRecordPath",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await rewriteJson(
          completionPath(
            mediaRoot,
          ),
          {
            generationRecordPath:
              join(
                mediaRoot,
                "generated-video",
                "EP92",
                "S01",
                "elsewhere.google-genai-generation.json",
              ),
          },
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /references a non-canonical generation record/,
        );
      },
    );

    it(
      "B17 rejects a missing generation record",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await unlink(
          recordPath(
            mediaRoot,
          ),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /generation record is missing for a durable completion/,
        );
      },
    );

    it(
      "B18 rejects a generation record that fails strict parsing",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await replaceFile(
          recordPath(
            mediaRoot,
          ),
          "{damaged",
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /not valid JSON/,
        );

        await replaceFile(
          recordPath(
            mediaRoot,
          ),
          JSON.stringify({
            ...(await completeGoogleRecord()),

            promptText:
              "leaked",
          }),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it.each([
      [
        "B19 reservationId",
        "reservationId",
        "44444444-4444-4444-8444-444444444444",
      ],
      [
        "B19 episodeId",
        "episodeId",
        "EP93",
      ],
      [
        "B19 shotId",
        "shotId",
        "S02",
      ],
      [
        "B22 providerExecutionId",
        "providerExecutionId",
        "v1_other-interaction",
      ],
    ])(
      "%s mismatch in the generation record is rejected",
      async (
        _label,
        field,
        value,
      ) => {
        const mediaRoot =
          await completeGoogle();

        await rewriteJson(
          recordPath(
            mediaRoot,
          ),
          {
            [field]:
              value,
          },
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /generation record identity does not match/,
        );
      },
    );

    it(
      "B20 rejects a submission whose identity does not match the reservation",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await rewriteJson(
          createExecutionSubmissionPath(
            mediaRoot,
            "EP92",
            "S01",
          ),
          {
            reservationId:
              "55555555-5555-4555-8555-555555555555",
          },
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /submission identity does not match the durable reservation/,
        );
      },
    );

    it(
      "B21 rejects a generation record whose provider is not GOOGLE_GENAI",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await rewriteJson(
          recordPath(
            mediaRoot,
          ),
          {
            provider:
              "VEO",
          },
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "B23 rejects a generation record with more than one output",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const record =
          await readJsonObject(
            recordPath(
              mediaRoot,
            ),
          );

        const outputs =
          Array.isArray(
            record.outputs,
          )
            ? record.outputs
            : [];

        await replaceFile(
          recordPath(
            mediaRoot,
          ),
          JSON.stringify({
            ...record,

            outputs: [
              ...outputs,
              ...outputs,
            ],
          }),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it.each([
      [
        "B24 outputIndex 2",
        {
          outputIndex:
            2,
        },
      ],
      [
        "B25 contentType video/webm",
        {
          contentType:
            "video/webm",
        },
      ],
    ])(
      "%s is rejected",
      async (
        _label,
        changes,
      ) => {
        const mediaRoot =
          await completeGoogle();

        await rewriteOutput(
          mediaRoot,
          changes,
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "B26 rejects a non-canonical destinationPath",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await rewriteOutput(
          mediaRoot,
          {
            destinationPath:
              join(
                mediaRoot,
                "generated-video",
                "EP92",
                "S01",
                "missing.mp4",
              ),
          },
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /is not the canonical output path/,
        );
      },
    );

    it(
      "B27 rejects a durable destinationPath pointing at another valid copy of the output",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const copyPath =
          join(
            mediaRoot,
            "generated-video",
            "EP92",
            "S01",
            "copy-of-output.mp4",
          );

        await copyFile(
          outputPath(
            mediaRoot,
          ),
          copyPath,
        );

        await rewriteOutput(
          mediaRoot,
          {
            destinationPath:
              copyPath,
          },
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /is not the canonical output path/,
        );
      },
    );

    it(
      "B28 evaluates containment on real paths when the shot directory is reached through a junction",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const shotDirectory =
          dirname(
            outputPath(
              mediaRoot,
            ),
          );

        const relocated =
          join(
            mediaRoot,
            "relocated-shot",
          );

        await rename(
          shotDirectory,
          relocated,
        );

        await symlink(
          relocated,
          shotDirectory,
          "junction",
        );

        const verification =
          await verify(
            mediaRoot,
          );

        expect(
          verification.outputPath,
        ).toBe(
          outputPath(
            mediaRoot,
          ),
        );
      },
    );

    it(
      "B29 rejects a directory at the output path",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await unlink(
          outputPath(
            mediaRoot,
          ),
        );

        await mkdir(
          outputPath(
            mediaRoot,
          ),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /is not a regular file/,
        );
      },
    );

    it(
      "B30 rejects an empty output file",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await replaceFile(
          outputPath(
            mediaRoot,
          ),
          Buffer.alloc(
            0,
          ),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /durable output is empty/,
        );
      },
    );

    it(
      "B31/B34 rejects an output whose byte count differs from the record",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await replaceFile(
          outputPath(
            mediaRoot,
          ),
          Buffer.concat([
            OUTPUT_BYTES,
            Buffer.from([
              0x00,
            ]),
          ]),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /bytes; generation record records/,
        );
      },
    );

    it(
      "B32/B35 rejects a same-size output whose SHA-256 differs from the record",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const corrupted =
          Buffer.from(
            OUTPUT_BYTES,
          );

        corrupted[corrupted.byteLength - 1] =
          (corrupted[corrupted.byteLength - 1] ?? 0) ^ 0xff;

        await replaceFile(
          outputPath(
            mediaRoot,
          ),
          corrupted,
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /SHA-256 [0-9a-f]{64} does not match generation record/,
        );
      },
    );

    it(
      "B33 rejects a missing output file",
      async () => {
        const mediaRoot =
          await completeGoogle();

        await unlink(
          outputPath(
            mediaRoot,
          ),
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /durable output does not exist/,
        );
      },
    );

    it(
      "B36 rejects a link at the output path that escapes to an outside directory",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const outside =
          join(
            mediaRoot,
            "outside-target",
          );

        await mkdir(
          outside,
        );

        await copyFile(
          outputPath(
            mediaRoot,
          ),
          join(
            outside,
            "copy.mp4",
          ),
        );

        await unlink(
          outputPath(
            mediaRoot,
          ),
        );

        // A directory junction needs no elevated privilege on Windows and is
        // a directory symlink elsewhere; lstat must report it as non-regular.
        await symlink(
          outside,
          outputPath(
            mediaRoot,
          ),
          "junction",
        );

        await expect(
          verify(
            mediaRoot,
          ),
        ).rejects.toThrow(
          /is not a regular file/,
        );
      },
    );

    it(
      "B37 has no provider, SDK, or network seams and takes only shot coordinates",
      async () => {
        const source =
          (
            await readFile(
              join(
                process.cwd(),
                VERIFIER_SOURCE,
              ),
              "utf8",
            )
          )
            .replace(
              /\/\*[\s\S]*?\*\//g,
              "",
            )
            .replace(
              /\/\/.*$/gm,
              "",
            );

        expect(
          source,
        ).not.toMatch(
          /@google\/genai|\bfetch\s*\(|node:https?|node:net|getInteraction|retrieveOutput|downloadUri|interactions\.|process\.env/,
        );

        expect(
          verifyGoogleGenAiDurableCompletion.length,
        ).toBe(
          3,
        );
      },
    );

    it(
      "B38 performs no writes",
      async () => {
        const mediaRoot =
          await completeGoogle();

        const before =
          await snapshot(
            mediaRoot,
          );

        await verify(
          mediaRoot,
        );

        expect(
          await snapshot(
            mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );

        const source =
          await readFile(
            join(
              process.cwd(),
              VERIFIER_SOURCE,
            ),
            "utf8",
          );

        expect(
          source,
        ).not.toMatch(
          /\bwriteFile\b|\blink\(|\bunlink\b|\bmkdir\b|\brename\b|\bcopyFile\b|"w"|"wx"|"a"/,
        );
      },
    );

    describe(
      "existing completion fail-closed",
      () => {
        it(
          "C39 completion with a missing generation record fails and nothing is recreated",
          async () => {
            const mediaRoot =
              await completeGoogle();

            await unlink(
              recordPath(
                mediaRoot,
              ),
            );

            await expect(
              verify(
                mediaRoot,
              ),
            ).rejects.toThrow();

            await expect(
              readFile(
                recordPath(
                  mediaRoot,
                ),
              ),
            ).rejects.toThrow();
          },
        );

        it(
          "C40 completion with a conflicting generation record fails",
          async () => {
            const mediaRoot =
              await completeGoogle();

            await rewriteOutput(
              mediaRoot,
              {
                sha256:
                  "c".repeat(
                    64,
                  ),
              },
            );

            await expect(
              verify(
                mediaRoot,
              ),
            ).rejects.toThrow(
              /does not match generation record/,
            );
          },
        );

        it(
          "C41 completion with a non-canonical generationRecordPath fails",
          async () => {
            const mediaRoot =
              await completeGoogle();

            await rewriteJson(
              completionPath(
                mediaRoot,
              ),
              {
                generationRecordPath:
                  "/somewhere/else.google-genai-generation.json",
              },
            );

            await expect(
              verify(
                mediaRoot,
              ),
            ).rejects.toThrow(
              /non-canonical generation record/,
            );
          },
        );

        it(
          "C42 completion with a missing output fails",
          async () => {
            const mediaRoot =
              await completeGoogle();

            await unlink(
              outputPath(
                mediaRoot,
              ),
            );

            await expect(
              verify(
                mediaRoot,
              ),
            ).rejects.toThrow(
              /does not exist/,
            );
          },
        );

        it(
          "C43 completion with a corrupt output fails",
          async () => {
            const mediaRoot =
              await completeGoogle();

            await replaceFile(
              outputPath(
                mediaRoot,
              ),
              Buffer.alloc(
                OUTPUT_BYTES.byteLength,
                0x41,
              ),
            );

            await expect(
              verify(
                mediaRoot,
              ),
            ).rejects.toThrow(
              /does not match generation record/,
            );
          },
        );
      },
    );
  },
);

async function completeGoogleRecord():
Promise<Record<string, unknown>> {
  const mediaRoot =
    await completeGoogle();

  return readJsonObject(
    recordPath(
      mediaRoot,
    ),
  );
}
