export { EpisodeAutomationError } from "./boundEpisodeProduction.types.js";
import { EpisodeAutomationError } from "./boundEpisodeProduction.types.js";
import { BoundEpisodeError, BoundEpisodeActionError, freezeBoundCopy, type BoundEpisodeActionResult, type ControlledEpisodeAutomationPlan } from "./boundEpisodeProduction.types.js";
import { buildBoundEpisodePreflight, episodeIssue } from "./buildBoundEpisodePreflight.js";
import { verifyEpisodeRuntimeIdentity } from "./episodeInputBinding.js";
import { acquireEpisodeExecutionGuard, releaseEpisodeExecutionGuard, createEpisodeInvocation, consumeFreshEpisodeOperatorSession,
  createCheckedEpisodeExecutionContext, assertReviewedEpisodeAction, type FreshEpisodeOperatorSession } from "./episodeExecutionGuard.js";
import {
  coordinateEpisodeAction,
  EpisodeActionPostStateResolutionError,
  type CoordinateEpisodeActionResult,
  type EpisodeCoordinatorAction,
} from "./coordinateEpisodeAction.js";

import {
  parseEpisodeAutomationPlan,
} from "./episodeAutomationPlan.schema.js";

import type {
  DurableEpisodeProductionState,
} from "./resolveDurableEpisodeProductionState.js";

// C7: run an operator's explicit plan strictly in order, one C6b action at a
// time, stopping at the first failure. There is no ledger, cursor, retry,
// skip, automatic reconciliation or composition. A rerun starts at action 0.

export type RunEpisodeAutomationDependencies =
  Readonly<{
    coordinateAction:
      typeof coordinateEpisodeAction;
    buildPreflight?: typeof buildBoundEpisodePreflight;
    verifyRuntime?: typeof verifyEpisodeRuntimeIdentity;
  }>;

export type EpisodeAutomationResult =
  Readonly<{
    episodeId: string;
    results: readonly CoordinateEpisodeActionResult[];
    finalState: DurableEpisodeProductionState;
  }>;
export type ControlledEpisodeAutomationResult = BoundEpisodeActionResult;

export type EpisodeAutomationFailedActionOutcome =
  | "COMPLETED_STATE_UNRESOLVED"
  | "UNKNOWN";

const defaultDependencies:
  RunEpisodeAutomationDependencies =
    Object.freeze({
      coordinateAction:
        coordinateEpisodeAction,
    });

// UNKNOWN means only that C6b did not report a completed action; it is not
// evidence that the failed action had no durable or provider effects.
export async function runEpisodeAutomation(
  input:
    unknown,

  dependencies:
    RunEpisodeAutomationDependencies =
      defaultDependencies,
  freshOperatorSession?: FreshEpisodeOperatorSession,
): Promise<EpisodeAutomationResult | ControlledEpisodeAutomationResult> {
  // Complete structural validation before the first coordinator call, even
  // when a CLI already validated: this is the public runtime boundary.
  const plan =
    parseEpisodeAutomationPlan(
      input,
    );

  if (plan.schemaVersion === "2.0") {
    return runControlledEpisodeAutomation(plan, dependencies, freshOperatorSession);
  }
  if (plan.actions.some(action => action.kind === "VISUAL_GENERATE" || action.kind === "VISUAL_RECONCILE")) {
    throw new BoundEpisodeError("LEGACY_VISUAL_PLAN_REQUIRES_CONVERSION");
  }

  const results:
    CoordinateEpisodeActionResult[] =
      [];

  for (
    const [
      index,
      action,
    ]
    of plan.actions.entries()
  ) {
    let result:
      CoordinateEpisodeActionResult;

    try {
      result =
        await dependencies
          .coordinateAction({
            episodeId:
              plan.episodeId,
            action,
          });
    } catch (error) {
      throw new EpisodeAutomationError({
        episodeId:
          plan.episodeId,
        failedActionIndex:
          index,
        failedAction:
          action,
        completedResults:
          results,
        cause:
          error,
      });
    }

    results.push(
      result,
    );
  }

  const lastResult =
    results[
      results.length -
        1
    ];

  // A validated plan is nonempty, so a full success always has a last result.
  if (
    lastResult ===
    undefined
  ) {
    throw new Error(
      "Episode automation completed without any action result.",
    );
  }

  return Object.freeze({
    episodeId:
      plan.episodeId,
    results:
      Object.freeze(
        results,
      ),
    finalState:
      lastResult.afterState,
  });
}

