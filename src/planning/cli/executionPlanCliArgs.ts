export type ExecutionPlanCliOptions =
  Readonly<{
    episodeId: string;
  }>;

function requireValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value =
    args[index + 1]?.trim();

  if (
    !value ||
    value.startsWith("--")
  ) {
    throw new Error(
      `${flag} requires a value.`,
    );
  }

  return value;
}

export function parseExecutionPlanCliArgs(
  args: readonly string[],
): ExecutionPlanCliOptions {
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
          `Unknown execution plan CLI argument: ${argument}`,
        );
    }
  }

  if (!episodeId) {
    throw new Error(
      "--episode is required.",
    );
  }

  return Object.freeze({
    episodeId,
  });
}
