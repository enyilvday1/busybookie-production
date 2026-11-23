import { randomBytes } from "node:crypto";

import { GOOGLE_PROVIDER_ID } from "commercial-worker-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGoogleVerificationRequest, classifyGoogleVerificationOutcome } from "../src/googleProviderVerification.js";
import { isProviderVerificationResultReport, PROVIDER_VERIFICATION_REASONS_BY_OUTCOME, type ProviderVerificationResultReport } from "../src/providerVerificationContract.js";
import { performProviderVerification, type ProviderVerificationRawOutcome } from "../src/providerVerificationTransport.js";

// R44B11F Phase 6: the fixed Google verification request and classifier
// (architecture "Fixed requests", "Result classification", "Success shapes",
// "Google authentication and authorization semantics"). Every request goes
// through the real transport to an injected fake fetchImpl; nothing reaches
// a provider.

const POLICY = "GOOGLE_GENAI_MODELS_LIST_V1BETA";
const URL_LITERAL = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1";
const CREDENTIAL = `fixture-google-key-${randomBytes(16).toString("hex")}`;
const encoder = new TextEncoder();

const report = (outcome: string, reasonCode: string) => ({ outcome, reasonCode });
const VERIFIED = report("VERIFIED", "VERIFICATION_SUCCEEDED");
const REJECTED = report("DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED");
const NOT_AUTHORIZED = report("DEFINITIVE_FAILURE", "CREDENTIAL_NOT_AUTHORIZED");
const TIMEOUT = report("INCONCLUSIVE", "PROVIDER_TIMEOUT");
const AMBIGUOUS = report("INCONCLUSIVE", "VERIFICATION_AMBIGUOUS");
const NETWORK = report("INCONCLUSIVE", "PROVIDER_NETWORK_FAILURE");
const TOO_LARGE = report("INCONCLUSIVE", "PROVIDER_RESPONSE_TOO_LARGE");
const MALFORMED = report("INCONCLUSIVE", "PROVIDER_RESPONSE_MALFORMED");
const DRIFT = report("INCONCLUSIVE", "PROVIDER_OPERATION_DRIFT");
const BILLING = report("INCONCLUSIVE", "PROVIDER_BILLING_RESTRICTION");
const RATE = report("INCONCLUSIVE", "PROVIDER_RATE_OR_QUOTA_LIMITED");
const UNAVAILABLE = report("INCONCLUSIVE", "PROVIDER_UNAVAILABLE");
const UNEXPECTED = report("INCONCLUSIVE", "PROVIDER_UNEXPECTED_STATUS");

const streamOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
const bodyBytes = (body: string | Uint8Array) => (typeof body === "string" ? encoder.encode(body) : body);
// A response-shaped fake: any status from 0 to 599 (a real Response refuses 0 and 1xx).
const fakeResponse = (status: number, body: string | Uint8Array | null = "", headers: Record<string, string> = {}) =>
  Object.freeze({ status, headers: new Headers(headers), body: body === null ? null : streamOf(bodyBytes(body)) });
const json = (value: unknown) => JSON.stringify(value);
const envelope = (error: unknown) => json({ error });
const errorInfo = (reason: string) => ({ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com", metadata: { service: "x" } });

type Call = Readonly<{ url: unknown; init: RequestInit | undefined }>;
const seenReports: ProviderVerificationResultReport[] = [];

async function verifyWith(answer: () => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  const result = await performProviderVerification({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: POLICY, credential: CREDENTIAL }, { fetchImpl });
  seenReports.push(result);
  return { result, calls };
}
const verify = (status: number, body: string | Uint8Array | null = "", headers: Record<string, string> = {}) => verifyWith(() => fakeResponse(status, body, headers));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Google verification request (R44B11F Phase 6)", () => {
  it("builds the exact frozen request: the complete URL literal and exactly one header", () => {
    const request = buildGoogleVerificationRequest(CREDENTIAL);
    expect(request).toEqual({ url: URL_LITERAL, headers: { "x-goog-api-key": CREDENTIAL } });
    expect(Object.keys(request).sort()).toEqual(["headers", "url"]);
    expect(Object.keys(request.headers)).toEqual(["x-goog-api-key"]);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
    expect(Object.getPrototypeOf(request.headers)).toBe(Object.prototype);
    const url = new URL(request.url);
    expect([url.origin, url.pathname, url.search]).toEqual(["https://generativelanguage.googleapis.com", "/v1beta/models", "?pageSize=1"]);
  });

  it("sends exactly one GET with the locked URL, header, manual redirect and the internal signal, and no body", async () => {
    const { result, calls } = await verify(200, json({ models: [] }));
    expect(result).toEqual(VERIFIED);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Call];
    expect(url).toBe(URL_LITERAL);
    expect(Object.keys(init ?? {}).sort()).toEqual(["headers", "method", "redirect", "signal"]);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ "x-goog-api-key": CREDENTIAL });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});

