import { createHash, randomBytes } from "node:crypto";

import RunwayML, { APIError } from "@runwayml/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkerProviderAcceptance } from "../src/acceptanceHandler.js";
import type { CredentialOpener, CredentialSealingContext } from "../src/credentialContracts.js";
import { SealedCredentialCapability } from "../src/credentialOpeningRun.js";
import type { VerifiedReferenceImage } from "../src/inputMediaRetrieval.js";
import {
  buildRunwayCreateRequest,
  buildRunwayDataUri,
  classifyRunwayCreateFailure,
  prepareRunwaySubmission,
  RUNWAY_DEFINITIVE_STATUSES,
  type RunwaySubmissionDependencies,
} from "../src/runwayProviderAdapter.js";
import { parseRunwayGenerationRequest, RUNWAY_DATA_URI_MAX_CHARS, RUNWAY_MAX_REFERENCE_IMAGE_BYTES, RUNWAY_PROVIDER_ID } from "../src/runwayProviderContract.js";
import { WorkerError } from "../src/workerError.js";

// R44B10B: the Runway create adapter driven through the ACTUAL @runwayml/sdk
// 4.20.0 package with an injected counting fetch. No SDK mock, no real
// network: every request is answered locally and counted.

const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const API_KEY = `fixture-key-${randomBytes(18).toString("hex")}`;
const TASK_ID = "17f20503-6c24-4c16-946b-35dbbce2af2f";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const verified = (bytes: Buffer, contentType: VerifiedReferenceImage["contentType"]): VerifiedReferenceImage =>
  Object.freeze({ bytes, byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), contentType });
const IMAGE = verified(PNG, "image/png");
const PROMPT = "A red kite over a quiet harbour.";
const REQUEST = parseRunwayGenerationRequest({ prompt: PROMPT, referenceImage: { opaque: true }, durationSeconds: 4 });
const ENDPOINT = "https://api.dev.runwayml.com/v1/image_to_video";
const SECRET_BODY_MARKER = "provider-detail-must-not-leak";

type Answer = (request: Request) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (id: unknown = TASK_ID) => json(200, { id, estimatedCost: { credits: 48 } });
const rejected = (status: number, headers: Record<string, string> = {}) => json(status, { error: `${SECRET_BODY_MARKER} ${status}` }, headers);

type Sent = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown>; signal: AbortSignal | undefined };

// The counting transport: one entry per HTTP request the SDK actually sends.
function countingTransport(answer: Answer) {
  const requests: Sent[] = [];
  const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push({
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body: JSON.parse(await request.clone().text()) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    });
    return answer(request);
  }) as typeof fetch;
  return { transport, requests };
}

// A counting subclass of the REAL SDK class: construction is observable,
// behaviour is the package's own.
function countingClient() {
  const constructed: Array<Record<string, unknown>> = [];
  class CountingRunwayML extends RunwayML {
    constructor(options: ConstructorParameters<typeof RunwayML>[0]) {
      super(options);
      const { apiKey: _key, fetch: injected, ...rest } = (options ?? {}) as Record<string, unknown>;
      constructed.push({ ...rest, injectedFetch: injected, apiKeyMatches: options?.apiKey === API_KEY });
    }
  }
  return { clientConstructor: CountingRunwayML as unknown as typeof RunwayML, constructed };
}

function capability() {
  const seen = { opened: 0 };
  const opener: CredentialOpener = {
    open: async () => {
      seen.opened += 1;
      return API_KEY;
    },
  };
  const sealed = new SealedCredentialCapability(opener, { sealed: true }, {} as CredentialSealingContext, { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID });
  return { sealed, seen };
}

