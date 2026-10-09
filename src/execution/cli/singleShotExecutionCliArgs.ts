import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../executionReservation.schema.js";

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
  }>;

export function parseSingleShotExecutionCliArgs(
  args:
    readonly string[],
): SingleShotExecutionCliOptions {
  const values = new Map<string, string>();

  const seen = new Set<string>();

  let confirmPaidGeneration = false;

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
  });
}
