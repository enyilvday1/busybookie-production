import {
  z,
} from "zod";

import {
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "../dialogue/dialogueReservation.schema.js";

import type {
  EpisodeCoordinatorAction,
} from "./coordinateEpisodeAction.js";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

// C7 operator plan: a strict, explicit list of C6b actions. It authorizes
// WHAT may be attempted; C6b still decides, per action and from fresh C4
// state, WHETHER it is admitted.

export const MAX_EPISODE_AUTOMATION_PLAN_BYTES =
  1048576;

export const MAX_EPISODE_AUTOMATION_ACTIONS =
  1000;

export type EpisodeAutomationPlan =
  Readonly<{
    schemaVersion: "1.0";
    episodeId: string;
    actions: readonly EpisodeCoordinatorAction[];
  }>;

// Canonical id schemas are reused exactly as C6b validates each kind.
const VisualGenerateActionSchema =
  z.object({
    kind:
      z.literal(
        "VISUAL_GENERATE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      ExecutionReservationShotIdSchema,
    confirmPaidGeneration:
      z.literal(
        true,
      ),
  })
    .strict();

const VisualReconcileActionSchema =
  z.object({
    kind:
      z.literal(
        "VISUAL_RECONCILE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      ExecutionReservationShotIdSchema,
    confirmReconciliation:
      z.literal(
        true,
      ),
  })
    .strict();

const DialogueGenerateActionSchema =
  z.object({
    kind:
      z.literal(
        "DIALOGUE_GENERATE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      DialogueReservationShotIdSchema,
    dialogueLineId:
      DialogueReservationLineIdSchema,
    confirmPaidGeneration:
      z.literal(
        true,
      ),
  })
    .strict();

const DialogueReconcileActionSchema =
  z.object({
    kind:
      z.literal(
        "DIALOGUE_RECONCILE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      DialogueReservationShotIdSchema,
    dialogueLineId:
      DialogueReservationLineIdSchema,
    confirmReconciliation:
      z.literal(
        true,
      ),
  })
    .strict();

const EpisodeAutomationPlanSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),
    episodeId:
      ExecutionReservationEpisodeIdSchema,
    actions:
      z.array(
        z.discriminatedUnion(
          "kind",
          [
            VisualGenerateActionSchema,
            VisualReconcileActionSchema,
            DialogueGenerateActionSchema,
            DialogueReconcileActionSchema,
          ],
        ),
      )
        .min(
          1,
        )
        .max(
          MAX_EPISODE_AUTOMATION_ACTIONS,
        ),
  })
    .strict();

// Rule names only; never input values or unknown field names.
const ISSUE_RULES:
  Readonly<Record<string, string>> =
    Object.freeze({
      invalid_type:
        "has the wrong type or is missing",
      invalid_value:
        "is not an allowed value",
      invalid_format:
        "has an invalid format",
      invalid_union:
        "is not one of the four supported action shapes",
      unrecognized_keys:
        "contains unsupported fields",
      too_small:
        "is empty or too small",
      too_big:
        "exceeds the allowed size",
    });

function describePath(
  path:
    readonly PropertyKey[],
): string {
  if (
    path.length ===
    0
  ) {
    return "plan";
  }

  return path
    .map(
      (segment) =>
        typeof segment ===
          "number"
          ? `[${segment}]`
          : `.${String(segment)}`,
    )
    .join(
      "",
    )
    .replace(
      /^\./,
      "",
    );
}

function planError(
  detail:
    string,
): Error {
  return new Error(
    `Episode automation plan is invalid: ${detail}`,
  );
}

function schemaError(
  error:
    z.ZodError,
): Error {
  const details =
    error.issues
      .slice(
        0,
        5,
      )
      .map(
        (issue) =>
          `${describePath(issue.path)} ${ISSUE_RULES[issue.code] ?? "is invalid"}`,
      );

  const more =
    error.issues.length >
    details.length
      ? ` (+${error.issues.length - details.length} more)`
      : "";

  return planError(
    `${details.join("; ")}${more}.`,
  );
}

function axisOf(
  action:
    EpisodeCoordinatorAction,
): "VISUAL" | "DIALOGUE" {
  return action.kind ===
      "VISUAL_GENERATE" ||
    action.kind ===
      "VISUAL_RECONCILE"
    ? "VISUAL"
    : "DIALOGUE";
}

// The target an action addresses on its axis (a dialogue line for dialogue).
function targetKey(
  action:
    EpisodeCoordinatorAction,
): string {
  return JSON.stringify(
    action.kind ===
      "DIALOGUE_GENERATE" ||
    action.kind ===
      "DIALOGUE_RECONCILE"
      ? [
          "DIALOGUE",
          action.sceneId,
          action.shotId,
          action.dialogueLineId,
        ]
      : [
          "VISUAL",
          action.sceneId,
          action.shotId,
        ],
  );
}

function copyAction(
  action:
    EpisodeCoordinatorAction,
): EpisodeCoordinatorAction {
  switch (
    action.kind
  ) {
    case "VISUAL_GENERATE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        confirmPaidGeneration:
          true,
      });

    case "VISUAL_RECONCILE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        confirmReconciliation:
          true,
      });

    case "DIALOGUE_GENERATE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        dialogueLineId:
          action.dialogueLineId,
        confirmPaidGeneration:
          true,
      });

    case "DIALOGUE_RECONCILE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        dialogueLineId:
          action.dialogueLineId,
        confirmReconciliation:
          true,
      });
  }
}

