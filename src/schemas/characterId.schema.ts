import { z } from "zod";

// Standalone so E9 identity contracts can import it without a module cycle through
// character.schema.ts, which re-exports it unchanged.
export const CharacterIdSchema = z.string().regex(
  /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
  "Character id must use uppercase letters, numbers, and single underscores only.",
);
