// E9 Step 1137D1: PREACT_14 guard for persisted approval-receipt strings (Step 1137C AMBIGUITY_PATTERNS).
// Deterministic and word-aware: "or" is rejected only as a standalone word, never as letters inside a word
// such as "colour" or "accessory". The guard protects authoring-language text; machine codes stay the
// semantic authority and are governed by their own identifier schemas.

const WORD = /[\p{L}\p{N}]+/gu;

// "/" between two words (incl. "and/or") signals an alternative in free text. Applied only to free text,
// because canonical media-root-relative paths legitimately contain "/".
const SLASH_ALTERNATIVE = /[\p{L}\p{N}]\s*\/\s*[\p{L}\p{N}]/u;

const STANDALONE_ALTERNATIVE_WORDS = new Map<string, string>([
  ["or", "standalone \"or\" alternative"],
  ["either", "\"either\" alternative"],
  ["if", "\"if\" conditional"],
  ["unless", "\"unless\" conditional"],
]);

export function approvalTextWords(value: string): string[] {
  return (value.match(WORD) ?? []).map((word) => word.toLowerCase());
}

// Returns a description of the first unresolved construction, or null when the text is resolved.
export function findUnresolvedApprovalWording(
  value: string,
  options: Readonly<{ freeText: boolean }> = { freeText: true },
): string | null {
  const words = approvalTextWords(value);

  for (const word of words) {
    const finding = STANDALONE_ALTERNATIVE_WORDS.get(word);

    if (finding) return finding;
  }

  for (let index = 1; index < words.length; index += 1) {
    if (words[index - 1] === "when" && words[index] === "required") return "\"when required\" conditional";
  }

  if (options.freeText && SLASH_ALTERNATIVE.test(value)) return "\"/\" alternative between words";

  return null;
}

// Complete-receipt scan: every persisted string is checked. Keys named in freeTextKeys get the stricter
// free-text rules. Keys in closedValueKeys hold values fixed by a closed schema enum or literal (for
// example the frozen disposition EXCLUDED_SHOT_OR_STORY_STATE, whose "_OR_" is part of the code) and are
// governed by that schema alone. Every other string (open machine codes such as itemKey and valueCode,
// ids, digests, relative paths) gets the word rules.
export function collectUnresolvedApprovalWording(
  value: unknown,
  freeTextKeys: ReadonlySet<string>,
  closedValueKeys: ReadonlySet<string> = new Set(),
  path: readonly PropertyKey[] = [],
): Array<Readonly<{ path: PropertyKey[]; finding: string }>> {
  if (typeof value === "string") {
    const key = path[path.length - 1];

    if (typeof key === "string" && closedValueKeys.has(key)) return [];

    const finding = findUnresolvedApprovalWording(value, {
      freeText: typeof key === "string" && freeTextKeys.has(key),
    });

    return finding ? [{ path: [...path], finding }] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectUnresolvedApprovalWording(item, freeTextKeys, closedValueKeys, [...path, index]));
  }

  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      collectUnresolvedApprovalWording(child, freeTextKeys, closedValueKeys, [...path, key]));
  }

  return [];
}
