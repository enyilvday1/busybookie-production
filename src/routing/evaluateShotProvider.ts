import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

import type {
  GenerationProvider,
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import type {
  ProviderRoutingDecision,
} from "./providerRouter.types.js";

function hasDialogueIntent(
  shot: Shot,
  policy: ProviderRoutingPolicy,
): boolean {
  if (shot.dialogue.length > 0) {
    return true;
  }

  return (
    policy.dialogue
      .treatDialogueShotTypeAsDialogueIntent &&
    shot.type === "DIALOGUE"
  );
}

function evaluateDialogueReadiness(
  shot: Shot,
  bible: CharacterBible,
  policy: ProviderRoutingPolicy,
): readonly string[] {
  if (
    !policy.dialogue
      .requireLockedVoices
  ) {
    return [];
  }

  const blockers: string[] = [];

  const speakingCharacterIds =
    new Set(
      shot.dialogue.map(
        (line) =>
          line.characterId,
      ),
    );

  for (
    const characterId
    of speakingCharacterIds
  ) {
    const character =
      bible.characters.find(
        (candidate) =>
          candidate.id ===
          characterId,
      );

    if (!character) {
      blockers.push(
        `${shot.id}: unknown dialogue character ${characterId}.`,
      );

      continue;
    }

    if (
      character.voice
        .selectionStatus !==
      "LOCKED"
    ) {
      blockers.push(
        `${shot.id}: ${character.name} requires dialogue but no approved voice is locked.`,
      );
    }
  }

  return blockers;
}

function createNonDialogueReason(
  shot: Shot,
  provider: GenerationProvider,
): string {
  if (
    shot.generation.nativeAudio
  ) {
    return (
      `${shot.id}: non-dialogue shot requests native audio, ` +
      `so routing policy recommends ${provider}.`
    );
  }

  return (
    `${shot.id}: non-dialogue visual-only shot ` +
    `routes to ${provider}.`
  );
}

export function evaluateShotProvider(
  shot: Shot,
  bible: CharacterBible,
  rules: ProductionRules,
  policy: ProviderRoutingPolicy,
): ProviderRoutingDecision {
  const currentProvider =
    shot.generation.provider;

  if (
    hasDialogueIntent(
      shot,
      policy,
    )
  ) {
    const blockers =
      evaluateDialogueReadiness(
        shot,
        bible,
        policy,
      );

    if (blockers.length > 0) {
      return {
        disposition: "BLOCKED",
        recommendedProvider: null,
        currentProvider,
        currentProviderMatchesRecommendation: null,
        manifestConflict: false,
        reasons: [
          `${shot.id}: dialogue routing requires locked voices before provider review.`,
        ],
        blockers,
      };
    }

    return {
      disposition: "MANUAL_REVIEW",
      recommendedProvider: null,
      currentProvider,
      currentProviderMatchesRecommendation: null,
      manifestConflict: false,
      reasons: [
        `${shot.id}: dialogue intent detected and all declared speakers satisfy locked-voice requirements.`,
        `${shot.id}: automatic dialogue provider selection is disabled to preserve voice continuity.`,
      ],
      blockers: [],
    };
  }

  const recommendedProvider =
    shot.generation.nativeAudio
      ? policy.nonDialogue
          .nativeAudioProvider
      : policy.nonDialogue
          .visualOnlyProvider;

  const currentProviderMatchesRecommendation =
    currentProvider ===
    recommendedProvider;

  const manifestConflict =
    policy.manifest
      .flagProviderMismatch &&
    !currentProviderMatchesRecommendation;

  const routingReason =
    createNonDialogueReason(
      shot,
      recommendedProvider,
    );

  if (
    !rules.generation
      .supportedProviders
      .includes(
        recommendedProvider,
      )
  ) {
    return {
      disposition: "BLOCKED",
      recommendedProvider,
      currentProvider,
      currentProviderMatchesRecommendation,
      manifestConflict,
      reasons: [
        routingReason,
      ],
      blockers: [
        `${shot.id}: recommended provider ${recommendedProvider} is not enabled in production rules.`,
      ],
    };
  }

  if (manifestConflict) {
    return {
      disposition: "CONFLICT",
      recommendedProvider,
      currentProvider,
      currentProviderMatchesRecommendation,
      manifestConflict: true,
      reasons: [
        routingReason,
        `${shot.id}: manifest provider ${currentProvider} conflicts with routing recommendation ${recommendedProvider}.`,
      ],
      blockers: [],
    };
  }

  return {
    disposition: "ROUTABLE",
    recommendedProvider,
    currentProvider,
    currentProviderMatchesRecommendation,
    manifestConflict: false,
    reasons: [
      routingReason,
    ],
    blockers: [],
  };
}
