import type {
  EpisodeManifest,
  Shot,
} from "../../schemas/episodeManifest.schema.js";

const LIVE_EPISODE_STATUSES =
  new Set([
    "READY_FOR_GENERATION",
    "IN_PRODUCTION",
  ]);

export function findEpisodeShot(
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

export function assertRunwayGen45ShotReady(
  episode: EpisodeManifest,
  shot: Shot,
): void {
  if (
    !LIVE_EPISODE_STATUSES.has(
      episode.status,
    )
  ) {
    throw new Error(
      `Paid Runway generation blocked: episode ${episode.episodeId} status is ${episode.status}.`,
    );
  }

  if (
    shot.generation.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Paid Runway generation blocked: ${shot.id} provider is ${shot.generation.provider}.`,
    );
  }

  if (
    shot.generation.status !==
    "APPROVED_FOR_GENERATION"
  ) {
    throw new Error(
      `Paid Runway generation blocked: ${shot.id} status is ${shot.generation.status}.`,
    );
  }

  if (
    shot.generation.nativeAudio
  ) {
    throw new Error(
      `Gen-4.5 CLI blocked: ${shot.id} requests native audio.`,
    );
  }

  if (
    shot.dialogue.length >
    0
  ) {
    throw new Error(
      `Gen-4.5 CLI blocked: ${shot.id} contains dialogue.`,
    );
  }

  if (
    shot.references.required &&
    shot.references.approvalStatus !==
      "APPROVED"
  ) {
    throw new Error(
      `Paid Runway generation blocked: ${shot.id} references are not approved.`,
    );
  }
}
