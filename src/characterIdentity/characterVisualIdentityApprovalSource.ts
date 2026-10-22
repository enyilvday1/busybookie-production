import {
  canonicalCharacterIdentityJson,
  characterIdentitySha256,
} from "./canonicalCharacterIdentityJson.js";

import {
  findUnresolvedApprovalWording,
} from "./characterVisualIdentityApprovalAmbiguity.js";

import type {
  Character,
  CharacterBible,
} from "../schemas/character.schema.js";

// E9 Step 1137D1 (Step 1137C r1137c-1): approval decisions point at CharacterBible source strings by
// field + index + sourceTextSha256. The source prose itself is never copied into a receipt.

export const CHARACTER_APPROVAL_SOURCE_FIELDS = [
  "appearance.outfit",
  "appearance.accessories",
] as const;

export type CharacterApprovalSourceField =
  (typeof CHARACTER_APPROVAL_SOURCE_FIELDS)[number];

export type CharacterApprovalSourceLocation =
  Readonly<{
    field: CharacterApprovalSourceField;
    index: number;
  }>;

export function sourceLocationKey(location: CharacterApprovalSourceLocation): string {
  return `${location.field}[${location.index}]`;
}

// Whole-Bible provenance anchor: E9 canonical JSON of the validated CharacterBible, not raw file bytes.
export function computeCharacterBibleCanonicalSha256(bible: CharacterBible): string {
  return characterIdentitySha256(canonicalCharacterIdentityJson(bible));
}

// Exact UTF-8 bytes of the JavaScript string: no trim, case folding, whitespace, punctuation or Unicode
// normalization. Any change to the string changes the digest.
export function computeExactSourceTextSha256(text: string): string {
  return characterIdentitySha256(text);
}

function sourceList(character: Character, field: CharacterApprovalSourceField): readonly string[] {
  return field === "appearance.outfit"
    ? character.appearance.outfit
    : character.appearance.accessories;
}

export function isCharacterApprovalSourceField(value: unknown): value is CharacterApprovalSourceField {
  return CHARACTER_APPROVAL_SOURCE_FIELDS.some((field) => field === value);
}

// Every outfit/accessories entry of the character, in field then index order. Each needs exactly one decision.
export function listCharacterApprovalSourceLocations(character: Character): CharacterApprovalSourceLocation[] {
  return CHARACTER_APPROVAL_SOURCE_FIELDS.flatMap((field) =>
    sourceList(character, field).map((_, index) => ({ field, index })));
}

// Reads the exact source string from the validated CharacterBible. Unknown fields and missing indices fail.
export function resolveCharacterApprovalSourceText(
  character: Character,
  location: Readonly<{ field: unknown; index: unknown }>,
): string {
  if (!isCharacterApprovalSourceField(location.field)) {
    throw new Error(
      `Character approval source field must be one of ${CHARACTER_APPROVAL_SOURCE_FIELDS.join(", ")}; received ${String(location.field)}.`,
    );
  }

  const { index } = location;

  if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) {
    throw new Error(`Character approval source index must be a non-negative safe integer; received ${String(index)}.`);
  }

  const text = sourceList(character, location.field)[index];

  if (text === undefined) {
    throw new Error(`Character ${character.id} has no source entry at ${location.field}[${index}].`);
  }

  return text;
}

export function sourceTextRequiresResolution(text: string): boolean {
  return findUnresolvedApprovalWording(text, { freeText: true }) !== null;
}

// Frozen D1 immediate-token grammar: the source contains exactly one standalone lowercase "or", separated by
// single spaces, and the tokens immediately before and after it are single ASCII alphabetic words. Those two
// immediate tokens are the candidate alternatives. Anything else fails closed. General to the grammar: no
// per-character table. It does not claim semantic multi-word detection: in "light x or y" it cannot know
// whether "light" belongs to the alternative, so it yields X/Y. Onboarding therefore runs only
// against a frozen, human-reviewed CharacterBible digest, and 1137E replaces this prose with structured state.
export function parseCharacterApprovalSourceAlternatives(text: string): readonly [string, string] {
  const tokens = text.split(" ");

  if (tokens.some((token) => token.length === 0)) {
    throw new Error(`Unrecognised alternative grammar (irregular spacing): "${text}".`);
  }

  if (tokens.some((token) => token !== "or" && token.toLowerCase() === "or")) {
    throw new Error(`Unrecognised alternative grammar (non-canonical "or"): "${text}".`);
  }

  const orIndices = tokens.flatMap((token, index) => (token === "or" ? [index] : []));

  if (orIndices.length !== 1) {
    throw new Error(
      `Alternative grammar requires exactly one standalone "or"; found ${orIndices.length} in "${text}".`,
    );
  }

  const orIndex = orIndices[0]!;
  const left = tokens[orIndex - 1];
  const right = tokens[orIndex + 1];

  if (left === undefined || right === undefined || !/^[A-Za-z]+$/.test(left) || !/^[A-Za-z]+$/.test(right)) {
    throw new Error(
      `Alternative grammar requires one alphabetic word on each side of "or" in "${text}".`,
    );
  }

  const alternatives = [left.toUpperCase(), right.toUpperCase()] as const;

  if (alternatives[0] === alternatives[1]) {
    throw new Error(`Alternative grammar requires two distinct alternatives in "${text}".`);
  }

  return alternatives;
}

// Case-insensitive match of the human value code against the parsed alternatives; returns the canonical code.
export function selectCharacterApprovalAlternative(text: string, requestedValueCode: string): string {
  const alternatives = parseCharacterApprovalSourceAlternatives(text);
  const selected = alternatives.find((alternative) => alternative === requestedValueCode.toUpperCase());

  if (!selected) {
    throw new Error(
      `Value ${requestedValueCode} is not one of the alternatives offered by the CharacterBible source (${alternatives.join(", ")}).`,
    );
  }

  return selected;
}
