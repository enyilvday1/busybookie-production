import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseSingleShotExecutionCliArgs,
} from "../src/execution/cli/singleShotExecutionCliArgs.js";

const args = [
  "--episode",
  "EP90",
  "--shot",
  "S01",
  "--image",
  "references/source.png"
];

describe(
  "secured single-shot CLI arguments",
  () => {
    it(
      "uses explicit affirmative confirmation and preserves the supplied path",
      () => {
        expect(
          parseSingleShotExecutionCliArgs(
            args
          )
        ).toEqual({
          episodeId: "EP90",
          shotId: "S01",
          sourceImagePath: "references/source.png",
          confirmPaidGeneration: false,
        });

        const confirmed = parseSingleShotExecutionCliArgs([
          ...args,
          "--confirm-paid-generation"
        ]);

        expect(
          confirmed.confirmPaidGeneration
        ).toBe(
          true
        );

        expect(
          Object.isFrozen(
            confirmed
          )
        ).toBe(
          true
        );
      }
    );

    it.each([
      "--episode",
      "--shot",
      "--image"
    ])(
      "requires %s and its value",
      (
        flag
      ) => {
        const index = args.indexOf(
          flag
        );

        expect(
          () => parseSingleShotExecutionCliArgs(
            args.filter(
              (
                _,
                i
              ) => i !== index && i !== index + 1
            )
          )
        ).toThrow(
          `${flag} is required`
        );

        expect(
          () => parseSingleShotExecutionCliArgs([
            flag
          ])
        ).toThrow(
          `${flag} requires a value`
        );

        expect(
          () => parseSingleShotExecutionCliArgs([
            flag,
            "--confirm-paid-generation"
          ])
        ).toThrow(
          `${flag} requires a value`
        );
      }
    );

    it.each([
      "--episode",
      "--shot"
    ])(
      "validates %s with the durable identity schema",
      (
        flag
      ) => {
        const invalid = [
          ...args
        ];
        invalid[invalid.indexOf(
          flag
        ) + 1] = "../escape";

        expect(
          () => parseSingleShotExecutionCliArgs(
            invalid
          )
        ).toThrow();
      }
    );

    it.each([
      [
        "--registry",
        "custom.json"
      ],
      [
        "--provider",
        "VEO"
      ],
      [
        "--confirm-paid-generation=false"
      ],
      [
        "--confirm-paid-generation",
        "false"
      ],
      [
        "--approved-asset-id",
        "custom"
      ],
      [
        "--media-root",
        "custom"
      ],
    ])(
      "rejects unsupported or ambiguous arguments %s",
      (
        ...extra
      ) => {
        expect(
          () => parseSingleShotExecutionCliArgs([
            ...args,
            ...extra
          ])
        ).toThrow(
          /Unknown/
        );
      }
    );

    it(
      "rejects repeated identity or confirmation flags",
      () => {
        expect(
          () => parseSingleShotExecutionCliArgs([
            ...args,
            "--shot",
            "S02"
          ])
        ).toThrow(
          /Duplicate/
        );

        expect(
          () => parseSingleShotExecutionCliArgs([
            ...args,
            "--confirm-paid-generation",
            "--confirm-paid-generation"
          ])
        ).toThrow(
          /Duplicate/
        );
      }
    );
  }
);