async function runControlledEpisodeAutomation(plan: ControlledEpisodeAutomationPlan,
  dependencies: RunEpisodeAutomationDependencies, session?: FreshEpisodeOperatorSession): Promise<BoundEpisodeActionResult> {
  const action = plan.actions[0];
  const sessionId = consumeFreshEpisodeOperatorSession(session, action.kind === "VISUAL_GENERATE" ? "GENERATION" : "RECONCILIATION");
  const manifest = plan.inputBinding.fileBindings.find(file => file.role === "MANIFEST");
  if (!manifest?.rawSha256) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  const runtime = plan.inputBinding.runtimeIdentity;
  const verifyRuntime = dependencies.verifyRuntime ?? verifyEpisodeRuntimeIdentity;
  await verifyRuntime(runtime, true);
  const guard = await acquireEpisodeExecutionGuard({ episodeId: plan.episodeId, mediaRoot: runtime.mediaRoot,
    manifestRawSha256: manifest.rawSha256, sessionId });
  let result: BoundEpisodeActionResult | undefined;
  let originalFailure: unknown; let failed = false;
  try {
    const preflight = dependencies.buildPreflight ?? buildBoundEpisodePreflight;
    const beforePlan = await preflight({ episodeId: plan.episodeId, scope: plan.scope, mediaRoot: runtime.mediaRoot,
      runtimeIdentity: runtime, expectedBinding: plan.inputBinding, evidenceAdoptions: plan.evidenceAdoptions,
      ...(runtime.ffprobe ? { ffprobeExecutable: runtime.ffprobe.canonicalPath } : {}) });
    try { assertReviewedEpisodeAction(plan, beforePlan); }
    catch (cause) {
      if (!(cause instanceof BoundEpisodeError)) throw cause;
      result = freezeBoundCopy({ episodeId: plan.episodeId, action, beforePlan, afterPlan: null, status: "REJECTED", stopReason: cause.code,
        dispatchAllowanceConsumed: 0, observedNewCreateCount: 0, recoveryDispatchCount: 0, visualCompletion: "INCOMPLETE",
        handoff: beforePlan.handoff, remainingWork: beforePlan.remainingWork, actionMayHaveEffects: false,
        issues: [episodeIssue(cause.code, { episodeId: action.episodeId, sceneId: action.sceneId, shotId: action.shotId, order: action.order }, "ADMISSION", cause)] });
      return result;
    }
    const invocation = createEpisodeInvocation(plan.episodeId, plan.maximumNewProviderCreates);
    const controlledContext = await createCheckedEpisodeExecutionContext({ plan, beforePlan, guard, invocation, preflight, verifyRuntime });
    // Exactly one C6b delegation. No loop, no fallback, no second recovery and
    // no implicit advancement to a different frontier after a stale action.
    result = await dependencies.coordinateAction({ episodeId: plan.episodeId, action, controlledContext });
    return result;
  } catch (cause) { originalFailure = cause; failed = true; throw cause; }
  finally {
    try { await releaseEpisodeExecutionGuard(guard); }
    catch (ownershipCause) {
      const observed = originalFailure instanceof BoundEpisodeActionError ? originalFailure.result : result;
      if (observed) {
        const ownershipFailure = freezeBoundCopy({ ...observed, status: "UNRESOLVED" as const,
          stopReason: "EPISODE_OWNERSHIP_CONFLICT" as const, issues: [...observed.issues,
            episodeIssue("EPISODE_OWNERSHIP_CONFLICT", { episodeId: action.episodeId, sceneId: action.sceneId, shotId: action.shotId, order: action.order },
              "OWNERSHIP", ownershipCause, observed.actionMayHaveEffects)] });
        throw new BoundEpisodeActionError(ownershipFailure, failed ? originalFailure : ownershipCause, ownershipCause);
      }
      throw new BoundEpisodeError("EPISODE_OWNERSHIP_CONFLICT", { cause: failed
        ? new AggregateError([originalFailure, ownershipCause], "Action and owner release both failed.") : ownershipCause });
    }
  }
}
