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
  hashShotCharacterContinuitySnapshotV2,
  parseShotCharacterContinuitySnapshotV2,
  type ShotCharacterContinuitySnapshotV2,
} from "./shotCharacterContinuitySnapshot.schema.js";

import {
  assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority,
  isVerifiedCharacterIdentityConsumption,
} from "./verifyCharacterVisualIdentityApprovalForConsumption.js";

export type BuildShotCharacterContinuitySnapshotV2Input =
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

    // Results of verifyCharacterVisualIdentityApprovalForConsumption for every shot character. Only results produced
    // by that verifier, for exactly the current authority of the character, are accepted; one per character. This
    // module stays pure and performs no I/O itself.
    verifiedIdentities:
      readonly unknown[];
  }>;

export type ShotCharacterContinuitySnapshotV2Result =
  Readonly<{
    snapshot:
      ShotCharacterContinuitySnapshotV2;

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

// Membership comes only from shot.characters; identity only from CharacterBible v2 visualIdentity and default state
// only from defaultContinuityState. promptAnchor is legacy, non-authoritative text and is never read.
export function buildShotCharacterContinuitySnapshotV2(
  input:
    BuildShotCharacterContinuitySnapshotV2Input,
): ShotCharacterContinuitySnapshotV2Result {
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

  const verifiedByCharacter =
    new Map<
      string,
      unknown
    >();

  for (
    const candidate
    of input.verifiedIdentities
  ) {
    if (
      !isVerifiedCharacterIdentityConsumption(
        candidate,
      )
    ) {
      blocked(
        "verifiedIdentities contains a value that was not issued by the consumption verifier.",
      );
    }

    if (
      verifiedByCharacter.has(
        candidate.characterId,
      )
    ) {
      blocked(
        `verifiedIdentities contains more than one verification for ${candidate.characterId}.`,
      );
    }

    verifiedByCharacter.set(
      candidate.characterId,
      candidate,
    );
  }

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

          const master =
            identity.referenceBindings.find(
              (binding) =>
                binding.role ===
                "MASTER_IDENTITY",
            ) ??
            blocked(
              `character ${characterId} has no MASTER_IDENTITY binding.`,
            );

          const verified =
            verifiedByCharacter.get(
              characterId,
            );

          if (
            verified ===
            undefined
          ) {
            blocked(
              `character ${characterId} has no matching consumption-verified approval for identity version ${identity.identityVersion}.`,
            );
          }

          // Binds the genuine verification to the exact current authority (stale or foreign results fail).
          try {
            assertCharacterVisualIdentityConsumptionVerificationMatchesAuthority(
              verified,
              character,
            );
          } catch (error) {
            blocked(
              `character ${characterId} has no matching consumption-verified approval for identity version ${identity.identityVersion}: ${(error as Error).message}`,
            );
          }

          return {
            characterId,

            identityVersion:
              identity.identityVersion,

            approval: {
              approvalId:
                identity.approval.approvalId,

              receiptSha256:
                identity.approval.receiptSha256,
            },

            immutableIdentity: {
              species:
                character.species,

              invariantTraits: [
                ...identity.invariantTraits,
              ],

              prohibitedVariations: [
                ...identity.prohibitedVariations,
              ],

              approvedTraitDecisions:
                identity.approvedTraitDecisions.map(
                  (decision) => ({
                    traitKey:
                      decision.traitKey,

                    valueCode:
                      decision.valueCode,

                    description:
                      decision.description,

                    provenance:
                      decision.provenance,
                  }),
                ),

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

              items:
                character.defaultContinuityState.items.map(
                  (item) => ({
                    itemKey:
                      item.itemKey,

                    description:
                      item.description,

                    resolutions:
                      item.resolutions.map(
                        (resolution) => ({
                          ...resolution,
                        }),
                      ),
                  }),
                ),
            },
          };
        },
      );

  const snapshot =
    parseShotCharacterContinuitySnapshotV2({
      recordType:
        "BUSYBOOKIE_SHOT_CHARACTER_CONTINUITY_SNAPSHOT",

      recordVersion:
        "2",

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
      hashShotCharacterContinuitySnapshotV2(
        snapshot,
      ),
  });
}
