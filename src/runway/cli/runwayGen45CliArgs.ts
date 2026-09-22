export type RunwayGen45CliOptions =
  Readonly<{
    episodeId: string;
    shotId: string;
    imagePath: string;
    confirmPaidGeneration: boolean;
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

export function parseRunwayGen45CliArgs(
  args: readonly string[],
): RunwayGen45CliOptions {
  let episodeId: string | undefined;
  let shotId: string | undefined;
  let imagePath: string | undefined;

  let confirmPaidGeneration =
    false;

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

      case "--image":
        imagePath =
          requireValue(
            args,
            index,
            "--image",
          );

        index += 1;
        break;

      case "--confirm-paid-generation":
        confirmPaidGeneration =
          true;
        break;

      default:
        throw new Error(
          `Unknown Runway CLI argument: ${argument}`,
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

  if (!imagePath) {
    throw new Error(
      "--image is required.",
    );
  }

  return Object.freeze({
    episodeId,
    shotId,
    imagePath,
    confirmPaidGeneration,
  });
}
