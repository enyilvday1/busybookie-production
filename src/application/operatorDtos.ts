import type {
  CanonicalEpisodeListing,
} from "./listCanonicalEpisodes.js";

import type {
  EpisodeProductionStatus,
} from "./readEpisodeProductionStatus.js";

import type {
  DurableShotDialogueCompositionState,
} from "../dialogue/resolveDurableShotDialogueCompositionState.js";

import type {
  DurableShotVisualGenerationState,
} from "../execution/resolveDurableShotVisualGenerationState.js";

import type {
  ShotExecutionReadiness,
} from "../planning/executionReadiness.types.js";

// Browser DTOs for the D1 read-only operator API (Step 981 section 7).
// Every field is constructed explicitly from an allowlist; domain objects are
// never spread or serialized. No path, media root, executable, environment
// value, secret, token, durable record, plan key, admission ID or Error is
// ever included.
//
// Identity scope: every episodeId in these DTOs identifies an episode within
// the current BusyBookie engine/production instance (its canonical episodes
// root). It is not a globally unique or multi-tenant identifier.

export const OPERATOR_API_VERSION =
  "v1" as const;

const MAX_TEXT_CODE_POINTS =
  300;

type VisualState =
  DurableShotVisualGenerationState["state"];

type DialogueState =
  DurableShotDialogueCompositionState["state"];

// Record<State, true> forces every backend state to be listed here, so the
// summary allowlist cannot silently miss or invent a state.
const VISUAL_STATES:
  Readonly<Record<VisualState, true>> =
    Object.freeze({
      RESERVED_ONLY_INTERVENTION_REQUIRED: true,
      SUBMITTED_RECONCILIATION_REQUIRED: true,
      LIFECYCLE_COMPLETED: true,
      CANONICAL_NOT_EXECUTABLE: true,
      VISUAL_AUTHORIZATION_REQUIRED: true,
      REFERENCE_UNAVAILABLE: true,
      REFERENCE_SELECTION_REQUIRED: true,
      READY_FOR_GENERATION: true,
    });

const DIALOGUE_STATES:
  Readonly<Record<DialogueState, true>> =
    Object.freeze({
      NO_DIALOGUE: true,
      DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED: true,
      DIALOGUE_PLANNING_BLOCKED: true,
      DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED: true,
      DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED: true,
      DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED: true,
      DIALOGUE_RECONCILIATION_REQUIRED: true,
      DIALOGUE_AUDIO_REQUIRED: true,
      PLACEMENT_REQUIRED: true,
      COMPOSITION_AUDIO_RESOLVED: true,
    });

export type HealthDto =
  Readonly<{
    apiVersion: typeof OPERATOR_API_VERSION;
    status: "ok";
    readOnly: true;
  }>;

export type EpisodeListItemDto =
  | Readonly<{
      /** Identifies the episode within this engine/production instance only. */
      episodeId: string;
      manifest: "VALID";
      title: string;
      sceneCount: number;
      shotCount: number;
    }>
  | Readonly<{
      /** Identifies the episode within this engine/production instance only. */
      episodeId: string;
      manifest: "INVALID";
    }>;

export type EpisodeListDto =
  Readonly<{
    apiVersion: typeof OPERATOR_API_VERSION;
    episodes: readonly EpisodeListItemDto[];
  }>;

export type ReadinessDto =
  Readonly<{
    disposition: ShotExecutionReadiness["disposition"];
    executionProvider: ShotExecutionReadiness["executionProvider"];
    blockers: readonly string[];
  }>;

