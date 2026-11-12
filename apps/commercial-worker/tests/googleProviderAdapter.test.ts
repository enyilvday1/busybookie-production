import { createHash, randomBytes } from "node:crypto";

import { GoogleGenAI } from "@google/genai";
import { describe, expect, it } from "vitest";

import type { WorkerProviderAcceptance } from "../src/acceptanceHandler.js";
import type { CredentialOpener, CredentialSealingContext } from "../src/credentialContracts.js";
import { SealedCredentialCapability } from "../src/credentialOpeningRun.js";
import { GOOGLE_PROVIDER_ID, parseGoogleGenerationRequest } from "../src/googleProviderContract.js";
import {
  buildGoogleInteractionRequest,
  classifyGoogleCreateFailure,
  GOOGLE_DEFINITIVE_ERROR_CODES,
  prepareGoogleSubmission,
  type GoogleSubmissionDependencies,
} from "../src/googleProviderAdapter.js";
import type { VerifiedReferenceImage } from "../src/inputMediaRetrieval.js";
import { WorkerError } from "../src/workerError.js";

// R44B10A: the Google create adapter driven through the ACTUAL @google/genai
// 2.24.0 package with an injected counting fetch. No SDK mock, no real
// network: every request is answered locally and counted.

const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const API_KEY = `fixture-key-${randomBytes(18).toString("hex")}`;
const INTERACTION_ID = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const IMAGE: VerifiedReferenceImage = Object.freeze({
  bytes: PNG,
  byteCount: PNG.length,
  sha256: createHash("sha256").update(PNG).digest("hex"),
  contentType: "image/png",
});
const PROMPT = "A red kite over a quiet harbour.";
const REQUEST = parseGoogleGenerationRequest({ prompt: PROMPT, referenceImage: { opaque: true }, resolution: "720p" });
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const SECRET_BODY_MARKER = "provider-detail-must-not-leak";

type Answer = (request: Request) => Response | Promise<Response>;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const accepted = (id: unknown = INTERACTION_ID) => json(200, { id, status: "in_progress" });
const rejected = (status: number, code: string) => json(status, { error: { code, message: `${SECRET_BODY_MARKER} ${code}` } });

// The counting transport: one entry per HTTP request the SDK actually sends.
function countingTransport(answer: Answer) {
  const requests: Array<{ url: string; method: string; apiKey: string | null; body: Record<string, unknown>; hasSignal: boolean }> = [];
  const transport = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push({
      url: request.url,
      method: request.method,
      apiKey: request.headers.get("x-goog-api-key"),
      body: JSON.parse(await request.clone().text()) as Record<string, unknown>,
      hasSignal: request.signal instanceof AbortSignal,
    });
    return answer(request);
  }) as typeof fetch;
  return { transport, requests };
}

// A counting subclass of the REAL SDK class: construction is observable,
// behaviour is the package's own.
function countingClient() {
  const constructed: Array<Record<string, unknown>> = [];
  class CountingGoogleGenAI extends GoogleGenAI {
    constructor(options: ConstructorParameters<typeof GoogleGenAI>[0]) {
      super(options);
      const { apiKey: _key, ...rest } = options as Record<string, unknown>;
      constructed.push({ ...rest, apiKeyMatches: (options as { apiKey?: string }).apiKey === API_KEY });
    }
  }
  return { clientConstructor: CountingGoogleGenAI as unknown as typeof GoogleGenAI, constructed };
}

function capability() {
  const seen = { opened: 0 };
  const opener: CredentialOpener = {
    open: async () => {
      seen.opened += 1;
      return API_KEY;
    },
  };
  const sealed = new SealedCredentialCapability(opener, { sealed: true }, {} as CredentialSealingContext, { executionAttemptId: ATTEMPT, provider: GOOGLE_PROVIDER_ID });
  return { sealed, seen };
}

async function prepare(answer: Answer) {
  const counted = countingTransport(answer);
  const client = countingClient();
  const cap = capability();
  const dependencies: GoogleSubmissionDependencies = { transport: counted.transport, clientConstructor: client.clientConstructor };
  const operation = await prepareGoogleSubmission(
    { executionAttemptId: ATTEMPT, provider: GOOGLE_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: cap.sealed },
    dependencies,
  );
  const acceptances: WorkerProviderAcceptance[] = [];
  const execute = () =>
    operation.execute(async (acceptance) => {
      acceptances.push(acceptance);
    });
  return { operation, execute, acceptances, ...counted, ...client, opened: cap.seen };
}

const visible = (value: unknown) => (value instanceof Error ? `${value.message} ${String(value.stack)} ${JSON.stringify(value)}` : JSON.stringify(value));

