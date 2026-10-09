import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DialoguePlacementDecisionSchema,
} from "../src/dialogue/dialoguePlacementDecision.schema.js";

function validRecord() {
  return {
    schemaVersion:
      "1.0" as const,

    revision:
      1,

    recordedAt:
      "2026-10-09T20:00:00.000Z",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialoguePlanKey:
      "a".repeat(
        64,
      ),

    placements: [
      {
        dialogueLineId:
          "EP02_SC01_S02_L01",

        sourceSha256:
          "b".repeat(
            64,
          ),

        startSeconds:
          0.5,
      },

      {
        dialogueLineId:
          "EP02_SC01_S02_L02",

        sourceSha256:
          "c".repeat(
            64,
          ),

        startSeconds:
          2.5,
      },
    ],
  };
}

describe(
  "Busybookie dialogue placement decision schema",
  () => {
    it(
      "accepts the minimal durable editorial decision with identity and freshness bindings",
      () => {
        expect(
          DialoguePlacementDecisionSchema
            .parse(
              validRecord(),
            ),
        ).toEqual(
          validRecord(),
        );
      },
    );

    it.each([
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ])(
      "rejects invalid revision %s",
      (
        revision,
      ) => {
        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse({
                ...validRecord(),
                revision,
              }),
        ).toThrow();
      },
    );

    it(
      "rejects malformed plan hash",
      () => {
        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse({
                ...validRecord(),

                dialoguePlanKey:
                  "ABC",
              }),
        ).toThrow(
          /dialoguePlanKey|hexadecimal|sha256/i,
        );
      },
    );

    it(
      "rejects malformed source audio hash",
      () => {
        const record =
          validRecord();

        record.placements[0]!.sourceSha256 =
          "ABC";

        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse(
                record,
              ),
        ).toThrow(
          /sourceSha256|hexadecimal|sha256/i,
        );
      },
    );

    it(
      "rejects duplicate dialogue line identities",
      () => {
        const record =
          validRecord();

        record.placements[1]!.dialogueLineId =
          record
            .placements[0]!
            .dialogueLineId;

        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse(
                record,
              ),
        ).toThrow(
          /duplicate.*line/i,
        );
      },
    );

    it(
      "rejects dialogue line identity outside the record shot",
      () => {
        const record =
          validRecord();

        record.placements[0]!.dialogueLineId =
          "EP02_SC01_S03_L01";

        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse(
                record,
              ),
        ).toThrow(
          /identity.*does not match/i,
        );
      },
    );

    it.each([
      -0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects invalid startSeconds %s",
      (
        startSeconds,
      ) => {
        const record =
          validRecord();

        record.placements[0]!.startSeconds =
          startSeconds;

        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse(
                record,
              ),
        ).toThrow();
      },
    );

    it(
      "rejects unknown persisted fields",
      () => {
        expect(
          () =>
            DialoguePlacementDecisionSchema
              .parse({
                ...validRecord(),

                sourceAudioPath:
                  "D:/not-authoritative.audio",
              }),
        ).toThrow();
      },
    );
  },
);
