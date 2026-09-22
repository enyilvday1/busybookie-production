import {
  isAbsolute,
  resolve,
} from "node:path";

const EPISODE_ID_PATTERN =
  /^EP[0-9]{2,3}$/;

const SHOT_ID_PATTERN =
  /^S[0-9]{2,3}[A-Z]?$/;

export function sanitizeVeoOperationId(
  operationName:
    string,
): string {
  const trimmed =
    operationName.trim();

  if (!trimmed) {
    throw new Error(
      "Veo operation name cannot be empty.",
    );
  }

  const segments =
    trimmed
      .split("/")
      .filter(
        Boolean,
      );

  const rawId =
    segments.at(-1) ??
    trimmed;

  const safeId =
    rawId
      .replace(
        /[^A-Za-z0-9_-]+/g,
        "_",
      )
      .slice(
        0,
        100,
      );

  if (!safeId) {
    throw new Error(
      "Veo operation name cannot produce a safe output identifier.",
    );
  }

  return safeId;
}

export function createVeoVideoOutputPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  operationName:
    string,

  outputIndex:
    number,
): string {
  if (
    !isAbsolute(
      mediaRoot,
    )
  ) {
    throw new Error(
      "Veo media root must be absolute.",
    );
  }

  if (
    !EPISODE_ID_PATTERN.test(
      episodeId,
    )
  ) {
    throw new Error(
      `Invalid Veo episode id: ${episodeId}`,
    );
  }

  if (
    !SHOT_ID_PATTERN.test(
      shotId,
    )
  ) {
    throw new Error(
      `Invalid Veo shot id: ${shotId}`,
    );
  }

  if (
    !Number.isSafeInteger(
      outputIndex,
    ) ||
    outputIndex <= 0
  ) {
    throw new Error(
      "Veo output index must be a positive safe integer.",
    );
  }

  const operationId =
    sanitizeVeoOperationId(
      operationName,
    );

  const index =
    String(
      outputIndex,
    )
      .padStart(
        2,
        "0",
      );

  return resolve(
    mediaRoot,
    "generated-video",
    episodeId,
    shotId,
    `${episodeId}_${shotId}_${operationId}_${index}.mp4`,
  );
}
