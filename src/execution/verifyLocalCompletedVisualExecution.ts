import { isDeepStrictEqual } from "node:util";
import { inspectExecutionLifecycle } from "./inspectExecutionLifecycle.js";
import type { ExecutionLifecycleClassification } from "./classifyExecutionLifecycle.js";
import type { ExecutionLifecycleReconciliationInput, ExecutionLifecycleReconciliationDependencies,
  ExecutionLifecycleReconciliationResult } from "./reconcileExecutionLifecycle.js";
import { createExecutionCompletionPath } from "./executionCompletionPath.js";
import { readRunwayGenerationRecord } from "../runway/audit/readRunwayGenerationRecord.js";
import { createRunwayGenerationRecordPathFromIdentity } from "../runway/audit/writeRunwayGenerationRecord.js";
import { createRunwayVideoOutputPath } from "../runway/output/runwayOutputPath.js";
import { inspectRunwayOutput } from "../runway/output/recoverRunwayOutput.js";
import { readVeoGenerationRecord } from "../veo/audit/readVeoGenerationRecord.js";
import { createVeoGenerationRecordPathFromIdentity } from "../veo/audit/writeVeoGenerationRecord.js";
import { createVeoVideoOutputPath } from "../veo/output/veoOutputPath.js";
import { inspectVeoOutput } from "../veo/output/recoverVeoOutput.js";
import { verifyGoogleGenAiDurableCompletion } from "./verifyGoogleGenAiDurableCompletion.js";

type CompletedInspection = Extract<ExecutionLifecycleClassification, { state: "COMPLETED" }>;
export type LocalCompletedReadDependencies = Pick<ExecutionLifecycleReconciliationDependencies,
  "readRunwayGenerationRecord" | "readVeoGenerationRecord" | "inspectRunwayOutput" | "inspectVeoOutput">;
type LocalResult = Extract<ExecutionLifecycleReconciliationResult, { reconciliationMode: "DURABLE_COMPLETION" }>;

