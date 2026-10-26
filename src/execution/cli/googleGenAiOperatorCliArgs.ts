import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../executionReservation.schema.js";

/**
 * Argument grammar of the operator-only Google runner:
 *
 *   execute   --episode EP## --shot S## --image <path> --resolution <r>
 *             [--confirm-paid-generation]
 *   reconcile --episode EP## --shot S##
 *
 * Exactly one canonical shot per invocation. No defaults select a shot,
 * and there is no batch, provider, prompt, policy-path or force option.
 * Parsing is pure: no filesystem, environment or provider access.
 */

export type GoogleGenAiOperatorCliOptions =
  | Readonly<{
      subcommand:
        "execute";
      episodeId:
        string;
      shotId:
        string;
      sourceImagePath:
        string;
      resolution:
        string;
      confirmPaidGeneration:
        boolean;
    }>
  | Readonly<{
      subcommand:
        "reconcile";
      episodeId:
        string;
      shotId:
        string;
    }>;

const VALUE_FLAGS =
  Object.freeze({
    execute:
      Object.freeze([
        "--episode",
        "--shot",
        "--image",
        "--resolution",
      ]),
    reconcile:
      Object.freeze([
        "--episode",
        "--shot",
      ]),
  });

const CONFIRM_FLAG =
  "--confirm-paid-generation";

export function parseGoogleGenAiOperatorCliArgs(
  args:
    readonly string[],
): GoogleGenAiOperatorCliOptions {
  const subcommand =
    args[0];

  if (
    subcommand !==
      "execute" &&
    subcommand !==
      "reconcile"
  ) {
    throw new Error(
      "The first argument must be execute or reconcile.",
    );
  }

  const valueFlags: readonly string[] =
    VALUE_FLAGS[subcommand];

  const values =
    new Map<string, string>();

  let confirmPaidGeneration =
    false;

  for (
    let index = 1;
    index < args.length;
    index += 1
  ) {
    const flag =
      args[index]!;

    if (
      values.has(
        flag,
      ) ||
      (flag ===
        CONFIRM_FLAG &&
        confirmPaidGeneration)
    ) {
      throw new Error(
        "Duplicate Google GenAI operator argument.",
      );
    }

    if (
      subcommand ===
        "execute" &&
      flag ===
        CONFIRM_FLAG
    ) {
      confirmPaidGeneration =
        true;
      continue;
    }

    if (
      !valueFlags.includes(
        flag,
      )
    ) {
      throw new Error(
        "Unknown Google GenAI operator argument.",
      );
    }

    const value =
      args[index + 1]?.trim();

    if (
      !value ||
      value.startsWith(
        "--",
      )
    ) {
      throw new Error(
        "A Google GenAI operator flag is missing its value.",
      );
    }

    values.set(
      flag,
      value,
    );

    index += 1;
  }

  for (
    const flag of valueFlags
  ) {
    if (
      !values.has(
        flag,
      )
    ) {
      throw new Error(
        "A required Google GenAI operator argument is missing.",
      );
    }
  }

  const episodeId =
    ExecutionReservationEpisodeIdSchema.safeParse(
      values.get(
        "--episode",
      ),
    );

  const shotId =
    ExecutionReservationShotIdSchema.safeParse(
      values.get(
        "--shot",
      ),
    );

  if (
    !episodeId.success ||
    !shotId.success
  ) {
    throw new Error(
      "The episode or shot identity is not canonical.",
    );
  }

  if (
    subcommand ===
    "reconcile"
  ) {
    return Object.freeze({
      subcommand,
      episodeId:
        episodeId.data,
      shotId:
        shotId.data,
    });
  }

  return Object.freeze({
    subcommand,
    episodeId:
      episodeId.data,
    shotId:
      shotId.data,
    sourceImagePath:
      values.get(
        "--image",
      )!,
    resolution:
      values.get(
        "--resolution",
      )!,
    confirmPaidGeneration,
  });
}
