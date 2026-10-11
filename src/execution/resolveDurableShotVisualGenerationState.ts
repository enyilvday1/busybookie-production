import {
  resolve,
} from "node:path";

import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import type {
  ShotExecutionReadiness,
} from "../planning/executionReadiness.types.js";

import type {
  ExecutionLifecycleClassification,
} from "./classifyExecutionLifecycle.js";

import {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import {
  readDialogueVisualAuthorization,
} from "./readDialogueVisualAuthorization.js";

import {
  readVisualReferenceAssetRegistry,
} from "./readVisualReferenceAssetRegistry.js";

import {
  resolveDurableShotExecutionReadiness,
} from "./resolveDurableShotExecutionReadiness.js";

import type {
  DialogueVisualAuthorizationReader,
  PaidExecutionProvider,
} from "./singleShotExecution.types.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "./verifyApprovedVisualReferenceAsset.js";

export type ResolveDurableShotVisualGenerationStateInput =
  Readonly<{
    episode: EpisodeManifest;
    shot: Shot;
    bible: CharacterBible;
    rules: ProductionRules;
    policy: ProviderRoutingPolicy;
    mediaRoot: string;
  }>;

export type ResolveDurableShotVisualGenerationStateDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectExecutionLifecycle;

    readDialogueVisualAuthorization:
      DialogueVisualAuthorizationReader;

    readRegistry:
      typeof readVisualReferenceAssetRegistry;

    verifyReference:
      typeof verifyApprovedVisualReferenceAsset;
  }>;

type ExecutionLifecycleState<
  S extends ExecutionLifecycleClassification["state"],
> =
  Extract<
    ExecutionLifecycleClassification,
    { state: S }
  >;

export type DurableShotVisualGenerationState =
  | Readonly<{
      state: "RESERVED_ONLY_INTERVENTION_REQUIRED";
      episodeId: string;
      shotId: string;
      lifecycle: ExecutionLifecycleState<"RESERVED_ONLY">;
    }>
  | Readonly<{
      state: "SUBMITTED_RECONCILIATION_REQUIRED";
      episodeId: string;
      shotId: string;
      lifecycle: ExecutionLifecycleState<"SUBMITTED">;
    }>
  | Readonly<{
      state: "LIFECYCLE_COMPLETED";
      episodeId: string;
      shotId: string;
      lifecycle: ExecutionLifecycleState<"COMPLETED">;
    }>
  | Readonly<{
      state: "CANONICAL_NOT_EXECUTABLE";
      episodeId: string;
      shotId: string;
      readiness: ShotExecutionReadiness;
    }>
  | Readonly<{
      state: "VISUAL_AUTHORIZATION_REQUIRED";
      episodeId: string;
      shotId: string;
      readiness: ShotExecutionReadiness;
    }>
  | Readonly<{
      state: "REFERENCE_UNAVAILABLE";
      episodeId: string;
      shotId: string;
      readiness: ShotExecutionReadiness;
      provider: PaidExecutionProvider;
    }>
  | Readonly<{
      state: "REFERENCE_SELECTION_REQUIRED";
      episodeId: string;
      shotId: string;
      readiness: ShotExecutionReadiness;
      provider: PaidExecutionProvider;
      candidateAssetIds: readonly string[];
    }>
  | Readonly<{
      state: "READY_FOR_GENERATION";
      episodeId: string;
      shotId: string;
      readiness: ShotExecutionReadiness;
      provider: PaidExecutionProvider;
      reference: Readonly<{
        assetId: string;
        absolutePath: string;
      }>;
    }>;

// Every default only reads durable evidence. C1 keeps its own no-default
// reader contract; this resolver forwards its reader explicitly.
const defaultDependencies:
  ResolveDurableShotVisualGenerationStateDependencies =
    Object.freeze({
      inspectLifecycle:
        inspectExecutionLifecycle,

      readDialogueVisualAuthorization,

      readRegistry:
        readVisualReferenceAssetRegistry,

      verifyReference:
        verifyApprovedVisualReferenceAsset,
    });

