import {
  constants,
} from "node:fs";

import {
  open,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  EpisodeActionPostStateResolutionError,
  type EpisodeCoordinatorAction,
} from "../coordinateEpisodeAction.js";

import {
  MAX_EPISODE_AUTOMATION_PLAN_BYTES,
  parseEpisodeAutomationPlan,
} from "../episodeAutomationPlan.schema.js";

import {
  EpisodeAutomationError,
  runEpisodeAutomation,
  type EpisodeAutomationResult,
} from "../runEpisodeAutomation.js";

import {
  parseEpisodeAutomationCliArgs,
} from "./episodeAutomationCliArgs.js";

export type RunEpisodeAutomationCliDependencies =
  Readonly<{
    // Reads only the operator-selected control-plane plan file.
    readPlanText:
      (absolutePath: string) => Promise<string>;

    runAutomation:
      typeof runEpisodeAutomation;

    writeStdout:
      (text: string) => void;
  }>;

// Bounded, read-only, regular-file-only, strict UTF-8 read of the plan file.
// The handle is always closed before this resolves, i.e. before execution.
export async function readEpisodeAutomationPlanText(
  absolutePath:
    string,
): Promise<string> {
  let handle:
    Awaited<ReturnType<typeof open>>;

  try {
    handle =
      await open(
        absolutePath,
        // O_NONBLOCK keeps a FIFO from blocking the open; it is undefined
        // (no-op) on Windows.
        constants.O_RDONLY |
          (constants.O_NONBLOCK ?? 0),
      );
  } catch (error) {
    throw new Error(
      `Could not open the episode automation plan file: ${absolutePath}`,
      {
        cause:
          error,
      },
    );
  }

  try {
    const stats =
      await handle.stat();

    if (!stats.isFile()) {
      throw new Error(
        `Episode automation plan path is not a regular file: ${absolutePath}`,
      );
    }

    // The bounded read below is authoritative; this only fails fast.
    if (
      stats.size >
      MAX_EPISODE_AUTOMATION_PLAN_BYTES
    ) {
      throw new Error(
        `Episode automation plan exceeds ${MAX_EPISODE_AUTOMATION_PLAN_BYTES} bytes.`,
      );
    }

    const buffer =
      Buffer.alloc(
        MAX_EPISODE_AUTOMATION_PLAN_BYTES +
          1,
      );

    let total =
      0;

    while (
      total <
      buffer.length
    ) {
      const {
        bytesRead,
      } =
        await handle.read(
          buffer,
          total,
          buffer.length -
            total,
          total,
        );

      if (
        bytesRead ===
        0
      ) {
        break;
      }

      total +=
        bytesRead;
    }

    if (
      total >
      MAX_EPISODE_AUTOMATION_PLAN_BYTES
    ) {
      throw new Error(
        `Episode automation plan exceeds ${MAX_EPISODE_AUTOMATION_PLAN_BYTES} bytes.`,
      );
    }

    try {
      // fatal: invalid UTF-8 throws instead of becoming U+FFFD.
      return new TextDecoder(
        "utf-8",
        {
          fatal:
            true,
        },
      ).decode(
        buffer.subarray(
          0,
          total,
        ),
      );
    } catch {
      throw new Error(
        "Episode automation plan is not valid UTF-8.",
      );
    }
  } finally {
    await handle.close();
  }
}

const defaultDependencies:
  RunEpisodeAutomationCliDependencies =
    Object.freeze({
      readPlanText:
        readEpisodeAutomationPlanText,

      runAutomation:
        runEpisodeAutomation,

      writeStdout:
        (text: string) => {
          process.stdout.write(
            text,
          );
        },
    });

function describeTarget(
  episodeId:
    string,

  action:
    EpisodeCoordinatorAction,
): string {
  const shot =
    `${episodeId}/${action.sceneId}/${action.shotId}`;

  return action.kind ===
      "DIALOGUE_GENERATE" ||
    action.kind ===
      "DIALOGUE_RECONCILE"
    ? `${shot} line ${action.dialogueLineId}`
    : shot;
}

