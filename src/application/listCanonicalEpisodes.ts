import type {
  Dirent,
} from "node:fs";

import {
  readdir,
} from "node:fs/promises";

import {
  join,
  resolve,
} from "node:path";

import {
  ExecutionReservationEpisodeIdSchema,
} from "../execution/executionReservation.schema.js";

import {
  loadEpisodeManifest,
} from "../validation/loadEpisodeManifest.js";

// D1 read-only episode-listing authority. Episodes are the plain directories
// under the canonical episodes root whose names are canonical episode IDs.
// Each listed ID is unique only within this engine instance's episodes root.
// Nothing is written, followed through links or recursed into, and no caller
// supplies a path.

export type CanonicalEpisodeListing =
  | Readonly<{
      episodeId: string;
      manifest: "VALID";
      title: string;
      sceneCount: number;
      shotCount: number;
    }>
  | Readonly<{
      episodeId: string;
      manifest: "INVALID";
    }>;

export type ListCanonicalEpisodesDependencies =
  Readonly<{
    episodesDirectory:
      string;

    readDirectory:
      (directory: string) => Promise<readonly Dirent[]>;

    loadEpisodeManifest:
      typeof loadEpisodeManifest;
  }>;

// The single canonical episode-ID rule shared by listing and the HTTP layer.
export function isCanonicalEpisodeId(
  value:
    unknown,
): value is string {
  return ExecutionReservationEpisodeIdSchema.safeParse(
    value,
  ).success;
}

function defaultDependencies(): ListCanonicalEpisodesDependencies {
  return Object.freeze({
    // Same base as loadEpisodeManifest's default manifest path.
    episodesDirectory:
      resolve(
        process.cwd(),
        "episodes",
      ),

    readDirectory:
      (directory: string) =>
        readdir(
          directory,
          {
            withFileTypes:
              true,
          },
        ),

    loadEpisodeManifest,
  });
}

function compareEpisodeIds(
  left:
    string,

  right:
    string,
): number {
  const numeric =
    Number(left.slice(2)) -
    Number(right.slice(2));

  if (numeric !== 0) {
    return numeric;
  }

  return left < right
    ? -1
    : left > right
      ? 1
      : 0;
}

export async function listCanonicalEpisodes(
  dependencies:
    ListCanonicalEpisodesDependencies =
      defaultDependencies(),
): Promise<readonly CanonicalEpisodeListing[]> {
  // A missing or unreadable root rejects; it is never an empty catalogue.
  const entries =
    await dependencies
      .readDirectory(
        dependencies.episodesDirectory,
      );

  const episodeIds:
    string[] =
      [];

  for (
    const entry
    of entries
  ) {
    const name =
      entry.name;

    const upperCaseName =
      name.toUpperCase();

    if (
      isCanonicalEpisodeId(
        name,
      )
    ) {
      // Links and junctions are never followed; a non-directory or linked
      // canonical name fails the whole listing closed.
      if (
        entry.isSymbolicLink() ||
        !entry.isDirectory()
      ) {
        throw new Error(
          `Canonical episode entry ${name} is not a plain directory.`,
        );
      }

      episodeIds.push(
        name,
      );

      continue;
    }

    // On a case-insensitive filesystem a case variant would alias a canonical
    // ID, so the ambiguity fails closed rather than being skipped.
    if (
      isCanonicalEpisodeId(
        upperCaseName,
      )
    ) {
      throw new Error(
        "An episode directory name differs from a canonical episode ID only by letter case.",
      );
    }

    // Anything else (hidden, temporary, README, orphan) is not an episode.
  }

  episodeIds.sort(
    compareEpisodeIds,
  );

  const listings:
    CanonicalEpisodeListing[] =
      [];

  // Sequential and manifest-level only: no durable-state evaluation here.
  for (
    const episodeId
    of episodeIds
  ) {
    try {
      const manifest =
        await dependencies
          .loadEpisodeManifest(
            episodeId,
            join(
              dependencies.episodesDirectory,
              episodeId,
              "episode.json",
            ),
          );

      listings.push(
        Object.freeze({
          episodeId,

          manifest:
            "VALID" as const,

          title:
            manifest.title,

          sceneCount:
            manifest.scenes.length,

          shotCount:
            manifest.scenes.reduce(
              (total, scene) =>
                total +
                scene.shots.length,
              0,
            ),
        }),
      );
    } catch {
      // Listed as invalid, never as valid; the reason is not surfaced.
      listings.push(
        Object.freeze({
          episodeId,

          manifest:
            "INVALID" as const,
        }),
      );
    }
  }

  return Object.freeze(
    listings,
  );
}
