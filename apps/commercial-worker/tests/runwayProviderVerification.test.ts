import { randomBytes } from "node:crypto";

import { RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { isProviderVerificationResultReport, type ProviderVerificationResultReport } from "../src/providerVerificationContract.js";
import { performProviderVerification, type ProviderVerificationRawOutcome } from "../src/providerVerificationTransport.js";
import { buildRunwayVerificationRequest, classifyRunwayVerificationOutcome } from "../src/runwayProviderVerification.js";

// R44B11F Phase 6: the fixed Runway verification request and classifier
// (architecture "Fixed requests", "Result classification", "Success shapes",
// "Runway 401, 403 and 404 semantics"). Every request goes through the real
// transport to an injected fake fetchImpl; nothing reaches a provider.

const POLICY = "RUNWAY_ORGANIZATION_GET_V1_2024_11_06";
const URL_LITERAL = "https://api.dev.runwayml.com/v1/organization";
const CREDENTIAL = `key_fixture${randomBytes(24).toString("hex")}`;
const encoder = new TextEncoder();

const report = (outcome: string, reasonCode: string) => ({ outcome, reasonCode });
const VERIFIED = report("VERIFIED", "VERIFICATION_SUCCEEDED");
const REJECTED = report("DEFINITIVE_FAILURE", "CREDENTIAL_REJECTED");
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
const fakeResponse = (status: number, body: string | Uint8Array | null = "", headers: Record<string, string> = {}) =>
  Object.freeze({ status, headers: new Headers(headers), body: body === null ? null : streamOf(bodyBytes(body)) });
const json = (value: unknown) => JSON.stringify(value);

type Call = Readonly<{ url: unknown; init: RequestInit | undefined }>;
const seenReports: ProviderVerificationResultReport[] = [];

async function verifyWith(answer: () => unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  const result = await performProviderVerification({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: POLICY, credential: CREDENTIAL }, { fetchImpl });
  seenReports.push(result);
  return { result, calls };
}
const verify = (status: number, body: string | Uint8Array | null = "", headers: Record<string, string> = {}) => verifyWith(() => fakeResponse(status, body, headers));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Runway verification request (R44B11F Phase 6)", () => {
  it("builds the exact frozen request: the complete URL literal, the bearer credential and the version header only", () => {
    const request = buildRunwayVerificationRequest(CREDENTIAL);
    expect(request).toEqual({ url: URL_LITERAL, headers: { Authorization: `Bearer ${CREDENTIAL}`, "X-Runway-Version": "2024-11-06" } });
    expect(Object.keys(request).sort()).toEqual(["headers", "url"]);
    expect(Object.keys(request.headers).sort()).toEqual(["Authorization", "X-Runway-Version"]);
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.headers)).toBe(true);
    expect(Object.getPrototypeOf(request.headers)).toBe(Object.prototype);
    const url = new URL(request.url);
    expect([url.origin, url.pathname, url.search]).toEqual(["https://api.dev.runwayml.com", "/v1/organization", ""]);
  });

  it("sends exactly one GET with the locked URL, headers, manual redirect and the internal signal, and no body", async () => {
    const { result, calls } = await verify(200, json({ creditBalance: 10, tier: { maxMonthlyCreditSpend: 1 } }));
    expect(result).toEqual(VERIFIED);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Call];
    expect(url).toBe(URL_LITERAL);
    expect(Object.keys(init ?? {}).sort()).toEqual(["headers", "method", "redirect", "signal"]);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("manual");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ Authorization: `Bearer ${CREDENTIAL}`, "X-Runway-Version": "2024-11-06" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("Runway success shape (R44B11F Phase 6)", () => {
  it.each([
    ["organization fields", json({ creditBalance: 0, tier: {}, usage: {} })],
    ["an empty object", json({})],
    ["a nested error member", json({ usage: { error: 1 } })],
  ])("is VERIFIED for %s", async (_name, body) => {
    expect((await verify(200, body)).result).toEqual(VERIFIED);
  });

  it.each([
    ["malformed JSON", "{"],
    ["an empty body", ""],
    ["a missing body", null],
    ["invalid UTF-8", Uint8Array.from([0x7b, 0x7d, 0xff])],
    ["an array", json([{}])],
    ["a string", json("x")],
    ["a number", json(0)],
    ["a boolean", json(false)],
    ["null", "null"],
    ["an own error member", json({ creditBalance: 1, error: "x" })],
    ["an own null error member", json({ error: null })],
  ])("is PROVIDER_RESPONSE_MALFORMED for a 200 with %s", async (_name, body) => {
    expect((await verify(200, body)).result).toEqual(MALFORMED);
  });
});

describe("Runway status classification (R44B11F Phase 6)", () => {
  it.each([
    [0, DRIFT],
    [300, DRIFT],
    [302, DRIFT],
    [399, DRIFT],
    [400, AMBIGUOUS],
    [401, REJECTED],
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
    [406, UNEXPECTED],
    [409, UNEXPECTED],
    [411, UNEXPECTED],
    [418, UNEXPECTED],
    [428, UNEXPECTED],
    [430, UNEXPECTED],
    [451, UNEXPECTED],
    [499, UNEXPECTED],
  ])("status %i maps as tabled", async (status, expected) => {
    expect((await verify(status, "")).result).toEqual(expected);
  });

  it("decides 401 on the status alone, whatever the body says, within the bound", async () => {
    for (const body of ["", "not json", json({ error: "Invalid API key" }), json({ ok: true }), null]) {
      expect((await verify(401, body)).result).toEqual(REJECTED);
    }
    // An oversized 401 is still PROVIDER_RESPONSE_TOO_LARGE.
    expect((await verify(401, new Uint8Array(65537))).result).toEqual(TOO_LARGE);
    expect((await verify(401, "", { "content-length": "70000" })).result).toEqual(TOO_LARGE);
  });

  it("keeps 403 VERIFICATION_AMBIGUOUS whatever the body says", async () => {
    for (const body of ["", json({ error: "forbidden" }), json({ error: { status: "PERMISSION_DENIED" } })]) {
      expect((await verify(403, body)).result).toEqual(AMBIGUOUS);
    }
  });

  it("never reads the Location header of a redirect and never sends a second request", async () => {
    const reads: string[] = [];
    const headers = { get: (name: string) => (reads.push(name), name === "location" ? "https://elsewhere.example/" : null) };
    const { result, calls } = await verifyWith(() => ({ status: 301, headers, body: null }));
    expect(result).toEqual(DRIFT);
    expect(calls).toHaveLength(1);
    expect(reads).toEqual(["content-length"]);
  });

  it("maps a non-response, an out-of-range status and a rejected fetch to PROVIDER_NETWORK_FAILURE", async () => {
    for (const answer of [
      () => fakeResponse(600),
      () => ({ status: "200", headers: new Headers(), body: null }),
      () => undefined,
      () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      expect((await verifyWith(answer)).result).toEqual(NETWORK);
    }
  });

  it("maps a declared and a streamed oversize 200 to PROVIDER_RESPONSE_TOO_LARGE", async () => {
    expect((await verify(200, "{}", { "content-length": "65537" })).result).toEqual(TOO_LARGE);
    expect((await verify(200, new Uint8Array(65537).fill(0x20))).result).toEqual(TOO_LARGE);
  });

  it("maps the internal deadline to PROVIDER_TIMEOUT and a caller abort to VERIFICATION_AMBIGUOUS", async () => {
    let expire: () => void = () => undefined;
    const deadlineTimer = (_ms: number, onExpiry: () => void) => ((expire = onExpiry), () => undefined);
    const never = (() => new Promise<never>(() => undefined)) as unknown as typeof fetch;
    const timed = performProviderVerification({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: POLICY, credential: CREDENTIAL }, { fetchImpl: never, deadlineTimer });
    expire();
    const timedReport = await timed;
    expect(timedReport).toEqual(TIMEOUT);
    seenReports.push(timedReport);
    const caller = new AbortController();
    const aborted = performProviderVerification({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: POLICY, credential: CREDENTIAL, signal: caller.signal }, { fetchImpl: never });
    caller.abort();
    expect(await aborted).toEqual(AMBIGUOUS);
  });
});

describe("Runway classifier purity and secrecy (R44B11F Phase 6)", () => {
  const raw = (status: number, body: string): ProviderVerificationRawOutcome => Object.freeze({ kind: "RESPONSE", status, body: encoder.encode(body) });

  it.each([
    [{ kind: "TIMEOUT" } as const, TIMEOUT],
    [{ kind: "CALLER_ABORT" } as const, AMBIGUOUS],
    [{ kind: "NETWORK_FAILURE" } as const, NETWORK],
    [{ kind: "BODY_TOO_LARGE" } as const, TOO_LARGE],
  ])("classifies the raw %o directly", (outcome, expected) => {
    expect(classifyRunwayVerificationOutcome(outcome)).toEqual(expected);
  });

  it("is synchronous and pure: equal frozen reports with exactly outcome and reasonCode, no retry field", () => {
    for (const outcome of [raw(200, json({})), raw(401, ""), raw(429, ""), { kind: "CALLER_ABORT" } as const]) {
      const first = classifyRunwayVerificationOutcome(outcome);
      const second = classifyRunwayVerificationOutcome(outcome);
      expect(first).not.toBeInstanceOf(Promise);
      expect(second).toEqual(first);
      expect(Object.isFrozen(first)).toBe(true);
      expect(Object.keys(first).sort()).toEqual(["outcome", "reasonCode"]);
      expect(isProviderVerificationResultReport(first)).toBe(true);
    }
  });

  it("never exposes the credential, headers or body in a report, error or console output", async () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => undefined));
    const { result } = await verify(401, json({ error: `bad key ${CREDENTIAL}` }));
    expect(JSON.stringify(result)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(result)).not.toContain("Bearer");
    const refusing = vi.fn(async () => {
      throw new Error("no request may be sent");
    }) as unknown as typeof fetch;
    const failure = await performProviderVerification({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: POLICY, credential: `${CREDENTIAL}\n` }, { fetchImpl: refusing }).catch(
      (error: unknown) => error,
    );
    expect(refusing).not.toHaveBeenCalled();
    expect((failure as { code?: unknown }).code).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect(String(failure)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(failure)).not.toContain(CREDENTIAL);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("produces every reason the Runway table names, each a valid Phase 3 report", () => {
    const named = new Set([
      "VERIFICATION_SUCCEEDED",
      "CREDENTIAL_REJECTED",
      "PROVIDER_BILLING_RESTRICTION",
      "PROVIDER_RATE_OR_QUOTA_LIMITED",
      "PROVIDER_UNAVAILABLE",
      "PROVIDER_TIMEOUT",
      "PROVIDER_NETWORK_FAILURE",
      "PROVIDER_RESPONSE_MALFORMED",
      "PROVIDER_RESPONSE_TOO_LARGE",
      "PROVIDER_UNEXPECTED_STATUS",
      "PROVIDER_OPERATION_DRIFT",
      "VERIFICATION_AMBIGUOUS",
    ]);
    for (const seen of seenReports) expect(isProviderVerificationResultReport(seen)).toBe(true);
    expect(new Set(seenReports.map(({ reasonCode }) => reasonCode))).toEqual(named);
    // The Runway table never produces CREDENTIAL_NOT_AUTHORIZED.
    expect(seenReports.some(({ reasonCode }) => reasonCode === "CREDENTIAL_NOT_AUTHORIZED")).toBe(false);
  });
});
