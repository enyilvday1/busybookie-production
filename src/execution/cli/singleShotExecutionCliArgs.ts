import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../executionReservation.schema.js";

import {
  VisualReplacementAttemptNumberSchema,
} from "../visualAttemptNumber.schema.js";

export type SingleShotExecutionCliOptions =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;

    sourceImagePath:
      string;

    confirmPaidGeneration:
      boolean;

    // B5 Slice-2I-B: transport only. Present solely when --attempt was given;
    // the reviewed action in a genuine checked context is the only authority.
    attemptNumber?:
      number;
  }>;

export function parseSingleShotExecutionCliArgs(
  args:
    readonly string[],
): SingleShotExecutionCliOptions {
  const values = new Map<string, string>();

  const seen = new Set<string>();

  let confirmPaidGeneration = false;

  let attemptNumber: number | undefined;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const flag = args[index]!;

    if (
      seen.has(
        flag
      )
    ) {
      throw new Error(
        `Duplicate single-shot execution CLI argument: ${flag}`
      );
    }

    seen.add(
      flag
    );

    switch (
      flag
    ) {
      case "--confirm-paid-generation":
        confirmPaidGeneration = true;
        break;

      case "--episode":
      case "--shot":
      case "--image": {
        const value = args[index + 1]?.trim();

        if (
          !value || value.startsWith(
            "--"
          )
        ) {
          throw new Error(
            `${flag} requires a value.`
          );
        }

        values.set(
          flag,
          value
        );

        index += 1;
        break;
      }

      // One canonical decimal value, then the canonical replacement-attempt
      // schema (safe integer >= 2). No default, alias or inferred attempt.
      case "--attempt": {
        const value = args[index + 1];

        if (
          !value || value.startsWith(
            "--"
          )
        ) {
          throw new Error(
            `${flag} requires a value.`
          );
        }

        if (
          !/^[1-9][0-9]*$/.test(
            value
          )
        ) {
          throw new Error(
            `${flag} must be a canonical decimal integer.`
          );
        }

        attemptNumber = VisualReplacementAttemptNumberSchema.parse(
          Number(
            value
          )
        );

        index += 1;
        break;
      }

      default:
        throw new Error(
          `Unknown single-shot execution CLI argument: ${flag}`
        );
    }
  }

  function required(
    flag:
      string
  ): string {
    const value = values.get(
      flag
    );

    if (
      !value
    )
      throw new Error(
        `${flag} is required.`
      );

    return value;
  }

  return Object.freeze({
    episodeId: ExecutionReservationEpisodeIdSchema.parse(
      required(
        "--episode"
      )
    ),
    shotId: ExecutionReservationShotIdSchema.parse(
      required(
        "--shot"
      )
    ),
    sourceImagePath: required(
      "--image"
    ),
    confirmPaidGeneration,
    ...(
      attemptNumber === undefined
        ? {}
        : {
            attemptNumber
          }
    ),
  });
}
