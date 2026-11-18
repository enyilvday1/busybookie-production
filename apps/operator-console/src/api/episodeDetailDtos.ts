export const VISUAL_GENERATION_STATES = [
  "RESERVED_ONLY_INTERVENTION_REQUIRED",
  "SUBMITTED_RECONCILIATION_REQUIRED",
  "LIFECYCLE_COMPLETED",
  "CANONICAL_NOT_EXECUTABLE",
  "VISUAL_AUTHORIZATION_REQUIRED",
  "REFERENCE_UNAVAILABLE",
  "REFERENCE_SELECTION_REQUIRED",
  "READY_FOR_GENERATION",
] as const;

export type VisualGenerationState =
  (typeof VISUAL_GENERATION_STATES)[number];

export const DIALOGUE_COMPOSITION_STATES = [
  "NO_DIALOGUE",
  "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
  "DIALOGUE_PLANNING_BLOCKED",
  "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
  "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
  "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
  "DIALOGUE_RECONCILIATION_REQUIRED",
  "DIALOGUE_AUDIO_REQUIRED",
  "PLACEMENT_REQUIRED",
  "COMPOSITION_AUDIO_RESOLVED",
] as const;

export type DialogueCompositionState =
  (typeof DIALOGUE_COMPOSITION_STATES)[number];

export const EXECUTION_READINESS_DISPOSITIONS = [
  "EXECUTABLE",
  "NOT_READY",
  "MANUAL_REVIEW",
  "CONFLICT",
  "BLOCKED",
] as const;

export type ExecutionReadinessDisposition =
  (typeof EXECUTION_READINESS_DISPOSITIONS)[number];

export const GENERATION_PROVIDERS = [
  "RUNWAY",
  "VEO",
  "KREA",
  "MANUAL",
  "GOOGLE_GENAI",
] as const;

export type GenerationProvider =
  (typeof GENERATION_PROVIDERS)[number];

export const VISUAL_EXECUTION_PROVIDERS = [
  "RUNWAY",
  "VEO",
  "GOOGLE_GENAI",
] as const;

export type VisualExecutionProvider =
  (typeof VISUAL_EXECUTION_PROVIDERS)[number];

export type EpisodeReadiness = Readonly<{
  disposition: ExecutionReadinessDisposition;
  executionProvider: GenerationProvider | null;
  blockers: readonly string[];
}>;

export type EpisodeVisualDetail =
  | Readonly<{
      state:
        | "RESERVED_ONLY_INTERVENTION_REQUIRED"
        | "SUBMITTED_RECONCILIATION_REQUIRED"
        | "LIFECYCLE_COMPLETED";
    }>
  | Readonly<{
      state:
        | "CANONICAL_NOT_EXECUTABLE"
        | "VISUAL_AUTHORIZATION_REQUIRED";
      readiness: EpisodeReadiness;
    }>
  | Readonly<{
      state: "REFERENCE_UNAVAILABLE";
      readiness: EpisodeReadiness;
      provider: VisualExecutionProvider;
    }>
  | Readonly<{
      state: "REFERENCE_SELECTION_REQUIRED";
      readiness: EpisodeReadiness;
      provider: VisualExecutionProvider;
      candidateReferenceCount: number;
    }>
  | Readonly<{
      state: "READY_FOR_GENERATION";
      readiness: EpisodeReadiness;
      provider: VisualExecutionProvider;
      referenceAssetId: string;
    }>;

export type EpisodeDialogueDetail =
  Readonly<{
    state: DialogueCompositionState;
  }>;

export type EpisodeShotDetail =
  Readonly<{
    order: number;
    sceneId: string;
    shotId: string;
    visual: EpisodeVisualDetail;
    dialogue: EpisodeDialogueDetail;
  }>;

export type EpisodeDetail =
  Readonly<{
    apiVersion: "v1";
    episodeId: string;
    title: string;
    evaluatedAt: string;
    summary: Readonly<{
      totalShots: number;
      visualGenerationStates:
        Readonly<Record<VisualGenerationState, number>>;
      dialogueCompositionStates:
        Readonly<Record<DialogueCompositionState, number>>;
    }>;
    shots: readonly EpisodeShotDetail[];
  }>;

export type CanonicalEpisodeId =
  string &
  Readonly<{
    readonly __canonicalEpisodeIdBrand: unique symbol;
  }>;

