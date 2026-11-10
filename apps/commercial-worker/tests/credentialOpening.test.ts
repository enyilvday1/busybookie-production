import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CredentialOpener } from "../src/credentialContracts.js";
import { runCredentialOpeningOnce, type WorkerLogEvent } from "../src/credentialOpeningRun.js";
import { assertNoProviderEnvironment, FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES } from "../src/providerEnvironment.js";
import {
  createHttpWorkerControlClient,
  parseCredentialGrantResponse,
  parseLeaseResponse,
  type WorkerControlClient,
  type WorkerCredentialGrant,
  type WorkerLease,
} from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";
import { createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "./support/testCredentialOpening.js";

// Worker unit tests without a database or network: a fake control client
// (or a fake fetch for the HTTP client) and the test opener. Credentials are
// generated fixture strings; assertions on them are booleans.

const key = generateTestKey("worker-unit-encryption/v1");
const sealer = createTestCredentialSealer(key);
const opener = createTestCredentialOpener(key);

const ACCOUNT = randomUUID();
const CONNECTION = randomUUID();
const ATTEMPT = randomUUID();
const JOB = randomUUID();
const MACHINE = `fixture-machine-${randomBytes(16).toString("hex")}`;
const PLAINTEXT = `fixture-credential-${randomBytes(18).toString("hex")}`;
const LEASE_TOKEN = randomBytes(32).toString("base64url");

const context = { accountId: ACCOUNT, providerConnectionId: CONNECTION, provider: "EXAMPLE_PROVIDER", credentialVersion: 1, purpose: "provider-credential" as const };
const envelope = await sealer.seal(PLAINTEXT, context);

const lease = (overrides: Partial<WorkerLease> = {}): WorkerLease => ({
  executionJobId: JOB,
  executionAttemptId: ATTEMPT,
  attemptNumber: 1,
  provider: "EXAMPLE_PROVIDER",
  model: "example-model-1",
  generationRequest: { prompt: "fixture" },
  generationRequestSha256: "c".repeat(64),
  expectedCostCap: { unit: "MICRO_USD", amount: 1000 },
  leaseToken: LEASE_TOKEN,
  fencingCounter: 1,
  leaseExpiresAt: new Date(Date.now() + 120_000),
  ...overrides,
});

const grant = (overrides: Partial<WorkerCredentialGrant> = {}): WorkerCredentialGrant => ({
  executionAttemptId: ATTEMPT,
  fencingCounter: 1,
  credentialGrantedAt: new Date(),
  sealedEnvelope: envelope,
  openingContext: context,
  ...overrides,
});

function fakeClient(options: { lease?: () => Promise<WorkerLease | null>; grant?: () => Promise<WorkerCredentialGrant> } = {}) {
  const calls = { lease: 0, grant: 0 };
  const client: WorkerControlClient = {
    leaseNextAttempt: async () => {
      calls.lease += 1;
      return (options.lease ?? (async () => lease()))();
    },
    requestCredentialGrant: async () => {
      calls.grant += 1;
      return (options.grant ?? (async () => grant()))();
    },
  };
  return { client, calls };
}

function countingOpener(inner: CredentialOpener = opener) {
  const seen: { opened: number; sawExactPlaintext: boolean } = { opened: 0, sawExactPlaintext: false };
  const wrapped: CredentialOpener = {
    open: async (sealed, openContext) => {
      seen.opened += 1;
      const plaintext = await inner.open(sealed, openContext);
      seen.sawExactPlaintext = plaintext === PLAINTEXT;
      return plaintext;
    },
  };
  return { opener: wrapped, seen };
}

async function failure(promise: Promise<unknown>): Promise<WorkerError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkerError);
  const visible = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`;
  for (const secret of [PLAINTEXT, LEASE_TOKEN, MACHINE, (envelope as { ciphertext: string }).ciphertext]) expect(visible.includes(secret)).toBe(false);
  return error as WorkerError;
}

describe("provider-global environment refusal", () => {
  it.each(FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES)("refuses to start with %s present, before any work", async (name) => {
    const { client, calls } = fakeClient();
    const counted = countingOpener();
    const error = await failure(runCredentialOpeningOnce({ environment: { [name]: "sentinel-secret" }, client, opener: counted.opener }));
    expect(error.code).toBe("FORBIDDEN_PROVIDER_ENVIRONMENT");
    expect(error.message.includes("sentinel-secret")).toBe(false);
    expect(calls).toEqual({ lease: 0, grant: 0 });
    expect(counted.seen.opened).toBe(0);
  });

  it("refuses an empty or differently-cased variable and accepts a clean environment", () => {
    expect(() => assertNoProviderEnvironment({ RUNWAYML_API_SECRET: "" })).toThrow(WorkerError);
    expect(() => assertNoProviderEnvironment({ gemini_api_key: "x" })).toThrow(WorkerError);
    expect(() => assertNoProviderEnvironment({ PATH: "/usr/bin", NODE_ENV: "test" })).not.toThrow();
    expect(FORBIDDEN_PROVIDER_ENVIRONMENT_VARIABLES).toEqual(expect.arrayContaining(["RUNWAYML_API_SECRET", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS"]));
  });
});

describe("credential opening run", () => {
  it("opens exactly the granted credential in memory and returns only safe metadata", async () => {
    const { client, calls } = fakeClient();
    const counted = countingOpener();
    const events: WorkerLogEvent[] = [];
    const result = await runCredentialOpeningOnce({ environment: {}, client, opener: counted.opener, log: (event) => events.push(event) });
    expect(result).toEqual({ status: "CREDENTIAL_OPENED", executionJobId: JOB, executionAttemptId: ATTEMPT, provider: "EXAMPLE_PROVIDER", fencingCounter: 1, credentialOpened: true });
    expect(counted.seen).toEqual({ opened: 1, sawExactPlaintext: true });
    expect(calls).toEqual({ lease: 1, grant: 1 });
    const visible = JSON.stringify(result) + JSON.stringify(events);
    for (const secret of [PLAINTEXT, LEASE_TOKEN, MACHINE, (envelope as { ciphertext: string }).ciphertext, CONNECTION, ACCOUNT]) expect(visible.includes(secret)).toBe(false);
    expect(events.map((event) => `${event.stage}/${event.outcome}`)).toEqual(["LEASE/OK", "GRANT/OK", "DONE/OK"]);
  });

  it("returns NO_WORK without requesting a grant", async () => {
    const { client, calls } = fakeClient({ lease: async () => null });
    expect(await runCredentialOpeningOnce({ environment: {}, client, opener })).toEqual({ status: "NO_WORK" });
    expect(calls.grant).toBe(0);
  });

  it("refuses to continue on a lease that has already expired", async () => {
    const { client, calls } = fakeClient({ lease: async () => lease({ leaseExpiresAt: new Date(Date.now() - 1) }) });
    const counted = countingOpener();
    expect((await failure(runCredentialOpeningOnce({ environment: {}, client, opener: counted.opener }))).code).toBe("LEASE_EXPIRED");
    expect(calls.grant).toBe(0);
    expect(counted.seen.opened).toBe(0);
  });

  it.each([
    ["the account", { accountId: randomUUID() }],
    ["the connection", { providerConnectionId: randomUUID() }],
    ["the credential version", { credentialVersion: 2 }],
  ])("fails to open when %s in the opening context is changed", async (_label, change) => {
    const { client } = fakeClient({ grant: async () => grant({ openingContext: { ...context, ...change } }) });
    expect((await failure(runCredentialOpeningOnce({ environment: {}, client, opener }))).code).toBe("CREDENTIAL_OPEN_FAILED");
  });

  it("refuses a context for a different provider than the lease, and a context in any other format", async () => {
    for (const openingContext of [{ ...context, provider: "OTHER_PROVIDER" }, { ...context, purpose: "other" }, { ...context, extra: true }, null]) {
      const counted = countingOpener();
      const { client } = fakeClient({ grant: async () => grant({ openingContext }) });
      expect((await failure(runCredentialOpeningOnce({ environment: {}, client, opener: counted.opener }))).code).toBe("ENVELOPE_INVALID");
      expect(counted.seen.opened).toBe(0);
    }
  });

  it("refuses corrupted or non-canonical envelopes, and never falls back", async () => {
    const env = envelope as Record<string, string>;
    const flipped = env.ciphertext!.slice(0, -2) + (env.ciphertext!.endsWith("AA") ? "BA" : "AA");
    // A tampered but well-formed envelope reaches the opener and fails authentication.
    const tampered = countingOpener();
    const { client } = fakeClient({ grant: async () => grant({ sealedEnvelope: { ...env, ciphertext: flipped } }) });
    expect((await failure(runCredentialOpeningOnce({ environment: {}, client, opener: tampered.opener }))).code).toBe("CREDENTIAL_OPEN_FAILED");
    // Anything not exactly the supported envelope format never reaches the opener.
    for (const sealedEnvelope of [{ ...env, format: "other" }, { ...env, extra: "x" }, { ciphertext: env.ciphertext }, "sealed", null]) {
      const counted = countingOpener();
      const bad = fakeClient({ grant: async () => grant({ sealedEnvelope }) });
      expect((await failure(runCredentialOpeningOnce({ environment: {}, client: bad.client, opener: counted.opener }))).code).toBe("ENVELOPE_INVALID");
      expect(counted.seen.opened).toBe(0);
    }
  });

  it("retries a transient failure once with the same proof, and never retries a refusal", async () => {
    let grantCalls = 0;
    const flaky = fakeClient({
      grant: async () => {
        grantCalls += 1;
        if (grantCalls === 1) throw new WorkerError("CONTROL_API_UNAVAILABLE");
        return grant();
      },
    });
    expect((await runCredentialOpeningOnce({ environment: {}, client: flaky.client, opener })).status).toBe("CREDENTIAL_OPENED");
    expect(flaky.calls).toEqual({ lease: 1, grant: 2 });

    const down = fakeClient({ lease: async () => Promise.reject(new WorkerError("CONTROL_API_UNAVAILABLE")) });
    expect((await failure(runCredentialOpeningOnce({ environment: {}, client: down.client, opener }))).code).toBe("CONTROL_API_UNAVAILABLE");
    expect(down.calls.lease).toBe(2);

    for (const code of ["WORKER_AUTHENTICATION_REJECTED", "CREDENTIAL_GRANT_REJECTED", "MALFORMED_CONTROL_RESPONSE"] as const) {
      const refused = fakeClient({ grant: async () => Promise.reject(new WorkerError(code)) });
      const counted = countingOpener();
      expect((await failure(runCredentialOpeningOnce({ environment: {}, client: refused.client, opener: counted.opener }))).code).toBe(code);
      expect(refused.calls).toEqual({ lease: 1, grant: 1 });
      expect(counted.seen.opened).toBe(0);
    }
  });
});

describe("control-plane response validation", () => {
  const wireLease = {
    executionJobId: JOB,
    executionAttemptId: ATTEMPT,
    attemptNumber: 1,
    provider: "EXAMPLE_PROVIDER",
    model: "example-model-1",
    generationRequest: { prompt: "fixture" },
    generationRequestSha256: "c".repeat(64),
    expectedCostCap: { unit: "MICRO_USD", amount: 1000 },
    leaseToken: LEASE_TOKEN,
    fencingCounter: 1,
    leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  };

  it("accepts exactly the lease protocol", () => {
    expect(parseLeaseResponse({ lease: null })).toBeNull();
    expect(parseLeaseResponse({ lease: wireLease })).toMatchObject({ executionAttemptId: ATTEMPT, fencingCounter: 1 });
  });

  it.each([
    ["an extra member", { lease: { ...wireLease, providerCredentialVersionId: randomUUID() } }],
    ["a missing member", { lease: { ...wireLease, leaseToken: undefined } }],
    ["an extra envelope member", { lease: null, accountId: ACCOUNT }],
    ["an uppercase UUID", { lease: { ...wireLease, executionAttemptId: ATTEMPT.toUpperCase() } }],
    ["a malformed provider", { lease: { ...wireLease, provider: "example" } }],
    ["a zero fencing counter", { lease: { ...wireLease, fencingCounter: 0 } }],
    ["a string fencing counter", { lease: { ...wireLease, fencingCounter: "1" } }],
    ["a short lease token", { lease: { ...wireLease, leaseToken: "short" } }],
    ["a non-ISO expiry", { lease: { ...wireLease, leaseExpiresAt: "tomorrow" } }],
    ["an unknown cost unit", { lease: { ...wireLease, expectedCostCap: { unit: "USD", amount: 1 } } }],
    ["an empty generation request", { lease: { ...wireLease, generationRequest: {} } }],
    ["a bad request hash", { lease: { ...wireLease, generationRequestSha256: "C".repeat(64) } }],
  ])("rejects a lease with %s", (_label, body) => {
    expect(() => parseLeaseResponse(JSON.parse(JSON.stringify(body)))).toThrow(WorkerError);
  });

  it("accepts a grant only for the exact attempt and fencing generation, with exactly the protocol's members", () => {
    const wire = { executionAttemptId: ATTEMPT, fencingCounter: 1, credentialGrantedAt: new Date().toISOString(), credential: { sealedEnvelope: envelope, openingContext: context } };
    expect(parseCredentialGrantResponse(wire, { executionAttemptId: ATTEMPT, fencingCounter: 1 }).openingContext).toEqual(context);
    for (const body of [
      { ...wire, executionAttemptId: randomUUID() },
      { ...wire, fencingCounter: 2 },
      { ...wire, credential: { sealedEnvelope: envelope } },
      { ...wire, credential: { sealedEnvelope: envelope, openingContext: context, fingerprint: "x" } },
      { ...wire, plaintext: "x" },
      { ...wire, credentialGrantedAt: "now" },
    ]) {
      expect(() => parseCredentialGrantResponse(body, { executionAttemptId: ATTEMPT, fencingCounter: 1 })).toThrow(WorkerError);
    }
  });
});

describe("HTTP worker-control client", () => {
  function recordingFetch(respond: (url: string) => Response | Promise<Response>) {
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
      requests.push({ url: String(input), init: init ?? {} });
      return respond(String(input));
    }) as typeof fetch;
    return { fetchImpl, requests };
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("sends the machine credential only in the Authorization header and posts only to worker-control paths", async () => {
    const { fetchImpl, requests } = recordingFetch(() => json(200, { lease: null }));
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    expect(await client.leaseNextAttempt()).toBeNull();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("http://127.0.0.1:9/worker-control/v1/leases");
    expect(requests[0]!.url.includes(MACHINE)).toBe(false);
    expect(requests[0]!.init.method).toBe("POST");
    expect(requests[0]!.init.redirect).toBe("error");
    expect(requests[0]!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}` });
  });

  it.each([
    [401, "WORKER_AUTHENTICATION_REJECTED"],
    [403, "WORKER_AUTHENTICATION_REJECTED"],
    [409, "LEASE_REJECTED"],
    [503, "CONTROL_API_UNAVAILABLE"],
    [500, "CONTROL_API_UNAVAILABLE"],
    [404, "MALFORMED_CONTROL_RESPONSE"],
    [400, "MALFORMED_CONTROL_RESPONSE"],
  ] as const)("maps HTTP %d to %s", async (status, code) => {
    const { fetchImpl } = recordingFetch(() => json(status, { status: "error", code: "X" }));
    const client = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
    expect((await failure(client.leaseNextAttempt())).code).toBe(code);
  });

  it("maps a transport failure to UNAVAILABLE without leaking the request", async () => {
    const client = createHttpWorkerControlClient({
      baseUrl: "http://127.0.0.1:9",
      machineCredential: MACHINE,
      fetchImpl: (async () => {
        throw new TypeError(`fetch failed for Bearer ${MACHINE}`);
      }) as typeof fetch,
    });
    expect((await failure(client.leaseNextAttempt())).code).toBe("CONTROL_API_UNAVAILABLE");
  });

  it.each(["not a url", "ftp://host", "http://user:pass@host", "http://host/path", "http://host?x=1", "http://host/#frag"])(
    "refuses the control-plane base URL %j",
    (baseUrl) => {
      expect(() => createHttpWorkerControlClient({ baseUrl, machineCredential: MACHINE })).toThrow(WorkerError);
    },
  );

  it("refuses a malformed machine credential", () => {
    for (const machineCredential of ["", "has space", "x".repeat(4097), "line\nbreak"]) {
      expect(() => createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential })).toThrow(WorkerError);
    }
  });
});
