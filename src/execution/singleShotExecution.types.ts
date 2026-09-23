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
  CreateExecutionReservationResult,
} from "./createExecutionReservation.js";

import type {
  ExecutionReservationInput,
} from "./executionReservation.schema.js";

export type PaidExecutionProvider =
  ExecutionReservationInput[
    "provider"
  ];

export type SingleShotExecutionRequest =
  Readonly<{
    episode: EpisodeManifest;
    shotId: string;

    bible: CharacterBible;
    rules: ProductionRules;
    policy: ProviderRoutingPolicy;

    mediaRoot: string;
    sourceImagePath: string;

    confirmPaidGeneration:
      boolean;
  }>;

export type SingleShotProviderExecutionInput =
  Readonly<{
    episode: EpisodeManifest;
    shot: Shot;

    readiness:
      ShotExecutionReadiness;

    mediaRoot: string;
    sourceImagePath: string;

    reservation:
      CreateExecutionReservationResult;
  }>;

export type SingleShotProviderExecutionResult =
  Readonly<{
    providerExecutionId:
      string;

    recordPath:
      string;
  }>;

export type ExecutionReservationCreator =
  (
    mediaRoot: string,
    input:
      ExecutionReservationInput,
  ) =>
    Promise<
      CreateExecutionReservationResult
    >;

export type SingleShotProviderExecutor =
  (
    input:
      SingleShotProviderExecutionInput,
  ) =>
    Promise<
      SingleShotProviderExecutionResult
    >;

export type SingleShotExecutionDependencies =
  Readonly<{
    createReservation:
      ExecutionReservationCreator;

    executeRunway:
      SingleShotProviderExecutor;

    executeVeo:
      SingleShotProviderExecutor;
  }>;

export type SingleShotExecutionResult =
  Readonly<{
    provider:
      PaidExecutionProvider;

    readiness:
      ShotExecutionReadiness;

    reservation:
      CreateExecutionReservationResult;

    providerExecution:
      SingleShotProviderExecutionResult;
  }>;
