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
  CreateExecutionCompletionResult,
} from "./createExecutionCompletion.js";

import type {
  CreateExecutionReservationResult,
} from "./createExecutionReservation.js";

import type {
  CreateExecutionSubmissionResult,
} from "./createExecutionSubmission.js";

import type {
  ExecutionCompletionInput,
} from "./executionCompletion.schema.js";

import type {
  ExecutionReservationInput,
} from "./executionReservation.schema.js";

import type {
  ExecutionSubmissionInput,
} from "./executionSubmission.schema.js";

export type PaidExecutionProvider =
  ExecutionReservationInput[
    "provider"
  ];

export type SingleShotSubmissionAcceptance =
  | Readonly<{
      provider:
        "RUNWAY";

      providerExecutionId:
        string;

      providerEstimatedCredits:
        number;
    }>
  | Readonly<{
      provider:
        "VEO";

      providerExecutionId:
        string;
    }>;

export type SingleShotSubmissionAcceptedHandler =
  (
    acceptance:
      SingleShotSubmissionAcceptance,
  ) =>
    Promise<void>;

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

    onSubmissionAccepted:
      SingleShotSubmissionAcceptedHandler;
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

export type ExecutionSubmissionCreator =
  (
    mediaRoot: string,
    input:
      ExecutionSubmissionInput,
  ) =>
    Promise<
      CreateExecutionSubmissionResult
    >;

export type ExecutionCompletionCreator =
  (
    mediaRoot: string,
    input:
      ExecutionCompletionInput,
  ) =>
    Promise<
      CreateExecutionCompletionResult
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

    createSubmission:
      ExecutionSubmissionCreator;

    createCompletion:
      ExecutionCompletionCreator;

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

    submission:
      CreateExecutionSubmissionResult;

    providerExecution:
      SingleShotProviderExecutionResult;

    completion:
      CreateExecutionCompletionResult;
  }>;
