import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

const ACTIVE_GENERATION_STATUSES = new Set([
  "APPROVED_FOR_GENERATION",
  "GENERATING",
  "GENERATED",
  "REVIEW_REQUIRED",
  "APPROVED",
]);

const REFERENCE_REQUIRED_STATUSES = new Set([
  "APPROVED_FOR_GENERATION",
  "GENERATING",
  "GENERATED",
  "REVIEW_REQUIRED",
  "APPROVED",
]);

function assertEpisodeApprovals(
  episode: EpisodeManifest,
  rules: ProductionRules,
): void {
  const generationReadyStatuses = new Set([
    "READY_FOR_GENERATION",
    "IN_PRODUCTION",
    "ROUGH_CUT",
    "FINAL_QC",
    "COMPLETE",
  ]);

  if (generationReadyStatuses.has(episode.status)) {
    if (
      rules.approvals.requireScriptApproval &&
      episode.approvals.script !== "APPROVED"
    ) {
      throw new Error(
        "Episode generation blocked: script approval is required.",
      );
    }

    if (
      rules.approvals.requireStoryboardApproval &&
      episode.approvals.storyboard !== "APPROVED"
    ) {
      throw new Error(
        "Episode generation blocked: storyboard approval is required.",
      );
    }

    if (
      rules.approvals.requireReferenceApproval &&
      episode.approvals.references !== "APPROVED"
    ) {
      throw new Error(
        "Episode generation blocked: reference approval is required.",
      );
    }
  }

  if (
    (episode.status === "FINAL_QC" ||
      episode.status === "COMPLETE") &&
    rules.approvals.requireRoughCutApproval &&
    episode.approvals.roughCut !== "APPROVED"
  ) {
    throw new Error(
      "Episode cannot enter final QC without rough-cut approval.",
    );
  }

  if (
    episode.status === "COMPLETE" &&
    rules.approvals.requireFinalQcApproval &&
    episode.approvals.finalQc !== "APPROVED"
  ) {
    throw new Error(
      "Episode cannot be complete without final-QC approval.",
    );
  }
}

function assertShotCanProgress(
  shot: Shot,
  bible: CharacterBible,
  rules: ProductionRules,
): void {
  if (
    !rules.generation.supportedProviders.includes(
      shot.generation.provider,
    )
  ) {
    throw new Error(
      `${shot.id}: provider ${shot.generation.provider} is not enabled.`,
    );
  }

  if (
    REFERENCE_REQUIRED_STATUSES.has(
      shot.generation.status,
    ) &&
    shot.references.required &&
    shot.references.approvalStatus !== "APPROVED"
  ) {
    throw new Error(
      `${shot.id}: generation blocked because required references are not approved.`,
    );
  }

  if (
    ACTIVE_GENERATION_STATUSES.has(
      shot.generation.status,
    )
  ) {
    const speakingCharacterIds = new Set(
      shot.dialogue.map(
        (line) => line.characterId,
      ),
    );

    for (const characterId of speakingCharacterIds) {
      const character = bible.characters.find(
        (candidate) =>
          candidate.id === characterId,
      );

      if (!character) {
        throw new Error(
          `${shot.id}: unknown dialogue character ${characterId}.`,
        );
      }

      if (
        character.voice.selectionStatus !== "LOCKED"
      ) {
        throw new Error(
          `${shot.id}: generation blocked because ${character.name} requires dialogue but no approved voice is locked.`,
        );
      }
    }
  }
}

export function validateEpisodeProduction(
  episode: EpisodeManifest,
  bible: CharacterBible,
  rules: ProductionRules,
): void {
  assertEpisodeApprovals(
    episode,
    rules,
  );

  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      assertShotCanProgress(
        shot,
        bible,
        rules,
      );
    }
  }
}
