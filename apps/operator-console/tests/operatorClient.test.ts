import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createOperatorClient,
  EPISODE_LIST_PATH,
  OPERATOR_REQUEST_TIMEOUT_MS,
  type ListEpisodesResult,
} from "../src/api/operatorClient";

const TOKEN = "f".repeat(64);
const REQUEST_ID = "aed7ef66-15f4-48e7-8c37-6d28fa204f09";
const BODY_REQUEST_ID = "11111111-2222-3333-4444-555555555555";
const LIST = { apiVersion: "v1", episodes: [{ episodeId: "EP02", manifest: "VALID", title: "T", sceneCount: 1, shotCount: 2 }] };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

function envelope(code: string, requestId = BODY_REQUEST_ID) {
  return { error: { code, message: "D:/SECRET backend detail", requestId } };
}

// A fetch that never settles on its own and rejects like the browser when its
// signal aborts.
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
}

function stubFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function list(): Promise<ListEpisodesResult> {
  return createOperatorClient(TOKEN).listEpisodes(new AbortController().signal);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("operator client request", () => {
  it("issues exactly one same-origin GET with the frozen options", async () => {
    const fetchMock = stubFetch(async () => json(200, LIST));
    const result = await list();
    expect(result).toEqual({ ok: true, episodes: LIST.episodes });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    expect(input).toBe("/api/v1/operator/episodes");
    expect(EPISODE_LIST_PATH).toBe("/api/v1/operator/episodes");
    expect(init).toMatchObject({
      method: "GET",
      mode: "same-origin",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", Authorization: `Bearer ${TOKEN}` },
    });
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("exposes no token-bearing property and keeps the token out of results", async () => {
    stubFetch(async () => json(500, envelope("INTERNAL_ERROR")));
    const client = createOperatorClient(TOKEN);
    expect(Object.keys(client)).toEqual(["listEpisodes"]);
    expect(Object.isFrozen(client)).toBe(true);
    expect(JSON.stringify(client)).not.toContain(TOKEN);
    expect(JSON.stringify(await client.listEpisodes(new AbortController().signal))).not.toContain(TOKEN);
  });

  it.each([401, 403, 500, 503, 400, 404, 405])("makes no retry after HTTP %i", async (status) => {
    const fetchMock = stubFetch(async () => json(status, envelope("BAD_REQUEST")));
    await list();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("makes no retry after a network failure", async () => {
    const fetchMock = stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await list()).toEqual({ ok: false, failure: "NETWORK" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("timeout versus caller abort", () => {
  it("reports TIMEOUT only after the 30 s limit and leaves no timer behind", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);
    const pending = createOperatorClient(TOKEN).listEpisodes(new AbortController().signal);
    let settled: ListEpisodesResult | undefined;
    void pending.then((result) => (settled = result));
    expect(OPERATOR_REQUEST_TIMEOUT_MS).toBe(30_000);
    await vi.advanceTimersByTimeAsync(OPERATOR_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ ok: false, failure: "TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a caller abort as ABORTED, never as TIMEOUT or NETWORK", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
    const controller = new AbortController();
    const pending = createOperatorClient(TOKEN).listEpisodes(controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, failure: "ABORTED" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not fetch at all for an already-aborted signal", async () => {
    const fetchMock = stubFetch(async () => json(200, LIST));
    const controller = new AbortController();
    controller.abort();
    expect(await createOperatorClient(TOKEN).listEpisodes(controller.signal)).toEqual({ ok: false, failure: "ABORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports ABORTED when the caller aborts while the body is being read", async () => {
    const controller = new AbortController();
    stubFetch(async () => {
      const response = json(200, LIST);
      controller.abort();
      return response;
    });
    expect(await createOperatorClient(TOKEN).listEpisodes(controller.signal)).toEqual({ ok: false, failure: "ABORTED" });
  });
});

describe("response classification", () => {
  it.each([
    [401, "UNAUTHORIZED", "UNAUTHORIZED"],
    [403, "FORBIDDEN", "FORBIDDEN"],
    [503, "STATE_UNAVAILABLE", "STATE_UNAVAILABLE"],
    [500, "INTERNAL_ERROR", "SERVER_ERROR"],
    [502, "INTERNAL_ERROR", "SERVER_ERROR"],
    [400, "BAD_REQUEST", "UNEXPECTED_RESPONSE"],
    [404, "NOT_FOUND", "UNEXPECTED_RESPONSE"],
    [405, "METHOD_NOT_ALLOWED", "UNEXPECTED_RESPONSE"],
  ])("HTTP %i with code %s is %s", async (status, code, failure) => {
    stubFetch(async () => json(status, envelope(code), { "X-Request-Id": REQUEST_ID }));
    expect(await list()).toEqual({ ok: false, failure, code, requestId: REQUEST_ID });
  });

  it("omits a backend code outside the allowlist and never keeps the message", async () => {
    stubFetch(async () => json(500, envelope("PROVIDER_EXPLODED")));
    const result = await list();
    expect(result).toEqual({ ok: false, failure: "SERVER_ERROR", requestId: BODY_REQUEST_ID });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it("handles an error response without a usable envelope", async () => {
    stubFetch(async () => new Response("<html>proxy error</html>", { status: 502, headers: { "Content-Type": "text/html" } }));
    expect(await list()).toEqual({ ok: false, failure: "SERVER_ERROR" });
  });

  it("treats a non-JSON content type as UNREADABLE_RESPONSE", async () => {
    stubFetch(async () => new Response(JSON.stringify(LIST), { status: 200, headers: { "Content-Type": "text/html" } }));
    expect(await list()).toEqual({ ok: false, failure: "UNREADABLE_RESPONSE" });
  });

  it("treats malformed JSON as UNREADABLE_RESPONSE", async () => {
    stubFetch(async () => new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } }));
    expect(await list()).toEqual({ ok: false, failure: "UNREADABLE_RESPONSE" });
  });

  it("treats a shape mismatch as UNRECOGNIZED_DATA", async () => {
    stubFetch(async () => json(200, { apiVersion: "v2", episodes: [] }, { "X-Request-Id": REQUEST_ID }));
    expect(await list()).toEqual({ ok: false, failure: "UNRECOGNIZED_DATA", requestId: REQUEST_ID });
  });
});

describe("request ID selection", () => {
  it("prefers a valid X-Request-Id header", async () => {
    stubFetch(async () => json(503, envelope("STATE_UNAVAILABLE", BODY_REQUEST_ID), { "X-Request-Id": REQUEST_ID }));
    expect(await list()).toMatchObject({ requestId: REQUEST_ID });
  });

  // (Header values are whitespace-trimmed by the Fetch Headers API itself.)
  it.each([undefined, "req-1", `x${REQUEST_ID}`, `${REQUEST_ID}-extra`, `${REQUEST_ID},${REQUEST_ID}`])(
    "falls back to the envelope when the header is %j",
    async (header) => {
      stubFetch(async () => json(503, envelope("STATE_UNAVAILABLE"), header === undefined ? {} : { "X-Request-Id": header }));
      expect(await list()).toMatchObject({ requestId: BODY_REQUEST_ID });
    },
  );

  it.each(["req-7", "<b>id</b>", `${BODY_REQUEST_ID}0`, ""])("omits the request ID when neither source is valid (%j)", async (bodyId) => {
    stubFetch(async () => json(503, envelope("STATE_UNAVAILABLE", bodyId), { "X-Request-Id": "not-a-uuid" }));
    const result = await list();
    expect(result).toEqual({ ok: false, failure: "STATE_UNAVAILABLE", code: "STATE_UNAVAILABLE" });
    expect(result).not.toHaveProperty("requestId");
  });
});
