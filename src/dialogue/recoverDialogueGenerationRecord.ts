import {
  isDeepStrictEqual,
} from "node:util";

import {
  DialogueGenerationRecordSchema,
  type DialogueGenerationRecord,
} from "./dialogueGenerationRecord.schema.js";

import {
  createDialogueGenerationRecordPath,
} from "./dialogueGenerationRecordPath.js";

import {
  readDialogueGenerationRecord,
} from "./readDialogueGenerationRecord.js";

import {
  writeDialogueGenerationRecord,
} from "./writeDialogueGenerationRecord.js";

export type RecoverDialogueGenerationRecordResult =
  Readonly<{
    record:
      DialogueGenerationRecord;

    recordPath:
      string;
  }>;

export type RecoverDialogueGenerationRecordDependencies =
  Readonly<{
    readGenerationRecord:
      typeof readDialogueGenerationRecord;

    writeGenerationRecord:
      typeof writeDialogueGenerationRecord;
  }>;

const defaultDependencies:
  RecoverDialogueGenerationRecordDependencies =
    Object.freeze({
      readGenerationRecord:
        readDialogueGenerationRecord,

      writeGenerationRecord:
        writeDialogueGenerationRecord,
    });

function createRecordPath(
  mediaRoot:
    string,

  record:
    DialogueGenerationRecord,
): string {
  return createDialogueGenerationRecordPath(
    mediaRoot,
    record.plan.episodeId,
    record.plan.shotId,
    record.plan.dialogueLineId,
    record.provider,
    record.providerExecutionId,
  );
}

function matchesRecoveredExecutionEvidence(
  existing:
    DialogueGenerationRecord,

  expected:
    DialogueGenerationRecord,
): boolean {
  return isDeepStrictEqual(
    {
      ...existing,

      recordedAt:
        expected.recordedAt,
    },
    expected,
  );
}

function requireMatchingRecoveredEvidence(
  mediaRoot:
    string,

  existing:
    DialogueGenerationRecord,

  expected:
    DialogueGenerationRecord,
): void {
  if (
    !matchesRecoveredExecutionEvidence(
      existing,
      expected,
    )
  ) {
    throw new Error(
      `Existing dialogue generation record does not match recovered execution evidence: ${createRecordPath(
        mediaRoot,
        existing,
      )}`,
    );
  }
}

export async function recoverDialogueGenerationRecord(
  mediaRoot:
    string,

  input:
    DialogueGenerationRecord,

  dependencies:
    RecoverDialogueGenerationRecordDependencies =
      defaultDependencies,
): Promise<
  RecoverDialogueGenerationRecordResult
> {
  const expected =
    DialogueGenerationRecordSchema.parse(
      input,
    );

  const existing =
    await dependencies
      .readGenerationRecord(
        mediaRoot,
        expected.plan.episodeId,
        expected.plan.shotId,
        expected.plan.dialogueLineId,
        expected.provider,
        expected.providerExecutionId,
      );

  if (existing) {
    requireMatchingRecoveredEvidence(
      mediaRoot,
      existing,
      expected,
    );

    return Object.freeze({
      record:
        existing,

      recordPath:
        createRecordPath(
          mediaRoot,
          existing,
        ),
    });
  }

  try {
    const recordPath =
      await dependencies
        .writeGenerationRecord(
          mediaRoot,
          expected,
        );

    return Object.freeze({
      record:
        expected,

      recordPath,
    });
  } catch (writeError) {
    const concurrentWinner =
      await dependencies
        .readGenerationRecord(
          mediaRoot,
          expected.plan.episodeId,
          expected.plan.shotId,
          expected.plan.dialogueLineId,
          expected.provider,
          expected.providerExecutionId,
        );

    if (!concurrentWinner) {
      throw writeError;
    }

    requireMatchingRecoveredEvidence(
      mediaRoot,
      concurrentWinner,
      expected,
    );

    return Object.freeze({
      record:
        concurrentWinner,

      recordPath:
        createRecordPath(
          mediaRoot,
          concurrentWinner,
        ),
    });
  }
}
