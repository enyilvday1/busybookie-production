import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
} from "../dialogueReservation.schema.js";

import type {
  DialoguePlacementInputLine,
} from "../buildDialoguePlacementPlan.js";

export type DialoguePlacementCliOptions = Readonly<{
  episodeId: string;
  sceneId: string;
  shotId: string;
  placements: readonly DialoguePlacementInputLine[];
  confirmPlacement: boolean;
}>;

function parsePlacements(value: string): readonly DialoguePlacementInputLine[] {
  const seen = new Set<string>();
  const placements = value.split(",").map((entry) => {
    const parts = entry.trim().split("=");
    const dialogueLineId = parts[0]?.trim();
    const startToken = parts[1]?.trim();

    if (parts.length !== 2 || !dialogueLineId || !startToken) {
      throw new Error(
        "Each placement requires exactly dialogueLineId=startSeconds with non-empty values.",
      );
    }

    const startSeconds = Number(startToken);
    if (!Number.isFinite(startSeconds) || startSeconds < 0) {
      throw new Error(
        `Placement start for ${dialogueLineId} must be finite and non-negative.`,
      );
    }

    if (seen.has(dialogueLineId)) {
      throw new Error(`Duplicate dialogue placement line: ${dialogueLineId}`);
    }
    seen.add(dialogueLineId);

    return Object.freeze({ dialogueLineId, startSeconds });
  });

  // Preserve operator order; canonical order and timing belong to the creator.
  return Object.freeze(placements);
}

export function parseDialoguePlacementCliArgs(
  args: readonly string[],
): DialoguePlacementCliOptions {
  const values = new Map<string, string>();
  const seen = new Set<string>();
  let confirmPlacement = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]!;
    if (seen.has(flag)) {
      throw new Error(`Duplicate dialogue placement CLI argument: ${flag}`);
    }
    seen.add(flag);

    switch (flag) {
      case "--confirm-placement":
        confirmPlacement = true;
        break;

      case "--episode":
      case "--scene":
      case "--shot":
      case "--placements": {
        const value = args[index + 1]?.trim();
        if (!value || value.startsWith("--")) {
          throw new Error(`${flag} requires a value.`);
        }
        values.set(flag, value);
        index += 1;
        break;
      }

      default:
        throw new Error(`Unknown dialogue placement CLI argument: ${flag}`);
    }
  }

  function required(flag: string): string {
    const value = values.get(flag);
    if (!value) {
      throw new Error(`${flag} is required.`);
    }
    return value;
  }

  return Object.freeze({
    episodeId: DialogueReservationEpisodeIdSchema.parse(required("--episode")),
    sceneId: DialogueReservationSceneIdSchema.parse(required("--scene")),
    shotId: DialogueReservationShotIdSchema.parse(required("--shot")),
    placements: parsePlacements(required("--placements")),
    confirmPlacement,
  });
}
