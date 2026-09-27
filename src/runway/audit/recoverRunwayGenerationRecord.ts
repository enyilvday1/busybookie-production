import {
  isDeepStrictEqual,
} from "node:util";

import {
  buildRunwayGenerationRecord,
  type BuildRunwayGenerationRecordInput,
} from "./buildRunwayGenerationRecord.js";

import type {
  RunwayGenerationRecord,
} from "./runwayGenerationRecord.schema.js";

import {
  readRunwayGenerationRecord,
} from "./readRunwayGenerationRecord.js";

import {
  createRunwayGenerationRecordPath,
  writeRunwayGenerationRecord,
} from "./writeRunwayGenerationRecord.js";

export type RecoverRunwayGenerationRecordResult =
  Readonly<{
    record:
      RunwayGenerationRecord;

    recordPath:
      string;
  }>;

export type RecoverRunwayGenerationRecordDependencies =
  Readonly<{
    readGenerationRecord:
      typeof readRunwayGenerationRecord;

    writeGenerationRecord:
      typeof writeRunwayGenerationRecord;
  }>;

const defaultDependencies:
  RecoverRunwayGenerationRecordDependencies =
  Object.freeze({
    readGenerationRecord:
      readRunwayGenerationRecord,

    writeGenerationRecord:
      writeRunwayGenerationRecord,
  });

function matchesRecoveredExecutionEvidence(
  existing:
    RunwayGenerationRecord,

  expected:
    RunwayGenerationRecord,
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

export async function recoverRunwayGenerationRecord(
  mediaRoot:
    string,

  input:
    BuildRunwayGenerationRecordInput,

  dependencies:
    RecoverRunwayGenerationRecordDependencies =
      defaultDependencies,
): Promise<RecoverRunwayGenerationRecordResult> {
  const expected =
    buildRunwayGenerationRecord(
      input,
    );

  const existing =
    await dependencies
      .readGenerationRecord(
        mediaRoot,
        expected.episodeId,
        expected.shotId,
        expected.taskId,
      );

  if (existing) {
    if (
      !matchesRecoveredExecutionEvidence(
        existing,
        expected,
      )
    ) {
      throw new Error(
        `Existing Runway generation record does not match recovered execution evidence: ${createRunwayGenerationRecordPath(
          mediaRoot,
          existing,
        )}`,
      );
    }

    return Object.freeze({
      record:
        existing,

      recordPath:
        createRunwayGenerationRecordPath(
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
          expected.taskId,
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
        `Existing Runway generation record does not match recovered execution evidence: ${createRunwayGenerationRecordPath(
          mediaRoot,
          concurrentWinner,
        )}`,
      );
    }

    return Object.freeze({
      record:
        concurrentWinner,

      recordPath:
        createRunwayGenerationRecordPath(
          mediaRoot,
          concurrentWinner,
        ),
    });
  }
}
