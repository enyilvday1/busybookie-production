import {
  isDisplayableRequestId,
  isOperatorErrorCode,
  parseEpisodeList,
  parseErrorEnvelope,
  type EpisodeListItem,
  type OperatorErrorCode,
} from "./operatorDtos";

// The only module that talks to the operator API (Step 1018 section 7).
// Same-origin relative URL, explicit bearer header, no cookies, no HTTP
// cache, one fetch per call: no retry, no polling, no background requests.

export const EPISODE_LIST_PATH = "/api/v1/operator/episodes";

export const OPERATOR_REQUEST_TIMEOUT_MS = 30_000;

// ABORTED is the caller's own cancellation (Refresh, Lock, unmount) and is
// never shown to the operator.
export type OperatorFailure =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "STATE_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNEXPECTED_RESPONSE"
  | "NETWORK"
  | "TIMEOUT"
  | "UNREADABLE_RESPONSE"
  | "UNRECOGNIZED_DATA"
  | "ABORTED";

export type ListEpisodesResult =
  | Readonly<{ ok: true; episodes: readonly EpisodeListItem[] }>
  | Readonly<{ ok: false; failure: OperatorFailure; code?: OperatorErrorCode; requestId?: string }>;

// The credential lives only in the closure behind listEpisodes; the client
// object carries no token-bearing property.
export type OperatorClient = Readonly<{
  listEpisodes: (signal: AbortSignal) => Promise<ListEpisodesResult>;
}>;

function failed(
  failure: OperatorFailure,
  extra: Readonly<{ code?: OperatorErrorCode | undefined; requestId?: string | undefined }> = {},
): ListEpisodesResult {
  return Object.freeze({
    ok: false,
    failure,
    ...(extra.code === undefined ? {} : { code: extra.code }),
    ...(extra.requestId === undefined ? {} : { requestId: extra.requestId }),
  });
}

function statusFailure(status: number): OperatorFailure {
  if (status === 401) {
    return "UNAUTHORIZED";
  }

  if (status === 403) {
    return "FORBIDDEN";
  }

  if (status === 503) {
    return "STATE_UNAVAILABLE";
  }

  return status >= 500 ? "SERVER_ERROR" : "UNEXPECTED_RESPONSE";
}

function parseJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return null;
  }
}

export function createOperatorClient(token: string): OperatorClient {
  const authorization = `Bearer ${token}`;

  async function listEpisodes(signal: AbortSignal): Promise<ListEpisodesResult> {
    if (signal.aborted) {
      return failed("ABORTED");
    }

    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    signal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OPERATOR_REQUEST_TIMEOUT_MS);

    // A caller abort always wins: deliberate cancellation is never reported
    // as a timeout or a network failure.
    const interrupted = (): OperatorFailure => (signal.aborted ? "ABORTED" : timedOut ? "TIMEOUT" : "NETWORK");

    try {
      let response: Response;

      try {
        response = await fetch(EPISODE_LIST_PATH, {
          method: "GET",
          mode: "same-origin",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json", Authorization: authorization },
          signal: controller.signal,
        });
      } catch {
        return failed(interrupted());
      }

      const headerRequestId = response.headers.get("X-Request-Id");
      let text: string;

      try {
        text = await response.text();
      } catch {
        const failure = interrupted();
        return failed(failure === "NETWORK" ? "UNREADABLE_RESPONSE" : failure);
      }

      if (signal.aborted) {
        return failed("ABORTED");
      }

      if (!response.ok) {
        const parsed = parseJson(text);
        const envelope = parsed === null ? null : parseErrorEnvelope(parsed.value);
        const requestId = isDisplayableRequestId(headerRequestId)
          ? headerRequestId
          : isDisplayableRequestId(envelope?.requestId)
            ? envelope.requestId
            : undefined;
        const code = isOperatorErrorCode(envelope?.code) ? envelope.code : undefined;
        return failed(statusFailure(response.status), { code, requestId });
      }

      const requestId = isDisplayableRequestId(headerRequestId) ? headerRequestId : undefined;
      const contentType = response.headers.get("Content-Type") ?? "";
      const parsed = contentType.toLowerCase().startsWith("application/json") ? parseJson(text) : null;

      if (parsed === null) {
        return failed("UNREADABLE_RESPONSE", { requestId });
      }

      const episodes = parseEpisodeList(parsed.value);

      if (episodes === null) {
        return failed("UNRECOGNIZED_DATA", { requestId });
      }

      return Object.freeze({ ok: true, episodes });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", forwardAbort);
    }
  }

  return Object.freeze({ listEpisodes });
}
