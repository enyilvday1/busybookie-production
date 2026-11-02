import {
  describe,
  expect,
  it,
} from "vitest";

import {
  VisualAttemptAdmissionSchema,
  type VisualAttemptAdmission,
} from "../src/execution/visualAttemptAdmission.schema.js";

function record(
  overrides:
    Partial<VisualAttemptAdmission> =
      {},
): VisualAttemptAdmission {
  return VisualAttemptAdmissionSchema
    .parse({
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
        "a".repeat(
          64,
        ),

      promptIdentitySha256:
        "b".repeat(
          64,
        ),

      referenceIdentitySha256:
        "c".repeat(
          64,
        ),

      previousAttemptNumber:
        1,

      previousAttemptQcSha256:
        "d".repeat(
          64,
        ),

      ...overrides,
    });
}

describe(
  "visual attempt admission schema",
  () => {
    it(
      "accepts a strict replacement attempt bound to the immediately preceding attempt",
      () => {
        expect(
          record(),
        ).toMatchObject({
          schemaVersion:
            "1.0",

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

          attemptNumber:
            2,

          previousAttemptNumber:
            1,
        });
      },
    );

    it(
      "supports every existing paid visual execution provider",
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
            record({
              provider,
            }).provider,
          ).toBe(
            provider,
          );
        }
      },
    );

    it(
      "never materializes legacy attempt 1 as a replacement admission",
      () => {
        expect(
          () =>
            record({
              attemptNumber:
                1,
            }),
        ).toThrow(
          /at least 2/,
        );
      },
    );

    it(
      "requires the previous attempt to be exactly N minus 1",
      () => {
        expect(
          () =>
            record({
              attemptNumber:
                3,

              previousAttemptNumber:
                1,
            }),
        ).toThrow(
          /must be 2/,
        );

        expect(
          record({
            attemptNumber:
              3,

            previousAttemptNumber:
              2,
          }).attemptNumber,
        ).toBe(
          3,
        );
      },
    );

    it(
      "is strict and rejects malformed evidence identities",
      () => {
        expect(
          () =>
            VisualAttemptAdmissionSchema
              .parse({
                ...record(),
                extra:
                  true,
              }),
        ).toThrow();

        expect(
          () =>
            record({
              previousAttemptQcSha256:
                "not-a-sha256",
            }),
        ).toThrow();

        expect(
          () =>
            record({
              manifestRawSha256:
                "A".repeat(
                  64,
                ),
            }),
        ).toThrow();

        expect(
          () =>
            record({
              provider:
                "OTHER" as never,
            }),
        ).toThrow();
      },
    );
  },
);