async function prepare(answer: Answer, image: VerifiedReferenceImage = IMAGE) {
  const counted = countingTransport(answer);
  const client = countingClient();
  const cap = capability();
  const dependencies: RunwaySubmissionDependencies = { transport: counted.transport, clientConstructor: client.clientConstructor };
  const operation = await prepareRunwaySubmission({ executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image, sealedCredential: cap.sealed }, dependencies);
  const acceptances: WorkerProviderAcceptance[] = [];
  const execute = () =>
    operation.execute(async (acceptance) => {
      acceptances.push(acceptance);
    });
  return { operation, execute, acceptances, ...counted, ...client, opened: cap.seen };
}

const visible = (value: unknown) => (value instanceof Error ? `${value.message} ${String(value.stack)} ${JSON.stringify(value)}` : JSON.stringify(value));

afterEach(() => {
  vi.useRealTimers();
});

describe("exact client authority and create request through the real SDK", () => {
  it("constructs one client with every authority explicit and sends exactly the locked request once", async () => {
    const run = await prepare(() => accepted());
    expect(run.constructed).toHaveLength(1);
    expect(run.opened.opened).toBe(1);
    expect(run.constructed[0]).toEqual({
      apiKeyMatches: true,
      baseURL: "https://api.dev.runwayml.com",
      runwayVersion: "2024-11-06",
      maxRetries: 0,
      timeout: 60000,
      logLevel: "off",
      injectedFetch: run.transport,
    });
    // Nothing is sent before execute.
    expect(run.requests).toHaveLength(0);

    await expect(run.execute()).resolves.toEqual({ kind: "ACCEPTED" });
    expect(run.requests).toHaveLength(1);
    const [sent] = run.requests;
    expect(sent!.url).toBe(ENDPOINT);
    expect(sent!.method).toBe("POST");
    expect(sent!.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(sent!.headers["x-runway-version"]).toBe("2024-11-06");
    // The per-request timeout the SDK applied (60000 ms) and no retry count.
    expect(sent!.headers["x-stainless-timeout"]).toBe("60");
    expect(sent!.headers["x-stainless-retry-count"]).toBe("0");
    // No idempotency key is set or relied on.
    expect(Object.keys(sent!.headers).filter((name) => /idempotency/i.test(name))).toEqual([]);
    expect(sent!.signal).toBeInstanceOf(AbortSignal);
    expect(sent!.body).toEqual({
      model: "gen4.5",
      promptImage: `data:image/png;base64,${PNG.toString("base64")}`,
      promptText: PROMPT,
      ratio: "1280:720",
      duration: 4,
      outputFormat: "mp4",
    });
    // The raw task.id, unchanged, is the only acceptance; estimatedCost is not part of it.
    expect(run.acceptances).toEqual([{ provider: "RUNWAY", providerExecutionId: TASK_ID }]);
    expect(run.constructed).toHaveLength(1);
  });

  it("builds the request from the authorised values only, with adapter-owned constants and no other member", () => {
    const uri = buildRunwayDataUri(IMAGE);
    const built = buildRunwayCreateRequest(REQUEST, uri);
    expect(Object.keys(built).sort()).toEqual(["duration", "model", "outputFormat", "promptImage", "promptText", "ratio"]);
    expect(built).toEqual({ model: "gen4.5", promptImage: uri, promptText: PROMPT, ratio: "1280:720", duration: 4, outputFormat: "mp4" });
    expect(JSON.stringify(built)).not.toMatch(/opaque|referenceImage|seed|contentModeration|prores|https?:|runway:\/\//i);
  });

  it.each([2, 5])("passes the authorised duration %i unchanged", async (durationSeconds) => {
    const counted = countingTransport(() => accepted());
    const operation = await prepareRunwaySubmission(
      {
        executionAttemptId: ATTEMPT,
        provider: RUNWAY_PROVIDER_ID,
        request: parseRunwayGenerationRequest({ prompt: PROMPT, referenceImage: {}, durationSeconds }),
        image: IMAGE,
        sealedCredential: capability().sealed,
      },
      { transport: counted.transport },
    );
    await operation.execute(async () => {});
    expect(counted.requests[0]!.body.duration).toBe(durationSeconds);
  });

  it("settles ACCEPTED only after the awaited acceptance callback", async () => {
    const counted = countingTransport(() => accepted());
    const operation = await prepareRunwaySubmission(
      { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: capability().sealed },
      { transport: counted.transport },
    );
    let release!: () => void;
    let settled = false;
    const seen: WorkerProviderAcceptance[] = [];
    const pending = operation
      .execute(async (acceptance) => {
        seen.push(acceptance);
        await new Promise<void>((resolve) => (release = resolve));
      })
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    while (seen.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await expect(pending).resolves.toEqual({ kind: "ACCEPTED" });
  });

  it("propagates a callback failure after a valid ID, with no second request", async () => {
    const run = await prepare(() => accepted());
    const failure = new WorkerError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    await expect(
      run.operation.execute(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(run.requests).toHaveLength(1);
    await expect(run.execute()).rejects.toMatchObject({ code: "PROVIDER_CONTRACT_VIOLATION" });
    expect(run.requests).toHaveLength(1);
  });

  it("dispatches at most once per operation and drops the client after the create settles", async () => {
    const run = await prepare(() => accepted());
    await run.execute();
    await expect(run.execute()).rejects.toMatchObject({ code: "PROVIDER_CONTRACT_VIOLATION" });
    expect(run.requests).toHaveLength(1);
    expect(run.constructed).toHaveLength(1);
  });

  it("refuses preparation for another provider without opening the credential or building a client", async () => {
    const counted = countingTransport(() => accepted());
    const client = countingClient();
    const cap = capability();
    await expect(
      prepareRunwaySubmission(
        { executionAttemptId: ATTEMPT, provider: "GOOGLE_GENAI", request: REQUEST, image: IMAGE, sealedCredential: cap.sealed },
        { transport: counted.transport, clientConstructor: client.clientConstructor },
      ),
    ).rejects.toMatchObject({ code: "LEASED_PROVIDER_INCOMPATIBLE" });
    expect([cap.seen.opened, client.constructed.length, counted.requests.length]).toEqual([0, 0, 0]);
  });

  it("refuses preparation without an explicit transport: there is no default network", async () => {
    const client = countingClient();
    const cap = capability();
    await expect(
      prepareRunwaySubmission(
        { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: cap.sealed },
        { clientConstructor: client.clientConstructor } as unknown as RunwaySubmissionDependencies,
      ),
    ).rejects.toMatchObject({ code: "WORKER_CONFIGURATION_INVALID" });
    expect([cap.seen.opened, client.constructed.length]).toEqual([0, 0]);
  });
});

describe("inline data URI from the verified bytes", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ] as const)("sends a %s reference as its exact verified data URI", async (_label, bytes, contentType) => {
    const run = await prepare(() => accepted(), verified(bytes, contentType));
    await run.execute();
    expect(run.requests[0]!.body.promptImage).toBe(`data:${contentType};base64,${bytes.toString("base64")}`);
  });

  it("derives the media type from the verified bytes, never from a mismatched label", () => {
    expect(() => buildRunwayDataUri({ ...IMAGE, contentType: "image/jpeg" })).toThrow(WorkerError);
    expect(() => buildRunwayDataUri({ ...IMAGE, bytes: Buffer.from("not an image") })).toThrow(WorkerError);
    expect(() => buildRunwayDataUri({ ...IMAGE, contentType: "image/png;base64,AAAA" as never })).toThrow(WorkerError);
  });

  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ] as const)("keeps a %s at the exact raw-byte ceiling within the final data-URI limit", (_label, header, contentType) => {
    const bytes = Buffer.alloc(RUNWAY_MAX_REFERENCE_IMAGE_BYTES);
    header.copy(bytes);
    const uri = buildRunwayDataUri(verified(bytes, contentType));
    expect(uri.length).toBeLessThanOrEqual(RUNWAY_DATA_URI_MAX_CHARS);
    expect(uri.startsWith(`data:${contentType};base64,`)).toBe(true);
  });

  it("runs the locked order: re-open the sealed grant, then the data URI, then the one client", async () => {
    const events: string[] = [];
    const opener: CredentialOpener = {
      open: async () => {
        events.push("reopen");
        return API_KEY;
      },
    };
    const sealed = new SealedCredentialCapability(opener, { sealed: true }, {} as CredentialSealingContext, { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID });
    // The verified bytes are first read by data-URI construction.
    const image = Object.freeze({
      ...IMAGE,
      get bytes() {
        if (!events.includes("dataUri")) events.push("dataUri");
        return PNG;
      },
    }) as VerifiedReferenceImage;
    class OrderedRunwayML extends RunwayML {
      constructor(options: ConstructorParameters<typeof RunwayML>[0]) {
        events.push("construct");
        super(options);
      }
    }
    const counted = countingTransport(() => accepted());
    const operation = await prepareRunwaySubmission(
      { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image, sealedCredential: sealed },
      { transport: counted.transport, clientConstructor: OrderedRunwayML as unknown as typeof RunwayML },
    );
    expect(events).toEqual(["reopen", "dataUri", "construct"]);
    expect(counted.requests).toHaveLength(0);
    await expect(operation.execute(async () => {})).resolves.toEqual({ kind: "ACCEPTED" });
    expect(counted.requests[0]!.body.promptImage).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
  });

  it("fails a local data-URI fault only after the single re-open, with no client or dispatch and the re-open spent", async () => {
    const counted = countingTransport(() => accepted());
    const client = countingClient();
    const cap = capability();
    // A label that does not match the verified bytes: a local invariant fault.
    await expect(
      prepareRunwaySubmission(
        { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image: { ...IMAGE, contentType: "image/jpeg" }, sealedCredential: cap.sealed },
        { transport: counted.transport, clientConstructor: client.clientConstructor },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_CONTRACT_VIOLATION" });
    expect([cap.seen.opened, client.constructed.length, counted.requests.length]).toEqual([1, 0, 0]);
    // The one re-open is used up: nothing can open the grant again.
    await expect(cap.sealed.openOnceFor({ executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID }, () => "again")).rejects.toMatchObject({ code: "CREDENTIAL_OPEN_FAILED" });
    expect(cap.seen.opened).toBe(1);
  });

  it("enforces the exact final string limit after the re-open and before any client or dispatch", async () => {
    // One byte above the ceiling: only reachable if retrieval were bypassed.
    const bytes = Buffer.alloc(RUNWAY_MAX_REFERENCE_IMAGE_BYTES + 1);
    JPEG.copy(bytes);
    const oversized = verified(bytes, "image/jpeg");
    expect(`data:image/jpeg;base64,${bytes.toString("base64")}`.length).toBeGreaterThan(RUNWAY_DATA_URI_MAX_CHARS);
    expect(() => buildRunwayDataUri(oversized)).toThrow(WorkerError);

    const counted = countingTransport(() => accepted());
    const client = countingClient();
    const cap = capability();
    await expect(
      prepareRunwaySubmission(
        { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image: oversized, sealedCredential: cap.sealed },
        { transport: counted.transport, clientConstructor: client.clientConstructor },
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_CONTRACT_VIOLATION" });
    expect([cap.seen.opened, client.constructed.length, counted.requests.length]).toEqual([1, 0, 0]);
  });
});

describe("zero create retries at the actual SDK HTTP layer", () => {
  const cases = [
    ["HTTP 408", () => rejected(408, { "retry-after-ms": "1" }), "AMBIGUOUS_FAILURE"],
    ["HTTP 409", () => rejected(409, { "retry-after-ms": "1" }), "AMBIGUOUS_FAILURE"],
    ["HTTP 429", () => rejected(429, { "retry-after-ms": "1" }), "DEFINITIVE_FAILURE"],
    ["HTTP 503", () => rejected(503, { "retry-after-ms": "1" }), "AMBIGUOUS_FAILURE"],
    [
      "a connection failure",
      () => {
        throw new TypeError("fetch failed");
      },
      "AMBIGUOUS_FAILURE",
    ],
    [
      "a timeout",
      () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      "AMBIGUOUS_FAILURE",
    ],
    [
      "a connection reset after the request was read (lost response)",
      async (request: Request) => {
        await request.clone().text();
        throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });
      },
      "AMBIGUOUS_FAILURE",
    ],
  ] as const;

  it.each(cases)("sends exactly one HTTP request on %s and maps it without retry", async (_label, answer, kind) => {
    const run = await prepare(answer as Answer);
    await expect(run.execute()).resolves.toEqual({ kind });
    expect(run.requests).toHaveLength(1);
    expect(run.constructed).toHaveLength(1);
    expect(run.acceptances).toEqual([]);
  });

  it("sends exactly one HTTP request when the SDK's own 60000 ms timer expires, and only then", async () => {
    vi.useFakeTimers();
    const counted = countingTransport(() => accepted());
    const aborted: string[] = [];
    const hanging = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      await counted.transport(input, { ...init, signal: null });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted.push("abort");
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    }) as typeof fetch;
    const operation = await prepareRunwaySubmission(
      { executionAttemptId: ATTEMPT, provider: RUNWAY_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: capability().sealed },
      { transport: hanging },
    );
    const pending = operation.execute(async () => {});
    await vi.advanceTimersByTimeAsync(59_999);
    expect(aborted).toEqual([]);
    expect(counted.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ kind: "AMBIGUOUS_FAILURE" });
    expect(aborted).toEqual(["abort"]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(counted.requests).toHaveLength(1);
  });

  it.each(cases.filter(([label]) => !label.startsWith("a timeout")))(
    "guards the guard: the same transport counts SDK retries on %s when retries are enabled",
    async (_label, answer) => {
      const counted = countingTransport(answer as Answer);
      const client = new RunwayML({ apiKey: API_KEY, baseURL: "https://api.dev.runwayml.com", maxRetries: 1, timeout: 60000, fetch: counted.transport, logLevel: "off" });
      await expect(
        client.imageToVideo.create({ model: "gen4.5", promptImage: "data:image/png;base64,AA==", promptText: "p", ratio: "1280:720", duration: 2 }, { maxRetries: 1 }),
      ).rejects.toBeDefined();
      expect(counted.requests.length).toBeGreaterThan(1);
    },
  );
});

