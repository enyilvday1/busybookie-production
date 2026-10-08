import type {
  EpisodeManifest,
  Shot,
} from "../../schemas/episodeManifest.schema.js";

const LIVE_EPISODE_STATUSES =
  new Set([
    "READY_FOR_GENERATION",
    "IN_PRODUCTION",
  ]);

export function findVeoEpisodeShot(
  episode: EpisodeManifest,
  shotId: string,
): Shot {
  for (
    const scene
    of episode.scenes
  ) {
    const shot =
      scene.shots.find(
        (candidate) =>
          candidate.id ===
          shotId,
      );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Shot ${shotId} was not found in episode ${episode.episodeId}.`,
  );
}

export type VeoShotReadinessMode =
  | "CONNECTIVITY_CLI"
  | "DURABLE_AUTHORIZED_DIALOGUE_VISUAL";

export function assertVeoShotReady(
  episode: EpisodeManifest,
  shot: Shot,
  mode:
    VeoShotReadinessMode =
      "CONNECTIVITY_CLI",
): void {
  if (
    mode !== "CONNECTIVITY_CLI" &&
    mode !==
      "DURABLE_AUTHORIZED_DIALOGUE_VISUAL"
  ) {
    throw new Error(
      `Unsupported Veo shot readiness mode: ${String(mode)}.`,
    );
  }

  if (
    !LIVE_EPISODE_STATUSES.has(
      episode.status,
    )
  ) {
    throw new Error(
      `Paid Veo generation blocked: episode ${episode.episodeId} status is ${episode.status}.`,
    );
  }

  if (
    shot.generation.provider !==
    "VEO"
  ) {
    throw new Error(
      `Paid Veo generation blocked: ${shot.id} provider is ${shot.generation.provider}.`,
    );
  }

  if (
    shot.generation.status !==
    "APPROVED_FOR_GENERATION"
  ) {
    throw new Error(
      `Paid Veo generation blocked: ${shot.id} status is ${shot.generation.status}.`,
    );
  }

  if (
    !shot.generation.nativeAudio
  ) {
    throw new Error(
      `Veo CLI blocked: ${shot.id} does not request native audio.`,
    );
  }

  if (
    mode ===
      "CONNECTIVITY_CLI" &&
    shot.dialogue.length >
      0
  ) {
    throw new Error(
      `Veo connectivity CLI blocked: ${shot.id} contains dialogue. Dialogue generation remains disabled until Busybookie voice continuity is explicitly approved.`,
    );
  }

  if (
    !shot.references.required
  ) {
    throw new Error(
      `Veo image-to-video CLI blocked: ${shot.id} does not declare a required reference image.`,
    );
  }

  if (
    shot.references.approvalStatus !==
    "APPROVED"
  ) {
    throw new Error(
      `Paid Veo generation blocked: ${shot.id} references are not approved.`,
    );
  }
}