// Pure, complete structural validation. Runtime admissibility is NOT checked
// here: that is C6b's responsibility for each action when it is reached.
export function parseEpisodeAutomationPlan(
  input:
    unknown,
): EpisodeAutomationPlan {
  const parsed =
    EpisodeAutomationPlanSchema
      .safeParse(
        input,
      );

  if (!parsed.success) {
    throw schemaError(
      parsed.error,
    );
  }

  const {
    episodeId,
  } = parsed.data;

  const actions:
    EpisodeCoordinatorAction[] =
      parsed.data.actions.map(
        copyAction,
      );

  const sceneByShot =
    new Map<string, string>();

  const seenActions =
    new Set<string>();

  const reconciledTargets =
    new Set<string>();

  actions.forEach(
    (
      action,
      index,
    ) => {
      const position =
        `actions[${index}]`;

      if (
        (
          action.kind ===
            "DIALOGUE_GENERATE" ||
          action.kind ===
            "DIALOGUE_RECONCILE"
        ) &&
        !dialogueReservationIdentityMatches(
          episodeId,
          action.sceneId,
          action.shotId,
          action.dialogueLineId,
        )
      ) {
        throw planError(
          `${position}.dialogueLineId does not belong to the plan episode and the action's scene and shot.`,
        );
      }

      const knownScene =
        sceneByShot.get(
          action.shotId,
        );

      if (
        knownScene !==
          undefined &&
        knownScene !==
          action.sceneId
      ) {
        throw planError(
          `${position} assigns shot ${action.shotId} to a different scene than an earlier action.`,
        );
      }

      sceneByShot.set(
        action.shotId,
        action.sceneId,
      );

      const target =
        targetKey(
          action,
        );

      const identity =
        `${action.kind}:${target}`;

      if (
        seenActions.has(
          identity,
        )
      ) {
        throw planError(
          `${position} duplicates an earlier ${action.kind} action for the same target.`,
        );
      }

      seenActions.add(
        identity,
      );

      if (
        action.kind ===
          "VISUAL_RECONCILE" ||
        action.kind ===
          "DIALOGUE_RECONCILE"
      ) {
        reconciledTargets.add(
          target,
        );
      } else if (
        reconciledTargets.has(
          target,
        )
      ) {
        throw planError(
          `${position} requests ${axisOf(action)} generation after a reconciliation of the same target; generation must precede reconciliation.`,
        );
      }
    },
  );

  return Object.freeze({
    schemaVersion:
      "1.0",
    episodeId,
    actions:
      Object.freeze(
        actions,
      ),
  });
}
