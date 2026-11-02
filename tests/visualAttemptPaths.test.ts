import {
  tmpdir,
} from "node:os";

import {
  join,
  sep,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createVisualAttemptAdmissionFileName,
  createVisualAttemptAdmissionPath,
  createVisualAttemptQcFileName,
  createVisualAttemptQcPath,
  createVisualAttemptShotDirectory,
  parseVisualAttemptLedgerFileName,
} from "../src/execution/visualAttemptPaths.js";

describe(
  "visual attempt path contract",
  () => {
    it(
      "keeps replacement-attempt admission evidence inside the canonical shot directory",
      () => {
        const root =
          join(
            tmpdir(),
            "busybookie-visual-attempt-path",
          );

        const directory =
          createVisualAttemptShotDirectory(
            root,
            "EP93",
            "S01",
          );

        expect(
          directory,
        ).toBe(
          join(
            root,
            "generated-video",
            "EP93",
            "S01",
          ),
        );

        expect(
          createVisualAttemptAdmissionFileName(
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          "EP93_S01_a2.visual-attempt-admission.json",
        );

        expect(
          createVisualAttemptAdmissionPath(
            root,
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          `${directory}${sep}EP93_S01_a2.visual-attempt-admission.json`,
        );
      },
    );

    it(
      "supports immutable QC evidence for attempt 1 and later attempts",
      () => {
        const root =
          join(
            tmpdir(),
            "busybookie-visual-attempt-qc-path",
          );

        const directory =
          createVisualAttemptShotDirectory(
            root,
            "EP93",
            "S01",
          );

        expect(
          createVisualAttemptQcFileName(
            "EP93",
            "S01",
            1,
          ),
        ).toBe(
          "EP93_S01_a1.visual-qc.json",
        );

        expect(
          createVisualAttemptQcFileName(
            "EP93",
            "S01",
            2,
          ),
        ).toBe(
          "EP93_S01_a2.visual-qc.json",
        );

        expect(
          createVisualAttemptQcPath(
            root,
            "EP93",
            "S01",
            1,
          ),
        ).toBe(
          `${directory}${sep}EP93_S01_a1.visual-qc.json`,
        );
      },
    );

    it(
      "rejects relative roots, unsafe identities, attempt 1 admission and invalid QC attempt numbers",
      () => {
        expect(
          () =>
            createVisualAttemptShotDirectory(
              "relative",
              "EP93",
              "S01",
            ),
        ).toThrow(
          /absolute/,
        );

        expect(
          () =>
            createVisualAttemptShotDirectory(
              " ",
              "EP93",
              "S01",
            ),
        ).toThrow(
          /required/,
        );

        expect(
          () =>
            createVisualAttemptAdmissionFileName(
              "EP9",
              "S01",
              2,
            ),
        ).toThrow();

        expect(
          () =>
            createVisualAttemptAdmissionFileName(
              "EP93",
              "../S01",
              2,
            ),
        ).toThrow();

        expect(
          () =>
            createVisualAttemptAdmissionFileName(
              "EP93",
              "S01",
              1,
            ),
        ).toThrow(
          /at least 2/,
        );

        expect(
          () =>
            createVisualAttemptQcFileName(
              "EP93",
              "S01",
              0,
            ),
        ).toThrow();

        expect(
          () =>
            createVisualAttemptQcFileName(
              "EP93",
              "S01",
              Number.MAX_SAFE_INTEGER + 1,
            ),
        ).toThrow(
          /safe positive integer/,
        );
      },
    );

    it(
      "parses only exact canonical visual-attempt ledger file names",
      () => {
        expect(
          parseVisualAttemptLedgerFileName(
            "EP93_S01_a2.visual-attempt-admission.json",
            "EP93",
            "S01",
          ),
        ).toEqual({
          kind:
            "ADMISSION",

          attemptNumber:
            2,
        });

        expect(
          parseVisualAttemptLedgerFileName(
            "EP93_S01_a1.visual-qc.json",
            "EP93",
            "S01",
          ),
        ).toEqual({
          kind:
            "QC",

          attemptNumber:
            1,
        });

        expect(
          parseVisualAttemptLedgerFileName(
            "EP93_S01_a2.visual-qc.json",
            "EP93",
            "S01",
          ),
        ).toEqual({
          kind:
            "QC",

          attemptNumber:
            2,
        });

        for (
          const name
          of [
            "EP93_S01_a1.visual-attempt-admission.json",
            "EP93_S01_a02.visual-attempt-admission.json",
            "EP93_S01_a0.visual-attempt-admission.json",
            "EP93_S01_a-2.visual-attempt-admission.json",
            "EP93_S02_a2.visual-attempt-admission.json",
            "EP93_S01_a2.visual-attempt-admission.json.bak",
            "EP93_S01_a99999999999999999999.visual-attempt-admission.json",
            "EP93_S01_a01.visual-qc.json",
            "EP93_S01_a0.visual-qc.json",
            "EP93_S01_a-1.visual-qc.json",
            "EP93_S02_a1.visual-qc.json",
            "EP93_S01_a1.visual-qc.json.bak",
            "EP93_S01_a99999999999999999999.visual-qc.json",
          ]
        ) {
          expect(
            parseVisualAttemptLedgerFileName(
              name,
              "EP93",
              "S01",
            ),
          ).toBeNull();
        }
      },
    );
  },
);