export type VisualDto =
  | Readonly<{
      state:
        | "RESERVED_ONLY_INTERVENTION_REQUIRED"
        | "SUBMITTED_RECONCILIATION_REQUIRED"
        | "LIFECYCLE_COMPLETED";
    }>
  | Readonly<{
      state: "CANONICAL_NOT_EXECUTABLE" | "VISUAL_AUTHORIZATION_REQUIRED";
      readiness: ReadinessDto;
    }>
  | Readonly<{
      state: "REFERENCE_UNAVAILABLE";
      readiness: ReadinessDto;
      provider: string;
    }>
  | Readonly<{
      state: "REFERENCE_SELECTION_REQUIRED";
      readiness: ReadinessDto;
      provider: string;
      candidateReferenceCount: number;
    }>
  | Readonly<{
      state: "READY_FOR_GENERATION";
      readiness: ReadinessDto;
      provider: string;
      referenceAssetId: string;
    }>;

export type DialogueBlockerDto =
  Readonly<{
    reason: string;
    lineNumber: number;
    dialogueLineId: string;
    characterId: string;
  }>;

export type DialogueWorkDto =
  Readonly<{
    dialogueLineId: string;
    namespace: string;
    state: string;
  }>;

export type DialogueOpenAdmissionDto =
  Readonly<{
    dialogueLineId: string;
    attemptNumber: number;
    generationNamespace: string;
    matchesCurrentCanonicalPlan: boolean;
  }>;

export type DialogueDto =
  | Readonly<{
      state: "NO_DIALOGUE" | "PLACEMENT_REQUIRED";
    }>
  | Readonly<{
      state: "DIALOGUE_PLANNING_BLOCKED";
      blockers: readonly DialogueBlockerDto[];
    }>
  | Readonly<{
      state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED";
      blockers: readonly DialogueBlockerDto[];
      activeWork: readonly DialogueWorkDto[];
    }>
  | Readonly<{
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED";
      staleWork: readonly DialogueWorkDto[];
      reservedLineIds: readonly string[];
      submittedLineIds: readonly string[];
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED";
      reservedLineIds: readonly string[];
      submittedLineIds: readonly string[];
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED";
      openAdmissions: readonly DialogueOpenAdmissionDto[];
    }>
  | Readonly<{
      state: "DIALOGUE_RECONCILIATION_REQUIRED";
      submittedLineIds: readonly string[];
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "DIALOGUE_AUDIO_REQUIRED";
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "COMPOSITION_AUDIO_RESOLVED";
      resolvedLineCount: number;
    }>;

export type ShotDto =
  Readonly<{
    order: number;
    sceneId: string;
    shotId: string;
    visual: VisualDto;
    dialogue: DialogueDto;
  }>;

export type EpisodeDetailDto =
  Readonly<{
    apiVersion: typeof OPERATOR_API_VERSION;
    /** Identifies the episode within this engine/production instance only. */
    episodeId: string;
    title: string;
    evaluatedAt: string;
    summary: Readonly<{
      totalShots: number;
      visualGenerationStates: Readonly<Record<VisualState, number>>;
      dialogueCompositionStates: Readonly<Record<DialogueState, number>>;
    }>;
    shots: readonly ShotDto[];
  }>;

function unexpectedState(
  axis:
    string,
  value:
    never,
): never {
  void value;

  throw new Error(
    `Unsupported ${axis} state for the operator DTO boundary.`,
  );
}

// Single-line, control-free and bounded to 300 code points.
function boundedText(
  value:
    string,
): string {
  const line =
    value
      .replace(
        /[\u0000-\u001f\u007f]/g,
        " ",
      )
      .trim();

  const codePoints =
    Array.from(
      line,
    );

  return codePoints.length >
    MAX_TEXT_CODE_POINTS
    ? `${codePoints.slice(0, MAX_TEXT_CODE_POINTS).join("")}...`
    : line;
}

function lineIds(
  values:
    readonly string[],
): readonly string[] {
  return [
    ...values,
  ];
}