// Exact extraction of the existing shared reconciler's COMPLETED branch.
// No submitted-recovery or writing capability is accepted by this function.
export async function verifyRunwayVeoCompletedInspection(
  input: ExecutionLifecycleReconciliationInput, lifecycle: CompletedInspection,
  dependencies: LocalCompletedReadDependencies = {},
): Promise<LocalResult> {
    const submission =
      lifecycle.submission;

    const completion =
      lifecycle.completion;

    // Only the shared Runway/Veo completion is reconciled here; any other
    // completed provider fails closed before provider-specific handling.
    if (
      completion.provider !==
        "VEO" &&
      completion.provider !==
        "RUNWAY"
    ) {
      throw new Error(
        `Execution lifecycle reconciliation for completed provider ${completion.provider} is not implemented in this milestone.`,
      );
    }

    if (
      submission.provider ===
      "VEO"
    ) {
      if (
        submission.schemaVersion !==
        "1.3"
      ) {
        throw new Error(
          `Completed Veo submission schema ${submission.schemaVersion} cannot be automatically reconciled because durable recovery metadata is unavailable.`,
        );
      }

      const generationRecordPath =
        createVeoGenerationRecordPathFromIdentity(
          input.mediaRoot,
          submission.episodeId,
          submission.shotId,
          submission
            .providerExecutionId,
        );

      if (
        completion
          .generationRecordPath !==
        generationRecordPath
      ) {
        throw new Error(
          "Execution completion generation record path does not match the canonical durable Veo generation record path.",
        );
      }

      const readGenerationRecord =
        dependencies
          .readVeoGenerationRecord ??
        readVeoGenerationRecord;

      const generationRecord =
        await readGenerationRecord(
          input.mediaRoot,
          submission.episodeId,
          submission.shotId,
          submission
            .providerExecutionId,
        );

      if (!generationRecord) {
        throw new Error(
          "Execution completion references a missing durable Veo generation record.",
        );
      }

      const generationIdentityMatchesSubmission =
        generationRecord.episodeId ===
          submission.episodeId &&
        generationRecord.shotId ===
          submission.shotId &&
        generationRecord.operationName ===
          submission.providerExecutionId;

      if (
        !generationIdentityMatchesSubmission
      ) {
        throw new Error(
          "Durable Veo generation record identity does not match completed submission identity.",
        );
      }

      const generationEvidenceMatchesSubmission =
        isDeepStrictEqual(
          generationRecord.request,
          submission
            .recoveryMetadata
            .request,
        ) &&
        isDeepStrictEqual(
          generationRecord
            .costPolicy,
          submission
            .recoveryMetadata
            .costPolicy,
        );

      if (
        !generationEvidenceMatchesSubmission
      ) {
        throw new Error(
          "Durable Veo generation record does not match durable submission recovery metadata.",
        );
      }

      if (
        generationRecord
          .outputs
          .length !==
        submission
          .recoveryMetadata
          .request
          .numberOfVideos
      ) {
        throw new Error(
          "Durable Veo generation record output count does not match durable submission recovery metadata.",
        );
      }

      const inspectLocalVeoOutput =
        dependencies
          .inspectVeoOutput ??
        inspectVeoOutput;

      for (
        const output
        of generationRecord.outputs
      ) {
        const canonicalOutputPath =
          createVeoVideoOutputPath(
            input.mediaRoot,
            generationRecord
              .episodeId,
            generationRecord
              .shotId,
            generationRecord
              .operationName,
            output.outputIndex,
          );

        if (
          output.destinationPath !==
          canonicalOutputPath
        ) {
          throw new Error(
            "Durable Veo generation record output path does not match canonical output path.",
          );
        }

        const inspectedOutput =
          await inspectLocalVeoOutput(
            output.destinationPath,
          );

        if (
          inspectedOutput.bytes !==
            output.bytes ||
          inspectedOutput.sha256 !==
            output.sha256
        ) {
          throw new Error(
            "Durable Veo local output does not match generation record evidence.",
          );
        }
      }

      return Object.freeze({
        lifecycleState:
          "COMPLETED",

        reconciliationMode:
          "DURABLE_COMPLETION",

        provider:
          "VEO",

        providerExecutionId:
          submission
            .providerExecutionId,

        generationRecord,

        generationRecordPath,

        completion,

        completionPath:
          createExecutionCompletionPath(
            input.mediaRoot,
            completion.episodeId,
            completion.shotId,
          ),
      });
    }

    if (
      submission.provider !==
      "RUNWAY"
    ) {
      throw new Error(
        `Execution lifecycle reconciliation for completed provider ${submission.provider} is not implemented in this milestone.`,
      );
    }

    if (
      submission.schemaVersion !==
      "1.2"
    ) {
      throw new Error(
        `Completed Runway submission schema ${submission.schemaVersion} cannot be automatically reconciled because durable recovery metadata is unavailable.`,
      );
    }

    const generationRecordPath =
      createRunwayGenerationRecordPathFromIdentity(
        input.mediaRoot,
        submission.episodeId,
        submission.shotId,
        submission.providerExecutionId,
      );

    if (
      completion.generationRecordPath !==
      generationRecordPath
    ) {
      throw new Error(
        "Execution completion generation record path does not match the canonical durable Runway generation record path.",
      );
    }

    const readGenerationRecord =
      dependencies
        .readRunwayGenerationRecord ??
      readRunwayGenerationRecord;

    const generationRecord =
      await readGenerationRecord(
        input.mediaRoot,
        submission.episodeId,
        submission.shotId,
        submission.providerExecutionId,
      );

    if (!generationRecord) {
      throw new Error(
        "Execution completion references a missing durable Runway generation record.",
      );
    }

    const generationIdentityMatchesSubmission =
      generationRecord.episodeId ===
        submission.episodeId &&
      generationRecord.shotId ===
        submission.shotId &&
      generationRecord.taskId ===
        submission.providerExecutionId;

    if (
      !generationIdentityMatchesSubmission
    ) {
      throw new Error(
        "Durable Runway generation record identity does not match completed submission identity.",
      );
    }

    const generationEvidenceMatchesSubmission =
      isDeepStrictEqual(
        generationRecord.request,
        submission
          .recoveryMetadata
          .request,
      ) &&
      generationRecord
        .credits
        .locallyExpected ===
        submission
          .recoveryMetadata
          .locallyExpectedCredits &&
      generationRecord
        .credits
        .providerEstimated ===
        submission
          .providerEstimatedCredits;

    if (
      !generationEvidenceMatchesSubmission
    ) {
      throw new Error(
        "Durable Runway generation record does not match durable submission recovery metadata.",
      );
    }

    const inspectLocalRunwayOutput =
      dependencies
        .inspectRunwayOutput ??
      inspectRunwayOutput;

    for (
      const output
      of generationRecord.outputs
    ) {
      const canonicalOutputPath =
        createRunwayVideoOutputPath(
          input.mediaRoot,
          generationRecord.episodeId,
          generationRecord.shotId,
          generationRecord.taskId,
          output.outputIndex,
        );

      if (
        output.destinationPath !==
        canonicalOutputPath
      ) {
        throw new Error(
          "Durable Runway generation record output path does not match canonical output path.",
        );
      }

      const inspectedOutput =
        await inspectLocalRunwayOutput(
          output.destinationPath,
        );

      if (
        inspectedOutput.bytes !==
          output.bytes ||
        inspectedOutput.sha256 !==
          output.sha256
      ) {
        throw new Error(
          "Durable Runway local output does not match generation record evidence.",
        );
      }
    }

    return Object.freeze({
      lifecycleState:
        "COMPLETED",

      reconciliationMode:
        "DURABLE_COMPLETION",

      provider:
        "RUNWAY",

      providerExecutionId:
        submission
          .providerExecutionId,

      generationRecord,

      generationRecordPath,

      completion,

      completionPath:
        createExecutionCompletionPath(
          input.mediaRoot,
          completion.episodeId,
          completion.shotId,
        ),
    });

}

export async function verifyLocalCompletedVisualExecution(
  input: Readonly<{ mediaRoot: string; episodeId: string; shotId: string }>,
  reviewed: CompletedInspection,
  dependencies: LocalCompletedReadDependencies & Readonly<{ inspectLifecycle?: typeof inspectExecutionLifecycle }> = {},
) {
  const inspect = dependencies.inspectLifecycle ?? inspectExecutionLifecycle;
  const fresh = await inspect(input.mediaRoot, input.episodeId, input.shotId);
  if (fresh.state !== "COMPLETED" || !isDeepStrictEqual(fresh, reviewed)) throw new Error("Completed visual lineage changed before local verification.");
  const result = fresh.reservation.provider === "GOOGLE_GENAI"
    ? await verifyGoogleGenAiDurableCompletion(input.mediaRoot, input.episodeId, input.shotId)
    : await verifyRunwayVeoCompletedInspection(input, fresh, dependencies);
  const after = await inspect(input.mediaRoot, input.episodeId, input.shotId);
  if (after.state !== "COMPLETED" || !isDeepStrictEqual(after, fresh)) throw new Error("Completed visual lineage changed during local verification.");
  return result;
}
