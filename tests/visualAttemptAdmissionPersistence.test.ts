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
  calculateVisualAttemptAdmissionSha256,
  createVisualAttemptAdmission,
} from "../src/execution/createVisualAttemptAdmission.js";

import {
  readVisualAttemptAdmission,
  readVisualAttemptAdmissionEvidence,
} from "../src/execution/readVisualAttemptAdmission.js";

import {
  createVisualAttemptAdmissionPath,
} from "../src/execution/visualAttemptPaths.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
  Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-visual-attempt-admission-",
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

const hashD =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

const input = {
  attemptNumber:
    2,

  episodeId:
    "EP93",

  sceneId:
    "SC01",

  shotId:
    "S01",

  provider:
    "GOOGLE_GENAI",

  manifestRawSha256:
    hashA,

  promptIdentitySha256:
    hashB,

  referenceIdentitySha256:
    hashC,

  previousAttemptNumber:
    1,

  previousAttemptQcSha256:
    hashD,
} as const;

const dependencies = {
  now:
    () =>
      "2026-11-02T21:00:00.000Z",

  createAdmissionId:
    () =>
      "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
};

describe(
  "immutable visual attempt admission persistence",
  () => {
    it(
      "writes canonical attempt-2 admission bytes and returns their SHA-256",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const result =
          await createVisualAttemptAdmission(
            mediaRoot,
            input,
            dependencies,
          );

        expect(
          result.admissionPath,
        ).toBe(
          createVisualAttemptAdmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          admissionId:
            "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e5f",

          attemptNumber:
            2,

          admittedAt:
            "2026-11-02T21:00:00.000Z",

          status:
            "ADMITTED",

          episodeId:
            "EP93",

          sceneId:
            "SC01",

          shotId:
            "S01",

          provider:
            "GOOGLE_GENAI",

          manifestRawSha256:
            hashA,

          promptIdentitySha256:
            hashB,

          referenceIdentitySha256:
            hashC,

          previousAttemptNumber:
            1,

          previousAttemptQcSha256:
            hashD,
        });

        const raw =
          await readFile(
            result.admissionPath,
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
          result.admissionSha256,
        ).toBe(
          expectedSha,
        );

        expect(
          calculateVisualAttemptAdmissionSha256(
            raw,
          ),
        ).toBe(
          expectedSha,
        );
      },
    );

    it(
      "reads the durable admission and exposes the exact byte hash",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const created =
          await createVisualAttemptAdmission(
            mediaRoot,
            input,
            dependencies,
          );

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).resolves.toEqual(
          created.record,
        );

        await expect(
          readVisualAttemptAdmissionEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).resolves.toEqual({
          record:
            created.record,

          admissionPath:
            created.admissionPath,

          admissionSha256:
            created.admissionSha256,
        });
      },
    );

    it(
      "returns null when the canonical admission artifact does not exist",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).resolves.toBeNull();

        await expect(
          readVisualAttemptAdmissionEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "fails closed on duplicate admission creation and preserves the original",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const original =
          await createVisualAttemptAdmission(
            mediaRoot,
            input,
            dependencies,
          );

        await expect(
          createVisualAttemptAdmission(
            mediaRoot,
            {
              ...input,

              promptIdentitySha256:
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            },
            {
              ...dependencies,

              createAdmissionId:
                () =>
                  "11111111-1111-4111-8111-111111111111",
            },
          ),
        ).rejects.toThrow(
          /visual attempt admission already exists/i,
        );

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
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

        const admissionPath =
          createVisualAttemptAdmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          );

        await mkdir(
          dirname(
            admissionPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          admissionPath,
          "{broken",
          "utf8",
        );

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
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

        const admissionPath =
          createVisualAttemptAdmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          );

        await mkdir(
          dirname(
            admissionPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          admissionPath,
          `${JSON.stringify({
            invalid:
              true,
          })}\n`,
          "utf8",
        );

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
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
          await createVisualAttemptAdmission(
            mediaRoot,
            input,
            dependencies,
          );

        await writeFile(
          created.admissionPath,
          JSON.stringify(
            created.record,
          ),
          "utf8",
        );

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow(
          /bytes are not canonical/i,
        );
      },
    );

    it(
      "rejects a schema-valid record whose embedded attempt identity disagrees with its path",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const created =
          await createVisualAttemptAdmission(
            mediaRoot,
            input,
            dependencies,
          );

        const wrongIdentity = {
          ...created.record,

          attemptNumber:
            3,

          previousAttemptNumber:
            2,
        };

        await writeFile(
          created.admissionPath,
          `${JSON.stringify(
            wrongIdentity,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readVisualAttemptAdmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow(
          /identity does not match/i,
        );
      },
    );
  },
);
