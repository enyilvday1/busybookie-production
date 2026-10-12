export type EpisodeAutomationCliOptions =
  Readonly<{
    planPath: string;
    validateOnly: boolean;
  }>;

// Exactly: --plan <path> [--validate-only]. Anything else (unknown or
// "--x=value" flags, positionals, duplicates, stdin "-", global confirmations,
// retry/force/cursor/skip or per-action flags) is rejected. Pure: no file,
// environment or state access.
export function parseEpisodeAutomationCliArgs(
  args:
    readonly string[],
): EpisodeAutomationCliOptions {
  let planPath:
    string | undefined;

  let validateOnly =
    false;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index];

    switch (argument) {
      case "--plan": {
        if (
          planPath !==
          undefined
        ) {
          throw new Error(
            "Duplicate episode automation CLI argument: --plan",
          );
        }

        const value =
          args[index + 1];

        if (
          value ===
            undefined ||
          value.trim() ===
            "" ||
          value.startsWith(
            "--",
          )
        ) {
          throw new Error(
            "--plan requires a plan file path.",
          );
        }

        if (
          value.trim() ===
          "-"
        ) {
          throw new Error(
            "--plan does not accept stdin (\"-\"); supply a plan file path.",
          );
        }

        planPath =
          value;

        index += 1;
        break;
      }

      case "--validate-only":
        if (validateOnly) {
          throw new Error(
            "Duplicate episode automation CLI argument: --validate-only",
          );
        }

        validateOnly =
          true;
        break;

      default:
        throw new Error(
          argument?.startsWith(
            "-",
          )
            ? `Unknown episode automation CLI argument: ${argument.split("=")[0]}`
            : "Unexpected positional episode automation CLI argument.",
        );
    }
  }

  if (
    planPath ===
    undefined
  ) {
    throw new Error(
      "--plan is required.",
    );
  }

  return Object.freeze({
    planPath,
    validateOnly,
  });
}
