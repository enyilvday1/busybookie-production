import {
  dirname,
  resolve,
} from "node:path";

import {
  createDialogueGenerationRecordPath,
  sanitizeDialogueProviderExecutionId,
  type DialogueVoiceProvider,
} from "./dialogueGenerationRecordPath.js";

export function createDialogueAudioOutputPath(
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

  outputIndex:
    number,
): string {
  if (
    !Number.isSafeInteger(
      outputIndex,
    ) ||
    outputIndex <=
      0
  ) {
    throw new Error(
      "Dialogue audio output index must be a positive safe integer.",
    );
  }

  /*
   * Reuse the durable generation-record path contract as
   * the canonical validation boundary for:
   *
   * - absolute media root
   * - episode identity
   * - shot identity
   * - dialogue-line identity
   * - supported voice provider
   * - provider execution identity
   *
   * The returned record path is used only to derive the
   * already-validated dialogue-line directory.
   */
  const generationRecordPath =
    createDialogueGenerationRecordPath(
      mediaRoot,
      episodeId,
      shotId,
      dialogueLineId,
      provider,
      providerExecutionId,
    );

  const safeProviderExecutionId =
    sanitizeDialogueProviderExecutionId(
      providerExecutionId,
    );

  const index =
    String(
      outputIndex,
    ).padStart(
      2,
      "0",
    );

  return resolve(
    dirname(
      generationRecordPath,
    ),
    `${dialogueLineId}_${provider}_${safeProviderExecutionId}_${index}.audio`,
  );
}
