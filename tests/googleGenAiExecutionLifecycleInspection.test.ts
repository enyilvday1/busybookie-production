import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
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
  inspectGoogleGenAiExecutionLifecycle,
} from "../src/execution/inspectGoogleGenAiExecutionLifecycle.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputRetriever,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  persistGoogleGenAiSingleShotCompletion,
} from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const INSPECTOR_SOURCE =
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts";

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
      "busybookie-google-inspection-output",
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

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-inspection-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function reserve(
  mediaRoot:
    string,
  provider:
    "GOOGLE_GENAI" | "RUNWAY" =
      "GOOGLE_GENAI",
): Promise<void> {
  await createExecutionReservation(
    mediaRoot,
    {
      episodeId:
        "EP92",

      shotId:
        "S01",

      provider,
    },
    {
      now: () =>
        "2026-10-24T12:00:00.000Z",

      createReservationId: () =>
        RESERVATION_ID,
    },
  );
}

function googleSubmissionRecord(
  mediaRoot:
    string,
) {
  return {
    schemaVersion:
      "1.4",

    submittedAt:
      "2026-10-24T12:01:00.000Z",

    status:
      "SUBMITTED",

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
          "Busybookie Google inspection test.",

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
  };
}

async function submitGoogle(
  mediaRoot:
    string,
): Promise<void> {
  await reserve(
    mediaRoot,
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
            "Busybookie Google inspection test.",

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
}

async function completeGoogle(
  mediaRoot:
    string,
): Promise<void> {
  await submitGoogle(
    mediaRoot,
  );

  const bytes =
    makeMp4();

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
                  bytes.toString(
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

async function rewriteJson(
  path:
    string,
  changes:
    Record<string, unknown>,
): Promise<void> {
  const current =
    await readJsonObject(
      path,
    );

  await unlink(
    path,
  );

  await writeFile(
    path,
    JSON.stringify({
      ...current,
      ...changes,
    }),
    "utf8",
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

    if (entry.isFile()) {
      result[key] =
        createHash(
          "sha256",
        )
          .update(
            await readFile(
              absolute,
            ),
          )
          .digest(
            "hex",
          );
    } else {
      result[key] =
        `dir:${(await stat(absolute)).isDirectory()}`;
    }
  }

  return result;
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

describe(
  "Busybookie Google GenAI lifecycle inspection",
  () => {
    it(
      "A1 throws when no durable reservation exists",
      async () => {
        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            await makeMediaRoot(),
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          "Google GenAI lifecycle inspection requires a durable reservation for EP92/S01.",
        );
      },
    );

    it(
      "A2 throws for a non-Google reservation",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await reserve(
          mediaRoot,
          "RUNWAY",
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          "Google GenAI lifecycle inspection requires a GOOGLE_GENAI reservation; received RUNWAY.",
        );
      },
    );

    it(
      "A2b throws for a corrupt reservation",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await reserve(
          mediaRoot,
        );

        const reservationPath =
          join(
            dirname(
              completionPath(
                mediaRoot,
              ),
            ),
            "EP92_S01.execution-reservation.json",
          );

        await unlink(
          reservationPath,
        );

        await writeFile(
          reservationPath,
          "{damaged",
          "utf8",
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "A3 returns RESERVED_ONLY for a Google reservation without a submission",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await reserve(
          mediaRoot,
        );

        const inspection =
          await inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          );

        expect(
          inspection.state,
        ).toBe(
          "RESERVED_ONLY",
        );

        expect(
          inspection.provider,
        ).toBe(
          "GOOGLE_GENAI",
        );

        expect(
          inspection.reservation
            .reservationId,
        ).toBe(
          RESERVATION_ID,
        );

        expect(
          Object.isFrozen(
            inspection,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "A3b throws when a Google completion exists without a submission",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await completeGoogle(
          mediaRoot,
        );

        await unlink(
          createExecutionSubmissionPath(
            mediaRoot,
            "EP92",
            "S01",
          ),
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          "Google GenAI lifecycle completion exists without a durable submission.",
        );
      },
    );

    it(
      "A4 returns SUBMITTED for a submission 1.4 without a completion",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await submitGoogle(
          mediaRoot,
        );

        const inspection =
          await inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          );

        if (
          inspection.state !==
          "SUBMITTED"
        ) {
          throw new Error(
            `Expected SUBMITTED; received ${inspection.state}.`,
          );
        }

        expect(
          inspection.submission
            .providerExecutionId,
        ).toBe(
          INTERACTION_ID,
        );

        expect(
          inspection.submission
            .schemaVersion,
        ).toBe(
          "1.4",
        );
      },
    );

    it(
      "A4b throws for a non-Google submission under a Google reservation",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await reserve(
          mediaRoot,
        );

        const submissionPath =
          createExecutionSubmissionPath(
            mediaRoot,
            "EP92",
            "S01",
          );

        await writeFile(
          submissionPath,
          JSON.stringify({
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-10-24T12:01:00.000Z",

            status:
              "SUBMITTED",

            reservationId:
              RESERVATION_ID,

            episodeId:
              "EP92",

            shotId:
              "S01",

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-runway",
          }),
          "utf8",
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          "Google GenAI lifecycle inspection requires a GOOGLE_GENAI submission; received RUNWAY.",
        );
      },
    );

    it(
      "A4c throws when the submission identity does not match the reservation",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await reserve(
          mediaRoot,
        );

        await writeFile(
          createExecutionSubmissionPath(
            mediaRoot,
            "EP92",
            "S01",
          ),
          JSON.stringify({
            ...googleSubmissionRecord(
              mediaRoot,
            ),

            reservationId:
              "22222222-2222-4222-8222-222222222222",
          }),
          "utf8",
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          "Google GenAI lifecycle submission identity does not match the durable reservation.",
        );
      },
    );

    it(
      "A5 returns COMPLETED with the canonical completion path for a valid Google completion",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await completeGoogle(
          mediaRoot,
        );

        const inspection =
          await inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          );

        if (
          inspection.state !==
          "COMPLETED"
        ) {
          throw new Error(
            `Expected COMPLETED; received ${inspection.state}.`,
          );
        }

        expect(
          inspection.completionPath,
        ).toBe(
          completionPath(
            mediaRoot,
          ),
        );

        expect(
          inspection.completion
            .schemaVersion,
        ).toBe(
          "1.1",
        );

        expect(
          inspection.completion
            .providerExecutionId,
        ).toBe(
          INTERACTION_ID,
        );
      },
    );

    it(
      "A6 throws for a malformed completion instead of downgrading to SUBMITTED",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await completeGoogle(
          mediaRoot,
        );

        await unlink(
          completionPath(
            mediaRoot,
          ),
        );

        await writeFile(
          completionPath(
            mediaRoot,
          ),
          "{damaged",
          "utf8",
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          /not valid JSON/,
        );
      },
    );

    it(
      "A6b throws for a completion whose provider is not GOOGLE_GENAI",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await completeGoogle(
          mediaRoot,
        );

        await rewriteJson(
          completionPath(
            mediaRoot,
          ),
          {
            provider:
              "VEO",
          },
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow();
      },
    );

    it.each([
      [
        "A7 reservationId",
        "reservationId",
        "33333333-3333-4333-8333-333333333333",
      ],
      [
        "A8 episodeId",
        "episodeId",
        "EP93",
      ],
      [
        "A9 shotId",
        "shotId",
        "S02",
      ],
      [
        "A10 providerExecutionId",
        "providerExecutionId",
        "v1_other-interaction",
      ],
    ])(
      "%s mismatch in the completion throws",
      async (
        _label,
        field,
        value,
      ) => {
        const mediaRoot =
          await makeMediaRoot();

        await completeGoogle(
          mediaRoot,
        );

        await rewriteJson(
          completionPath(
            mediaRoot,
          ),
          {
            [field]:
              value,
          },
        );

        await expect(
          inspectGoogleGenAiExecutionLifecycle(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow(
          "Google GenAI lifecycle completion does not match the durable reservation and submission.",
        );
      },
    );

    it(
      "A11 has no provider, SDK, or network seams in its source",
      async () => {
        const source =
          (
            await readFile(
              join(
                process.cwd(),
                INSPECTOR_SOURCE,
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
      },
    );

    it(
      "A12 performs no writes in any state",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        await completeGoogle(
          mediaRoot,
        );

        const before =
          await snapshot(
            mediaRoot,
          );

        await inspectGoogleGenAiExecutionLifecycle(
          mediaRoot,
          "EP92",
          "S01",
        );

        expect(
          await snapshot(
            mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );

        const submittedRoot =
          await makeMediaRoot();

        await submitGoogle(
          submittedRoot,
        );

        const submittedBefore =
          await snapshot(
            submittedRoot,
          );

        await inspectGoogleGenAiExecutionLifecycle(
          submittedRoot,
          "EP92",
          "S01",
        );

        expect(
          await snapshot(
            submittedRoot,
          ),
        ).toStrictEqual(
          submittedBefore,
        );
      },
    );

    it(
      "A13 never uses the shared completion reader or shared lifecycle inspection",
      async () => {
        const source =
          await readFile(
            join(
              process.cwd(),
              INSPECTOR_SOURCE,
            ),
            "utf8",
          );

        expect(
          source,
        ).not.toMatch(
          /["']\.\/readExecutionCompletion\.js["']|["']\.\/inspectExecutionLifecycle\.js["']|["']\.\/classifyExecutionLifecycle\.js["']/,
        );

        expect(
          source,
        ).toMatch(
          /["']\.\/readGoogleGenAiExecutionCompletion\.js["']/,
        );
      },
    );
  },
);
