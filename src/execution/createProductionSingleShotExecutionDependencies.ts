import {
  createExecutionCompletion,
} from "./createExecutionCompletion.js";
import { readCheckedEpisodeJson, recheckEpisodeExecutionBindings, assertCheckedEpisodeAdmission,
  type CheckedEpisodeExecutionContext } from "./episodeExecutionGuard.js";
import { BoundEpisodeError } from "./boundEpisodeProduction.types.js";
import { RunwayPolicySchema } from "../schemas/runwayPolicy.schema.js";
import { VeoPolicySchema } from "../schemas/veoPolicy.schema.js";
import { GoogleGenAiPolicySchema } from "../schemas/googleGenAiPolicy.schema.js";
import { GoogleGenAiActivationPolicySchema } from "../schemas/googleGenAiActivationPolicy.schema.js";
import { DialogueVisualAuthorizationSchema } from "./dialogueVisualAuthorization.schema.js";
import { VisualReferenceAssetRegistrySchema } from "./visualReferenceAsset.schema.js";
import { verifyApprovedVisualReferenceAsset } from "./verifyApprovedVisualReferenceAsset.js";
import { createRunwayClient } from "../runway/createRunwayClient.js";
import { createVeoClient } from "../veo/createVeoClient.js";
import { buildRunwayGen45Prompt } from "../runway/cli/buildRunwayGen45Prompt.js";
import { buildVeoPrompt } from "../veo/cli/buildVeoPrompt.js";
import { createRunwaySingleShotProductionTransactionRunner } from "./providers/createRunwaySingleShotProductionTransactionRunner.js";
import { createVeoSingleShotProductionTransactionRunner } from "./providers/createVeoSingleShotProductionTransactionRunner.js";
import { executeRunwaySingleShot } from "./providers/executeRunwaySingleShot.js";
import { executeVeoSingleShot } from "./providers/executeVeoSingleShot.js";

import {
  createExecutionReservation,
} from "./createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "./createExecutionSubmission.js";

import {
  createGoogleGenAiOperatorProductionDependencies,
} from "./createGoogleGenAiOperatorProductionDependencies.js";

import {
  executeGoogleGenAiOperatorSingleShot,
  executeGoogleGenAiVisualAttemptSingleShot,
  GOOGLE_GENAI_OPERATOR_RESOLUTION,
} from "./executeGoogleGenAiOperatorSingleShot.js";

import type {
  GoogleGenAiOperatorPolicies,
  GoogleGenAiVisualAttemptExecuteRequest,
  GoogleGenAiVisualAttemptExecuteResult,
} from "./executeGoogleGenAiOperatorSingleShot.js";

