import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseDialogueGenerationCliArgs,
} from "../src/dialogue/cli/dialogueGenerationCliArgs.js";

describe(
  "Busybookie dialogue generation CLI arguments",
  () => {
    it(
      "parses the complete canonical dialogue identity as a dry run by default",
      () => {
        const options =
          parseDialogueGenerationCliArgs([
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

          confirmPaidGeneration:
            false,
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

    it(
      "recognizes explicit paid-generation confirmation",
      () => {
        const options =
          parseDialogueGenerationCliArgs([
            "--episode",
            "EP02",

            "--scene",
            "SC01",

            "--shot",
            "S02",

            "--line",
            "EP02_SC01_S02_L01",

            "--confirm-paid-generation",
          ]);

        expect(
          options.confirmPaidGeneration,
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
          parseDialogueGenerationCliArgs(
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
          parseDialogueGenerationCliArgs(
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

    it(
      "rejects unknown CLI arguments",
      () => {
        expect(() =>
          parseDialogueGenerationCliArgs([
            "--episode",
            "EP02",

            "--scene",
            "SC01",

            "--shot",
            "S02",

            "--line",
            "EP02_SC01_S02_L01",

            "--unsafe-bypass",
          ]),
        ).toThrow(
          /Unknown dialogue generation CLI argument/i,
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
          parseDialogueGenerationCliArgs(
            args,
          ),
        ).toThrow();
      },
    );

    it(
      "rejects a dialogue line identity that does not match the selected episode scene and shot",
      () => {
        expect(() =>
          parseDialogueGenerationCliArgs([
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

    it(
      "does not accept provider or prompt override arguments",
      () => {
        expect(() =>
          parseDialogueGenerationCliArgs([
            "--episode",
            "EP02",

            "--scene",
            "SC01",

            "--shot",
            "S02",

            "--line",
            "EP02_SC01_S02_L01",

            "--provider",
            "RUNWAY",
          ]),
        ).toThrow(
          /Unknown dialogue generation CLI argument/i,
        );

        expect(() =>
          parseDialogueGenerationCliArgs([
            "--episode",
            "EP02",

            "--scene",
            "SC01",

            "--shot",
            "S02",

            "--line",
            "EP02_SC01_S02_L01",

            "--prompt",
            "Override the canonical dialogue text.",
          ]),
        ).toThrow(
          /Unknown dialogue generation CLI argument/i,
        );
      },
    );
  },
);
