import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../executionReservation.schema.js";

export type ExecutionReconcileCliOptions =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;
  }>;

function requireValue(
  args:
    readonly string[],

  index:
    number,

  flag:
    string,
): string {
  const value =
    args[index + 1]
      ?.trim();

  if (
    !value ||
    value.startsWith(
      "--",
    )
  ) {
    throw new Error(
      `${flag} requires a value.`,
    );
  }

  return value;
}

export function parseExecutionReconcileCliArgs(
  args:
    readonly string[],
): ExecutionReconcileCliOptions {
  let episodeId:
    string | undefined;

  let shotId:
    string | undefined;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index];

    switch (argument) {
      case "--episode":
        episodeId =
          requireValue(
            args,
            index,
            "--episode",
          );

        index += 1;
        break;

      case "--shot":
        shotId =
          requireValue(
            args,
            index,
            "--shot",
          );

        index += 1;
        break;

      default:
        throw new Error(
          `Unknown execution reconciliation CLI argument: ${argument}`,
        );
    }
  }

  if (!episodeId) {
    throw new Error(
      "--episode is required.",
    );
  }

  if (!shotId) {
    throw new Error(
      "--shot is required.",
    );
  }

  const validatedEpisodeId =
    ExecutionReservationEpisodeIdSchema
      .parse(
        episodeId,
      );

  const validatedShotId =
    ExecutionReservationShotIdSchema
      .parse(
        shotId,
      );

  return Object.freeze({
    episodeId:
      validatedEpisodeId,

    shotId:
      validatedShotId,
  });
}