function countsFor<State extends string>(
  states:
    Readonly<Record<State, true>>,

  counts:
    Readonly<Record<State, number>>,
): Readonly<Record<State, number>> {
  const result =
    {} as Record<State, number>;

  for (
    const state
    of Object.keys(states) as State[]
  ) {
    const count =
      counts[state];

    if (
      !Number.isInteger(
        count,
      ) ||
      count < 0
    ) {
      throw new Error(
        "Operator DTO summary count is not a non-negative integer.",
      );
    }

    result[state] =
      count;
  }

  return result;
}

function mapReadiness(
  readiness:
    ShotExecutionReadiness,
): ReadinessDto {
  return {
    disposition:
      readiness.disposition,

    executionProvider:
      readiness.executionProvider,

    blockers:
      readiness.blockers.map(
        boundedText,
      ),
  };
}

export function mapVisualDto(
  visual:
    DurableShotVisualGenerationState,
): VisualDto {
  switch (visual.state) {
    case "RESERVED_ONLY_INTERVENTION_REQUIRED":
    case "SUBMITTED_RECONCILIATION_REQUIRED":
    case "LIFECYCLE_COMPLETED":
      return {
        state:
          visual.state,
      };

    case "CANONICAL_NOT_EXECUTABLE":
    case "VISUAL_AUTHORIZATION_REQUIRED":
      return {
        state:
          visual.state,

        readiness:
          mapReadiness(
            visual.readiness,
          ),
      };

    case "REFERENCE_UNAVAILABLE":
      return {
        state:
          visual.state,

        readiness:
          mapReadiness(
            visual.readiness,
          ),

        provider:
          visual.provider,
      };

    case "REFERENCE_SELECTION_REQUIRED":
      return {
        state:
          visual.state,

        readiness:
          mapReadiness(
            visual.readiness,
          ),

        provider:
          visual.provider,

        candidateReferenceCount:
          visual.candidateAssetIds.length,
      };

    case "READY_FOR_GENERATION":
      return {
        state:
          visual.state,

        readiness:
          mapReadiness(
            visual.readiness,
          ),

        provider:
          visual.provider,

        referenceAssetId:
          visual.reference.assetId,
      };

    default:
      return unexpectedState(
        "visual",
        visual,
      );
  }
}

function mapDialogueBlockers(
  blockers:
    Extract<
      DurableShotDialogueCompositionState,
      { state: "DIALOGUE_PLANNING_BLOCKED" }
    >["blockers"],
): readonly DialogueBlockerDto[] {
  return blockers.map(
    (blocker) => ({
      reason:
        blocker.reason,

      lineNumber:
        blocker.lineNumber,

      dialogueLineId:
        blocker.dialogueLineId,

      characterId:
        blocker.characterId,
    }),
  );
}

