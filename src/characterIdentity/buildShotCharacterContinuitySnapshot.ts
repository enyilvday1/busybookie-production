import {
  freezeCharacterIdentity,
} from "./canonicalCharacterIdentityJson.js";

import {
  VisualReferenceAssetRegistrySchema,
} from "../execution/visualReferenceAsset.schema.js";

import {
  CharacterBibleSchema,
} from "../schemas/character.schema.js";

import {
  compareCharacterVisualReferenceRoles,
} from "../schemas/characterVisualIdentity.schema.js";

import {
  EpisodeManifestSchema,
} from "../schemas/episodeManifest.schema.js";

import {
  hashShotCharacterContinuitySnapshotV1,
  parseShotCharacterContinuitySnapshotV1,
  type ShotCharacterContinuitySnapshotV1,
} from "./shotCharacterContinuitySnapshot.schema.js";

export type BuildShotCharacterContinuitySnapshotV1Input =
  Readonly<{
    episode:
      unknown;

    sceneId:
      string;

    shotId:
      string;

    bible:
      unknown;

    // An already-read registry document; it is re-validated here, never trusted as typed.
    visualReferenceRegistry:
      unknown;
  }>;

export type ShotCharacterContinuitySnapshotV1Result =
  Readonly<{
    snapshot:
      ShotCharacterContinuitySnapshotV1;

    snapshotSha256:
      string;
  }>;

function blocked(
  detail:
    string,
): never {
  throw new Error(
    `Shot character continuity snapshot blocked: ${detail}`,
  );
}

function parseOrBlock<T>(
  label:
    string,
  result:
    | { success: true; data: T }
    | { success: false; error: { message: string } },
): T {
  if (!result.success) {
    blocked(
      `${label} is invalid: ${result.error.message}`,
    );
  }

  return result.data;
}

// Membership comes only from shot.characters; identity only from CharacterBible.visualIdentity.
// The registry check is referential only: it confirms each bound asset is registered, while
// byte-level verification stays with verifyApprovedVisualReferenceAsset at execution time.
export function buildShotCharacterContinuitySnapshotV1(
  input:
    BuildShotCharacterContinuitySnapshotV1Input,
): ShotCharacterContinuitySnapshotV1Result {
  // Parsing yields fresh copies, so caller inputs are never mutated.
  const episode =
    parseOrBlock(
      "episode manifest",
      EpisodeManifestSchema.safeParse(
        input.episode,
      ),
    );

  const bible =
    parseOrBlock(
      "character bible",
      CharacterBibleSchema.safeParse(
        input.bible,
      ),
    );

  const registry =
    parseOrBlock(
      "visual reference asset registry",
      VisualReferenceAssetRegistrySchema.safeParse(
        input.visualReferenceRegistry,
      ),
    );

  const scene =
    episode.scenes.find(
      (candidate) =>
        candidate.id ===
        input.sceneId,
    ) ??
    blocked(
      `scene ${input.sceneId} was not found in episode ${episode.episodeId}.`,
    );

  const shot =
    scene.shots.find(
      (candidate) =>
        candidate.id ===
        input.shotId,
    ) ??
    blocked(
      `shot ${input.shotId} was not found in ${episode.episodeId}/${scene.id}.`,
    );

  const registeredAssetIds =
    new Set(
      registry.assets.map(
        (asset) =>
          asset.assetId,
      ),
    );

  const characters =
    [...shot.characters]
      .sort()
      .map(
        (characterId) => {
          const character =
            bible.characters.find(
              (candidate) =>
                candidate.id ===
                characterId,
            ) ??
            blocked(
              `${shot.id} references unknown character ${characterId}.`,
            );

          const identity =
            character.visualIdentity;

          if (!identity) {
            blocked(
              `character ${characterId} has no CharacterBible visualIdentity (E9 activation pending).`,
            );
          }

          if (
            identity.status !==
            "LOCKED"
          ) {
            blocked(
              `character ${characterId} visual identity is ${identity.status}, not LOCKED.`,
            );
          }

          for (
            const binding
            of identity.referenceBindings
          ) {
            if (
              !registeredAssetIds.has(
                binding.assetId,
              )
            ) {
              blocked(
                `character ${characterId} ${binding.role} asset ${binding.assetId} is not in the visual reference asset registry.`,
              );
            }
          }

          return {
            characterId,

            identityVersion:
              identity.identityVersion,

            promptAnchor:
              character.promptAnchor,

            immutableIdentity: {
              species:
                character.species,

              invariantTraits: [
                ...identity.invariantTraits,
              ],

              prohibitedVariations: [
                ...identity.prohibitedVariations,
              ],

              referenceBindings:
                identity.referenceBindings
                  .map(
                    (binding) => ({
                      role:
                        binding.role,

                      assetId:
                        binding.assetId,
                    }),
                  )
                  .sort(
                    (
                      left,
                      right,
                    ) =>
                      compareCharacterVisualReferenceRoles(
                        left.role,
                        right.role,
                      ),
                  ),
            },

            continuityState: {
              source:
                "CHARACTER_BIBLE_DEFAULT" as const,

              outfit: [
                ...character.appearance.outfit,
              ],

              accessories: [
                ...character.appearance.accessories,
              ],
            },
          };
        },
      );

  const snapshot =
    parseShotCharacterContinuitySnapshotV1({
      recordType:
        "BUSYBOOKIE_SHOT_CHARACTER_CONTINUITY_SNAPSHOT",

      recordVersion:
        "1",

      episodeId:
        episode.episodeId,

      sceneId:
        scene.id,

      shotId:
        shot.id,

      shotContinuityNotes: [
        ...shot.continuityNotes,
      ],

      characters,
    });

  return freezeCharacterIdentity({
    snapshot,

    snapshotSha256:
      hashShotCharacterContinuitySnapshotV1(
        snapshot,
      ),
  });
}
