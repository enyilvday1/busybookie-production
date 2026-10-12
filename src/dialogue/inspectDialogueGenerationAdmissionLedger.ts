import type {
  Dirent,
} from "node:fs";

import {
  readdir,
  readFile,
} from "node:fs/promises";

import type {
  DialogueLifecycleClassification,
} from "./classifyDialogueLifecycle.js";

import {
  DialogueGenerationAdmissionSchema,
  type DialogueGenerationAdmission,
} from "./dialogueGenerationAdmission.schema.js";

import {
  createDialogueGenerationAdmissionDirectory,
  createDialogueGenerationAdmissionPath,
  parseDialogueGenerationLedgerFileName,
} from "./dialogueGenerationAdmissionPaths.js";

import {
  inspectDialogueDirectSeedAudioLifecycle,
} from "./inspectDialogueDirectSeedAudioLifecycle.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

// Derived from the bound namespace lifecycle only. There is no abandonment:
// an attempt closes solely through a COMPLETED bound lifecycle.
export type DialogueGenerationAdmissionAttemptState =
  | "PRE_RESERVATION_OPEN"
  | "RESERVED_ONLY_OPEN"
  | "SUBMITTED_OPEN"
  | "CLOSED_BY_COMPLETION";

export type InspectedDialogueGenerationAdmission =
  Readonly<{
    admission: DialogueGenerationAdmission;
    admissionPath: string;
    attemptState: DialogueGenerationAdmissionAttemptState;
  }>;

export type DialogueGenerationAdmissionLedger =
  Readonly<{
    dialogueLineId: string;
    attempts: readonly DialogueGenerationAdmission[];
    latest: InspectedDialogueGenerationAdmission | null;
  }>;

export type InspectDialogueGenerationAdmissionLedgerDependencies =
  Readonly<{
    readDirectory:
      typeof readdir;

    readFile:
      typeof readFile;

    inspectLineLifecycle:
      typeof inspectDialogueLifecycle;

    inspectDirectSeedAudioLifecycle:
      typeof inspectDialogueDirectSeedAudioLifecycle;
  }>;

