// Frontend view of the D1 read-only operator API (Step 1018 sections 5 and 8).
// Hand-written runtime guards: the console never imports backend modules and
// never trusts a response shape it has not checked. Guards copy allowlisted
// fields only, so unknown fields can never reach rendering.

export const OPERATOR_API_VERSION = "v1";

// The exact D1 error codes the console may display (Step 1004A/1004B).
export const OPERATOR_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "STATE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type OperatorErrorCode = (typeof OPERATOR_ERROR_CODES)[number];

// episodeId is opaque and identifies an episode within this production only.
export type EpisodeListItem =
  | Readonly<{
      episodeId: string;
      manifest: "VALID";
      title: string;
      sceneCount: number;
      shotCount: number;
    }>
  | Readonly<{
      episodeId: string;
      manifest: "INVALID";
    }>;

// Structural part of the D1 error envelope the console uses. The backend
// message is required for validity but deliberately never kept.
export type OperatorErrorEnvelope = Readonly<{
  code: string;
  requestId: string;
}>;

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isOperatorErrorCode(value: unknown): value is OperatorErrorCode {
  return typeof value === "string" && (OPERATOR_ERROR_CODES as readonly string[]).includes(value);
}

// Only an exact 8-4-4-4-12 hexadecimal value is displayable; nothing is
// trimmed, extracted or case-folded.
export function isDisplayableRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

function parseEpisodeListItem(value: unknown): EpisodeListItem | null {
  if (!isRecord(value) || typeof value.episodeId !== "string" || value.episodeId.length === 0) {
    return null;
  }

  if (value.manifest === "VALID") {
    if (typeof value.title !== "string" || !isCount(value.sceneCount) || !isCount(value.shotCount)) {
      return null;
    }

    return Object.freeze({
      episodeId: value.episodeId,
      manifest: "VALID",
      title: value.title,
      sceneCount: value.sceneCount,
      shotCount: value.shotCount,
    });
  }

  if (value.manifest === "INVALID") {
    return Object.freeze({ episodeId: value.episodeId, manifest: "INVALID" });
  }

  return null;
}

// Returns the episodes in received order, or null when the document does not
// match the D1 episode-list contract.
export function parseEpisodeList(value: unknown): readonly EpisodeListItem[] | null {
  if (!isRecord(value) || value.apiVersion !== OPERATOR_API_VERSION || !Array.isArray(value.episodes)) {
    return null;
  }

  const episodes: EpisodeListItem[] = [];

  for (const entry of value.episodes) {
    const item = parseEpisodeListItem(entry);

    if (item === null) {
      return null;
    }

    episodes.push(item);
  }

  return Object.freeze(episodes);
}

export function parseErrorEnvelope(value: unknown): OperatorErrorEnvelope | null {
  if (!isRecord(value) || !isRecord(value.error)) {
    return null;
  }

  const { code, message, requestId } = value.error;

  if (typeof code !== "string" || typeof message !== "string" || typeof requestId !== "string") {
    return null;
  }

  return Object.freeze({ code, requestId });
}