function mapDialogueWork(
  work:
    Extract<
      DurableShotDialogueCompositionState,
      { state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED" }
    >["activeWork"],
): readonly DialogueWorkDto[] {
  return work.map(
    (entry) => ({
      dialogueLineId:
        entry.dialogueLineId,

      namespace:
        entry.namespace,

      state:
        entry.state,
    }),
  );
}

export function mapDialogueDto(
  dialogue:
    DurableShotDialogueCompositionState,
): DialogueDto {
  switch (dialogue.state) {
    case "NO_DIALOGUE":
    case "PLACEMENT_REQUIRED":
      return {
        state:
          dialogue.state,
      };

    case "DIALOGUE_PLANNING_BLOCKED":
      return {
        state:
          dialogue.state,

        blockers:
          mapDialogueBlockers(
            dialogue.blockers,
          ),
      };

    case "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED":
      return {
        state:
          dialogue.state,

        blockers:
          mapDialogueBlockers(
            dialogue.blockers,
          ),

        activeWork:
          mapDialogueWork(
            dialogue.activeWork,
          ),
      };

    case "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED":
      return {
        state:
          dialogue.state,

        staleWork:
          mapDialogueWork(
            dialogue.staleWork,
          ),

        reservedLineIds:
          lineIds(
            dialogue.reservedLineIds,
          ),

        submittedLineIds:
          lineIds(
            dialogue.submittedLineIds,
          ),

        missingLineIds:
          lineIds(
            dialogue.missingLineIds,
          ),
      };

    case "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED":
      return {
        state:
          dialogue.state,

        reservedLineIds:
          lineIds(
            dialogue.reservedLineIds,
          ),

        submittedLineIds:
          lineIds(
            dialogue.submittedLineIds,
          ),

        missingLineIds:
          lineIds(
            dialogue.missingLineIds,
          ),
      };

    case "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED":
      return {
        state:
          dialogue.state,

        openAdmissions:
          dialogue.openAdmissions.map(
            (admission) => ({
              dialogueLineId:
                admission.dialogueLineId,

              attemptNumber:
                admission.attemptNumber,

              generationNamespace:
                admission.generationNamespace,

              matchesCurrentCanonicalPlan:
                admission.matchesCurrentCanonicalPlan,
            }),
          ),
      };

    case "DIALOGUE_RECONCILIATION_REQUIRED":
      return {
        state:
          dialogue.state,

        submittedLineIds:
          lineIds(
            dialogue.submittedLineIds,
          ),

        missingLineIds:
          lineIds(
            dialogue.missingLineIds,
          ),
      };

    case "DIALOGUE_AUDIO_REQUIRED":
      return {
        state:
          dialogue.state,

        missingLineIds:
          lineIds(
            dialogue.missingLineIds,
          ),
      };

    case "COMPOSITION_AUDIO_RESOLVED":
      return {
        state:
          dialogue.state,

        resolvedLineCount:
          dialogue.audioPlan.lines.length,
      };

    default:
      return unexpectedState(
        "dialogue",
        dialogue,
      );
  }
}

export function createHealthDto(): HealthDto {
  return {
    apiVersion:
      OPERATOR_API_VERSION,

    status:
      "ok",

    readOnly:
      true,
  };
}

export function mapEpisodeListDto(
  listing:
    readonly CanonicalEpisodeListing[],
): EpisodeListDto {
  return {
    apiVersion:
      OPERATOR_API_VERSION,

    episodes:
      listing.map(
        (entry): EpisodeListItemDto =>
          entry.manifest ===
            "VALID"
            ? {
                episodeId:
                  entry.episodeId,

                manifest:
                  "VALID",

                title:
                  boundedText(
                    entry.title,
                  ),

                sceneCount:
                  entry.sceneCount,

                shotCount:
                  entry.shotCount,
              }
            : {
                episodeId:
                  entry.episodeId,

                manifest:
                  "INVALID",
              },
      ),
  };
}

export function mapEpisodeDetailDto(
  status:
    EpisodeProductionStatus,

  evaluatedAt:
    Date,
): EpisodeDetailDto {
  const {
    episode,
    state,
  } = status;

  if (
    state.episodeId !==
    episode.episodeId
  ) {
    throw new Error(
      "Operator DTO episode identity does not match the evaluated state.",
    );
  }

  return {
    apiVersion:
      OPERATOR_API_VERSION,

    episodeId:
      episode.episodeId,

    title:
      boundedText(
        episode.title,
      ),

    evaluatedAt:
      evaluatedAt.toISOString(),

    summary: {
      totalShots:
        state.summary.totalShots,

      visualGenerationStates:
        countsFor(
          VISUAL_STATES,
          state.summary.visualGenerationStates,
        ),

      dialogueCompositionStates:
        countsFor(
          DIALOGUE_STATES,
          state.summary.dialogueCompositionStates,
        ),
    },

    shots:
      state.shots.map(
        (shot): ShotDto => ({
          order:
            shot.order,

          sceneId:
            shot.sceneId,

          shotId:
            shot.shotId,

          visual:
            mapVisualDto(
              shot.visualGenerationState,
            ),

          dialogue:
            mapDialogueDto(
              shot.dialogueCompositionState,
            ),
        }),
      ),
  };
}
