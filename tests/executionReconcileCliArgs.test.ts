import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseExecutionReconcileCliArgs,
} from "../src/execution/cli/executionReconcileCliArgs.js";

describe(
  "Busybookie execution reconciliation CLI arguments",
  () => {
    it(
      "parses only the durable execution identity required for reconciliation",
      () => {
        const options =
          parseExecutionReconcileCliArgs([
            "--episode",
            "EP91",
            "--shot",
            "S01",
          ]);

        expect(
          options,
        ).toEqual({
          episodeId:
            "EP91",

          shotId:
            "S01",
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
      "requires --episode",
      () => {
        expect(() =>
          parseExecutionReconcileCliArgs([
            "--shot",
            "S01",
          ]),
        ).toThrow(
          /--episode is required/i,
        );
      },
    );

    it(
      "requires --shot",
      () => {
        expect(() =>
          parseExecutionReconcileCliArgs([
            "--episode",
            "EP91",
          ]),
        ).toThrow(
          /--shot is required/i,
        );
      },
    );

    it(
      "requires a value after --episode",
      () => {
        expect(() =>
          parseExecutionReconcileCliArgs([
            "--episode",
            "--shot",
            "S01",
          ]),
        ).toThrow(
          /--episode requires a value/i,
        );
      },
    );

    it(
      "requires a value after --shot",
      () => {
        expect(() =>
          parseExecutionReconcileCliArgs([
            "--episode",
            "EP91",
            "--shot",
          ]),
        ).toThrow(
          /--shot requires a value/i,
        );
      },
    );

    it(
      "rejects malformed episode identity using the canonical execution schema",
      () => {
        expect(() =>
          parseExecutionReconcileCliArgs([
            "--episode",
            "../EP91",
            "--shot",
            "S01",
          ]),
        ).toThrow(
          /episodeId must use the Busybookie EP## or EP### format/i,
        );
      },
    );

    it(
      "rejects malformed shot identity using the canonical execution schema",
      () => {
        expect(() =>
          parseExecutionReconcileCliArgs([
            "--episode",
            "EP91",
            "--shot",
            "../../S01",
          ]),
        ).toThrow(
          /shotId must use the Busybookie S##, S###, or suffixed shot format/i,
        );
      },
    );

    it.each([
      [
        "--provider",
        "RUNWAY",
      ],
      [
        "--image",
        "D:/Busybookie/Production/references/EP91/S01/reference.png",
      ],
      [
        "--confirm-paid-generation",
        undefined,
      ],
    ])(
      "rejects recovery-unsafe argument %s",
      (
        argument,
        value,
      ) => {
        const args = [
          "--episode",
          "EP91",
          "--shot",
          "S01",
          argument,
        ];

        if (value) {
          args.push(
            value,
          );
        }

        expect(() =>
          parseExecutionReconcileCliArgs(
            args,
          ),
        ).toThrow(
          /Unknown execution reconciliation CLI argument/i,
        );
      },
    );
  },
);
