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
  }>;

export type EpisodeAutomationResult =
  Readonly<{
    episodeId: string;
    results: readonly CoordinateEpisodeActionResult[];
    finalState: DurableEpisodeProductionState;
  }>;

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
export class EpisodeAutomationError extends Error {
  readonly episodeId:
    string;

  readonly failedActionIndex:
    number;

  readonly failedAction:
    EpisodeCoordinatorAction;

  readonly completedResults:
    readonly CoordinateEpisodeActionResult[];

  readonly failedActionOutcome:
    EpisodeAutomationFailedActionOutcome;

  constructor(
    input:
      Readonly<{
        episodeId: string;
        failedActionIndex: number;
        failedAction: EpisodeCoordinatorAction;
        completedResults: readonly CoordinateEpisodeActionResult[];
        cause: unknown;
      }>,
  ) {
    const failedActionOutcome:
      EpisodeAutomationFailedActionOutcome =
        input.cause instanceof
          EpisodeActionPostStateResolutionError
          ? "COMPLETED_STATE_UNRESOLVED"
          : "UNKNOWN";

    super(
      `Episode automation for ${input.episodeId} stopped at action index ${input.failedActionIndex} (zero-based, ${input.failedAction.kind}); outcome ${failedActionOutcome}; later actions were not attempted.`,
      {
        cause:
          input.cause,
      },
    );

    this.name =
      "EpisodeAutomationError";

    this.episodeId =
      input.episodeId;

    this.failedActionIndex =
      input.failedActionIndex;

    this.failedAction =
      input.failedAction;

    this.completedResults =
      Object.freeze([
        ...input.completedResults,
      ]);

    this.failedActionOutcome =
      failedActionOutcome;
  }
}

export async function runEpisodeAutomation(
  input:
    unknown,

  dependencies:
    RunEpisodeAutomationDependencies =
      defaultDependencies,
): Promise<EpisodeAutomationResult> {
  // Complete structural validation before the first coordinator call, even
  // when a CLI already validated: this is the public runtime boundary.
  const plan =
    parseEpisodeAutomationPlan(
      input,
    );

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
