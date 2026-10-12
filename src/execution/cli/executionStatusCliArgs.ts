import {
  ExecutionReservationEpisodeIdSchema,
} from "../executionReservation.schema.js";

export type ExecutionStatusCliOptions =
  Readonly<{
    episodeId:
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

export function parseExecutionStatusCliArgs(
  args:
    readonly string[],
): ExecutionStatusCliOptions {
  let episodeId:
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
        if (
          episodeId !==
          undefined
        ) {
          throw new Error(
            "Duplicate execution status CLI argument: --episode",
          );
        }

        episodeId =
          requireValue(
            args,
            index,
            "--episode",
          );

        index += 1;
        break;

      default:
        throw new Error(
          `Unknown execution status CLI argument: ${argument}`,
        );
    }
  }

  if (!episodeId) {
    throw new Error(
      "--episode is required.",
    );
  }

  // Validated here so no manifest path is ever built from an unchecked id.
  const validatedEpisodeId =
    ExecutionReservationEpisodeIdSchema
      .parse(
        episodeId,
      );

  return Object.freeze({
    episodeId:
      validatedEpisodeId,
  });
}
