import {
  createHash,
  randomUUID,
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
  basename,
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
  claimGoogleGenAiProviderExecutionId,
} from "../src/execution/claimGoogleGenAiProviderExecutionId.js";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  GoogleGenAiExecutionSubmissionV1_4Schema,
} from "../src/execution/executionSubmission.schema.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  calculateGoogleGenAiProviderExecutionIdSha256,
  createGoogleGenAiProviderExecutionClaimPath,
} from "../src/execution/googleGenAiProviderExecutionClaimPath.js";

import {
  readGoogleGenAiProviderExecutionClaim,
} from "../src/execution/readGoogleGenAiProviderExecutionClaim.js";

import {
  VisualAttemptGoogleGenAiExecutionSubmissionSchema,
} from "../src/execution/visualAttemptExecutionLifecycle.schema.js";

import {
  createVisualAttemptExecutionSubmissionPath,
} from "../src/execution/visualAttemptExecutionPaths.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const temporaryRoots:
  string[] =
    [];

const PROVIDER_ID =
  "v1_claim_test_provider_execution_123";

const CLAIMED_AT =
  "2026-11-03T17:30:00.000Z";

async function makeRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-provider-claim-",
      ),
    );

  temporaryRoots.push(
    root,
  );

  return root;
}

afterEach(
  async () => {
    await Promise.all(
      temporaryRoots
        .splice(
          0,
        )
        .map(
          (root) =>
            rm(
              root,
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

function legacyOwner(
  mediaRoot:
    string,

  options:
    Partial<{
      providerExecutionId:
        string;

      shotId:
        string;

      reservationId:
        string;
    }> =
      {},
) {
  const shotId =
    options.shotId ??
    "S01";

  return {
    lifecycleMode:
      "LEGACY" as const,

    provider:
      "GOOGLE_GENAI" as const,

    providerExecutionId:
      options.providerExecutionId ??
      PROVIDER_ID,

    episodeId:
      "EP90",

    shotId,

    reservationId:
      options.reservationId ??
      randomUUID(),

    submissionPath:
      createExecutionSubmissionPath(
        mediaRoot,
        "EP90",
        shotId,
      ),
  };
}

async function googleRecoveryMetadata(
  mediaRoot:
    string,
) {
  const policySnapshot =
    await Promise.resolve(
      loadGoogleGenAiPolicy(),
    );

  return {
    request: {
      model:
        "gemini-omni-1.1-flash" as const,

      background:
        true as const,

      store:
        true as const,

      stream:
        false as const,

      promptText:
        "Atomic claim test.",

      sourceImagePath:
        join(
          mediaRoot,
          "references",
          "claim-test.png",
        ),
    },

    policySnapshot,
  };
}

describe(
  "B5 Slice-2H-A Google providerExecutionId global claim",
  () => {
    it(
      "derives the claim filename from the exact providerExecutionId SHA-256 and never exposes the raw id",
      async () => {
        const mediaRoot =
          await makeRoot();

        const expected =
          createHash(
            "sha256",
          )
            .update(
              PROVIDER_ID,
              "utf8",
            )
            .digest(
              "hex",
            );

        expect(
          calculateGoogleGenAiProviderExecutionIdSha256(
            PROVIDER_ID,
          ),
        ).toBe(
          expected,
        );

        const claimPath =
          createGoogleGenAiProviderExecutionClaimPath(
            mediaRoot,
            PROVIDER_ID,
          );

        expect(
          basename(
            claimPath,
          ),
        ).toBe(
          expected +
            ".json",
        );

        expect(
          basename(
            claimPath,
          ),
        ).not.toContain(
          PROVIDER_ID,
        );
      },
    );

    it(
      "allows exactly one winner when two different owners concurrently claim one providerExecutionId",
      async () => {
        const mediaRoot =
          await makeRoot();

        const ownerA =
          legacyOwner(
            mediaRoot,
            {
              shotId:
                "S01",
            },
          );

        const ownerB =
          legacyOwner(
            mediaRoot,
            {
              shotId:
                "S02",
            },
          );

        const settled =
          await Promise.allSettled([
            claimGoogleGenAiProviderExecutionId(
              mediaRoot,
              ownerA,
              {
                now:
                  () =>
                    CLAIMED_AT,
              },
            ),

            claimGoogleGenAiProviderExecutionId(
              mediaRoot,
              ownerB,
              {
                now:
                  () =>
                    CLAIMED_AT,
              },
            ),
          ]);

        expect(
          settled.filter(
            (entry) =>
              entry.status ===
                "fulfilled",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          settled.filter(
            (entry) =>
              entry.status ===
                "rejected",
          ),
        ).toHaveLength(
          1,
        );

        const evidence =
          await readGoogleGenAiProviderExecutionClaim(
            mediaRoot,
            PROVIDER_ID,
          );

        expect(
          evidence,
        ).not.toBeNull();
      },
    );

    it(
      "reuses an exact existing owner claim but refuses another owner",
      async () => {
        const mediaRoot =
          await makeRoot();

        const owner =
          legacyOwner(
            mediaRoot,
          );

        const first =
          await claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            owner,
            {
              now:
                () =>
                  CLAIMED_AT,
            },
          );

        expect(
          first.reused,
        ).toBe(
          false,
        );

        const second =
          await claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            owner,
            {
              now:
                () =>
                  "2026-11-03T17:31:00.000Z",
            },
          );

        expect(
          second.reused,
        ).toBe(
          true,
        );

        expect(
          second.claimSha256,
        ).toBe(
          first.claimSha256,
        );

        await expect(
          claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            {
              ...owner,

              shotId:
                "S02",

              submissionPath:
                createExecutionSubmissionPath(
                  mediaRoot,
                  "EP90",
                  "S02",
                ),
            },
          ),
        ).rejects.toThrow(
          /owned|collision/i,
        );
      },
    );

    it.each([
      "",
      "{",
      "{}\n",
    ])(
      "fails closed for malformed or partial existing claim bytes",
      async (
        bytes,
      ) => {
        const mediaRoot =
          await makeRoot();

        const claimPath =
          createGoogleGenAiProviderExecutionClaimPath(
            mediaRoot,
            PROVIDER_ID,
          );

        await mkdir(
          dirname(
            claimPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          claimPath,
          bytes,
          "utf8",
        );

        await expect(
          claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            legacyOwner(
              mediaRoot,
            ),
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "treats a historical legacy Google submission as ownership evidence even without a claim file",
      async () => {
        const mediaRoot =
          await makeRoot();

        const recoveryMetadata =
          await googleRecoveryMetadata(
            mediaRoot,
          );

        const historicalPath =
          createExecutionSubmissionPath(
            mediaRoot,
            "EP90",
            "S01",
          );

        const historical =
          GoogleGenAiExecutionSubmissionV1_4Schema
            .parse({
              schemaVersion:
                "1.4",

              submittedAt:
                CLAIMED_AT,

              status:
                "SUBMITTED",

              reservationId:
                randomUUID(),

              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                PROVIDER_ID,

              recoveryMetadata,
            });

        await mkdir(
          dirname(
            historicalPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          historicalPath,
          JSON.stringify(
            historical,
            null,
            2,
          ) +
            "\n",
          "utf8",
        );

        await expect(
          claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            legacyOwner(
              mediaRoot,
              {
                shotId:
                  "S02",
              },
            ),
          ),
        ).rejects.toThrow(
          /already owned|owned|collision/i,
        );
      },
    );

    it(
      "treats a historical attempt submission as ownership evidence even without a claim file",
      async () => {
        const mediaRoot =
          await makeRoot();

        const recoveryMetadata =
          await googleRecoveryMetadata(
            mediaRoot,
          );

        const historicalPath =
          createVisualAttemptExecutionSubmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          );

        const historical =
          VisualAttemptGoogleGenAiExecutionSubmissionSchema
            .parse({
              schemaVersion:
                "1.0",

              submittedAt:
                CLAIMED_AT,

              status:
                "SUBMITTED",

              reservationId:
                randomUUID(),

              reservationSha256:
                "b".repeat(
                  64,
                ),

              episodeId:
                "EP93",

              sceneId:
                "SC01",

              shotId:
                "S01",

              attemptNumber:
                2,

              admissionId:
                randomUUID(),

              admissionSha256:
                "a".repeat(
                  64,
                ),

              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                PROVIDER_ID,

              recoveryMetadata,
            });

        await mkdir(
          dirname(
            historicalPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          historicalPath,
          JSON.stringify(
            historical,
            null,
            2,
          ) +
            "\n",
          "utf8",
        );

        await expect(
          claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            legacyOwner(
              mediaRoot,
              {
                shotId:
                  "S02",
              },
            ),
          ),
        ).rejects.toThrow(
          /already owned|owned|collision/i,
        );
      },
    );

    it(
      "does not treat a generation-record-shaped file as an independent providerExecutionId owner",
      async () => {
        const mediaRoot =
          await makeRoot();

        const generationPath =
          join(
            mediaRoot,
            "generated-video",
            "EP90",
            "S01",
            "fake.google-genai-generation.json",
          );

        await mkdir(
          dirname(
            generationPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          generationPath,
          JSON.stringify(
            {
              providerExecutionId:
                PROVIDER_ID,
            },
            null,
            2,
          ) +
            "\n",
          "utf8",
        );

        await expect(
          claimGoogleGenAiProviderExecutionId(
            mediaRoot,
            legacyOwner(
              mediaRoot,
            ),
          ),
        ).resolves.toMatchObject({
          reused:
            false,
        });
      },
    );

    it(
      "allows unrelated Google providerExecutionIds to coexist",
      async () => {
        const mediaRoot =
          await makeRoot();

        await expect(
          Promise.all([
            claimGoogleGenAiProviderExecutionId(
              mediaRoot,
              legacyOwner(
                mediaRoot,
                {
                  providerExecutionId:
                    PROVIDER_ID +
                    "_a",

                  shotId:
                    "S01",
                },
              ),
            ),

            claimGoogleGenAiProviderExecutionId(
              mediaRoot,
              legacyOwner(
                mediaRoot,
                {
                  providerExecutionId:
                    PROVIDER_ID +
                    "_b",

                  shotId:
                    "S02",
                },
              ),
            ),
          ]),
        ).resolves.toHaveLength(
          2,
        );
      },
    );

    it(
      "retains the claim when legacy durable submission publication fails after claiming",
      async () => {
        const mediaRoot =
          await makeRoot();

        const reservation =
          await createExecutionReservation(
            mediaRoot,
            {
              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "GOOGLE_GENAI",
            },
          );

        const submissionPath =
          createExecutionSubmissionPath(
            mediaRoot,
            "EP90",
            "S01",
          );

        await mkdir(
          submissionPath,
          {
            recursive:
              true,
          },
        );

        const recoveryMetadata =
          await googleRecoveryMetadata(
            mediaRoot,
          );

        await expect(
          createExecutionSubmission(
            mediaRoot,
            {
              reservationId:
                reservation.record
                  .reservationId,

              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                PROVIDER_ID,

              recoveryMetadata,
            },
            {
              now:
                () =>
                  CLAIMED_AT,
            },
          ),
        ).rejects.toThrow();

        const claim =
          await readGoogleGenAiProviderExecutionClaim(
            mediaRoot,
            PROVIDER_ID,
          );

        expect(
          claim,
        ).not.toBeNull();

        expect(
          claim?.record,
        ).toMatchObject({
          lifecycleMode:
            "LEGACY",

          providerExecutionId:
            PROVIDER_ID,

          reservationId:
            reservation.record
              .reservationId,
        });
      },
    );

    it(
      "keeps claim acquisition before both durable submission publication seams and keeps non-Google legacy branches outside the claim guard",
      async () => {
        const legacySource =
          await readFile(
            join(
              process.cwd(),
              "src/execution/createExecutionSubmission.ts",
            ),
            "utf8",
          );

        const attemptSource =
          await readFile(
            join(
              process.cwd(),
              "src/execution/createVisualAttemptExecutionSubmission.ts",
            ),
            "utf8",
          );

        const legacyClaim =
          legacySource.indexOf(
            "await claimGoogleGenAiProviderExecutionId(",
          );

        const legacyPublication =
          legacySource.indexOf(
            "await mkdir(",
          );

        const attemptClaim =
          attemptSource.indexOf(
            "await claimGoogleGenAiProviderExecutionId(",
          );

        const attemptPublication =
          attemptSource.indexOf(
            "await publishVisualAttemptExecutionRecordCreateOnce(",
          );

        expect(
          legacyClaim,
        ).toBeGreaterThan(
          -1,
        );

        expect(
          legacyPublication,
        ).toBeGreaterThan(
          legacyClaim,
        );

        expect(
          attemptClaim,
        ).toBeGreaterThan(
          -1,
        );

        expect(
          attemptPublication,
        ).toBeGreaterThan(
          attemptClaim,
        );

        expect(
          legacySource,
        ).toMatch(
          /record\.schemaVersion\s*===\s*"1\.4"[\s\S]*?claimGoogleGenAiProviderExecutionId/,
        );
      },
    );

    it(
      "keeps claim modules free of provider transport, credentials, activation and network authority",
      async () => {
        for (
          const file of [
            "src/execution/googleGenAiProviderExecutionClaim.schema.ts",
            "src/execution/googleGenAiProviderExecutionClaimPath.ts",
            "src/execution/readGoogleGenAiProviderExecutionClaim.ts",
            "src/execution/claimGoogleGenAiProviderExecutionId.ts",
          ]
        ) {
          const source =
            await readFile(
              join(
                process.cwd(),
                file,
              ),
              "utf8",
            );

          expect(
            source,
            file,
          ).not.toMatch(
            /@google\/genai|process\.env|loadEnvironment|newSubmissionsEnabled|\bfetch\s*\(|node:https?|node:net|node:child_process|interactions\.create|createInteraction\(/,
          );
        }
      },
    );
  },
);