const defaultDependencies:
  InspectDialogueGenerationAdmissionLedgerDependencies =
    Object.freeze({
      readDirectory:
        readdir,

      readFile,

      inspectLineLifecycle:
        inspectDialogueLifecycle,

      inspectDirectSeedAudioLifecycle:
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

// `${canonical}.part-${pid}-${uuidv4}` left behind by an interrupted
// create-once writer; ignored, exactly like the other durable ledgers.
function isCanonicalTemporaryAdmissionFileName(
  fileName:
    string,

  dialogueLineId:
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

  if (
    parseDialogueGenerationLedgerFileName(
      fileName.slice(
        0,
        markerIndex,
      ),
      dialogueLineId,
    ) ===
    null
  ) {
    return false;
  }

  return /^[0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    fileName.slice(
      markerIndex +
        temporaryMarker.length,
    ),
  );
}

async function readAdmissionRecord(
  dependencies:
    InspectDialogueGenerationAdmissionLedgerDependencies,

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

  attemptNumber:
    number,
): Promise<DialogueGenerationAdmission> {
  const admissionPath =
    createDialogueGenerationAdmissionPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      attemptNumber,
    );

  let raw:
    string;

  try {
    raw =
      await dependencies
        .readFile(
          admissionPath,
          "utf8",
        );
  } catch (error) {
    throw new Error(
      `Could not read dialogue generation admission attempt ${attemptNumber}: ${admissionPath}`,
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
      `Dialogue generation admission contains malformed JSON: ${admissionPath}`,
      {
        cause:
          error,
      },
    );
  }

  const validated =
    DialogueGenerationAdmissionSchema
      .safeParse(
        parsed,
      );

  if (!validated.success) {
    throw new Error(
      `Dialogue generation admission is invalid: ${admissionPath}`,
      {
        cause:
          validated.error,
      },
    );
  }

  const admission =
    validated.data;

  if (
    admission.episodeId !==
      episodeId ||
    admission.sceneId !==
      sceneId ||
    admission.shotId !==
      shotId ||
    admission.dialogueLineId !==
      dialogueLineId ||
    admission.attemptNumber !==
      attemptNumber
  ) {
    throw new Error(
      `Dialogue generation admission identity/attempt does not match its deterministic path: ${admissionPath}`,
    );
  }

  return admission;
}

// The lifecycle of the exact namespace reservation path the attempt binds to.
async function inspectBoundLifecycle(
  dependencies:
    InspectDialogueGenerationAdmissionLedgerDependencies,

  mediaRoot:
    string,

  admission:
    DialogueGenerationAdmission,
): Promise<DialogueLifecycleClassification> {
  if (
    admission.generationNamespace ===
    "DIRECT_SEED_AUDIO"
  ) {
    return dependencies
      .inspectDirectSeedAudioLifecycle(
        mediaRoot,
        admission.episodeId,
        admission.sceneId,
        admission.shotId,
        admission.dialogueLineId,
        admission.planKey,
      );
  }

  const lifecycle =
    await dependencies
      .inspectLineLifecycle(
        mediaRoot,
        admission.episodeId,
        admission.sceneId,
        admission.shotId,
        admission.dialogueLineId,
      );

  if (
    lifecycle.state !==
      "NOTHING" &&
    lifecycle.reservation.planKey !==
      admission.planKey
  ) {
    throw new Error(
      `Dialogue generation admission attempt ${admission.attemptNumber} for ${admission.dialogueLineId} is bound to plan ${admission.planKey}, but line-scoped evidence belongs to plan ${lifecycle.reservation.planKey}.`,
    );
  }

  return lifecycle;
}

function attemptStateFor(
  lifecycle:
    DialogueLifecycleClassification,
): DialogueGenerationAdmissionAttemptState {
  switch (
    lifecycle.state
  ) {
    case "NOTHING":
      return "PRE_RESERVATION_OPEN";

    case "RESERVED_ONLY":
      return "RESERVED_ONLY_OPEN";

    case "SUBMITTED":
      return "SUBMITTED_OPEN";

    case "COMPLETED":
      return "CLOSED_BY_COMPLETION";
  }
}

// Read-only. Every malformed, missing, duplicated or inconsistent piece of
// evidence throws; nothing is ever classified as closed by absence.
export async function inspectDialogueGenerationAdmissionLedger(
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

  dependencies:
    InspectDialogueGenerationAdmissionLedgerDependencies =
      defaultDependencies,
): Promise<DialogueGenerationAdmissionLedger> {
  const directoryPath =
    createDialogueGenerationAdmissionDirectory(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
    );

  let entries:
    Dirent<string>[];

  try {
    entries =
      await dependencies
        .readDirectory(
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
      return Object.freeze({
        dialogueLineId,
        attempts:
          Object.freeze([]),
        latest:
          null,
      });
    }

    throw new Error(
      `Could not inspect dialogue generation admission directory: ${directoryPath}`,
      {
        cause:
          error,
      },
    );
  }

  const attemptNumbers:
    number[] =
      [];

  for (
    const entry
    of entries
  ) {
    if (
      isCanonicalTemporaryAdmissionFileName(
        entry.name,
        dialogueLineId,
      )
    ) {
      continue;
    }

    if (
      !entry.isFile()
    ) {
      throw new Error(
        `Unexpected non-file entry in dialogue generation admission directory: ${entry.name}`,
      );
    }

    const parsedName =
      parseDialogueGenerationLedgerFileName(
        entry.name,
        dialogueLineId,
      );

    if (
      parsedName ===
      null
    ) {
      throw new Error(
        `Unexpected file in dialogue generation admission directory: ${entry.name}`,
      );
    }

    attemptNumbers.push(
      parsedName.attemptNumber,
    );
  }

  attemptNumbers.sort(
    (
      left,
      right,
    ) =>
      left -
      right,
  );

  attemptNumbers.forEach(
    (
      attemptNumber,
      index,
    ) => {
      const expectedAttemptNumber =
        index +
        1;

      if (
        attemptNumber !==
        expectedAttemptNumber
      ) {
        throw new Error(
          `Dialogue generation admission attempt sequence is not contiguous: expected attempt ${expectedAttemptNumber}, received ${attemptNumber}.`,
        );
      }
    },
  );

  const attempts:
    DialogueGenerationAdmission[] =
      [];

  for (
    const attemptNumber
    of attemptNumbers
  ) {
    attempts.push(
      await readAdmissionRecord(
        dependencies,
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
        attemptNumber,
      ),
    );
  }

  let latest:
    InspectedDialogueGenerationAdmission | null =
      null;

  for (
    const admission
    of attempts
  ) {
    const attemptState =
      attemptStateFor(
        await inspectBoundLifecycle(
          dependencies,
          mediaRoot,
          admission,
        ),
      );

    const isLatest =
      admission.attemptNumber ===
      attempts.length;

    // A later attempt can only have been admitted after this one completed.
    if (
      !isLatest &&
      attemptState !==
        "CLOSED_BY_COMPLETION"
    ) {
      throw new Error(
        `Dialogue generation admission attempt ${admission.attemptNumber} for ${dialogueLineId} is ${attemptState} although a later attempt exists.`,
      );
    }

    if (isLatest) {
      latest =
        Object.freeze({
          admission,

          admissionPath:
            createDialogueGenerationAdmissionPath(
              mediaRoot,
              episodeId,
              sceneId,
              shotId,
              dialogueLineId,
              admission.attemptNumber,
            ),

          attemptState,
        });
    }
  }

  return Object.freeze({
    dialogueLineId,
    attempts:
      Object.freeze(
        attempts,
      ),
    latest,
  });
}
