import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readFile,
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
  calculateVisualAttemptQcSha256,
  createVisualAttemptQc,
} from "../src/execution/createVisualAttemptQc.js";

import {
  readVisualAttemptQc,
  readVisualAttemptQcEvidence,
} from "../src/execution/readVisualAttemptQc.js";

import {
  createVisualAttemptQcPath,
} from "../src/execution/visualAttemptPaths.js";

import {
  VisualAttemptQcInputSchema,
  VisualAttemptQcSchema,
} from "../src/execution/visualAttemptQc.schema.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
  Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-visual-attempt-qc-",
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

const hashA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const hashB =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const hashC =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const input = {
  episodeId:
    "EP93",

  sceneId:
    "SC01",

  shotId:
    "S01",

  attemptNumber:
    1,

  provider:
    "GOOGLE_GENAI",

  providerExecutionId:
    "interaction-ep93-s01-attempt-1",

  lineage: {
    completionSha256:
      hashA,

    generationRecordSha256:
      hashB,

    outputSha256:
      hashC,
  },

  decision:
    "REJECTED_FOR_PRODUCTION",

  reasonCode:
    "LOW_VISUAL_QUALITY",

  assessment: {
    visualIntegrity:
      "PASS",

    littleleafValleyConsistency:
      "PASS",

    motionCoherence:
      "PASS",

    motionComment:
      "Motion is coherent.",

    audioIntegrity:
      "PASS",

    beginningEndIntegrity:
      "PASS",

    overallUsability:
      "FAIL",

    overallUsabilityComment:
      "Not production usable because visual quality is below the approved standard.",
  },
} as const;

const dependencies = {
  now:
    () =>
      "2026-11-02T20:48:52.000Z",

  createQcId:
    () =>
      "11111111-1111-4111-8111-111111111111",
};

describe(
  "visual attempt QC schema",
  () => {
    it(
      "accepts attempt 1 and all durable visual providers",
      () => {
        for (
          const provider
          of [
            "RUNWAY",
            "VEO",
            "GOOGLE_GENAI",
          ] as const
        ) {
          expect(
            VisualAttemptQcInputSchema
              .safeParse({
                ...input,
                provider,
              })
              .success,
          ).toBe(
            true,
          );
        }
      },
    );

    it(
      "rejects invalid attempt numbers and uncontrolled reason codes",
      () => {
        expect(
          VisualAttemptQcInputSchema
            .safeParse({
              ...input,

              attemptNumber:
                0,
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          VisualAttemptQcInputSchema
            .safeParse({
              ...input,

              reasonCode:
                "low visual quality",
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "contains no replacement-generation authorization field",
      () => {
        expect(
          VisualAttemptQcInputSchema
            .safeParse({
              ...input,

              replacementGenerationAuthorized:
                true,
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          VisualAttemptQcSchema
            .safeParse({
              ...input,

              schemaVersion:
                "1.0",

              qcId:
                "11111111-1111-4111-8111-111111111111",

              recordedAt:
                "2026-11-02T20:48:52.000Z",

              status:
                "RECORDED",

              reviewer:
                "HUMAN_OPERATOR",

              replacementGenerationAuthorized:
                true,
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
  "immutable visual attempt QC persistence",
  () => {
    it(
      "writes canonical attempt-1 QC bytes and returns their SHA-256",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const result =
          await createVisualAttemptQc(
            mediaRoot,
            input,
            dependencies,
          );

        expect(
          result.qcPath,
        ).toBe(
          createVisualAttemptQcPath(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        );

        expect(
          result.record,
        ).toEqual({
          ...input,

          schemaVersion:
            "1.0",

          qcId:
            "11111111-1111-4111-8111-111111111111",

          recordedAt:
            "2026-11-02T20:48:52.000Z",

          status:
            "RECORDED",

          reviewer:
            "HUMAN_OPERATOR",
        });

        const raw =
          await readFile(
            result.qcPath,
            "utf8",
          );

        expect(
          raw,
        ).toBe(
          `${JSON.stringify(
            result.record,
            null,
            2,
          )}\n`,
        );

        const expectedSha =
          createHash(
            "sha256",
          )
            .update(
              raw,
            )
            .digest(
              "hex",
            );

        expect(
          result.qcSha256,
        ).toBe(
          expectedSha,
        );

        expect(
          calculateVisualAttemptQcSha256(
            raw,
          ),
        ).toBe(
          expectedSha,
        );
      },
    );

    it(
      "reads the durable record and exposes the exact byte hash",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const created =
          await createVisualAttemptQc(
            mediaRoot,
            input,
            dependencies,
          );

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).resolves.toEqual(
          created.record,
        );

        await expect(
          readVisualAttemptQcEvidence(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).resolves.toEqual({
          record:
            created.record,

          qcPath:
            created.qcPath,

          qcSha256:
            created.qcSha256,
        });
      },
    );

    it(
      "returns null when the canonical QC artifact does not exist",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).resolves.toBeNull();

        await expect(
          readVisualAttemptQcEvidence(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "fails closed on duplicate QC creation and preserves the original",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const original =
          await createVisualAttemptQc(
            mediaRoot,
            input,
            dependencies,
          );

        await expect(
          createVisualAttemptQc(
            mediaRoot,
            {
              ...input,

              reasonCode:
                "SECOND_DECISION",
            },
            {
              ...dependencies,

              createQcId:
                () =>
                  "22222222-2222-4222-8222-222222222222",
            },
          ),
        ).rejects.toThrow(
          /visual attempt QC already exists/i,
        );

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).resolves.toEqual(
          original.record,
        );
      },
    );

    it(
      "fails closed on malformed JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const qcPath =
          createVisualAttemptQcPath(
            mediaRoot,
            "EP93",
            "S01",
            1,
          );

        await mkdir(
          dirname(
            qcPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          qcPath,
          "{broken",
          "utf8",
        );

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );
      },
    );

    it(
      "fails closed on schema-invalid JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const qcPath =
          createVisualAttemptQcPath(
            mediaRoot,
            "EP93",
            "S01",
            1,
          );

        await mkdir(
          dirname(
            qcPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          qcPath,
          `${JSON.stringify({
            invalid:
              true,
          })}\n`,
          "utf8",
        );

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects noncanonical bytes even when the JSON value is valid",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const created =
          await createVisualAttemptQc(
            mediaRoot,
            input,
            dependencies,
          );

        await writeFile(
          created.qcPath,
          JSON.stringify(
            created.record,
          ),
          "utf8",
        );

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).rejects.toThrow(
          /bytes are not canonical/i,
        );
      },
    );

    it(
      "rejects a record whose embedded attempt identity disagrees with its path",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const created =
          await createVisualAttemptQc(
            mediaRoot,
            input,
            dependencies,
          );

        const wrongIdentity = {
          ...created.record,

          attemptNumber:
            2,
        };

        await writeFile(
          created.qcPath,
          `${JSON.stringify(
            wrongIdentity,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readVisualAttemptQc(
            mediaRoot,
            "EP93",
            "S01",
            1,
          ),
        ).rejects.toThrow(
          /identity does not match/i,
        );
      },
    );
  },
);
