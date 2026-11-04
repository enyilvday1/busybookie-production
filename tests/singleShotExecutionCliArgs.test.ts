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

    // B5 Slice-2I-B: --attempt is optional transport validated by the canonical replacement-attempt schema.
    it("keeps the exact legacy shape when --attempt is absent", () => {
      const parsed = parseSingleShotExecutionCliArgs([...args, "--confirm-paid-generation"]);
      expect(Object.keys(parsed).sort()).toEqual(["confirmPaidGeneration", "episodeId", "shotId", "sourceImagePath"]);
      expect("attemptNumber" in parsed).toBe(false);
    });

    it.each([
      ["2", 2],
      ["5", 5],
      [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
    ] as const)("accepts the explicit safe replacement attempt %s", (value, expected) => {
      const parsed = parseSingleShotExecutionCliArgs([...args, "--attempt", value, "--confirm-paid-generation"]);
      expect(parsed).toEqual({ episodeId: "EP90", shotId: "S01", sourceImagePath: "references/source.png",
        confirmPaidGeneration: true, attemptNumber: expected });
      expect(Object.isFrozen(parsed)).toBe(true);
    });

    it("requires exactly one --attempt value", () => {
      expect(() => parseSingleShotExecutionCliArgs([...args, "--attempt"])).toThrow("--attempt requires a value");
      expect(() => parseSingleShotExecutionCliArgs([...args, "--attempt", "--confirm-paid-generation"])).toThrow("--attempt requires a value");
      expect(() => parseSingleShotExecutionCliArgs([...args, "--attempt", ""])).toThrow("--attempt requires a value");
      expect(() => parseSingleShotExecutionCliArgs([...args, "--attempt", "2", "--attempt", "2"])).toThrow(/Duplicate/);
      expect(() => parseSingleShotExecutionCliArgs([...args, "--attempt", "2", "--attempt", "3"])).toThrow(/Duplicate/);
    });

    it.each([
      "0", "1", "-2", "2.0", "2.5", "1e1", "0x2", "+2", "02", " 2", "2 ", "two", "NaN", "Infinity",
      String(Number.MAX_SAFE_INTEGER + 1), "99999999999999999999",
    ])("rejects the invalid attempt value %j", (value) => {
      expect(() => parseSingleShotExecutionCliArgs([...args, "--attempt", value, "--confirm-paid-generation"])).toThrow();
    });

    it.each([
      ["--attempt=2"], ["--attempt-number", "2"], ["--attemptNumber", "2"], ["--attempts", "2"], ["-a", "2"],
    ])("rejects the attempt alias %s", (...extra) => {
      expect(() => parseSingleShotExecutionCliArgs([...args, ...extra])).toThrow(/Unknown/);
    });
  }
);