import {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import {
  inspectVisualAttemptExecutionLifecycle,
} from "./inspectVisualAttemptExecutionLifecycle.js";

import {
  createVisualAttemptExecutionReservation,
} from "./createVisualAttemptExecutionReservation.js";

import {
  createVisualAttemptExecutionSubmission,
} from "./createVisualAttemptExecutionSubmission.js";

import {
  loadGoogleGenAiActivationPolicy,
} from "../validation/loadGoogleGenAiActivationPolicy.js";

import {
  loadGoogleGenAiPolicy,
} from "../validation/loadGoogleGenAiPolicy.js";

import {
  readDialogueVisualAuthorization,
} from "./readDialogueVisualAuthorization.js";

import {
  createProductionVisualReferenceVerifier,
} from "./createProductionVisualReferenceVerifier.js";

import {
  prepareRunwaySingleShotProductionExecutor,
} from "./providers/createRunwaySingleShotProductionExecutor.js";

import {
  prepareVeoSingleShotProductionExecutor,
} from "./providers/createVeoSingleShotProductionExecutor.js";

import type {
  SingleShotExecutionDependencies,
  SingleShotProviderExecutor,
} from "./singleShotExecution.types.js";

export type ProductionSingleShotExecutionCredentialSource =
  Readonly<{
    RUNWAYML_API_SECRET?:
      string;

    GEMINI_API_KEY?:
      string;
  }>;

export type ProductionSingleShotExecutionCompositionDependencies =
  Readonly<{
    readDialogueVisualAuthorization?:
      NonNullable<
        SingleShotExecutionDependencies[
          "readDialogueVisualAuthorization"
        ]
      >;

    verifyVisualReference?:
      NonNullable<
        SingleShotExecutionDependencies[
          "verifyVisualReference"
        ]
      >;

    createReservation:
      SingleShotExecutionDependencies[
        "createReservation"
      ];

    createSubmission:
      SingleShotExecutionDependencies[
        "createSubmission"
      ];

    createCompletion:
      SingleShotExecutionDependencies[
        "createCompletion"
      ];

    prepareRunwayExecutor:
      typeof prepareRunwaySingleShotProductionExecutor;

    prepareVeoExecutor:
      typeof prepareVeoSingleShotProductionExecutor;

    // B5C-X1 seams for the existing Google orchestrator; production defaults
    // below. None of them is invoked until a GOOGLE_GENAI execution runs.
    loadGooglePolicies?:
      () => Promise<GoogleGenAiOperatorPolicies>;

    prepareGoogleInteraction?:
      typeof createGoogleGenAiOperatorProductionDependencies;

    submitGoogle?:
      typeof executeGoogleGenAiOperatorSingleShot;
  }>;

async function loadProductionGooglePolicies(): Promise<GoogleGenAiOperatorPolicies> {
  const [
    activationPolicy,
    googlePolicy,
  ] = await Promise.all([
    loadGoogleGenAiActivationPolicy(),
    loadGoogleGenAiPolicy(),
  ]);

  return {
    activationPolicy,
    googlePolicy,
  };
}

function requireBound<T>(value: T | null): T {
  if (value === null) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  return value;
}

// Checked mode: the Google policies are the reviewed bound files only.
async function loadCheckedGooglePolicies(checkedContext: CheckedEpisodeExecutionContext): Promise<GoogleGenAiOperatorPolicies> {
  return {
    activationPolicy: requireBound(await readCheckedEpisodeJson(checkedContext, "GOOGLE_ACTIVATION", value => GoogleGenAiActivationPolicySchema.parse(value))),
    googlePolicy: requireBound(await readCheckedEpisodeJson(checkedContext, "GOOGLE_POLICY", value => GoogleGenAiPolicySchema.parse(value))),
  };
}

// Checked mode: the reviewed registry, after every bound input is rechecked.
function createCheckedVisualReferenceVerifier(checkedContext: CheckedEpisodeExecutionContext): NonNullable<SingleShotExecutionDependencies["verifyVisualReference"]> {
  const verifier = createProductionVisualReferenceVerifier({
    readRegistry: async () => requireBound(await readCheckedEpisodeJson(checkedContext, "REFERENCE_REGISTRY", value => VisualReferenceAssetRegistrySchema.parse(value))),
    verifyAsset: verifyApprovedVisualReferenceAsset,
  });
  return async request => { await recheckEpisodeExecutionBindings(checkedContext); return verifier(request); };
}

// The credential is read only here, which the orchestrators call after their
// activation, confirmation and admission checks.
function prepareGoogleSubmission(
  credentialSource:
    ProductionSingleShotExecutionCredentialSource,
  prepareGoogleInteraction:
    typeof createGoogleGenAiOperatorProductionDependencies | undefined,
): Readonly<{ createInteraction: ReturnType<typeof createGoogleGenAiOperatorProductionDependencies>["createInteraction"] }> {
  const apiKey =
    credentialSource
      .GEMINI_API_KEY;

  if (
    apiKey ===
    undefined
  ) {
    throw new Error(
      "GEMINI_API_KEY is not configured.",
    );
  }

  return {
    createInteraction:
      (
        prepareGoogleInteraction ??
        createGoogleGenAiOperatorProductionDependencies
      )(
        apiKey,
      ).createInteraction,
  };
}

const defaultDependencies:
  ProductionSingleShotExecutionCompositionDependencies =
  Object.freeze({
    readDialogueVisualAuthorization:
      readDialogueVisualAuthorization,

    verifyVisualReference:
      createProductionVisualReferenceVerifier(),

    createReservation:
      createExecutionReservation,

    createSubmission:
      createExecutionSubmission,

    createCompletion:
      createExecutionCompletion,

    prepareRunwayExecutor:
      prepareRunwaySingleShotProductionExecutor,

    prepareVeoExecutor:
      prepareVeoSingleShotProductionExecutor,
  });

export function createProductionSingleShotExecutionDependencies(
  credentialSource:
    ProductionSingleShotExecutionCredentialSource,

  dependencies:
    ProductionSingleShotExecutionCompositionDependencies =
      defaultDependencies,
  checkedContext?: CheckedEpisodeExecutionContext,
): SingleShotExecutionDependencies {
  if (checkedContext) {
    const original = dependencies;
    const required = requireBound;
    dependencies = {
      ...original,
      readDialogueVisualAuthorization: async (_root, _episode, shotId) =>
        readCheckedEpisodeJson(checkedContext, `AUTHORIZATION:${shotId}`, value => DialogueVisualAuthorizationSchema.parse(value)),
      verifyVisualReference: createCheckedVisualReferenceVerifier(checkedContext),
      createReservation: async (root, request) => {
        await assertCheckedEpisodeAdmission(checkedContext);
        return original.createReservation(root, request);
      },
      prepareRunwayExecutor: credentials => original.prepareRunwayExecutor(credentials, {
        loadPolicy: async () => required(await readCheckedEpisodeJson(checkedContext, "RUNWAY_POLICY", value => RunwayPolicySchema.parse(value))),
        createClient: createRunwayClient, buildPrompt: buildRunwayGen45Prompt, executeAdapter: executeRunwaySingleShot,
        createTransactionRunner: client => {
          const run = createRunwaySingleShotProductionTransactionRunner(client);
          return async (...args) => { await recheckEpisodeExecutionBindings(checkedContext); return run(...args); };
        },
      }),
      prepareVeoExecutor: credentials => original.prepareVeoExecutor(credentials, {
        loadPolicy: async () => required(await readCheckedEpisodeJson(checkedContext, "VEO_POLICY", value => VeoPolicySchema.parse(value))),
        createClient: createVeoClient, buildPrompt: buildVeoPrompt, executeAdapter: executeVeoSingleShot,
        createTransactionRunner: client => {
          const run = createVeoSingleShotProductionTransactionRunner(client);
          return async (...args) => { await recheckEpisodeExecutionBindings(checkedContext); return run(...args); };
        },
      }),
      loadGooglePolicies: () => loadCheckedGooglePolicies(checkedContext),
      submitGoogle: (request, googleDependencies) => (original.submitGoogle ?? executeGoogleGenAiOperatorSingleShot)(request, googleDependencies, checkedContext),
    };
  }
  let runwayExecutorPromise:
    Promise<SingleShotProviderExecutor> | null =
    null;

  let veoExecutorPromise:
    Promise<SingleShotProviderExecutor> | null =
    null;

  const getRunwayExecutor =
    (): Promise<SingleShotProviderExecutor> => {
      if (!runwayExecutorPromise) {
        const runwayCredentialSource:
          Parameters<
            typeof prepareRunwaySingleShotProductionExecutor
          >[0] =
          credentialSource
            .RUNWAYML_API_SECRET ===
              undefined
            ? {}
            : {
                RUNWAYML_API_SECRET:
                  credentialSource
                    .RUNWAYML_API_SECRET,
              };

        runwayExecutorPromise =
          dependencies
            .prepareRunwayExecutor(
              runwayCredentialSource,
            );
      }

      return runwayExecutorPromise;
    };

  const getVeoExecutor =
    (): Promise<SingleShotProviderExecutor> => {
      if (!veoExecutorPromise) {
        veoExecutorPromise =
          dependencies
            .prepareVeoExecutor(
              credentialSource
                .GEMINI_API_KEY ??
                "",
            );
      }

      return veoExecutorPromise;
    };

  const createReservation:
    SingleShotExecutionDependencies[
      "createReservation"
    ] =
    async (
      mediaRoot,
      reservationInput,
    ) => {
      if (
        reservationInput
          .provider ===
        "RUNWAY"
      ) {
        await getRunwayExecutor();
      } else if (
        reservationInput
          .provider ===
        "VEO"
      ) {
        await getVeoExecutor();
      }

      return dependencies
        .createReservation(
          mediaRoot,
          reservationInput,
        );
    };

  const executeRunway:
    SingleShotProviderExecutor =
    async (
      input,
    ) => {
      const executor =
        await getRunwayExecutor();

      return executor(
        input,
      );
    };

  const executeVeo:
    SingleShotProviderExecutor =
    async (
      input,
    ) => {
      const executor =
        await getVeoExecutor();

      return executor(
        input,
      );
    };

  const verifyVisualReference =
    dependencies
      .verifyVisualReference ??
    createProductionVisualReferenceVerifier();

  // B5C-X1: the only shared route to the existing Google orchestrator. The
  // credential is read only inside prepareSubmission, which the orchestrator
  // calls after its activation, confirmation and admission checks.
  const executeGoogleSubmission:
    NonNullable<
      SingleShotExecutionDependencies[
        "executeGoogleSubmission"
      ]
    > =
    (
      request,
    ) =>
      (
        dependencies.submitGoogle ??
        executeGoogleGenAiOperatorSingleShot
      )(
        {
          ...request,
          resolution:
            GOOGLE_GENAI_OPERATOR_RESOLUTION,
        },
        {
          loadPolicies:
            dependencies.loadGooglePolicies ??
            loadProductionGooglePolicies,

          prepareSubmission:
            () =>
              prepareGoogleSubmission(
                credentialSource,
                dependencies.prepareGoogleInteraction,
              ),

          inspectLifecycle:
            inspectExecutionLifecycle,

          verifyVisualReference,

          createReservation:
            dependencies
              .createReservation,

          createSubmission:
            dependencies
              .createSubmission,
        },
      );

  return Object.freeze({
    readDialogueVisualAuthorization:
      dependencies
        .readDialogueVisualAuthorization ??
      readDialogueVisualAuthorization,

    verifyVisualReference,

    createReservation,

    createSubmission:
      dependencies
        .createSubmission,

    createCompletion:
      dependencies
        .createCompletion,

    executeRunway,
    executeVeo,
    executeGoogleSubmission,
  });
}

// B5 Slice-2I-B: the single shared attempt-mode composition point. The caller
// supplies no lineage; the request carries only the reviewed identity.
export type ProductionVisualAttemptRequest =
  Omit<GoogleGenAiVisualAttemptExecuteRequest, "resolution">;

export type ProductionVisualAttemptCompositionDependencies =
  Readonly<{
    prepareGoogleInteraction?:
      typeof createGoogleGenAiOperatorProductionDependencies;

    executeAttempt?:
      typeof executeGoogleGenAiVisualAttemptSingleShot;
  }>;

// Composes the existing attempt orchestrator from the checked Google policy,
// credential and reference composition above plus the existing attempt
// inspector and create-once attempt writers. The orchestrator keeps every
// attempt lifecycle, manifest, reference, cost and single-create gate and
// stops at SUBMITTED; nothing here retries, falls back or writes a completion.
export function executeProductionVisualAttemptSingleShot(
  credentialSource:
    ProductionSingleShotExecutionCredentialSource,

  request:
    ProductionVisualAttemptRequest,

  checkedContext:
    CheckedEpisodeExecutionContext,

  dependencies:
    ProductionVisualAttemptCompositionDependencies =
      {},
): Promise<GoogleGenAiVisualAttemptExecuteResult> {
  return (
    dependencies.executeAttempt ??
    executeGoogleGenAiVisualAttemptSingleShot
  )(
    {
      ...request,
      resolution:
        GOOGLE_GENAI_OPERATOR_RESOLUTION,
    },
    {
      loadPolicies:
        () =>
          loadCheckedGooglePolicies(
            checkedContext,
          ),

      prepareSubmission:
        () =>
          prepareGoogleSubmission(
            credentialSource,
            dependencies.prepareGoogleInteraction,
          ),

      inspectVisualAttemptLifecycle:
        inspectVisualAttemptExecutionLifecycle,

      verifyVisualReference:
        createCheckedVisualReferenceVerifier(
          checkedContext,
        ),

      // As for the checked shared reservation: the reviewed attempt must
      // still be admitted immediately before its durable reservation.
      createVisualAttemptReservation:
        async (...args) => {
          await assertCheckedEpisodeAdmission(checkedContext);
          return createVisualAttemptExecutionReservation(...args);
        },

      createVisualAttemptSubmission:
        createVisualAttemptExecutionSubmission,
    },
    checkedContext,
  );
}
