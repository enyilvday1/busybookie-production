import {
  resolve,
} from "node:path";

function sanitizeTaskId(
  taskId: string,
): string {
  const sanitized =
    taskId
      .trim()
      .replace(
        /[^A-Za-z0-9_-]+/g,
        "_",
      )
      .slice(
        0,
        80,
      );

  if (!sanitized) {
    throw new Error(
      "Runway task id cannot produce an empty output filename.",
    );
  }

  return sanitized;
}

export function createRunwayVideoOutputPath(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  taskId: string,
  outputIndex: number,
): string {
  if (
    !/^EP[0-9]{2,3}$/.test(
      episodeId,
    )
  ) {
    throw new Error(
      `Invalid episode id: ${episodeId}`,
    );
  }

  if (
    !/^S[0-9]{2,3}[A-Z]?$/.test(
      shotId,
    )
  ) {
    throw new Error(
      `Invalid shot id: ${shotId}`,
    );
  }

  if (
    !Number.isInteger(
      outputIndex,
    ) ||
    outputIndex < 1
  ) {
    throw new Error(
      "Runway output index must be a positive integer.",
    );
  }

  const safeTaskId =
    sanitizeTaskId(
      taskId,
    );

  const index =
    String(
      outputIndex,
    ).padStart(
      2,
      "0",
    );

  return resolve(
    mediaRoot,
    "generated-video",
    episodeId,
    shotId,
    `${episodeId}_${shotId}_${safeTaskId}_${index}.mp4`,
  );
}
