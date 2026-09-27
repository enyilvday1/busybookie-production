import {
  isDeepStrictEqual,
} from "node:util";

import {
  buildVeoGenerationRecord,
  type BuildVeoGenerationRecordInput,
} from "./buildVeoGenerationRecord.js";

import type {
  VeoGenerationRecord,
} from "./veoGenerationRecord.schema.js";

import {
  readVeoGenerationRecord,
} from "./readVeoGenerationRecord.js";

import {
  createVeoGenerationRecordPath,
  writeVeoGenerationRecord,
} from "./writeVeoGenerationRecord.js";

export type RecoverVeoGenerationRecordResult =
  Readonly<{
    record:
      VeoGenerationRecord;

    recordPath:
      string;
  }>;

export type RecoverVeoGenerationRecordDependencies =
  Readonly<{
    readGenerationRecord:
      typeof readVeoGenerationRecord;

    writeGenerationRecord:
      typeof writeVeoGenerationRecord;
  }>;

const defaultDependencies:
  RecoverVeoGenerationRecordDependencies =
    Object.freeze({
      readGenerationRecord:
        readVeoGenerationRecord,

      writeGenerationRecord:
        writeVeoGenerationRecord,
    });

function matchesRecoveredExecutionEvidence(
  existing:
    VeoGenerationRecord,

  expected:
    VeoGenerationRecord,
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

export async function recoverVeoGenerationRecord(
  mediaRoot:
    string,

  input:
    BuildVeoGenerationRecordInput,

  dependencies:
    RecoverVeoGenerationRecordDependencies =
      defaultDependencies,
): Promise<RecoverVeoGenerationRecordResult> {
  const expected =
    buildVeoGenerationRecord(
      input,
    );

  const existing =
    await dependencies
      .readGenerationRecord(
        mediaRoot,
        expected.episodeId,
        expected.shotId,
        expected.operationName,
      );

  if (existing) {
    if (
      !matchesRecoveredExecutionEvidence(
        existing,
        expected,
      )
    ) {
      throw new Error(
        `Existing Veo generation record does not match recovered execution evidence: ${createVeoGenerationRecordPath(
          mediaRoot,
          existing,
        )}`,
      );
    }

    return Object.freeze({
      record:
        existing,

      recordPath:
        createVeoGenerationRecordPath(
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
          expected.episodeId,
          expected.shotId,
          expected.operationName,
        );

    if (!concurrentWinner) {
      throw writeError;
    }

    if (
      !matchesRecoveredExecutionEvidence(
        concurrentWinner,
        expected,
      )
    ) {
      throw new Error(
        `Existing Veo generation record does not match recovered execution evidence: ${createVeoGenerationRecordPath(
          mediaRoot,
          concurrentWinner,
        )}`,
      );
    }

    return Object.freeze({
      record:
        concurrentWinner,

      recordPath:
        createVeoGenerationRecordPath(
          mediaRoot,
          concurrentWinner,
        ),
    });
  }
}