describe("exact create request through the real SDK", () => {
  it("constructs one client for the Gemini Developer API and sends exactly the locked request once", async () => {
    const run = await prepare(() => accepted());
    expect(run.constructed).toHaveLength(1);
    expect(run.opened.opened).toBe(1);
    expect(run.constructed[0]).toMatchObject({ apiKeyMatches: true, vertexai: false, apiVersion: "v1beta" });
    expect((run.constructed[0]!.httpOptions as { baseUrl: string }).baseUrl).toBe("https://generativelanguage.googleapis.com/");
    // Nothing is sent before execute.
    expect(run.requests).toHaveLength(0);

    await expect(run.execute()).resolves.toEqual({ kind: "ACCEPTED" });
    expect(run.requests).toHaveLength(1);
    const [sent] = run.requests;
    expect(sent!.url).toBe(ENDPOINT);
    expect(sent!.method).toBe("POST");
    expect(sent!.apiKey).toBe(API_KEY);
    expect(sent!.hasSignal).toBe(true);
    expect(sent!.body).toEqual({
      model: "gemini-omni-1.1-flash",
      input: [
        { type: "text", text: PROMPT },
        { type: "image", data: PNG.toString("base64"), mime_type: "image/png" },
      ],
      response_format: { type: "video", delivery: "uri", resolution: "720p" },
      background: true,
      store: true,
      stream: false,
    });
    // The raw Interaction.id, unchanged, is the only acceptance.
    expect(run.acceptances).toEqual([{ provider: "GOOGLE_GENAI", providerExecutionId: INTERACTION_ID }]);
    expect(run.constructed).toHaveLength(1);
  });

  it("builds the request from the verified bytes only, with adapter-owned constants", () => {
    const built = buildGoogleInteractionRequest(REQUEST, IMAGE);
    expect(built.input[1]).toEqual({ type: "image", data: PNG.toString("base64"), mime_type: "image/png" });
    expect(built.response_format).toEqual({ type: "video", delivery: "uri", resolution: "720p" });
    expect(JSON.stringify(built)).not.toMatch(/opaque|referenceImage|key|url|path/i);
  });

  it("settles ACCEPTED only after the awaited acceptance callback", async () => {
    const counted = countingTransport(() => accepted());
    const cap = capability();
    const operation = await prepareGoogleSubmission(
      { executionAttemptId: ATTEMPT, provider: GOOGLE_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: cap.sealed },
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
    const counted = countingTransport(() => accepted());
    const operation = await prepareGoogleSubmission(
      { executionAttemptId: ATTEMPT, provider: GOOGLE_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: capability().sealed },
      { transport: counted.transport },
    );
    const failure = new WorkerError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    await expect(
      operation.execute(async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(counted.requests).toHaveLength(1);
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
      prepareGoogleSubmission(
        { executionAttemptId: ATTEMPT, provider: "BUSYBOOKIE_FAKE", request: REQUEST, image: IMAGE, sealedCredential: cap.sealed },
        { transport: counted.transport, clientConstructor: client.clientConstructor },
      ),
    ).rejects.toMatchObject({ code: "LEASED_PROVIDER_INCOMPATIBLE" });
    expect([cap.seen.opened, client.constructed.length, counted.requests.length]).toEqual([0, 0, 0]);
  });

  it("refuses preparation without an explicit transport: there is no default network", async () => {
    const client = countingClient();
    const cap = capability();
    await expect(
      prepareGoogleSubmission(
        { executionAttemptId: ATTEMPT, provider: GOOGLE_PROVIDER_ID, request: REQUEST, image: IMAGE, sealedCredential: cap.sealed },
        { clientConstructor: client.clientConstructor } as unknown as GoogleSubmissionDependencies,
      ),
    ).rejects.toMatchObject({ code: "WORKER_CONFIGURATION_INVALID" });
    expect([cap.seen.opened, client.constructed.length]).toEqual([0, 0]);
  });
});

describe("zero create retries at the actual SDK HTTP layer", () => {
  it.each([
    ["HTTP 429 rate_limit_exceeded", () => rejected(429, "rate_limit_exceeded"), "DEFINITIVE_FAILURE"],
    ["HTTP 503", () => rejected(503, "unavailable"), "AMBIGUOUS_FAILURE"],
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
  ] as const)("sends exactly one HTTP request on %s and maps it without retry", async (_label, answer, kind) => {
    const run = await prepare(answer as Answer);
    await expect(run.execute()).resolves.toEqual({ kind });
    expect(run.requests).toHaveLength(1);
    expect(run.constructed).toHaveLength(1);
    expect(run.acceptances).toEqual([]);
  });

  it("guards the guard: the same transport counts SDK retries when retries are not disabled", async () => {
    const counted = countingTransport(() => rejected(503, "unavailable"));
    const client = new GoogleGenAI({ apiKey: API_KEY, vertexai: false, apiVersion: "v1beta", httpOptions: { baseUrl: "https://generativelanguage.googleapis.com/", fetch: counted.transport } });
    await expect(
      client.interactions.create(
        { model: "gemini-omni-1.1-flash", input: [{ type: "text", text: "p" }], background: true, store: true, stream: false } as unknown as Parameters<GoogleGenAI["interactions"]["create"]>[0],
        { maxRetries: 1, timeout: 60000 },
      ),
    ).rejects.toBeDefined();
    expect(counted.requests).toHaveLength(2);
  });
});

describe("closed failure classification (typed fields only)", () => {
  const statusFor: Readonly<Record<string, number>> = {
    invalid_request: 400,
    failed_precondition: 400,
    parameter_unknown: 400,
    out_of_range: 400,
    authentication: 401,
    payment_required: 402,
    permission_denied: 403,
    not_found: 404,
    model_not_found: 404,
    rate_limit_exceeded: 429,
    quota_exceeded: 429,
    too_many_requests: 429,
    unimplemented: 501,
  };

  it("locks exactly the thirteen definitive codes", () => {
    expect([...GOOGLE_DEFINITIVE_ERROR_CODES].sort()).toEqual(Object.keys(statusFor).sort());
  });

  it.each(Object.entries(statusFor))("maps a synchronous %s (HTTP %i) before any ID to DEFINITIVE_FAILURE, in one request", async (code, status) => {
    const run = await prepare(() => rejected(status, code));
    await expect(run.execute()).resolves.toEqual({ kind: "DEFINITIVE_FAILURE" });
    expect(run.requests).toHaveLength(1);
    expect(run.acceptances).toEqual([]);
  });

  it.each([
    ["HTTP 408", () => rejected(408, "invalid_request")],
    ["HTTP 409", () => rejected(409, "invalid_request")],
    ["HTTP 499 cancelled", () => rejected(499, "cancelled")],
    ["HTTP 500", () => rejected(500, "internal")],
    ["HTTP 503 with a locked code", () => rejected(503, "rate_limit_exceeded")],
    ["HTTP 504", () => rejected(504, "deadline_exceeded")],
    ["an unknown code", () => rejected(400, "something_new")],
    ["a URI-shaped code", () => rejected(400, "https://errors.example/invalid_request")],
    ["a differently cased code", () => rejected(400, "INVALID_REQUEST")],
    ["a 4xx without a code", () => json(400, { error: { message: "no code" } })],
    ["a 4xx with an unparsable body", () => new Response("<html>bad</html>", { status: 400, headers: { "content-type": "text/html" } })],
    ["an unknown 4xx status with a locked code", () => rejected(418, "invalid_request")],
    ["an unexpected redirect status", () => json(302, {})],
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
  ] as const)("maps %s to AMBIGUOUS_FAILURE, never definitive", async (_label, answer) => {
    const run = await prepare(answer as Answer);
    await expect(run.execute()).resolves.toEqual({ kind: "AMBIGUOUS_FAILURE" });
    expect(run.requests).toHaveLength(1);
  });

  it("never classifies from message text", () => {
    expect(classifyGoogleCreateFailure(new Error("invalid_request rate_limit_exceeded 400 definitive"))).toBe("AMBIGUOUS_FAILURE");
    expect(classifyGoogleCreateFailure({ status: 400, message: "invalid_request" })).toBe("AMBIGUOUS_FAILURE");
    expect(classifyGoogleCreateFailure({ status: 400, error: { error: { code: "invalid_request" } } })).toBe("DEFINITIVE_FAILURE");
    expect(classifyGoogleCreateFailure({ status: "400", error: { error: { code: "invalid_request" } } })).toBe("AMBIGUOUS_FAILURE");
    for (const value of [undefined, null, "invalid_request", 400, []]) expect(classifyGoogleCreateFailure(value)).toBe("AMBIGUOUS_FAILURE");
  });
});

describe("malformed provider success", () => {
  it.each([
    ["no id", () => json(200, { status: "in_progress" })],
    ["an empty id", () => accepted("")],
    ["a padded id", () => accepted(`  ${INTERACTION_ID}  `)],
    ["an id with a URL", () => accepted("https://example/op")],
    ["a numeric id", () => accepted(42)],
    ["an overlong id", () => accepted("x".repeat(300))],
  ] as const)("treats %s as ambiguous plus a host fault, never acceptance or a retry", async (_label, answer) => {
    const run = await prepare(answer as Answer);
    await expect(run.execute()).resolves.toEqual({ kind: "AMBIGUOUS_FAILURE", hostFault: "MALFORMED_PROVIDER_SUCCESS" });
    expect(run.acceptances).toEqual([]);
    expect(run.requests).toHaveLength(1);
  });
});

describe("secret and provider-detail safety", () => {
  it("keeps the credential, the provider body and the request bytes out of every outcome and error", async () => {
    const outcomes: unknown[] = [];
    for (const answer of [() => rejected(400, "invalid_request"), () => rejected(503, "unavailable"), () => accepted(""), () => accepted()] as Answer[]) {
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
    for (const secret of [API_KEY, SECRET_BODY_MARKER, PNG.toString("base64")]) expect(text.includes(secret)).toBe(false);
  });

  it("never exposes the sealed capability's contents", () => {
    const { sealed } = capability();
    expect(JSON.stringify({ sealed })).toBe('{"sealed":"[sealed credential capability]"}');
    expect(Object.keys(sealed)).toEqual([]);
  });
});