function formatSuccessSummary(
  result:
    EpisodeAutomationResult,
): string {
  const lines =
    result.results.map(
      (entry, index) =>
        `  ${index + 1}. ${entry.action.kind} ${describeTarget(result.episodeId, entry.action)} -> ${entry.runner}`,
    );

  return [
    "",
    `===== Busybookie Episode Automation (${result.episodeId}) =====`,
    ...lines,
    `Total successful explicit actions: ${result.results.length}`,
    "The explicit automation plan finished: every listed action returned successfully.",
    "Composition was not attempted by episode automation.",
    "",
  ].join(
    "\n",
  );
}

export async function runEpisodeAutomationCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunEpisodeAutomationCliDependencies =
      defaultDependencies,
): Promise<void> {
  // 1. All argv before any file access.
  const options =
    parseEpisodeAutomationCliArgs(
      args,
    );

  // 2. Read the selected control file once.
  const text =
    await dependencies
      .readPlanText(
        resolve(
          process.cwd(),
          options.planPath,
        ),
      );

  // 3. Plain JSON; parser messages can quote content, so they are not kept.
  let document:
    unknown;

  try {
    document =
      JSON.parse(
        text,
      );
  } catch {
    throw new Error(
      "Episode automation plan is not valid JSON.",
    );
  }

  // 4. Complete structural validation before anything can execute.
  const plan =
    parseEpisodeAutomationPlan(
      document,
    );

  if (options.validateOnly) {
    dependencies
      .writeStdout(
        `Plan structurally valid; ${plan.actions.length} explicitly authorized actions; no execution performed.\n`,
      );

    return;
  }

  // 5. Exactly one sequential run; summary only after it has fully returned.
  const result =
    await dependencies
      .runAutomation(
        plan,
      );

  dependencies
    .writeStdout(
      formatSuccessSummary(
        result,
      ),
    );
}

function safeCauseMessage(
  cause:
    unknown,
): string | null {
  if (!(cause instanceof Error)) {
    return null;
  }

  const firstLine =
    cause.message
      .split(
        /\r?\n/,
      )[0] ??
    "";

  return firstLine.length >
    300
    ? `${firstLine.slice(0, 300)}...`
    : firstLine;
}

// Typed, structured stderr text for the thin script. Classification uses
// types and known fields only, never message text. No stacks or raw causes.
export function formatEpisodeAutomationCliError(
  error:
    unknown,
): string {
  if (
    error instanceof
    EpisodeAutomationError
  ) {
    const completed =
      error.completedResults.map(
        (entry, index) =>
          `  ${index + 1}. ${entry.action.kind} ${describeTarget(error.episodeId, entry.action)} -> ${entry.runner}`,
      );

    const outcomeLines =
      error.failedActionOutcome ===
        "COMPLETED_STATE_UNRESOLVED"
        ? [
            "Outcome: COMPLETED_STATE_UNRESOLVED - the action completed, but the resulting durable state could not be resolved.",
            "Inspect durable state (for example npm run execution:status) before deciding whether to resume with a new plan.",
          ]
        : [
            "Outcome: UNKNOWN - the action outcome may include durable effects.",
            "Inspect durable state before deciding whether to resume with a new plan.",
          ];

    const reason =
      error.failedActionOutcome ===
        "COMPLETED_STATE_UNRESOLVED" &&
      error.cause instanceof
        EpisodeActionPostStateResolutionError
        ? safeCauseMessage(
            error.cause.cause,
          )
        : safeCauseMessage(
            error.cause,
          );

    return [
      "",
      `Episode automation stopped for ${error.episodeId}.`,
      `Successful explicit actions before the failure: ${error.completedResults.length}`,
      ...completed,
      `Failed action: #${error.failedActionIndex + 1} ${error.failedAction.kind} ${describeTarget(error.episodeId, error.failedAction)}`,
      ...outcomeLines,
      ...(reason
        ? [
            `Reason: ${reason}`,
          ]
        : []),
      "Later actions in the plan were not attempted.",
    ].join(
      "\n",
    );
  }

  if (
    error instanceof
    Error
  ) {
    return `\nEpisode automation failed: ${safeCauseMessage(error) ?? "unknown error"}`;
  }

  return "\nEpisode automation failed with a non-error value.";
}