describe("closed failure classification (typed fields only)", () => {
  it("locks exactly the six definitive statuses", () => {
    expect([...RUNWAY_DEFINITIVE_STATUSES]).toEqual([400, 401, 403, 404, 422, 429]);
  });

  it.each(RUNWAY_DEFINITIVE_STATUSES.map((status) => [status]))("maps a synchronous HTTP %i before any ID to DEFINITIVE_FAILURE, in one request", async (status) => {
    const run = await prepare(() => rejected(status));
    await expect(run.execute()).resolves.toEqual({ kind: "DEFINITIVE_FAILURE" });
    expect(run.requests).toHaveLength(1);
    expect(run.acceptances).toEqual([]);
  });

  it.each([
    ["HTTP 408", () => rejected(408)],
    ["HTTP 409", () => rejected(409)],
    ["HTTP 500", () => rejected(500)],
    ["HTTP 502", () => rejected(502)],
    ["HTTP 503", () => rejected(503)],
    ["HTTP 504", () => rejected(504)],
    ["an unlocked 402", () => rejected(402)],
    ["an unlocked 405", () => rejected(405)],
    ["an unknown 418", () => rejected(418)],
    ["an unknown 499", () => rejected(499)],
    ["an unexpected redirect status", () => json(302, {})],
    ["a 503 with an explicit no-retry header", () => rejected(503, { "x-should-retry": "false" })],
    ["an HTML 500", () => new Response("<html>oops</html>", { status: 500, headers: { "content-type": "text/html" } })],
    [
      "an abort",
      () => {
        throw new DOMException("aborted", "AbortError");
      },
    ],
    [
      "an unknown transport exception",
      () => {
        throw new Error("unexpected");
      },
    ],
    ["a nominal success whose JSON body cannot be parsed", () => new Response("{", { status: 200, headers: { "content-type": "application/json" } })],
  ] as const)("maps %s to AMBIGUOUS_FAILURE, never definitive", async (_label, answer) => {
    const run = await prepare(answer as Answer);
    await expect(run.execute()).resolves.toEqual({ kind: "AMBIGUOUS_FAILURE" });
    expect(run.requests).toHaveLength(1);
    expect(run.acceptances).toEqual([]);
  });

  it("never classifies from message text, headers, body or a look-alike object", () => {
    expect(classifyRunwayCreateFailure(new Error("400 Bad Request definitive"))).toBe("AMBIGUOUS_FAILURE");
    expect(classifyRunwayCreateFailure({ status: 400 })).toBe("AMBIGUOUS_FAILURE");
    expect(classifyRunwayCreateFailure(Object.assign(new Error("x"), { status: 400 }))).toBe("AMBIGUOUS_FAILURE");
    expect(classifyRunwayCreateFailure(new APIError(400, { error: "x" }, undefined, new Headers()))).toBe("DEFINITIVE_FAILURE");
    expect(classifyRunwayCreateFailure(new APIError(503, { error: "400 invalid" }, "400", new Headers({ status: "400" })))).toBe("AMBIGUOUS_FAILURE");
    expect(classifyRunwayCreateFailure(new APIError(undefined, undefined, "400 bad request", undefined))).toBe("AMBIGUOUS_FAILURE");
    for (const value of [undefined, null, "400", 400, []]) expect(classifyRunwayCreateFailure(value)).toBe("AMBIGUOUS_FAILURE");
  });
});

