import type {
  Dirent,
} from "node:fs";

import {
  readFile,
  readdir,
} from "node:fs/promises";

import {
  DialoguePlacementDecisionSchema,
  type DialoguePlacementDecision,
} from "./dialoguePlacementDecision.schema.js";

import {
  createDialoguePlacementDecisionDirectory,
  createDialoguePlacementDecisionPath,
  parseDialoguePlacementDecisionRevisionFileName,
} from "./dialoguePlacementDecisionPath.js";

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

function isCanonicalTemporaryDecisionFileName(
  fileName:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,
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

  const revision =
    parseDialoguePlacementDecisionRevisionFileName(
      canonicalFileName,
      episodeId,
      sceneId,
      shotId,
    );

  if (
    revision ===
    null
  ) {
    return false;
  }

  return /^[0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    temporaryIdentity,
  );
}

async function readRevisionRecord(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  revision:
    number,
): Promise<DialoguePlacementDecision> {
  const recordPath =
    createDialoguePlacementDecisionPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      revision,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        recordPath,
        "utf8",
      );
  } catch (error) {
    throw new Error(
      `Could not read dialogue placement decision revision ${revision}: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Dialogue placement decision contains malformed JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  const validated =
    DialoguePlacementDecisionSchema
      .safeParse(
        parsed,
      );

  if (!validated.success) {
    throw new Error(
      `Dialogue placement decision is invalid: ${recordPath}`,
      {
        cause:
          validated.error,
      },
    );
  }

  const record =
    validated.data;

  if (
    record.episodeId !==
      episodeId ||
    record.sceneId !==
      sceneId ||
    record.shotId !==
      shotId ||
    record.revision !==
      revision
  ) {
    throw new Error(
      `Dialogue placement decision identity/revision does not match its deterministic path: ${recordPath}`,
    );
  }

  return record;
}

export async function readLatestDialoguePlacementDecision(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,
): Promise<
  DialoguePlacementDecision | null
> {
  const directoryPath =
    createDialoguePlacementDecisionDirectory(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
    );

  let entries:
    Dirent<string>[];

  try {
    entries =
      await readdir(
        directoryPath,
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
      return null;
    }

    throw new Error(
      `Could not inspect dialogue placement decision directory: ${directoryPath}`,
      {
        cause:
          error,
      },
    );
  }

  const revisions:
    number[] =
      [];

  for (
    const entry
    of entries
  ) {
    if (
      isCanonicalTemporaryDecisionFileName(
        entry.name,
        episodeId,
        sceneId,
        shotId,
      )
    ) {
      continue;
    }

    if (
      !entry.isFile()
    ) {
      throw new Error(
        `Unexpected non-file entry in dialogue placement decision directory: ${entry.name}`,
      );
    }

    const revision =
      parseDialoguePlacementDecisionRevisionFileName(
        entry.name,
        episodeId,
        sceneId,
        shotId,
      );

    if (
      revision ===
      null
    ) {
      throw new Error(
        `Unexpected file in dialogue placement decision directory: ${entry.name}`,
      );
    }

    revisions.push(
      revision,
    );
  }

  if (
    revisions.length ===
    0
  ) {
    return null;
  }

  revisions.sort(
    (
      left,
      right,
    ) =>
      left -
      right,
  );

  revisions.forEach(
    (
      revision,
      index,
    ) => {
      const expectedRevision =
        index +
        1;

      if (
        revision !==
        expectedRevision
      ) {
        throw new Error(
          `Dialogue placement decision revision sequence is not contiguous: expected revision ${expectedRevision}, received ${revision}.`,
        );
      }
    },
  );

  let latestRecord:
    DialoguePlacementDecision | null =
      null;

  for (
    const revision
    of revisions
  ) {
    latestRecord =
      await readRevisionRecord(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        revision,
      );
  }

  return latestRecord;
}
