import {
  isAbsolute,
  resolve,
} from "node:path";

const EPISODE_ID_PATTERN =
  /^EP[0-9]{2,3}$/;

const SHOT_ID_PATTERN =
  /^S[0-9]{2,3}[A-Z]?$/;

const DIALOGUE_LINE_ID_PATTERN =
  /^EP[0-9]{2,3}_SC[0-9]{2,3}_S[0-9]{2,3}[A-Z]?_L[0-9]{2,3}$/;

export type DialogueVoiceProvider =
  "RUNWAY";

export function sanitizeDialogueProviderExecutionId(
  providerExecutionId:
    string,
): string {
  const trimmed =
    providerExecutionId.trim();

  if (!trimmed) {
    throw new Error(
      "Dialogue provider execution id cannot be empty.",
    );
  }

  const safeId =
    trimmed
      .replace(
        /[^A-Za-z0-9_-]+/g,
        "_",
      )
      .replace(
        /^[_-]+|[_-]+$/g,
        "",
      )
      .slice(
        0,
        100,
      );

  if (!safeId) {
    throw new Error(
      "Dialogue provider execution id cannot produce a safe identifier.",
    );
  }

  return safeId;
}

function validateDialogueLineIdentity(
  episodeId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,
): void {
  if (
    !DIALOGUE_LINE_ID_PATTERN.test(
      dialogueLineId,
    )
  ) {
    throw new Error(
      `Invalid dialogue line identity: ${dialogueLineId}`,
    );
  }

  const expectedPrefix =
    `${episodeId}_`;

  const expectedShotToken =
    `_${shotId}_`;

  if (
    !dialogueLineId.startsWith(
      expectedPrefix,
    ) ||
    !dialogueLineId.includes(
      expectedShotToken,
    )
  ) {
    throw new Error(
      `Dialogue line identity does not match ${episodeId}/${shotId}: ${dialogueLineId}`,
    );
  }
}

export function createDialogueGenerationRecordPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,

  provider:
    DialogueVoiceProvider,

  providerExecutionId:
    string,
): string {
  if (
    !isAbsolute(
      mediaRoot,
    )
  ) {
    throw new Error(
      "Dialogue media root must be absolute.",
    );
  }

  if (
    !EPISODE_ID_PATTERN.test(
      episodeId,
    )
  ) {
    throw new Error(
      `Invalid dialogue episode id: ${episodeId}`,
    );
  }

  if (
    !SHOT_ID_PATTERN.test(
      shotId,
    )
  ) {
    throw new Error(
      `Invalid dialogue shot id: ${shotId}`,
    );
  }

  validateDialogueLineIdentity(
    episodeId,
    shotId,
    dialogueLineId,
  );

  if (
    provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Unsupported dialogue voice provider: ${provider}`,
    );
  }

  const safeProviderExecutionId =
    sanitizeDialogueProviderExecutionId(
      providerExecutionId,
    );

  return resolve(
    mediaRoot,
    "voices",
    episodeId,
    shotId,
    dialogueLineId,
    `${dialogueLineId}_${provider}_${safeProviderExecutionId}.dialogue-generation.json`,
  );
}