describe("malformed provider success", () => {
  it.each([
    ["no id", () => json(200, { estimatedCost: { credits: 48 } })],
    ["an empty id", () => accepted("")],
    ["a padded id", () => accepted(`  ${TASK_ID}  `)],
    ["an id with a URL", () => accepted("https://example/task")],
    ["a numeric id", () => accepted(42)],
    ["an overlong id", () => accepted("x".repeat(300))],
    ["a non-JSON success body", () => new Response(TASK_ID, { status: 200, headers: { "content-type": "text/plain" } })],
    ["an empty success body", () => new Response(null, { status: 204 })],
  ] as const)("treats %s as ambiguous plus a host fault, never acceptance or a retry", async (_label, answer) => {
    const run = await prepare(answer as Answer);
    await expect(run.execute()).resolves.toEqual({ kind: "AMBIGUOUS_FAILURE", hostFault: "MALFORMED_PROVIDER_SUCCESS" });
    expect(run.acceptances).toEqual([]);
    expect(run.requests).toHaveLength(1);
  });
});

describe("secret and provider-detail safety", () => {
  it("keeps the credential, the provider body, the data URI and the image bytes out of every outcome and error", async () => {
    const outcomes: unknown[] = [];
    for (const answer of [() => rejected(400), () => rejected(503), () => accepted(""), () => accepted()] as Answer[]) {
      const run = await prepare(answer);
      outcomes.push(await run.execute(), run.acceptances);
    }
    const failing = await prepare(() => accepted());
    const error = await failing.operation
      .execute(async () => {
        throw new WorkerError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
      })
      .catch((caught: unknown) => caught);
    const text = outcomes.map(visible).join(" ") + visible(error);
    for (const secret of [API_KEY, SECRET_BODY_MARKER, PNG.toString("base64"), "data:image", "estimatedCost", "credits"]) expect(text.includes(secret)).toBe(false);
  });

  it("logs nothing through the SDK", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    try {
      for (const answer of [() => rejected(400), () => rejected(503), () => accepted()] as Answer[]) await (await prepare(answer)).execute();
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
