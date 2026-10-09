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

import {
  buildDialoguePlacementPlan,
} from "./buildDialoguePlacementPlan.js";

import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import {
  DialoguePlacementDecisionSchema,
  type DialoguePlacementDecision,
} from "./dialoguePlacementDecision.schema.js";

import {
  createDialoguePlacementDecisionPath,
} from "./dialoguePlacementDecisionPath.js";

import {
  readLatestDialoguePlacementDecision,
} from "./readDialoguePlacementDecision.js";

import type {
  VerifiedShotDialogueTiming,
} from "./verifyShotDialogueTiming.js";

export type DialoguePlacementDecisionInput =
  Readonly<{
    dialoguePlan:
      ShotDialoguePlan;

    timing:
      VerifiedShotDialogueTiming;

    placements:
      readonly Readonly<{
        dialogueLineId:
          string;

        startSeconds:
          number;
      }>[];
  }>;

export type DialoguePlacementDecisionDependencies =
  Readonly<{
    now?:
      () => string;

    readLatest?:
      typeof readLatestDialoguePlacementDecision;
  }>;

export type CreateDialoguePlacementDecisionResult =
  Readonly<{
    record:
      DialoguePlacementDecision;

    decisionPath:
      string;
  }>;

export async function createDialoguePlacementDecision(
  mediaRoot:
    string,

  input:
    DialoguePlacementDecisionInput,

  dependencies:
    DialoguePlacementDecisionDependencies =
      {},
): Promise<
  CreateDialoguePlacementDecisionResult
> {
  const placementPlan =
    buildDialoguePlacementPlan({
      dialoguePlan:
        input.dialoguePlan,

      timing:
        input.timing,

      placements:
        input.placements,
    });

  const readLatest =
    dependencies.readLatest ??
    readLatestDialoguePlacementDecision;

  const current =
    await readLatest(
      mediaRoot,
      placementPlan.episodeId,
      placementPlan.sceneId,
      placementPlan.shotId,
    );

  const revision =
    (
      current?.revision ??
      0
    ) +
    1;

  if (
    !Number.isSafeInteger(
      revision,
    )
  ) {
    throw new Error(
      "Dialogue placement decision revision exceeds the safe integer range.",
    );
  }

  const now =
    dependencies.now ??
    (
      () =>
        new Date()
          .toISOString()
    );

  const record =
    DialoguePlacementDecisionSchema
      .parse({
        schemaVersion:
          "1.0",

        revision,

        recordedAt:
          now(),

        episodeId:
          placementPlan.episodeId,

        sceneId:
          placementPlan.sceneId,

        shotId:
          placementPlan.shotId,

        dialoguePlanKey:
          placementPlan
            .dialoguePlanKey,

        placements:
          placementPlan.lines.map(
            (
              line,
            ) => ({
              dialogueLineId:
                line.dialogueLineId,

              sourceSha256:
                line.sourceSha256,

              startSeconds:
                line.startSeconds,
            }),
          ),
      });

  const decisionPath =
    createDialoguePlacementDecisionPath(
      mediaRoot,
      record.episodeId,
      record.sceneId,
      record.shotId,
      record.revision,
    );

  await mkdir(
    dirname(
      decisionPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${decisionPath}.part-${process.pid}-${randomUUID()}`;

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
        decisionPath,
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
          `Dialogue placement decision revision already exists: ${decisionPath}`,
        );
      }

      throw error;
    }

    return Object.freeze({
      record,
      decisionPath,
    });
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
