import {
  DialogueVisualAuthorizationProviderSchema,
  type DialogueVisualAuthorizationInput,
} from "../../execution/dialogueVisualAuthorization.schema.js";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../../execution/executionReservation.schema.js";

export type DialogueVisualAuthorizationCliOptions =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;

    provider:
      DialogueVisualAuthorizationInput["provider"];

    confirmAuthorization:
      boolean;
  }>;

export function parseDialogueVisualAuthorizationCliArgs(
  args:
    readonly string[],
): DialogueVisualAuthorizationCliOptions {
  const values =
    new Map<
      string,
      string
    >();

  const seen =
    new Set<string>();

  let confirmAuthorization =
    false;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const flag =
      args[index]!;

    if (
      seen.has(
        flag,
      )
    ) {
      throw new Error(
        `Duplicate dialogue visual authorization CLI argument: ${flag}`,
      );
    }

    seen.add(
      flag,
    );

    switch (
      flag
    ) {
      case "--confirm-authorization":
        confirmAuthorization =
          true;

        break;

      case "--episode":
      case "--shot":
      case "--provider": {
        const value =
          args[
            index + 1
          ]?.trim();

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

        values.set(
          flag,
          value,
        );

        index += 1;

        break;
      }

      default:
        throw new Error(
          `Unknown dialogue visual authorization CLI argument: ${flag}`,
        );
    }
  }

  function required(
    flag:
      string,
  ): string {
    const value =
      values.get(
        flag,
      );

    if (!value) {
      throw new Error(
        `${flag} is required.`,
      );
    }

    return value;
  }

  return Object.freeze({
    episodeId:
      ExecutionReservationEpisodeIdSchema
        .parse(
          required(
            "--episode",
          ),
        ),

    shotId:
      ExecutionReservationShotIdSchema
        .parse(
          required(
            "--shot",
          ),
        ),

    provider:
      DialogueVisualAuthorizationProviderSchema
        .parse(
          required(
            "--provider",
          ),
        ),

    confirmAuthorization,
  });
}