const EPISODE_ID_PATTERN =
  /^EP[0-9]{2,3}$/;

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isCount(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isPositiveInteger(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  );
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0
  );
}

function isIsoInstant(
  value: unknown,
): value is string {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  const milliseconds =
    Date.parse(
      value,
    );

  if (
    !Number.isFinite(
      milliseconds,
    )
  ) {
    return false;
  }

  return (
    new Date(
      milliseconds,
    ).toISOString() ===
    value
  );
}

function isOneOf<
  Value extends string,
>(
  value: unknown,
  choices: readonly Value[],
): value is Value {
  return (
    typeof value === "string" &&
    choices.includes(
      value as Value,
    )
  );
}

export function isCanonicalEpisodeId(
  value: unknown,
): value is CanonicalEpisodeId {
  return (
    typeof value === "string" &&
    EPISODE_ID_PATTERN.test(
      value,
    )
  );
}

function parseStringArray(
  value: unknown,
): readonly string[] | null {
  if (
    !Array.isArray(
      value,
    ) ||
    value.some(
      (entry) =>
        typeof entry !== "string",
    )
  ) {
    return null;
  }

  return Object.freeze([
    ...value,
  ]);
}

function parseReadiness(
  value: unknown,
): EpisodeReadiness | null {
  if (
    !isRecord(
      value,
    ) ||
    !isOneOf(
      value.disposition,
      EXECUTION_READINESS_DISPOSITIONS,
    )
  ) {
    return null;
  }

  const executionProvider =
    value.executionProvider;

  if (
    executionProvider !== null &&
    !isOneOf(
      executionProvider,
      GENERATION_PROVIDERS,
    )
  ) {
    return null;
  }

  const blockers =
    parseStringArray(
      value.blockers,
    );

  if (
    blockers === null
  ) {
    return null;
  }

  return Object.freeze({
    disposition:
      value.disposition,

    executionProvider,

    blockers,
  });
}

function parseVisual(
  value: unknown,
): EpisodeVisualDetail | null {
  if (
    !isRecord(
      value,
    ) ||
    !isOneOf(
      value.state,
      VISUAL_GENERATION_STATES,
    )
  ) {
    return null;
  }

  switch (
    value.state
  ) {
    case "RESERVED_ONLY_INTERVENTION_REQUIRED":
    case "SUBMITTED_RECONCILIATION_REQUIRED":
    case "LIFECYCLE_COMPLETED":
      return Object.freeze({
        state:
          value.state,
      });

    case "CANONICAL_NOT_EXECUTABLE":
    case "VISUAL_AUTHORIZATION_REQUIRED": {
      const readiness =
        parseReadiness(
          value.readiness,
        );

      if (
        readiness === null
      ) {
        return null;
      }

      return Object.freeze({
        state:
          value.state,

        readiness,
      });
    }

    case "REFERENCE_UNAVAILABLE": {
      const readiness =
        parseReadiness(
          value.readiness,
        );

      if (
        readiness === null ||
        !isOneOf(
          value.provider,
          VISUAL_EXECUTION_PROVIDERS,
        )
      ) {
        return null;
      }

      return Object.freeze({
        state:
          value.state,

        readiness,

        provider:
          value.provider,
      });
    }

    case "REFERENCE_SELECTION_REQUIRED": {
      const readiness =
        parseReadiness(
          value.readiness,
        );

      if (
        readiness === null ||
        !isOneOf(
          value.provider,
          VISUAL_EXECUTION_PROVIDERS,
        ) ||
        !isCount(
          value.candidateReferenceCount,
        )
      ) {
        return null;
      }

      return Object.freeze({
        state:
          value.state,

        readiness,

        provider:
          value.provider,

        candidateReferenceCount:
          value.candidateReferenceCount,
      });
    }

    case "READY_FOR_GENERATION": {
      const readiness =
        parseReadiness(
          value.readiness,
        );

      if (
        readiness === null ||
        !isOneOf(
          value.provider,
          VISUAL_EXECUTION_PROVIDERS,
        ) ||
        !isNonEmptyString(
          value.referenceAssetId,
        )
      ) {
        return null;
      }

      return Object.freeze({
        state:
          value.state,

        readiness,

        provider:
          value.provider,

        referenceAssetId:
          value.referenceAssetId,
      });
    }
  }
}

