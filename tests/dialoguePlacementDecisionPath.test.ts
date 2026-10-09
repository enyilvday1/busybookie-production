import {
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialoguePlacementDecisionDirectory,
  createDialoguePlacementDecisionFileName,
  createDialoguePlacementDecisionPath,
  parseDialoguePlacementDecisionRevisionFileName,
} from "../src/dialogue/dialoguePlacementDecisionPath.js";

const MEDIA_ROOT =
  resolve(
    "D:/Busybookie/Production",
  );

describe(
  "Busybookie dialogue placement decision paths",
  () => {
    it(
      "creates the canonical shot and scene scoped placement directory",
      () => {
        expect(
          createDialoguePlacementDecisionDirectory(
            MEDIA_ROOT,
            "EP02",
            "SC01",
            "S02",
          ),
        ).toBe(
          resolve(
            MEDIA_ROOT,
            "voices",
            "EP02",
            "S02",
            "dialogue-placement",
            "SC01",
          ),
        );
      },
    );

    it(
      "creates deterministic append-only revision filenames",
      () => {
        expect(
          createDialoguePlacementDecisionFileName(
            "EP02",
            "SC01",
            "S02",
            12,
          ),
        ).toBe(
          "EP02_SC01_S02_r12.dialogue-placement.json",
        );

        expect(
          createDialoguePlacementDecisionPath(
            MEDIA_ROOT,
            "EP02",
            "SC01",
            "S02",
            12,
          ),
        ).toBe(
          resolve(
            MEDIA_ROOT,
            "voices",
            "EP02",
            "S02",
            "dialogue-placement",
            "SC01",
            "EP02_SC01_S02_r12.dialogue-placement.json",
          ),
        );
      },
    );

    it(
      "parses only the exact canonical revision filename",
      () => {
        expect(
          parseDialoguePlacementDecisionRevisionFileName(
            "EP02_SC01_S02_r17.dialogue-placement.json",
            "EP02",
            "SC01",
            "S02",
          ),
        ).toBe(
          17,
        );

        expect(
          parseDialoguePlacementDecisionRevisionFileName(
            "EP02_SC01_S02_r017.dialogue-placement.json",
            "EP02",
            "SC01",
            "S02",
          ),
        ).toBeNull();

        expect(
          parseDialoguePlacementDecisionRevisionFileName(
            "EP02_SC01_S03_r17.dialogue-placement.json",
            "EP02",
            "SC01",
            "S02",
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects relative media roots",
      () => {
        expect(
          () =>
            createDialoguePlacementDecisionDirectory(
              "relative/media",
              "EP02",
              "SC01",
              "S02",
            ),
        ).toThrow(
          /absolute/i,
        );
      },
    );

    it.each([
      0,
      -1,
      1.25,
      Number.MAX_SAFE_INTEGER + 1,
    ])(
      "rejects invalid revision %s",
      (
        revision,
      ) => {
        expect(
          () =>
            createDialoguePlacementDecisionFileName(
              "EP02",
              "SC01",
              "S02",
              revision,
            ),
        ).toThrow();
      },
    );
  },
);
