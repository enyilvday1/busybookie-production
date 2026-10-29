import {
  constants,
} from "node:fs";

import {
  open,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import type {
  EpisodeCoordinatorAction,
} from "../coordinateEpisodeAction.js";

import {
  MAX_EPISODE_AUTOMATION_PLAN_BYTES,
  parseEpisodeAutomationPlan,
} from "../episodeAutomationPlan.schema.js";

import type {
  runEpisodeAutomation,
  EpisodeAutomationResult,
} from "../runEpisodeAutomation.js";
import { EpisodeActionPostStateResolutionError, EpisodeAutomationError, BoundEpisodeActionError, BoundEpisodeError } from "../boundEpisodeProduction.types.js";
import type { BoundEpisodeActionResult, BoundEpisodePreflight } from "../boundEpisodeProduction.types.js";
import { buildBoundEpisodePreflight } from "../buildBoundEpisodePreflight.js";
import { readEpisodeRuntimeIdentity } from "../episodeInputBinding.js";
import type { FreshEpisodeOperatorSession } from "../episodeExecutionGuard.js";

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
    buildPreflight?: typeof buildBoundEpisodePreflight;
    readRuntimeIdentity?: typeof readEpisodeRuntimeIdentity;
    setExitCode?: (code: 0 | 1) => void;
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
      async (...args) => (await import("../runEpisodeAutomation.js")).runEpisodeAutomation(...args),

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
    "LEGACY dialogue-only execution; outside controlled visual guarantees.",
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

export function formatBoundEpisodePreflight(report: BoundEpisodePreflight): string {
  const counts = Object.entries(report.counts.episode).map(([state, count]) => `${state}=${count}`).join(" ");
  return [
    `Busybookie controlled visual preflight: ${report.episodeId} — ${report.title}`,
    `Scope: ${report.scope.kind} (${report.scopeTotal ?? "unknown"}/${report.totalIntended ?? "unknown"} shots); inventory ${report.inventory.complete ? "complete" : "INCOMPLETE"}.`,
    counts,
    ...report.shots.map(row => `${row.order}. ${row.sceneId}/${row.shotId}${row.inScope ? "" : " [outside selected scope]"}: ${row.disposition}; lifecycle ${row.lifecycle.lifecycle}; provider ${row.durableProvider ?? row.resolvedProvider ?? row.manifestProvider}; ${row.primaryReason?.code ?? "no blocking reason"}; cost ${row.cost.status === "KNOWN" ? `${row.cost.modeledValue} ${row.cost.unit} (cap ${row.cost.perShotCap})` : "UNKNOWN"}; intent ${row.intentAlignment}; handoff ${row.handoffCompatibility}`),
    `Completion: ${report.completion}; intent alignment: ${report.intentAlignment}.`,
    `Next candidate: ${report.nextActionCandidate ? `${report.nextActionCandidate.kind} ${report.nextActionCandidate.sceneId}/${report.nextActionCandidate.shotId}` : "NONE"}. Explicit fresh authority is required for execution.`,
    `Binding SHA256: ${report.bindingSha256 ?? "unavailable"}; observations SHA256: ${report.observationsSha256}.`,
    `Ownership snapshot: ${report.ownership.observed}; no guard acquired by planning.`,
    ...report.costs.readyByNativeUnit.map(total => `READY modeled estimate: ${total.complete ? total.value : "INCOMPLETE_TOTAL"} ${total.unit} across ${total.count} shots; billingKnown=false.`),
    ...report.inventory.fatalReasons.map(issue => `Inventory issue: ${issue.code}.`),
    ...report.handoff.issues.map(issue => `Handoff: ${issue.target?.shotId ?? "episode"} ${issue.code}.`),
    "Use --json for the full immutable binding, reference and observation payloads. No production or editorial status was written.",
  ].join("\n") + "\n";
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

  const setExit = dependencies.setExitCode ?? ((code: 0 | 1) => { process.exitCode = code; });
  const report = (value: BoundEpisodePreflight | BoundEpisodeActionResult) => dependencies.writeStdout(options.json
    ? JSON.stringify(value) + "\n"
    : "shots" in value ? formatBoundEpisodePreflight(value)
    : [`Controlled visual action: ${value.status}; stop reason: ${value.stopReason ?? "none"}.`,
      `Dispatch allowance consumed: ${value.dispatchAllowanceConsumed}; observed new creates: ${value.observedNewCreateCount}; recovery calls: ${value.recoveryDispatchCount}.`,
      value.afterPlan ? formatBoundEpisodePreflight(value.afterPlan) : "Post-action preflight unavailable."].join("\n") + "\n");
  if (options.episodeId) {
    const mediaRoot = process.env.BUSYBOOKIE_MEDIA_ROOT;
    if (!mediaRoot) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    const runtimeIdentity = await (dependencies.readRuntimeIdentity ?? readEpisodeRuntimeIdentity)(process.cwd(), mediaRoot, process.env.BUSYBOOKIE_FFPROBE_PATH);
    const result = await (dependencies.buildPreflight ?? buildBoundEpisodePreflight)({ episodeId: options.episodeId,
      mediaRoot, runtimeIdentity, ...(process.env.BUSYBOOKIE_FFPROBE_PATH ? { ffprobeExecutable: process.env.BUSYBOOKIE_FFPROBE_PATH } : {}),
      ...(options.shotIds ? { scope: { kind: "SELECTED_SCOPE", shotIds: options.shotIds } } : {}) });
    report(result); setExit(result.completion === "INCOMPLETE" || !result.inventory.complete ? 1 : 0); return;
  }
  if (!options.planPath) throw new Error("--plan is required.");

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
        `Plan structurally valid (schema ${plan.schemaVersion}); ${plan.actions.length} actions; no production preflight or execution performed.\n`,
      );

    return;
  }

  if (options.planOnly) {
    if (plan.schemaVersion !== "2.0") throw new BoundEpisodeError("LEGACY_VISUAL_PLAN_REQUIRES_CONVERSION");
    const runtime = plan.inputBinding.runtimeIdentity;
    const result = await (dependencies.buildPreflight ?? buildBoundEpisodePreflight)({ episodeId: plan.episodeId, scope: plan.scope,
      mediaRoot: runtime.mediaRoot, runtimeIdentity: runtime, expectedBinding: plan.inputBinding,
      evidenceAdoptions: plan.evidenceAdoptions, ...(runtime.ffprobe ? { ffprobeExecutable: runtime.ffprobe.canonicalPath } : {}) });
    report(result); setExit(result.completion === "INCOMPLETE" || !result.inventory.complete ? 1 : 0); return;
  }
  let freshSession: FreshEpisodeOperatorSession | undefined;
  if (plan.schemaVersion === "2.0") {
    const family = plan.actions[0].kind === "VISUAL_GENERATE" ? "GENERATION" : "RECONCILIATION";
    if (options.confirmation !== family) throw new BoundEpisodeError("OPERATING_CONDITION_UNESTABLISHED");
    // Lazy import keeps dotenv, secured production factories and guard write
    // capabilities out of plan-only/structural-validation module loading.
    freshSession = (await import("../episodeExecutionGuard.js")).createFreshEpisodeOperatorSession(family, true);
  } else {
    if (options.json) throw new Error("Legacy dialogue execution has no controlled visual JSON result.");
    if (options.confirmation) throw new Error("Legacy dialogue execution does not accept visual confirmation flags.");
    if (plan.actions.some(action => action.kind === "VISUAL_GENERATE" || action.kind === "VISUAL_RECONCILE")) throw new BoundEpisodeError("LEGACY_VISUAL_PLAN_REQUIRES_CONVERSION");
  }

  // 5. Exactly one sequential run; summary only after it has fully returned.
  const result =
    await dependencies
      .runAutomation(
        plan,
        undefined,
        freshSession,
      );

  if (!("results" in result)) {
    report(result);
    setExit(result.status === "ACTION_COMPLETED" || (result.status === "NO_ACTION" && result.visualCompletion !== "INCOMPLETE") ? 0 : 1);
    return;
  }

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
  if (error instanceof BoundEpisodeActionError) return JSON.stringify(error.result);
  if (error instanceof BoundEpisodeError) return `Episode automation stopped (${error.code}).`;
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
