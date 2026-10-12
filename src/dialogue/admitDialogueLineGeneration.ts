import {
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import type {
  ShotDialoguePlan,
  ShotDialoguePlanLine,
} from "./buildShotDialoguePlan.js";

import {
  DialogueGenerationAdmissionSchema,
  DialogueGenerationAttemptNumberSchema,
  type DialogueGenerationAdmission,
  type DialogueGenerationNamespace,
} from "./dialogueGenerationAdmission.schema.js";

import {
  createDialogueGenerationAdmissionPath,
} from "./dialogueGenerationAdmissionPaths.js";

import {
  inspectDialogueGenerationAdmissionLedger,
  type InspectedDialogueGenerationAdmission,
} from "./inspectDialogueGenerationAdmissionLedger.js";

import {
  classifyDialogueLineGenerationEvidence,
  dialogueLineGenerationNamespace,
  isDialogueLineGenerationEligible,
} from "./inspectDialogueLineGenerationEvidence.js";

// C6a shared paid dialogue generation admission (recovery model R1:
// resumable, no abandonment). At most one unfinished paid attempt exists per
// canonical dialogueLineId across both namespaces and every planKey.

export type DialogueLineGenerationAdmissionInput =
  Readonly<{
    mediaRoot: string;
    plan: ShotDialoguePlan;
    dialogueLineId: string;
    generationNamespace: DialogueGenerationNamespace;
    confirmPaidGeneration: boolean;
  }>;

export type DialogueLineGenerationAdmission =
  Readonly<{
    disposition: "ADMITTED" | "RESUMED";
    admission: DialogueGenerationAdmission;
    admissionPath: string;
  }>;

export type AdmitDialogueLineGenerationDependencies =
  Readonly<{
    inspectLedger:
      typeof inspectDialogueGenerationAdmissionLedger;

    classifyLineEvidence:
      typeof classifyDialogueLineGenerationEvidence;

    createAdmission:
      typeof createDialogueGenerationAdmission;

    now:
      () => string;

    createAdmissionId:
      () => string;
  }>;

// Create-once, same convention as every other durable dialogue record. The
// written record is the arbitration evidence: a concurrent writer of the same
// attempt number fails closed on EEXIST.
export async function createDialogueGenerationAdmission(
  mediaRoot:
    string,

  admission:
    DialogueGenerationAdmission,
): Promise<string> {
  const record =
    DialogueGenerationAdmissionSchema
      .parse(
        admission,
      );

  const admissionPath =
    createDialogueGenerationAdmissionPath(
      mediaRoot,
      record.episodeId,
      record.sceneId,
      record.shotId,
      record.dialogueLineId,
      record.attemptNumber,
    );

  await mkdir(
    dirname(
      admissionPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${admissionPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        record,
        null,
        2,
      )}\n`,
      {
        encoding:
          "utf8",
        flag:
          "wx",
      },
    );

    temporaryCreated =
      true;

    try {
      await copyFile(
        temporaryPath,
        admissionPath,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        code ===
        "EEXIST"
      ) {
        throw new Error(
          `Dialogue generation admission attempt already exists: ${admissionPath}`,
        );
      }

      throw error;
    }

    return admissionPath;
  } finally {
    if (
      temporaryCreated
    ) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve the original result or failure.
      }
    }
  }
}

const defaultDependencies:
  AdmitDialogueLineGenerationDependencies =
    Object.freeze({
      inspectLedger:
        inspectDialogueGenerationAdmissionLedger,

      classifyLineEvidence:
        classifyDialogueLineGenerationEvidence,

      createAdmission:
        createDialogueGenerationAdmission,

      now:
        () =>
          new Date()
            .toISOString(),

      createAdmissionId:
        randomUUID,
    });

function requireCanonicalLine(
  plan:
    ShotDialoguePlan,

  dialogueLineId:
    string,
): ShotDialoguePlanLine {
  const matches =
    plan.lines.filter(
      (line) =>
        line.dialogueLineId ===
        dialogueLineId,
    );

  const [
    line,
  ] = matches;

  if (
    line ===
      undefined ||
    matches.length !==
      1
  ) {
    throw new Error(
      `Dialogue generation admission requires exactly one canonical line ${dialogueLineId} in the supplied dialogue plan.`,
    );
  }

  return line;
}

// Resume identity: line, plan and namespace (which fixes the exact namespace
// reservation path) and provider. planKey covers character, text and voice.
function matchesAdmittedAttempt(
  admission:
    DialogueGenerationAdmission,

  plan:
    ShotDialoguePlan,

  line:
    ShotDialoguePlanLine,

  generationNamespace:
    DialogueGenerationNamespace,
): boolean {
  return (
    admission.episodeId ===
      plan.episodeId &&
    admission.sceneId ===
      plan.sceneId &&
    admission.shotId ===
      plan.shotId &&
    admission.dialogueLineId ===
      line.dialogueLineId &&
    admission.planKey ===
      plan.planKey &&
    admission.generationNamespace ===
      generationNamespace &&
    admission.provider ===
      line.voice.provider
  );
}

async function assertLineEligible(
  dependencies:
    AdmitDialogueLineGenerationDependencies,

  mediaRoot:
    string,

  plan:
    ShotDialoguePlan,

  line:
    ShotDialoguePlanLine,
): Promise<void> {
  const evidence =
    await dependencies
      .classifyLineEvidence({
        mediaRoot,
        plan,
        line,
      });

  if (
    !isDialogueLineGenerationEligible(
      evidence,
    )
  ) {
    const staleDetail =
      evidence.staleWork
        .map(
          (work) =>
            `${work.namespace}:${work.planKey}:${work.state}`,
        )
        .join(
          ", ",
        );

    throw new Error(
      `Dialogue generation admission blocked for ${line.dialogueLineId}: current ${evidence.namespace} lifecycle is ${evidence.lifecycleState}` +
        (
          staleDetail
            ? `; active work outside the current plan: ${staleDetail}.`
            : "."
        ),
    );
  }
}

function describeAttempt(
  latest:
    InspectedDialogueGenerationAdmission,
): string {
  return `attempt ${latest.admission.attemptNumber} (${latest.admission.generationNamespace}, plan ${latest.admission.planKey})`;
}

export async function admitDialogueLineGeneration(
  input:
    DialogueLineGenerationAdmissionInput,

  dependencies:
    AdmitDialogueLineGenerationDependencies =
      defaultDependencies,
): Promise<DialogueLineGenerationAdmission> {
  // Before any durable read or write.
  if (
    input.confirmPaidGeneration !==
    true
  ) {
    throw new Error(
      "Paid-generation confirmation is required before dialogue generation admission.",
    );
  }

  const {
    mediaRoot,
    plan,
    generationNamespace,
  } = input;

  const line =
    requireCanonicalLine(
      plan,
      input.dialogueLineId,
    );

  const lineNamespace =
    dialogueLineGenerationNamespace(
      line,
    );

  if (
    lineNamespace !==
    generationNamespace
  ) {
    throw new Error(
      `Dialogue generation admission for ${line.dialogueLineId} was requested in ${generationNamespace}, but the canonical voice executes in ${lineNamespace}.`,
    );
  }

  const ledger =
    await dependencies
      .inspectLedger(
        mediaRoot,
        plan.episodeId,
        plan.sceneId,
        plan.shotId,
        line.dialogueLineId,
      );

  const latest =
    ledger.latest;

  let resumable:
    InspectedDialogueGenerationAdmission | null =
      null;

  if (
    latest !==
    null
  ) {
    switch (
      latest.attemptState
    ) {
      case "CLOSED_BY_COMPLETION":
        break;

      case "PRE_RESERVATION_OPEN":
        if (
          !matchesAdmittedAttempt(
            latest.admission,
            plan,
            line,
            generationNamespace,
          )
        ) {
          throw new Error(
            `Dialogue generation admission blocked for ${line.dialogueLineId}: open ${describeAttempt(latest)} can only be resumed by the identical canonical attempt; requested ${generationNamespace}, plan ${plan.planKey}.`,
          );
        }

        resumable =
          latest;

        break;

      case "RESERVED_ONLY_OPEN":
        throw new Error(
          `Dialogue generation admission blocked for ${line.dialogueLineId}: ${describeAttempt(latest)} is RESERVED_ONLY and requires human intervention.`,
        );

      case "SUBMITTED_OPEN":
        throw new Error(
          `Dialogue generation admission blocked for ${line.dialogueLineId}: ${describeAttempt(latest)} is SUBMITTED and requires reconciliation.`,
        );
    }
  }

  // Shared dual-namespace rule; also how a line without any ledger is checked.
  await assertLineEligible(
    dependencies,
    mediaRoot,
    plan,
    line,
  );

  let admitted:
    DialogueLineGenerationAdmission;

  if (
    resumable !==
    null
  ) {
    admitted =
      Object.freeze({
        disposition:
          "RESUMED",
        admission:
          resumable.admission,
        admissionPath:
          resumable.admissionPath,
      });
  } else {
    const attemptNumber =
      DialogueGenerationAttemptNumberSchema
        .parse(
          (
            latest?.admission.attemptNumber ??
            0
          ) +
            1,
        );

    const admission =
      DialogueGenerationAdmissionSchema
        .parse({
          schemaVersion:
            "1.0",
          admissionId:
            dependencies
              .createAdmissionId(),
          attemptNumber,
          admittedAt:
            dependencies
              .now(),
          status:
            "ADMITTED",
          episodeId:
            plan.episodeId,
          sceneId:
            plan.sceneId,
          shotId:
            plan.shotId,
          dialogueLineId:
            line.dialogueLineId,
          planKey:
            plan.planKey,
          generationNamespace,
          provider:
            line.voice.provider,
        });

    const admissionPath =
      await dependencies
        .createAdmission(
          mediaRoot,
          admission,
        );

    admitted =
      Object.freeze({
        disposition:
          "ADMITTED",
        admission,
        admissionPath,
      });
  }

  // Post-acquire re-check: the attempt must still be the latest,
  // pre-reservation attempt, and the line must still be eligible. On failure
  // the attempt simply stays open; nothing is closed or deleted.
  const recheck =
    await dependencies
      .inspectLedger(
        mediaRoot,
        plan.episodeId,
        plan.sceneId,
        plan.shotId,
        line.dialogueLineId,
      );

  if (
    recheck.latest ===
      null ||
    recheck.latest.admission.admissionId !==
      admitted.admission.admissionId ||
    recheck.latest.attemptState !==
      "PRE_RESERVATION_OPEN"
  ) {
    throw new Error(
      `Dialogue generation admission for ${line.dialogueLineId} attempt ${admitted.admission.attemptNumber} is no longer the open pre-reservation attempt.`,
    );
  }

  await assertLineEligible(
    dependencies,
    mediaRoot,
    plan,
    line,
  );

  return admitted;
}
