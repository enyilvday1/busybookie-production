import type {
  Dirent,
} from "node:fs";

import {
  readdir,
} from "node:fs/promises";

import {
  basename,
  dirname,
  join,
} from "node:path";

import type {
  DialogueLifecycleClassification,
} from "./classifyDialogueLifecycle.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
  createDialogueDirectSeedAudioReservationPath,
  createDialogueDirectSeedAudioSubmissionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

import {
  DialogueReservationPlanKeySchema,
} from "./dialogueReservation.schema.js";

import {
  inspectDialogueDirectSeedAudioLifecycle,
} from "./inspectDialogueDirectSeedAudioLifecycle.js";

export type DialogueDirectSeedAudioHistoricalLifecycle =
  Readonly<{
    planKey:
      string;

    lifecycle:
      DialogueLifecycleClassification;
  }>;

export type InspectDialogueDirectSeedAudioPlanHistoryDependencies =
  Readonly<{
    readDirectory:
      typeof readdir;

    inspectLifecycle:
      typeof inspectDialogueDirectSeedAudioLifecycle;
  }>;

// Both defaults only read durable evidence.
const defaultDependencies:
  InspectDialogueDirectSeedAudioPlanHistoryDependencies =
    Object.freeze({
      readDirectory:
        readdir,

      inspectLifecycle:
        inspectDialogueDirectSeedAudioLifecycle,
    });

function hasErrorCode(
  error:
    unknown,

  expectedCode:
    string,
): boolean {
  return (
    typeof error ===
      "object" &&
    error !==
      null &&
    "code" in
      error &&
    (
      error as {
        code?:
          unknown;
      }
    ).code ===
      expectedCode
  );
}

// Same temporary-file convention the plan-scoped lifecycle creators use:
// <canonical file name>.part-<pid>-<uuid v4>.
function isCanonicalTemporaryLifecycleFileName(
  fileName:
    string,

  canonicalFileNames:
    readonly string[],
): boolean {
  const temporaryMarker =
    ".part-";

  const markerIndex =
    fileName.indexOf(
      temporaryMarker,
    );

  if (
    markerIndex <=
    0
  ) {
    return false;
  }

  if (
    fileName.indexOf(
      temporaryMarker,
      markerIndex +
        temporaryMarker.length,
    ) !==
      -1
  ) {
    return false;
  }

  const canonicalFileName =
    fileName.slice(
      0,
      markerIndex,
    );

  const temporaryIdentity =
    fileName.slice(
      markerIndex +
        temporaryMarker.length,
    );

  if (
    !canonicalFileNames.includes(
      canonicalFileName,
    )
  ) {
    return false;
  }

  return /^[0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    temporaryIdentity,
  );
}

async function assertHistoricalPlanDirectoryEntries(
  readDirectory:
    typeof readdir,

  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,

  planKey:
    string,

  planDirectory:
    string,
): Promise<void> {
  const canonicalPaths = [
    createDialogueDirectSeedAudioReservationPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      planKey,
    ),

    createDialogueDirectSeedAudioSubmissionPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      planKey,
    ),

    createDialogueDirectSeedAudioCompletionPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      planKey,
    ),
  ];

  for (
    const canonicalPath
    of canonicalPaths
  ) {
    if (
      dirname(
        canonicalPath,
      ) !==
      planDirectory
    ) {
      throw new Error(
        `Direct SeedAudio lifecycle path does not belong to its plan directory: ${canonicalPath}`,
      );
    }
  }

  const canonicalFileNames =
    canonicalPaths.map(
      (canonicalPath) =>
        basename(
          canonicalPath,
        ),
    );

  const entries:
    Dirent<string>[] =
      await readDirectory(
        planDirectory,
        {
          withFileTypes:
            true,
        },
      );

  for (
    const entry
    of entries
  ) {
    if (
      !canonicalFileNames.includes(
        entry.name,
      ) &&
      !isCanonicalTemporaryLifecycleFileName(
        entry.name,
        canonicalFileNames,
      )
    ) {
      throw new Error(
        `Unexpected entry in historical direct SeedAudio plan directory: ${join(planDirectory, entry.name)}`,
      );
    }

    if (
      !entry.isFile()
    ) {
      throw new Error(
        `Unexpected non-file entry in historical direct SeedAudio plan directory: ${join(planDirectory, entry.name)}`,
      );
    }
  }
}

export async function inspectDialogueDirectSeedAudioPlanHistory(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,

  currentPlanKey:
    string,

  dependencies:
    InspectDialogueDirectSeedAudioPlanHistoryDependencies =
      defaultDependencies,
): Promise<
  readonly DialogueDirectSeedAudioHistoricalLifecycle[]
> {
  // The existing path helper validates every identity segment and the
  // current planKey; the history root is the parent of the plan directory.
  const currentPlanDirectory =
    dirname(
      createDialogueDirectSeedAudioReservationPath(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
        currentPlanKey,
      ),
    );

  const historyRoot =
    dirname(
      currentPlanDirectory,
    );

  let rootEntries:
    Dirent<string>[];

  try {
    rootEntries =
      await dependencies
        .readDirectory(
          historyRoot,
          {
            withFileTypes:
              true,
          },
        );
  } catch (error) {
    if (
      hasErrorCode(
        error,
        "ENOENT",
      )
    ) {
      return Object.freeze(
        [],
      );
    }

    throw error;
  }

  const historicalPlanKeys:
    string[] =
      [];

  for (
    const entry
    of rootEntries
  ) {
    if (
      !entry.isDirectory()
    ) {
      throw new Error(
        `Unexpected non-directory entry in direct SeedAudio history: ${join(historyRoot, entry.name)}`,
      );
    }

    if (
      !DialogueReservationPlanKeySchema
        .safeParse(
          entry.name,
        )
        .success
    ) {
      throw new Error(
        `Unexpected directory in direct SeedAudio history (not a planKey): ${join(historyRoot, entry.name)}`,
      );
    }

    if (
      entry.name !==
      basename(
        currentPlanDirectory,
      )
    ) {
      historicalPlanKeys.push(
        entry.name,
      );
    }
  }

  historicalPlanKeys.sort(
    (
      left,
      right,
    ) =>
      left <
      right
        ? -1
        : left >
            right
          ? 1
          : 0,
  );

  const history:
    DialogueDirectSeedAudioHistoricalLifecycle[] =
      [];

  for (
    const planKey
    of historicalPlanKeys
  ) {
    await assertHistoricalPlanDirectoryEntries(
      dependencies
        .readDirectory,
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      planKey,
      join(
        historyRoot,
        planKey,
      ),
    );

    // Record parsing, identity, planKey and classification stay with the
    // existing plan-scoped inspector; every error propagates unchanged.
    const lifecycle =
      await dependencies
        .inspectLifecycle(
          mediaRoot,
          episodeId,
          sceneId,
          shotId,
          dialogueLineId,
          planKey,
        );

    history.push(
      Object.freeze({
        planKey,
        lifecycle,
      }),
    );
  }

  return Object.freeze(
    history,
  );
}
