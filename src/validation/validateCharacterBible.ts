import { loadCharacterBible } from "./loadCharacterBible.js";

async function main(): Promise<void> {
  const bible = await loadCharacterBible();

  console.log(
    `Character Bible valid: ${bible.characters.length} characters loaded.`,
  );

  for (const character of bible.characters) {
    const voice =
      character.voice.selectionStatus === "LOCKED"
        ? character.voice.voiceName
        : "PENDING";

    console.log(
      `- ${character.id}: ${character.name} (${character.gender}, ${character.species}) / voice: ${voice}`,
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown validation error";

  console.error(message);
  process.exitCode = 1;
});
