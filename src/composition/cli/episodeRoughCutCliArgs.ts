import {
  ExecutionReservationEpisodeIdSchema,
} from "../../execution/executionReservation.schema.js";

export type EpisodeRoughCutCliOptions =
  Readonly<{
    episodeId: string;
    confirmLocalComposition: true;
  }>;

// Exactly: --episode <EP## or EP###> --confirm-local-composition, in either
// order, each once. Anything else (unknown or "--x=value" flags, positionals,
// duplicates, boolean values, plan/shot/line/path/tool overrides, dry-run,
// force/retry/resume, paid, reconciliation or publication flags) is
// rejected. Pure: no file, environment, tool or state access.
export function parseEpisodeRoughCutCliArgs(
  args:
    readonly string[],
): EpisodeRoughCutCliOptions {
  let episodeId:
    string | undefined;

  let confirmLocalComposition =
    false;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index];

    switch (argument) {
      case "--episode": {
        if (
          episodeId !==
          undefined
        ) {
          throw new Error(
            "Duplicate episode rough-cut CLI argument: --episode",
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
            "--episode requires an episode ID.",
          );
        }

        const parsed =
          ExecutionReservationEpisodeIdSchema.safeParse(
            value.trim(),
          );

        if (
          !parsed.success
        ) {
          throw new Error(
            "--episode requires a canonical episode ID (EP## or EP###).",
          );
        }

        episodeId =
          parsed.data;

        index += 1;
        break;
      }

      case "--confirm-local-composition":
        if (
          confirmLocalComposition
        ) {
          throw new Error(
            "Duplicate episode rough-cut CLI argument: --confirm-local-composition",
          );
        }

        confirmLocalComposition =
          true;
        break;

      default:
        if (
          argument?.startsWith(
            "--",
          ) &&
          argument.includes(
            "=",
          )
        ) {
          throw new Error(
            `Episode rough-cut CLI arguments do not accept --flag=value forms: ${argument.split("=")[0]}`,
          );
        }

        throw new Error(
          argument?.startsWith(
            "-",
          )
            ? `Unknown episode rough-cut CLI argument: ${argument}`
            : "Unexpected positional episode rough-cut CLI argument.",
        );
    }
  }

  if (
    episodeId ===
    undefined
  ) {
    throw new Error(
      "--episode is required.",
    );
  }

  if (
    !confirmLocalComposition
  ) {
    throw new Error(
      "--confirm-local-composition is required: the rough-cut operation performs local normalization and rendering.",
    );
  }

  return Object.freeze({
    episodeId,

    confirmLocalComposition:
      true,
  });
}
