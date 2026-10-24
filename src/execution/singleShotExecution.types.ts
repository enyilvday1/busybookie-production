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
  DialogueVisualAuthorization,
} from "./dialogueVisualAuthorization.schema.js";

import type {
  ExecutionReservationInput,
} from "./executionReservation.schema.js";

import type {
  ExecutionSubmissionInput,
} from "./executionSubmission.schema.js";

export type PaidExecutionProvider =
  | "RUNWAY"
  | "VEO";

export type SingleShotSubmissionAcceptance =
  | Readonly<{
      provider:
        "RUNWAY";

      providerExecutionId:
        string;

      providerEstimatedCredits:
        number;

      recoveryMetadata:
        Extract<
          ExecutionSubmissionInput,
          { provider: "RUNWAY" }
        >["recoveryMetadata"];
    }>
  | Readonly<{
      provider:
        "VEO";

      providerExecutionId:
        string;

      recoveryMetadata:
        Extract<
          ExecutionSubmissionInput,
          { provider: "VEO" }
        >["recoveryMetadata"];
    }>;

export type SingleShotSubmissionAcceptedHandler =
  (
    acceptance:
      SingleShotSubmissionAcceptance,
  ) =>
    Promise<void>;

export type DialogueVisualAuthorizationReader =
  (
    mediaRoot:
      string,
    episodeId:
      string,
    shotId:
      string,
  ) =>
    Promise<
      DialogueVisualAuthorization | null
    >;

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

export type SingleShotVisualReferenceVerificationInput =
  Readonly<{
    mediaRoot:
      string;

    sourceImagePath:
      string;

    approvedAssetIds:
      readonly string[];
  }>;

export type SingleShotVisualReferenceVerificationResult =
  Readonly<{
    absolutePath:
      string;
  }>;

export type SingleShotVisualReferenceVerifier =
  (
    input:
      SingleShotVisualReferenceVerificationInput,
  ) =>
    Promise<
      SingleShotVisualReferenceVerificationResult
    >;

export type SingleShotExecutionDependencies =
  Readonly<{
    readDialogueVisualAuthorization?:
      DialogueVisualAuthorizationReader;

    verifyVisualReference?:
      SingleShotVisualReferenceVerifier;

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
