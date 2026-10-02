import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseDialogueReconcileCliArgs,
} from "../src/dialogue/cli/dialogueReconcileCliArgs.js";

describe(
  "Busybookie dialogue reconciliation CLI arguments",
  () => {
    it(
      "parses only the durable dialogue identity required for reconciliation",
      () => {
        const options =
          parseDialogueReconcileCliArgs([
            "--episode",
            "EP02",

            "--scene",
            "SC01",

            "--shot",
            "S02",

            "--line",
            "EP02_SC01_S02_L01",
          ]);

        expect(
          options,
        ).toEqual({
          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialogueLineId:
            "EP02_SC01_S02_L01",
        });

        expect(
          Object.isFrozen(
            options,
          ),
        ).toBe(
          true,
        );
      },
    );

    it.each([
      [
        "--episode",
        [
          "--scene",
          "SC01",
          "--shot",
          "S02",
          "--line",
          "EP02_SC01_S02_L01",
        ],
      ],
      [
        "--scene",
        [
          "--episode",
          "EP02",
          "--shot",
          "S02",
          "--line",
          "EP02_SC01_S02_L01",
        ],
      ],
      [
        "--shot",
        [
          "--episode",
          "EP02",
          "--scene",
          "SC01",
          "--line",
          "EP02_SC01_S02_L01",
        ],
      ],
      [
        "--line",
        [
          "--episode",
          "EP02",
          "--scene",
          "SC01",
          "--shot",
          "S02",
        ],
      ],
    ])(
      "requires %s",
      (
        flag,
        args,
      ) => {
        expect(() =>
          parseDialogueReconcileCliArgs(
            args,
          ),
        ).toThrow(
          new RegExp(
            `${flag} is required`,
            "i",
          ),
        );
      },
    );

    it.each([
      "--episode",
      "--scene",
      "--shot",
      "--line",
    ])(
      "requires a value after %s",
      (
        flag,
      ) => {
        const args = [
          "--episode",
          "EP02",
          "--scene",
          "SC01",
          "--shot",
          "S02",
          "--line",
          "EP02_SC01_S02_L01",
        ];

        const index =
          args.indexOf(
            flag,
          );

        args.splice(
          index + 1,
          1,
        );

        expect(() =>
          parseDialogueReconcileCliArgs(
            args,
          ),
        ).toThrow(
          new RegExp(
            `${flag} requires a value`,
            "i",
          ),
        );
      },
    );

    it.each([
      [
        "--episode",
        "../EP02",
      ],
      [
        "--scene",
        "../SC01",
      ],
      [
        "--shot",
        "../../S02",
      ],
      [
        "--line",
        "../EP02_SC01_S02_L01",
      ],
    ])(
      "rejects malformed canonical identity supplied through %s",
      (
        flag,
        invalidValue,
      ) => {
        const args = [
          "--episode",
          "EP02",
          "--scene",
          "SC01",
          "--shot",
          "S02",
          "--line",
          "EP02_SC01_S02_L01",
        ];

        const index =
          args.indexOf(
            flag,
          );

        args[index + 1] =
          invalidValue;

        expect(() =>
          parseDialogueReconcileCliArgs(
            args,
          ),
        ).toThrow();
      },
    );

    it(
      "rejects a line identity that does not match the selected episode scene and shot",
      () => {
        expect(() =>
          parseDialogueReconcileCliArgs([
            "--episode",
            "EP02",

            "--scene",
            "SC01",

            "--shot",
            "S02",

            "--line",
            "EP02_SC01_S03_L01",
          ]),
        ).toThrow(
          /line identity.*episode.*scene.*shot|identity.*does not match/i,
        );
      },
    );

    it.each([
      [
        "--confirm-paid-generation",
        undefined,
      ],
      [
        "--provider",
        "RUNWAY",
      ],
      [
        "--prompt",
        "Resubmit this line.",
      ],
      [
        "--voice",
        "Chad",
      ],
    ])(
      "rejects recovery-unsafe argument %s",
      (
        argument,
        value,
      ) => {
        const args = [
          "--episode",
          "EP02",

          "--scene",
          "SC01",

          "--shot",
          "S02",

          "--line",
          "EP02_SC01_S02_L01",

          argument,
        ];

        if (value) {
          args.push(
            value,
          );
        }

        expect(() =>
          parseDialogueReconcileCliArgs(
            args,
          ),
        ).toThrow(
          /Unknown dialogue reconciliation CLI argument/i,
        );
      },
    );
  },
);