export async function resolveDurableShotVisualGenerationState(
  input:
    ResolveDurableShotVisualGenerationStateInput,

  dependencies:
    ResolveDurableShotVisualGenerationStateDependencies =
      defaultDependencies,
): Promise<DurableShotVisualGenerationState> {
  const episodeId =
    input.episode.episodeId;

  const shotId =
    input.shot.id;

  // Durable execution evidence takes precedence over every pre-generation
  // gate, so an existing execution can never be re-admitted for generation.
  const lifecycle =
    await dependencies
      .inspectLifecycle(
        input.mediaRoot,
        episodeId,
        shotId,
      );

  if (
    lifecycle.state !==
    "NOTHING"
  ) {
    if (
      lifecycle.reservation.episodeId !==
        episodeId ||
      lifecycle.reservation.shotId !==
        shotId
    ) {
      throw new Error(
        `Execution lifecycle evidence for ${episodeId}/${shotId} belongs to ${lifecycle.reservation.episodeId}/${lifecycle.reservation.shotId}.`,
      );
    }

    switch (
      lifecycle.state
    ) {
      case "RESERVED_ONLY":
        return Object.freeze({
          state:
            "RESERVED_ONLY_INTERVENTION_REQUIRED",
          episodeId,
          shotId,
          lifecycle,
        });

      case "SUBMITTED":
        return Object.freeze({
          state:
            "SUBMITTED_RECONCILIATION_REQUIRED",
          episodeId,
          shotId,
          lifecycle,
        });

      case "COMPLETED":
        return Object.freeze({
          state:
            "LIFECYCLE_COMPLETED",
          episodeId,
          shotId,
          lifecycle,
        });
    }
  }

  const readiness =
    await resolveDurableShotExecutionReadiness(
      input,
      {
        readDialogueVisualAuthorization:
          dependencies
            .readDialogueVisualAuthorization,
      },
    );

  if (
    readiness.disposition !==
    "EXECUTABLE"
  ) {
    // Routing MANUAL_REVIEW is the dialogue branch whose durable
    // authorization C1 consulted and found absent.
    if (
      readiness.disposition ===
        "MANUAL_REVIEW" &&
      readiness.routing.disposition ===
        "MANUAL_REVIEW"
    ) {
      return Object.freeze({
        state:
          "VISUAL_AUTHORIZATION_REQUIRED",
        episodeId,
        shotId,
        readiness,
      });
    }

    return Object.freeze({
      state:
        "CANONICAL_NOT_EXECUTABLE",
      episodeId,
      shotId,
      readiness,
    });
  }

  const provider =
    readiness.executionProvider;

  if (
    provider !==
      "RUNWAY" &&
    provider !==
      "VEO"
  ) {
    throw new Error(
      `Shot ${episodeId}/${shotId} is EXECUTABLE without a supported paid execution provider.`,
    );
  }

  const assetIds =
    input.shot.references
      .assetIds;

  if (
    assetIds.length ===
    0
  ) {
    return Object.freeze({
      state:
        "REFERENCE_UNAVAILABLE",
      episodeId,
      shotId,
      readiness,
      provider,
    });
  }

  const registry =
    await dependencies
      .readRegistry(
        input.mediaRoot,
      );

  // Verify every candidate, in manifest order, with the unchanged strict
  // verifier; any integrity failure is a hard failure, never a selection.
  const verifiedPaths:
    string[] =
    [];

  for (
    const assetId
    of assetIds
  ) {
    const asset =
      registry.assets.find(
        (candidate) =>
          candidate.assetId ===
          assetId,
      );

    if (!asset) {
      throw new Error(
        `Approved visual reference asset ${assetId} for ${episodeId}/${shotId} is not registered.`,
      );
    }

    const verified =
      await dependencies
        .verifyReference({
          mediaRoot:
            input.mediaRoot,

          sourceImagePath:
            resolve(
              input.mediaRoot,
              ...asset
                .mediaRootRelativePath
                .split(
                  "/",
                ),
            ),

          approvedAssetIds:
            assetIds,

          registry,
        });

    verifiedPaths.push(
      verified.absolutePath,
    );
  }

  const [
    onlyAssetId,
  ] = assetIds;

  const [
    onlyVerifiedPath,
  ] = verifiedPaths;

  if (
    assetIds.length ===
      1 &&
    onlyAssetId !==
      undefined &&
    onlyVerifiedPath !==
      undefined
  ) {
    // Planning data only: executeSingleShot re-verifies before reservation.
    return Object.freeze({
      state:
        "READY_FOR_GENERATION",
      episodeId,
      shotId,
      readiness,
      provider,
      reference:
        Object.freeze({
          assetId:
            onlyAssetId,

          absolutePath:
            onlyVerifiedPath,
        }),
    });
  }

  return Object.freeze({
    state:
      "REFERENCE_SELECTION_REQUIRED",
    episodeId,
    shotId,
    readiness,
    provider,
    candidateAssetIds:
      Object.freeze([
        ...assetIds,
      ]),
  });
}