function parseDialogue(
  value: unknown,
): EpisodeDialogueDetail | null {
  if (
    !isRecord(
      value,
    ) ||
    !isOneOf(
      value.state,
      DIALOGUE_COMPOSITION_STATES,
    )
  ) {
    return null;
  }

  return Object.freeze({
    state:
      value.state,
  });
}

function parseShot(
  value: unknown,
): EpisodeShotDetail | null {
  if (
    !isRecord(
      value,
    ) ||
    !isPositiveInteger(
      value.order,
    ) ||
    !isNonEmptyString(
      value.sceneId,
    ) ||
    !isNonEmptyString(
      value.shotId,
    )
  ) {
    return null;
  }

  const visual =
    parseVisual(
      value.visual,
    );

  const dialogue =
    parseDialogue(
      value.dialogue,
    );

  if (
    visual === null ||
    dialogue === null
  ) {
    return null;
  }

  return Object.freeze({
    order:
      value.order,

    sceneId:
      value.sceneId,

    shotId:
      value.shotId,

    visual,

    dialogue,
  });
}

function parseCounts<
  State extends string,
>(
  value: unknown,
  states: readonly State[],
): Readonly<Record<State, number>> | null {
  if (
    !isRecord(
      value,
    )
  ) {
    return null;
  }

  const result =
    {} as Record<State, number>;

  for (
    const state
    of states
  ) {
    const count =
      value[state];

    if (
      !isCount(
        count,
      )
    ) {
      return null;
    }

    result[state] =
      count;
  }

  return Object.freeze(
    result,
  );
}

function sumCounts<
  State extends string,
>(
  counts: Readonly<Record<State, number>>,
  states: readonly State[],
): number {
  return states.reduce(
    (
      total,
      state,
    ) =>
      total +
      counts[state],
    0,
  );
}

export function parseEpisodeDetail(
  value: unknown,
): EpisodeDetail | null {
  if (
    !isRecord(
      value,
    ) ||
    value.apiVersion !== "v1" ||
    !isCanonicalEpisodeId(
      value.episodeId,
    ) ||
    !isNonEmptyString(
      value.title,
    ) ||
    !isIsoInstant(
      value.evaluatedAt,
    ) ||
    !isRecord(
      value.summary,
    ) ||
    !Array.isArray(
      value.shots,
    )
  ) {
    return null;
  }

  const totalShots =
    value.summary.totalShots;

  if (
    !isCount(
      totalShots,
    )
  ) {
    return null;
  }

  const visualGenerationStates =
    parseCounts(
      value.summary.visualGenerationStates,
      VISUAL_GENERATION_STATES,
    );

  const dialogueCompositionStates =
    parseCounts(
      value.summary.dialogueCompositionStates,
      DIALOGUE_COMPOSITION_STATES,
    );

  if (
    visualGenerationStates === null ||
    dialogueCompositionStates === null
  ) {
    return null;
  }

  const shots:
    EpisodeShotDetail[] =
    [];

  const shotIdentities =
    new Set<string>();

  const shotOrders =
    new Set<number>();

  for (
    const candidate
    of value.shots
  ) {
    const shot =
      parseShot(
        candidate,
      );

    if (
      shot === null
    ) {
      return null;
    }

    const identity =
      `${shot.sceneId}\u0000${shot.shotId}`;

    if (
      shotIdentities.has(
        identity,
      ) ||
      shotOrders.has(
        shot.order,
      )
    ) {
      return null;
    }

    shotIdentities.add(
      identity,
    );

    shotOrders.add(
      shot.order,
    );

    shots.push(
      shot,
    );
  }

  if (
    shots.length !==
      totalShots ||
    sumCounts(
      visualGenerationStates,
      VISUAL_GENERATION_STATES,
    ) !==
      totalShots ||
    sumCounts(
      dialogueCompositionStates,
      DIALOGUE_COMPOSITION_STATES,
    ) !==
      totalShots
  ) {
    return null;
  }

  return Object.freeze({
    apiVersion:
      "v1",

    episodeId:
      value.episodeId,

    title:
      value.title,

    evaluatedAt:
      value.evaluatedAt,

    summary:
      Object.freeze({
        totalShots,

        visualGenerationStates,

        dialogueCompositionStates,
      }),

    shots:
      Object.freeze(
        shots,
      ),
  });
}