describe("Google success shape (R44B11F Phase 6)", () => {
  it.each([
    ["models with an element", json({ models: [{ name: "models/x" }], nextPageToken: "t" })],
    ["an empty models array", json({ models: [] })],
    ["models absent", json({})],
    ["other members ignored", json({ nextPageToken: "t", extra: { error: 1 } })],
  ])("is VERIFIED for %s", async (_name, body) => {
    expect((await verify(200, body)).result).toEqual(VERIFIED);
  });

  it.each([
    ["malformed JSON", "{"],
    ["an empty body", ""],
    ["a missing body", null],
    ["invalid UTF-8", Uint8Array.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])],
    ["an array", json([])],
    ["a string", json("x")],
    ["a number", json(1)],
    ["a boolean", json(true)],
    ["null", "null"],
    ["an own error member", json({ models: [], error: { status: "OK" } })],
    ["an own null error member", json({ error: null })],
    ["a non-array models member", json({ models: {} })],
    ["a null models member", json({ models: null })],
    ["a string models member", json({ models: "x" })],
  ])("is PROVIDER_RESPONSE_MALFORMED for a 200 with %s", async (_name, body) => {
    expect((await verify(200, body)).result).toEqual(MALFORMED);
  });
});

describe("Google status classification (R44B11F Phase 6)", () => {
  it.each([
    [0, DRIFT],
    [300, DRIFT],
    [302, DRIFT],
    [399, DRIFT],
    [400, AMBIGUOUS],
    [401, AMBIGUOUS],
    [402, BILLING],
    [403, AMBIGUOUS],
    [404, DRIFT],
    [405, DRIFT],
    [410, DRIFT],
    [429, RATE],
    [500, UNAVAILABLE],
    [503, UNAVAILABLE],
    [599, UNAVAILABLE],
    [201, UNEXPECTED],
    [204, UNEXPECTED],
    [299, UNEXPECTED],
    [100, UNEXPECTED],
    [199, UNEXPECTED],
    [406, UNEXPECTED],
    [409, UNEXPECTED],
    [411, UNEXPECTED],
    [418, UNEXPECTED],
    [428, UNEXPECTED],
    [430, UNEXPECTED],
    [451, UNEXPECTED],
    [499, UNEXPECTED],
  ])("status %i without a body envelope maps as tabled", async (status, expected) => {
    expect((await verify(status, "")).result).toEqual(expected);
  });

  it("is DEFINITIVE_FAILURE / CREDENTIAL_REJECTED only for a 401 envelope whose error.status is exactly UNAUTHENTICATED", async () => {
    expect((await verify(401, envelope({ code: 401, status: "UNAUTHENTICATED", message: "x" }))).result).toEqual(REJECTED);
    for (const body of [
      envelope({ status: "unauthenticated" }),
      envelope({ status: "PERMISSION_DENIED" }),
      envelope({ status: " UNAUTHENTICATED" }),
      envelope({ code: 401, message: "UNAUTHENTICATED" }),
      envelope({ status: ["UNAUTHENTICATED"] }),
      envelope("UNAUTHENTICATED"),
      envelope(null),
      envelope([{ status: "UNAUTHENTICATED" }]),
      json({ status: "UNAUTHENTICATED" }),
      json([{ error: { status: "UNAUTHENTICATED" } }]),
      "not json",
      "",
    ]) {
      expect((await verify(401, body)).result, body).toEqual(AMBIGUOUS);
    }
  });

  it("is DEFINITIVE_FAILURE / CREDENTIAL_NOT_AUTHORIZED only for a 403 envelope whose error.status is exactly PERMISSION_DENIED and no billing reason", async () => {
    expect((await verify(403, envelope({ code: 403, status: "PERMISSION_DENIED", details: [errorInfo("API_KEY_SERVICE_BLOCKED")] }))).result).toEqual(NOT_AUTHORIZED);
    for (const body of [
      envelope({ status: "permission_denied" }),
      envelope({ status: "UNAUTHENTICATED" }),
      envelope({ message: "PERMISSION_DENIED" }),
      json({ status: "PERMISSION_DENIED" }),
      "not json",
      "",
    ]) {
      expect((await verify(403, body)).result, body).toEqual(AMBIGUOUS);
    }
  });

  it("checks a 403 for BILLING_DISABLED first, from an ErrorInfo detail only", async () => {
    expect((await verify(403, envelope({ status: "PERMISSION_DENIED", details: [errorInfo("BILLING_DISABLED")] }))).result).toEqual(BILLING);
    expect((await verify(403, envelope({ status: "FAILED_PRECONDITION", details: [{ "@type": "x" }, errorInfo("BILLING_DISABLED")] }))).result).toEqual(BILLING);
    // Not an ErrorInfo, a near-miss reason, or reason text elsewhere: the status decides.
    expect((await verify(403, envelope({ status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.Help", reason: "BILLING_DISABLED" }] }))).result).toEqual(
      NOT_AUTHORIZED,
    );
    expect((await verify(403, envelope({ status: "PERMISSION_DENIED", details: [errorInfo("billing_disabled")] }))).result).toEqual(NOT_AUTHORIZED);
    expect((await verify(403, envelope({ status: "PERMISSION_DENIED", message: "BILLING_DISABLED", details: errorInfo("BILLING_DISABLED") }))).result).toEqual(NOT_AUTHORIZED);
    expect((await verify(403, envelope({ status: "OTHER", details: [errorInfo("BILLING_DISABLED_X")] }))).result).toEqual(AMBIGUOUS);
    // A billing reason on a 401 is not consulted.
    expect((await verify(401, envelope({ status: "UNAUTHENTICATED", details: [errorInfo("BILLING_DISABLED")] }))).result).toEqual(REJECTED);
  });

  it("keeps 400 VERIFICATION_AMBIGUOUS whatever its envelope says, including an invalid API key", async () => {
    for (const body of [
      envelope({ code: 400, status: "INVALID_ARGUMENT", message: "API key not valid.", details: [errorInfo("API_KEY_INVALID")] }),
      envelope({ status: "UNAUTHENTICATED" }),
      envelope({ status: "PERMISSION_DENIED" }),
      "",
    ]) {
      expect((await verify(400, body)).result).toEqual(AMBIGUOUS);
    }
  });

  it("never reads the Location header of a redirect and never sends a second request", async () => {
    const reads: string[] = [];
    const headers = { get: (name: string) => (reads.push(name), name === "location" ? "https://elsewhere.example/" : null) };
    const { result, calls } = await verifyWith(() => ({ status: 302, headers, body: null }));
    expect(result).toEqual(DRIFT);
    expect(calls).toHaveLength(1);
    expect(reads).toEqual(["content-length"]);
  });

  it("maps a response with a status outside 0 to 599 or a non-response to PROVIDER_NETWORK_FAILURE, never MALFORMED", async () => {
    for (const answer of [() => fakeResponse(600), () => fakeResponse(-1), () => ({ status: 200.5, headers: new Headers(), body: null }), () => null, () => "200"]) {
      expect((await verifyWith(answer)).result).toEqual(NETWORK);
    }
  });

  it("maps a declared and a streamed oversize body as PROVIDER_RESPONSE_TOO_LARGE for every status", async () => {
    for (const status of [200, 401, 403]) {
      expect((await verify(status, "{}", { "content-length": "65537" })).result).toEqual(TOO_LARGE);
      expect((await verify(status, new Uint8Array(65537).fill(0x20))).result).toEqual(TOO_LARGE);
    }
  });

  it("maps a rejected fetch to PROVIDER_NETWORK_FAILURE", async () => {
    expect(
      (
        await verifyWith(() => {
          throw new Error(`network down ${CREDENTIAL}`);
        })
      ).result,
    ).toEqual(NETWORK);
  });

  it("maps the internal deadline to PROVIDER_TIMEOUT and a caller abort to VERIFICATION_AMBIGUOUS", async () => {
    let expire: () => void = () => undefined;
    const deadlineTimer = (_ms: number, onExpiry: () => void) => ((expire = onExpiry), () => undefined);
    const never = (() => new Promise<never>(() => undefined)) as unknown as typeof fetch;
    const timed = performProviderVerification({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: POLICY, credential: CREDENTIAL }, { fetchImpl: never, deadlineTimer });
    expire();
    expect(await timed).toEqual(TIMEOUT);
    seenReports.push(await timed);
    const caller = new AbortController();
    const aborted = performProviderVerification({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: POLICY, credential: CREDENTIAL, signal: caller.signal }, { fetchImpl: never });
    caller.abort();
    expect(await aborted).toEqual(AMBIGUOUS);
  });
});

describe("Google classifier purity and secrecy (R44B11F Phase 6)", () => {
  const raw = (status: number, body: string): ProviderVerificationRawOutcome => Object.freeze({ kind: "RESPONSE", status, body: encoder.encode(body) });

  it.each([
    [{ kind: "TIMEOUT" } as const, TIMEOUT],
    [{ kind: "CALLER_ABORT" } as const, AMBIGUOUS],
    [{ kind: "NETWORK_FAILURE" } as const, NETWORK],
    [{ kind: "BODY_TOO_LARGE" } as const, TOO_LARGE],
  ])("classifies the raw %o directly", (outcome, expected) => {
    expect(classifyGoogleVerificationOutcome(outcome)).toEqual(expected);
  });

  it("is synchronous and pure: equal frozen reports with exactly outcome and reasonCode, no retry field", () => {
    for (const outcome of [raw(200, json({})), raw(401, envelope({ status: "UNAUTHENTICATED" })), raw(503, ""), { kind: "TIMEOUT" } as const]) {
      const first = classifyGoogleVerificationOutcome(outcome);
      const second = classifyGoogleVerificationOutcome(outcome);
      expect(first).not.toBeInstanceOf(Promise);
      expect(second).toEqual(first);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.keys(first).sort()).toEqual(["outcome", "reasonCode"]);
      expect(isProviderVerificationResultReport(first)).toBe(true);
    }
    // The input body is not modified.
    const outcome = raw(200, json({ models: [] }));
    const before = outcome.kind === "RESPONSE" ? [...outcome.body] : [];
    classifyGoogleVerificationOutcome(outcome);
    expect(outcome.kind === "RESPONSE" ? [...outcome.body] : []).toEqual(before);
  });

  it("never exposes the credential, headers or body in a report, error or console output", async () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const secretBody = `{"error":{"status":"UNAUTHENTICATED","message":"${CREDENTIAL}"}}`;
    const { result } = await verify(401, secretBody);
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain("x-goog-api-key");
    expect(JSON.stringify(result)).not.toContain("UNAUTHENTICATED\",\"message");
    const refusing = vi.fn(async () => {
      throw new Error("no request may be sent");
    }) as unknown as typeof fetch;
    const failure = await performProviderVerification({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: POLICY, credential: `${CREDENTIAL} ` }, { fetchImpl: refusing }).catch(
      (error: unknown) => error,
    );
    expect(refusing).not.toHaveBeenCalled();
    expect((failure as { code?: unknown }).code).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect(String(failure)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(failure)).not.toContain(CREDENTIAL);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("produces every reason the Google table names, each a valid Phase 3 report", () => {
    const named = new Set(["VERIFICATION_SUCCEEDED", "CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED", ...PROVIDER_VERIFICATION_REASONS_BY_OUTCOME.INCONCLUSIVE]);
    expect(seenReports.length).toBeGreaterThan(0);
    for (const seen of seenReports) expect(isProviderVerificationResultReport(seen)).toBe(true);
    expect(new Set(seenReports.map(({ reasonCode }) => reasonCode))).toEqual(named);
  });
});
