import type {
  DialogueVoicePolicy,
} from "../schemas/dialogueVoicePolicy.schema.js";

function requireDialoguePrompt(
  promptText:
    string,
): string {
  if (
    promptText.trim()
      .length ===
    0
  ) {
    throw new Error(
      "Dialogue generation requires non-empty prompt text.",
    );
  }

  return promptText;
}

export function calculateDialogueExpectedCredits(
  promptText:
    string,

  policy:
    DialogueVoicePolicy,
): number {
  const prompt =
    requireDialoguePrompt(
      promptText,
    );

  const calculatedCredits =
    Math.ceil(
      prompt.length /
      policy.generation
        .charactersPerCredit,
    );

  return Math.max(
    policy.generation
      .minimumCredits,
    calculatedCredits,
  );
}

export function assertDialogueWithinBudget(
  promptText:
    string,

  policy:
    DialogueVoicePolicy,
): number {
  const prompt =
    requireDialoguePrompt(
      promptText,
    );

  if (
    prompt.length >
    policy.generation
      .maxPromptCharacters
  ) {
    throw new Error(
      `Dialogue generation blocked: prompt contains ${prompt.length} characters, exceeding the local ${policy.generation.maxPromptCharacters}-character limit.`,
    );
  }

  const expectedCredits =
    calculateDialogueExpectedCredits(
      prompt,
      policy,
    );

  if (
    expectedCredits >
    policy.generation
      .maxCreditsPerLine
  ) {
    throw new Error(
      `Dialogue generation blocked: locally calculated cost is ${expectedCredits} credits, exceeding the ${policy.generation.maxCreditsPerLine}-credit line limit.`,
    );
  }

  return expectedCredits;
}
