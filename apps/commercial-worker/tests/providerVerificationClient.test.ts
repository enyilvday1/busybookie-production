import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";
import { describe, expect, it } from "vitest";

import {
  PROVIDER_VERIFICATION_OUTCOMES as API_OUTCOMES,
  isWorkerReportableVerificationReason,
} from "../../commercial-api/src/workerControl/workerProviderVerificationResultService.js";
import {
  classifyProviderVerificationLease,
  isProviderVerificationResultReport,
  PROVIDER_VERIFICATION_OUTCOMES,
  PROVIDER_VERIFICATION_REASONS_BY_OUTCOME,
  SUPPORTED_PROVIDER_VERIFICATION_PAIRS,
  type ProviderVerificationResultReport,
} from "../src/providerVerificationContract.js";
import {
  createHttpProviderVerificationControlClient,
  createHttpWorkerControlClient,
  isIssuedProviderVerificationCredentialGrant,
  isIssuedProviderVerificationLease,
  isIssuedProviderVerificationVerifyingAcknowledgement,
  parseProviderVerificationDeferralResponse,
  PROVIDER_VERIFICATION_REFUSALS,
  parseProviderVerificationCredentialGrantResponse,
  parseProviderVerificationLeaseResponse,
  parseProviderVerificationVerifyingResponse,
  type ProviderVerificationControlClient,
} from "../src/workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "../src/workerError.js";

// R44B11F Phase 5: the separate provider-verification control client
// (architecture "Client surface", "Worker-local wire types", "Issued-object
// provenance") and the pure verification contract. Injected fetch only: no
// network, no control plane, no provider.

const MACHINE = "fixture-machine-credential-5f2c";
const JOB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_JOB = "11111111-2222-4333-8444-555555555555";
const LEASE_TOKEN = "Lz".repeat(21) + "Q";
const PROOF = Object.freeze({ fencingCounter: 4, leaseToken: LEASE_TOKEN });
const GOOGLE_POLICY = "GOOGLE_GENAI_MODELS_LIST_V1BETA";
const RUNWAY_POLICY = "RUNWAY_ORGANIZATION_GET_V1_2024_11_06";
const LEASE_EXPIRES_AT = "2026-11-23T10:00:30.000Z";
const GRANTED_AT = "2026-11-23T10:00:01.000Z";
const VERIFYING_AT = "2026-11-23T10:00:02.000Z";
const COMPLETED_AT = "2026-11-23T10:00:05.000Z";
const ENVELOPE = Object.freeze({ fixture: "sealed-envelope-placeholder" });
const CONTEXT = Object.freeze({ fixture: "opening-context-placeholder" });
const REPORT: ProviderVerificationResultReport = Object.freeze({ outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });

const LEASE_BODY = {
  lease: {
    providerVerificationJobId: JOB,
    provider: GOOGLE_PROVIDER_ID,
    verificationPolicyId: GOOGLE_POLICY,
    leaseToken: LEASE_TOKEN,
    fencingCounter: 4,
    leaseExpiresAt: LEASE_EXPIRES_AT,
  },
};
const GRANT_BODY = {
  providerVerificationJobId: JOB,
  fencingCounter: 4,
  credentialGrantedAt: GRANTED_AT,
  credential: { sealedEnvelope: ENVELOPE, openingContext: CONTEXT },
};
const VERIFYING_BODY = { providerVerificationJobId: JOB, fencingCounter: 4, state: "VERIFYING", verifyingAt: VERIFYING_AT };
const RESULT_BODY = {
  providerVerificationJobId: JOB,
  fencingCounter: 4,
  state: "COMPLETED",
  outcome: "VERIFIED",
  reasonCode: "VERIFICATION_SUCCEEDED",
  completedAt: COMPLETED_AT,
};
// R44B11G: the committed deferral acknowledgement.
const DEFERRED_UNTIL = "2026-11-23T10:05:00.000Z";
const DEFERRAL_BODY = { providerVerificationJobId: JOB, fencingCounter: 4, state: "QUEUED", deferredUntil: DEFERRED_UNTIL };

type Captured = { url: string; init: RequestInit };
type Answer = Readonly<{ status: number; body: unknown }> | "THROW";

function clientAnswering(...answers: Answer[]) {
  const captured: Captured[] = [];
  const fetchImpl = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    const answer = answers[Math.min(captured.length - 1, answers.length - 1)]!;
    if (answer === "THROW") throw new TypeError("fixture transport failure");
    const body = typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body);
    return new Response(body, { status: answer.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const client = createHttpProviderVerificationControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl });
  return { client, captured };
}

const ok = (body: unknown): Answer => ({ status: 200, body });

// The error is a closed WorkerError whose visible text carries no secret.
async function codeOf(promise: Promise<unknown>): Promise<WorkerErrorCode> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  return inspectCode(error);
}

function inspectCode(error: unknown): WorkerErrorCode {
  expect(error).toBeInstanceOf(WorkerError);
  const visible = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)} ${String((error as Error).cause)}`;
  expect(visible.includes(LEASE_TOKEN) || visible.includes(MACHINE) || /Bearer|Authorization|sealed-envelope-placeholder/.test(visible)).toBe(false);
  expect((error as Error).cause).toBeUndefined();
  return (error as WorkerError).code;
}

type Call = Readonly<{ name: string; path: string; conflict: WorkerErrorCode; success: unknown; invoke: (client: ProviderVerificationControlClient) => Promise<unknown> }>;

const CALLS: readonly Call[] = [
  {
    name: "leaseProviderVerification",
    path: "/worker-control/v1/provider-verifications/lease",
    conflict: "PROVIDER_VERIFICATION_LEASE_REJECTED",
    success: LEASE_BODY,
    invoke: (client) => client.leaseProviderVerification(),
  },
  {
    name: "requestProviderVerificationCredentialGrant",
    path: `/worker-control/v1/provider-verifications/${JOB}/credential-grant`,
    conflict: "PROVIDER_VERIFICATION_GRANT_REJECTED",
    success: GRANT_BODY,
    invoke: (client) => client.requestProviderVerificationCredentialGrant(JOB, PROOF),
  },
  {
    name: "acknowledgeProviderVerificationVerifying",
    path: `/worker-control/v1/provider-verifications/${JOB}/verifying`,
    conflict: "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
    success: VERIFYING_BODY,
    invoke: (client) => client.acknowledgeProviderVerificationVerifying(JOB, PROOF),
  },
  {
    name: "reportProviderVerificationResult",
    path: `/worker-control/v1/provider-verifications/${JOB}/result`,
    conflict: "PROVIDER_VERIFICATION_RESULT_REJECTED",
    success: RESULT_BODY,
    invoke: (client) => client.reportProviderVerificationResult(JOB, PROOF, REPORT),
  },
  // R44B11G: the unsupported-lease deferral shares the same transport and mapping.
  {
    name: "deferUnsupportedProviderVerification",
    path: `/worker-control/v1/provider-verifications/${JOB}/unsupported`,
    conflict: "PROVIDER_VERIFICATION_DEFERRAL_REJECTED",
    success: DEFERRAL_BODY,
    invoke: (client) => client.deferUnsupportedProviderVerification(JOB, PROOF, "UNSUPPORTED_POLICY"),
  },
];

describe("provider verification client surface", () => {
  // R44B11G widens the locked surface by exactly the deferral method.
  it("is a separate client with exactly the five locked methods; the generation client is unchanged", () => {
    const { client } = clientAnswering(ok(LEASE_BODY));
    expect(Object.keys(client).sort()).toEqual([
      "acknowledgeProviderVerificationVerifying",
      "deferUnsupportedProviderVerification",
      "leaseProviderVerification",
      "reportProviderVerificationResult",
      "requestProviderVerificationCredentialGrant",
    ]);
    expect(Object.isFrozen(client)).toBe(true);
    const generation = createHttpWorkerControlClient({ baseUrl: "http://127.0.0.1:9", machineCredential: MACHINE, fetchImpl: (async () => new Response("{}")) as typeof fetch });
    expect(Object.keys(generation).sort()).toEqual([
      "acknowledgeSubmitting",
      "heartbeat",
      "leaseNextAttempt",
      "recoverAcceptance",
      "reportInputFailed",
      "reportSubmissionFailed",
      "reportSubmitted",
      "requestCredentialGrant",
    ]);
  });

  it("applies the existing base-URL and machine-credential validation", () => {
    for (const options of [
      { baseUrl: "not a url", machineCredential: MACHINE },
      { baseUrl: "ftp://127.0.0.1:9", machineCredential: MACHINE },
      { baseUrl: "http://user:pass@127.0.0.1:9", machineCredential: MACHINE },
      { baseUrl: "http://127.0.0.1:9/prefix", machineCredential: MACHINE },
      { baseUrl: "http://127.0.0.1:9", machineCredential: "" },
      { baseUrl: "http://127.0.0.1:9", machineCredential: "has space" },
    ]) {
      try {
        createHttpProviderVerificationControlClient(options);
        expect.unreachable();
      } catch (error) {
        expect((error as WorkerError).code).toBe("WORKER_CONFIGURATION_INVALID");
      }
    }
  });
});

describe("provider verification client requests", () => {
  it("posts the lease request with no body and Bearer authentication only", async () => {
    const { client, captured } = clientAnswering(ok(LEASE_BODY));
    const lease = await client.leaseProviderVerification();
    expect(lease).toEqual({
      providerVerificationJobId: JOB,
      provider: GOOGLE_PROVIDER_ID,
      verificationPolicyId: GOOGLE_POLICY,
      leaseToken: LEASE_TOKEN,
      fencingCounter: 4,
      leaseExpiresAt: new Date(LEASE_EXPIRES_AT),
    });
    expect(Object.isFrozen(lease)).toBe(true);
    expect(captured).toHaveLength(1);
    const [request] = captured;
    expect(request!.url).toBe("http://127.0.0.1:9/worker-control/v1/provider-verifications/lease");
    expect(request!.init.method).toBe("POST");
    expect(request!.init.redirect).toBe("error");
    expect(request!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}` });
    expect("body" in request!.init).toBe(false);
    // No signal unless the caller supplies one: the client owns no timeout.
    expect("signal" in request!.init).toBe(false);
  });

  it("returns null for an empty lease answer", async () => {
    const { client, captured } = clientAnswering(ok({ lease: null }));
    expect(await client.leaseProviderVerification()).toBeNull();
    expect(captured).toHaveLength(1);
  });

  it("posts exactly the proof to the grant and VERIFYING routes, and the proof plus the pair to the result route", async () => {
    const extraProof = { ...PROOF, providerVerificationJobId: JOB, extra: "never sent" };
    const extraReport = { ...REPORT, provider: GOOGLE_PROVIDER_ID };
    const grant = clientAnswering(ok(GRANT_BODY));
    expect(await grant.client.requestProviderVerificationCredentialGrant(JOB, extraProof)).toEqual({
      providerVerificationJobId: JOB,
      fencingCounter: 4,
      credentialGrantedAt: new Date(GRANTED_AT),
      sealedEnvelope: ENVELOPE,
      openingContext: CONTEXT,
    });
    const verifying = clientAnswering(ok(VERIFYING_BODY));
    expect(await verifying.client.acknowledgeProviderVerificationVerifying(JOB, extraProof)).toEqual({
      providerVerificationJobId: JOB,
      fencingCounter: 4,
      state: "VERIFYING",
      verifyingAt: new Date(VERIFYING_AT),
    });
    const result = clientAnswering(ok(RESULT_BODY));
    expect(await result.client.reportProviderVerificationResult(JOB, extraProof, extraReport)).toEqual({
      providerVerificationJobId: JOB,
      fencingCounter: 4,
      state: "COMPLETED",
      outcome: "VERIFIED",
      reasonCode: "VERIFICATION_SUCCEEDED",
      completedAt: new Date(COMPLETED_AT),
    });
    for (const [{ captured }, path, members] of [
      [grant, "credential-grant", ["fencingCounter", "leaseToken"]],
      [verifying, "verifying", ["fencingCounter", "leaseToken"]],
      [result, "result", ["fencingCounter", "leaseToken", "outcome", "reasonCode"]],
    ] as const) {
      expect(captured).toHaveLength(1);
      const [request] = captured;
      expect(request!.url).toBe(`http://127.0.0.1:9/worker-control/v1/provider-verifications/${JOB}/${path}`);
      expect(request!.url.includes(LEASE_TOKEN) || request!.url.includes(MACHINE)).toBe(false);
      expect(request!.init.method).toBe("POST");
      expect(request!.init.redirect).toBe("error");
      expect(request!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
      expect(Object.keys(JSON.parse(String(request!.init.body)) as object)).toEqual(members);
      expect("signal" in request!.init).toBe(false);
    }
    expect(JSON.parse(String(result.captured[0]!.init.body))).toEqual({ fencingCounter: 4, leaseToken: LEASE_TOKEN, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
  });

  it("passes the caller's signal through and treats its abort as a transport failure", async () => {
    for (const call of CALLS) {
      const { client, captured } = clientAnswering(ok(call.success));
      const controller = new AbortController();
      controller.abort();
      const invoke =
        call.name === "leaseProviderVerification"
          ? client.leaseProviderVerification(controller.signal)
          : call.name === "requestProviderVerificationCredentialGrant"
            ? client.requestProviderVerificationCredentialGrant(JOB, PROOF, controller.signal)
            : call.name === "acknowledgeProviderVerificationVerifying"
              ? client.acknowledgeProviderVerificationVerifying(JOB, PROOF, controller.signal)
              : call.name === "deferUnsupportedProviderVerification"
                ? client.deferUnsupportedProviderVerification(JOB, PROOF, "UNSUPPORTED_POLICY", controller.signal)
                : client.reportProviderVerificationResult(JOB, PROOF, REPORT, controller.signal);
      expect(await codeOf(invoke), call.name).toBe("CONTROL_API_UNAVAILABLE");
      expect(captured, call.name).toHaveLength(1);
      expect(captured[0]!.init.signal).toBe(controller.signal);
    }
  });
});

describe("provider verification client status mapping", () => {
  it("maps every status exactly as the existing client, with exactly one request and no retry", async () => {
    for (const call of CALLS) {
      for (const [answer, expected] of [
        [{ status: 401, body: { status: "error" } }, "WORKER_AUTHENTICATION_REJECTED"],
        [{ status: 403, body: { status: "error" } }, "WORKER_AUTHENTICATION_REJECTED"],
        [{ status: 409, body: { status: "error", code: "LEASE_REJECTED" } }, call.conflict],
        [{ status: 500, body: "oops" }, "CONTROL_API_UNAVAILABLE"],
        [{ status: 502, body: "" }, "CONTROL_API_UNAVAILABLE"],
        [{ status: 503, body: { status: "error" } }, "CONTROL_API_UNAVAILABLE"],
        ["THROW", "CONTROL_API_UNAVAILABLE"],
        [{ status: 400, body: { status: "error" } }, "MALFORMED_CONTROL_RESPONSE"],
        [{ status: 404, body: { status: "error" } }, "MALFORMED_CONTROL_RESPONSE"],
        [{ status: 302, body: "" }, "MALFORMED_CONTROL_RESPONSE"],
        [{ status: 201, body: call.success }, "MALFORMED_CONTROL_RESPONSE"],
        [{ status: 200, body: "not json" }, "MALFORMED_CONTROL_RESPONSE"],
      ] as const) {
        // Even a later success answer is never fetched: no automatic retry.
        const { client, captured } = clientAnswering(answer, ok(call.success));
        expect(await codeOf(call.invoke(client)), `${call.name} ${JSON.stringify(answer)}`).toBe(expected);
        expect(captured, `${call.name} ${JSON.stringify(answer)}`).toHaveLength(1);
      }
    }
  });

  it("gives each route its own 409 code", () => {
    expect(CALLS.map(({ conflict }) => conflict)).toEqual([
      "PROVIDER_VERIFICATION_LEASE_REJECTED",
      "PROVIDER_VERIFICATION_GRANT_REJECTED",
      "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
      "PROVIDER_VERIFICATION_RESULT_REJECTED",
      "PROVIDER_VERIFICATION_DEFERRAL_REJECTED",
    ]);
    expect(new WorkerError("PROVIDER_VERIFICATION_VERIFYING_REJECTED").message).toBe("The worker-control API rejected the VERIFYING acknowledgement.");
    expect(new WorkerError("PROVIDER_VERIFICATION_DEFERRAL_REJECTED").message).toBe("The worker-control API rejected the unsupported provider verification deferral.");
  });
});

// R44B11G section 5.1 and 11 W1-W5: the unsupported-lease deferral method.
describe("R44B11G deferral client (W1-W5)", () => {
  it("W1: posts exactly fencingCounter, leaseToken and refusal to the unsupported route, and returns the frozen acknowledgement", async () => {
    for (const refusal of PROVIDER_VERIFICATION_REFUSALS) {
      const { client, captured } = clientAnswering(ok(DEFERRAL_BODY));
      const extraProof = { ...PROOF, providerVerificationJobId: JOB, deferralSeconds: 1, extra: "never sent" };
      const acknowledgement = await client.deferUnsupportedProviderVerification(JOB, extraProof, refusal);
      expect(acknowledgement).toEqual({ providerVerificationJobId: JOB, fencingCounter: 4, state: "QUEUED", deferredUntil: new Date(DEFERRED_UNTIL) });
      expect(Object.isFrozen(acknowledgement)).toBe(true);
      expect(captured).toHaveLength(1);
      const [request] = captured;
      expect(request!.url).toBe(`http://127.0.0.1:9/worker-control/v1/provider-verifications/${JOB}/unsupported`);
      expect(request!.url.includes(LEASE_TOKEN) || request!.url.includes(MACHINE)).toBe(false);
      expect(request!.init.method).toBe("POST");
      expect(request!.init.redirect).toBe("error");
      expect(request!.init.headers).toEqual({ Authorization: `Bearer ${MACHINE}`, "Content-Type": "application/json" });
      // B4: exactly three members, and no duration, schedule or time member.
      expect(JSON.parse(String(request!.init.body))).toEqual({ fencingCounter: 4, leaseToken: LEASE_TOKEN, refusal });
      expect(Object.keys(JSON.parse(String(request!.init.body)) as object)).toEqual(["fencingCounter", "leaseToken", "refusal"]);
      expect("signal" in request!.init).toBe(false);
    }
    expect(PROVIDER_VERIFICATION_REFUSALS).toEqual(["UNSUPPORTED_PROVIDER", "UNSUPPORTED_POLICY", "PROVIDER_POLICY_MISMATCH"]);
    expect(Object.isFrozen(PROVIDER_VERIFICATION_REFUSALS)).toBe(true);
  });

  it("W2: validates the acknowledgement strictly: job, fence, state QUEUED, canonical instant and exact members", async () => {
    for (const body of [
      { ...DEFERRAL_BODY, providerVerificationJobId: OTHER_JOB },
      { ...DEFERRAL_BODY, providerVerificationJobId: JOB.toUpperCase() },
      { ...DEFERRAL_BODY, fencingCounter: 5 },
      { ...DEFERRAL_BODY, fencingCounter: "4" },
      { ...DEFERRAL_BODY, state: "LEASED" },
      { ...DEFERRAL_BODY, state: "queued" },
      { ...DEFERRAL_BODY, state: "CANCELLED" },
      { ...DEFERRAL_BODY, deferredUntil: "2026-11-23T10:05:00Z" },
      { ...DEFERRAL_BODY, deferredUntil: "2026-02-30T10:05:00.000Z" },
      { ...DEFERRAL_BODY, deferredUntil: 1795000000000 },
      { ...DEFERRAL_BODY, deferredUntil: null },
      { ...DEFERRAL_BODY, deferralSeconds: 300 },
      { ...DEFERRAL_BODY, leaseToken: LEASE_TOKEN },
      { providerVerificationJobId: JOB, fencingCounter: 4, state: "QUEUED" },
      [],
      null,
      "QUEUED",
    ]) {
      const { client, captured } = clientAnswering(ok(body));
      expect(await codeOf(client.deferUnsupportedProviderVerification(JOB, PROOF, "UNSUPPORTED_PROVIDER")), JSON.stringify(body)).toBe("MALFORMED_CONTROL_RESPONSE");
      expect(captured).toHaveLength(1);
    }
    // The exported parser applies the same rules and never registers provenance.
    expect(parseProviderVerificationDeferralResponse(DEFERRAL_BODY, { providerVerificationJobId: JOB, fencingCounter: 4 })).toEqual({
      providerVerificationJobId: JOB,
      fencingCounter: 4,
      state: "QUEUED",
      deferredUntil: new Date(DEFERRED_UNTIL),
    });
    expect(() => parseProviderVerificationDeferralResponse(DEFERRAL_BODY, { providerVerificationJobId: JOB, fencingCounter: 5 })).toThrow(WorkerError);
  });

  it("W3: maps every status, including 404 from an older API as MALFORMED_CONTROL_RESPONSE, with exactly one request", async () => {
    for (const [answer, expected] of [
      [{ status: 409, body: { status: "error", code: "LEASE_REJECTED" } }, "PROVIDER_VERIFICATION_DEFERRAL_REJECTED"],
      [{ status: 401, body: {} }, "WORKER_AUTHENTICATION_REJECTED"],
      [{ status: 403, body: {} }, "WORKER_AUTHENTICATION_REJECTED"],
      [{ status: 500, body: "" }, "CONTROL_API_UNAVAILABLE"],
      [{ status: 503, body: {} }, "CONTROL_API_UNAVAILABLE"],
      ["THROW", "CONTROL_API_UNAVAILABLE"],
      [{ status: 404, body: { status: "error", code: "NOT_FOUND" } }, "MALFORMED_CONTROL_RESPONSE"],
      [{ status: 400, body: {} }, "MALFORMED_CONTROL_RESPONSE"],
      [{ status: 405, body: {} }, "MALFORMED_CONTROL_RESPONSE"],
      [{ status: 413, body: {} }, "MALFORMED_CONTROL_RESPONSE"],
      [{ status: 415, body: {} }, "MALFORMED_CONTROL_RESPONSE"],
      [{ status: 201, body: DEFERRAL_BODY }, "MALFORMED_CONTROL_RESPONSE"],
    ] as const) {
      const { client, captured } = clientAnswering(answer, ok(DEFERRAL_BODY));
      expect(await codeOf(client.deferUnsupportedProviderVerification(JOB, PROOF, "PROVIDER_POLICY_MISMATCH")), JSON.stringify(answer)).toBe(expected);
      expect(captured).toHaveLength(1);
    }
  });

  it("W4: refuses an invalid job ID, proof or refusal with PROVIDER_VERIFICATION_REQUEST_INVALID and zero requests", async () => {
    const send = async (invoke: (client: ProviderVerificationControlClient) => Promise<unknown>) => {
      const { client, captured } = clientAnswering(ok(DEFERRAL_BODY));
      const code = await codeOf(invoke(client));
      expect(captured).toHaveLength(0);
      return code;
    };
    for (const job of ["", "not-a-uuid", JOB.toUpperCase(), `${JOB}/release`, 42, null, undefined]) {
      expect(await send((client) => client.deferUnsupportedProviderVerification(job as string, PROOF, "UNSUPPORTED_PROVIDER")), String(job)).toBe(
        "PROVIDER_VERIFICATION_REQUEST_INVALID",
      );
    }
    for (const proof of [null, "proof", { fencingCounter: 0, leaseToken: LEASE_TOKEN }, { fencingCounter: 4, leaseToken: "short" }, { fencingCounter: 4 }]) {
      expect(await send((client) => client.deferUnsupportedProviderVerification(JOB, proof as typeof PROOF, "UNSUPPORTED_PROVIDER")), JSON.stringify(proof)).toBe(
        "PROVIDER_VERIFICATION_REQUEST_INVALID",
      );
    }
    for (const refusal of ["", "unsupported_provider", "UNSUPPORTED_MODEL", "VERIFICATION_UNSCHEDULABLE", " UNSUPPORTED_POLICY", 1, null, undefined, ["UNSUPPORTED_POLICY"]]) {
      expect(await send((client) => client.deferUnsupportedProviderVerification(JOB, PROOF, refusal as "UNSUPPORTED_POLICY")), JSON.stringify(refusal)).toBe(
        "PROVIDER_VERIFICATION_REQUEST_INVALID",
      );
    }
  });

  it("W5: reads each proof member exactly once and sends only the validated locals", async () => {
    const reads = { fencingCounter: 0, leaseToken: 0 };
    const shifting = {
      get fencingCounter() {
        reads.fencingCounter += 1;
        return reads.fencingCounter === 1 ? 4 : 99;
      },
      get leaseToken() {
        reads.leaseToken += 1;
        return reads.leaseToken === 1 ? LEASE_TOKEN : "x";
      },
    };
    const { client, captured } = clientAnswering(ok(DEFERRAL_BODY));
    await client.deferUnsupportedProviderVerification(JOB, shifting, "UNSUPPORTED_PROVIDER");
    expect(reads).toEqual({ fencingCounter: 1, leaseToken: 1 });
    expect(JSON.parse(String(captured[0]!.init.body))).toEqual({ fencingCounter: 4, leaseToken: LEASE_TOKEN, refusal: "UNSUPPORTED_PROVIDER" });
  });

  it("keeps the error opaque: no lease token, credential or response body in a deferral failure", async () => {
    const { client } = clientAnswering({ status: 409, body: { status: "error", leaked: LEASE_TOKEN } });
    expect(await codeOf(client.deferUnsupportedProviderVerification(JOB, PROOF, "UNSUPPORTED_POLICY"))).toBe("PROVIDER_VERIFICATION_DEFERRAL_REJECTED");
  });
});

describe("provider verification client refuses to send anything outside the contract", () => {
  const send = async (invoke: (client: ProviderVerificationControlClient) => Promise<unknown>) => {
    const { client, captured } = clientAnswering(ok(GRANT_BODY));
    const code = await codeOf(invoke(client));
    expect(captured).toHaveLength(0);
    return code;
  };
  const badJobs: unknown[] = ["", "not-a-uuid", JOB.toUpperCase(), `${JOB} `, `{${JOB}}`, 42, null, undefined];
  const badProofs: unknown[] = [
    null,
    undefined,
    "proof",
    { fencingCounter: 0, leaseToken: LEASE_TOKEN },
    { fencingCounter: -1, leaseToken: LEASE_TOKEN },
    { fencingCounter: 1.5, leaseToken: LEASE_TOKEN },
    { fencingCounter: "4", leaseToken: LEASE_TOKEN },
    { fencingCounter: Number.NaN, leaseToken: LEASE_TOKEN },
    { fencingCounter: Number.MAX_SAFE_INTEGER + 1, leaseToken: LEASE_TOKEN },
    { fencingCounter: 4, leaseToken: LEASE_TOKEN.slice(1) },
    { fencingCounter: 4, leaseToken: `${LEASE_TOKEN}A` },
    { fencingCounter: 4, leaseToken: `${LEASE_TOKEN.slice(1)}=` },
    { fencingCounter: 4 },
  ];
  const badReports: unknown[] = [
    null,
    { outcome: "VERIFIED", reasonCode: "CREDENTIAL_REJECTED" },
    { outcome: "DEFINITIVE_FAILURE", reasonCode: "VERIFICATION_SUCCEEDED" },
    { outcome: "INCONCLUSIVE", reasonCode: "WORKER_LOST_AFTER_CREDENTIAL_GRANT" },
    { outcome: "INCONCLUSIVE", reasonCode: "WORKER_LOST_DURING_VERIFYING" },
    { outcome: "verified", reasonCode: "VERIFICATION_SUCCEEDED" },
    { outcome: "UNKNOWN", reasonCode: "VERIFICATION_SUCCEEDED" },
    { outcome: "VERIFIED" },
  ];

  it("refuses an invalid job ID or proof on the three proof routes with zero requests", async () => {
    for (const job of badJobs) {
      expect(await send((client) => client.requestProviderVerificationCredentialGrant(job as string, PROOF))).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
      expect(await send((client) => client.acknowledgeProviderVerificationVerifying(job as string, PROOF))).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
      expect(await send((client) => client.reportProviderVerificationResult(job as string, PROOF, REPORT))).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
    }
    for (const proof of badProofs) {
      const typed = proof as typeof PROOF;
      expect(await send((client) => client.requestProviderVerificationCredentialGrant(JOB, typed)), JSON.stringify(proof)).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
      expect(await send((client) => client.acknowledgeProviderVerificationVerifying(JOB, typed)), JSON.stringify(proof)).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
      expect(await send((client) => client.reportProviderVerificationResult(JOB, typed, REPORT)), JSON.stringify(proof)).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
    }
  });

  it("refuses a result report that is not a worker-reportable outcome and reason pair, with zero requests", async () => {
    for (const report of badReports) {
      expect(await send((client) => client.reportProviderVerificationResult(JOB, PROOF, report as ProviderVerificationResultReport)), JSON.stringify(report)).toBe(
        "PROVIDER_VERIFICATION_REQUEST_INVALID",
      );
    }
    expect(new WorkerError("PROVIDER_VERIFICATION_REQUEST_INVALID").message).toBe("The provider verification request is invalid and was not sent.");
  });
});

describe("provider verification client strict parsing", () => {
  const malformed = async (answer: unknown, invoke: (client: ProviderVerificationControlClient) => Promise<unknown>) => {
    const { client, captured } = clientAnswering(ok(answer));
    const code = await codeOf(invoke(client));
    expect(captured).toHaveLength(1);
    return code;
  };
  const lease = LEASE_BODY.lease;
  const leaseBodies: unknown[] = [
    {},
    { lease: null, extra: true },
    { lease: [] },
    { lease: { ...lease, extra: 1 } },
    { lease: { ...lease, leaseExpiresAt: undefined } },
    { lease: { ...lease, providerVerificationJobId: JOB.toUpperCase() } },
    { lease: { ...lease, provider: "google_genai" } },
    { lease: { ...lease, provider: "" } },
    { lease: { ...lease, verificationPolicyId: "google_genai_models_list_v1beta" } },
    { lease: { ...lease, verificationPolicyId: `A${"B".repeat(128)}` } },
    { lease: { ...lease, verificationPolicyId: "1POLICY" } },
    { lease: { ...lease, leaseToken: "short" } },
    { lease: { ...lease, fencingCounter: 0 } },
    { lease: { ...lease, fencingCounter: "4" } },
    { lease: { ...lease, leaseExpiresAt: "2026-11-23T10:00:30Z" } },
    { lease: { ...lease, leaseExpiresAt: "2026-02-30T10:00:30.000Z" } },
    { lease: { ...lease, sealedEnvelope: ENVELOPE } },
  ];
  const grantBodies: unknown[] = [
    { ...GRANT_BODY, providerVerificationJobId: OTHER_JOB },
    { ...GRANT_BODY, fencingCounter: 5 },
    { ...GRANT_BODY, extra: true },
    { ...GRANT_BODY, credential: { sealedEnvelope: ENVELOPE } },
    { ...GRANT_BODY, credential: { sealedEnvelope: ENVELOPE, openingContext: CONTEXT, plaintext: "x" } },
    { ...GRANT_BODY, credential: null },
    { ...GRANT_BODY, credentialGrantedAt: "yesterday" },
    { ...GRANT_BODY, leaseToken: LEASE_TOKEN },
  ];
  const verifyingBodies: unknown[] = [
    { ...VERIFYING_BODY, providerVerificationJobId: OTHER_JOB },
    { ...VERIFYING_BODY, fencingCounter: 3 },
    { ...VERIFYING_BODY, state: "LEASED" },
    { ...VERIFYING_BODY, state: "verifying" },
    { ...VERIFYING_BODY, verifyingAt: "2026-11-23T10:00:02.0Z" },
    { ...VERIFYING_BODY, extra: true },
    { providerVerificationJobId: JOB, fencingCounter: 4, state: "VERIFYING" },
  ];
  const resultBodies: unknown[] = [
    { ...RESULT_BODY, providerVerificationJobId: OTHER_JOB },
    { ...RESULT_BODY, fencingCounter: 3 },
    { ...RESULT_BODY, state: "VERIFYING" },
    { ...RESULT_BODY, outcome: "INCONCLUSIVE" },
    { ...RESULT_BODY, reasonCode: "VERIFICATION_AMBIGUOUS" },
    { ...RESULT_BODY, completedAt: null },
    { ...RESULT_BODY, extra: true },
  ];

  it("answers every deviation with MALFORMED_CONTROL_RESPONSE", async () => {
    for (const body of leaseBodies) expect(await malformed(body, (client) => client.leaseProviderVerification()), JSON.stringify(body)).toBe("MALFORMED_CONTROL_RESPONSE");
    for (const body of grantBodies) {
      expect(await malformed(body, (client) => client.requestProviderVerificationCredentialGrant(JOB, PROOF)), JSON.stringify(body)).toBe("MALFORMED_CONTROL_RESPONSE");
    }
    for (const body of verifyingBodies) {
      expect(await malformed(body, (client) => client.acknowledgeProviderVerificationVerifying(JOB, PROOF)), JSON.stringify(body)).toBe("MALFORMED_CONTROL_RESPONSE");
    }
    for (const body of resultBodies) {
      expect(await malformed(body, (client) => client.reportProviderVerificationResult(JOB, PROOF, REPORT)), JSON.stringify(body)).toBe("MALFORMED_CONTROL_RESPONSE");
    }
  });

  it("parses an unsupported lease structurally and returns it; admission is separate", async () => {
    for (const [provider, verificationPolicyId, reason] of [
      ["EXAMPLE_PROVIDER", GOOGLE_POLICY, "UNSUPPORTED_PROVIDER"],
      [GOOGLE_PROVIDER_ID, "OTHER_POLICY_V1", "UNSUPPORTED_POLICY"],
      [GOOGLE_PROVIDER_ID, RUNWAY_POLICY, "PROVIDER_POLICY_MISMATCH"],
    ] as const) {
      const { client } = clientAnswering(ok({ lease: { ...LEASE_BODY.lease, provider, verificationPolicyId } }));
      const lease = await client.leaseProviderVerification();
      expect(lease).toMatchObject({ provider, verificationPolicyId });
      expect(isIssuedProviderVerificationLease(lease)).toBe(true);
      expect(classifyProviderVerificationLease(lease!)).toEqual({ status: "REFUSED", reason });
    }
  });
});

describe("provider verification issued-object provenance", () => {
  async function issuedTriple() {
    const { client } = clientAnswering(ok(LEASE_BODY), ok(GRANT_BODY), ok(VERIFYING_BODY));
    const lease = (await client.leaseProviderVerification())!;
    const grant = await client.requestProviderVerificationCredentialGrant(JOB, PROOF);
    const acknowledgement = await client.acknowledgeProviderVerificationVerifying(JOB, PROOF);
    return { lease, grant, acknowledgement };
  }

  it("recognises only objects the client produced from a 200 of the matching route", async () => {
    const { lease, grant, acknowledgement } = await issuedTriple();
    expect(isIssuedProviderVerificationLease(lease)).toBe(true);
    expect(isIssuedProviderVerificationCredentialGrant(grant)).toBe(true);
    expect(isIssuedProviderVerificationVerifyingAcknowledgement(acknowledgement)).toBe(true);
    // Each predicate recognises only its own kind.
    expect(isIssuedProviderVerificationLease(grant) || isIssuedProviderVerificationLease(acknowledgement)).toBe(false);
    expect(isIssuedProviderVerificationCredentialGrant(lease) || isIssuedProviderVerificationCredentialGrant(acknowledgement)).toBe(false);
    expect(isIssuedProviderVerificationVerifyingAcknowledgement(lease) || isIssuedProviderVerificationVerifyingAcknowledgement(grant)).toBe(false);
    for (const value of [null, undefined, 0, "lease", Symbol("x")]) {
      expect(isIssuedProviderVerificationLease(value) || isIssuedProviderVerificationCredentialGrant(value) || isIssuedProviderVerificationVerifyingAcknowledgement(value)).toBe(false);
    }
  });

  it("never recognises parser output, look-alike literals or any copy of an issued object", async () => {
    const { lease, grant, acknowledgement } = await issuedTriple();
    const parsed = [
      [isIssuedProviderVerificationLease, parseProviderVerificationLeaseResponse(LEASE_BODY)],
      [isIssuedProviderVerificationCredentialGrant, parseProviderVerificationCredentialGrantResponse(GRANT_BODY, { providerVerificationJobId: JOB, fencingCounter: 4 })],
      [isIssuedProviderVerificationVerifyingAcknowledgement, parseProviderVerificationVerifyingResponse(VERIFYING_BODY, { providerVerificationJobId: JOB, fencingCounter: 4 })],
    ] as const;
    for (const [predicate, value] of parsed) expect(predicate(value)).toBe(false);
    for (const [predicate, original] of [
      [isIssuedProviderVerificationLease, lease],
      [isIssuedProviderVerificationCredentialGrant, grant],
      [isIssuedProviderVerificationVerifyingAcknowledgement, acknowledgement],
    ] as const) {
      const copies: unknown[] = [
        { ...original },
        Object.assign({}, original),
        structuredClone(original),
        JSON.parse(JSON.stringify(original)),
        Object.freeze({ ...original }),
        Object.create(original),
      ];
      for (const copy of copies) expect(predicate(copy)).toBe(false);
      expect(predicate(original)).toBe(true);
    }
    // A structurally identical literal is never authority.
    expect(
      isIssuedProviderVerificationVerifyingAcknowledgement(Object.freeze({ providerVerificationJobId: JOB, fencingCounter: 4, state: "VERIFYING", verifyingAt: new Date(VERIFYING_AT) })),
    ).toBe(false);
  });

  it("registers a new, distinct issued object for each successful VERIFYING call answering the same job and fence", async () => {
    const { client, captured } = clientAnswering(ok(VERIFYING_BODY), ok(VERIFYING_BODY));
    const first = await client.acknowledgeProviderVerificationVerifying(JOB, PROOF);
    const second = await client.acknowledgeProviderVerificationVerifying(JOB, PROOF);
    expect(captured).toHaveLength(2);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    expect(isIssuedProviderVerificationVerifyingAcknowledgement(first)).toBe(true);
    expect(isIssuedProviderVerificationVerifyingAcknowledgement(second)).toBe(true);
  });

  it("registers nothing for a call that fails before successful issuance", async () => {
    // Observe every provenance registration directly. Only objects shaped like
    // a verification answer are kept, so unrelated runtime WeakSet use is ignored.
    const registered: object[] = [];
    const originalAdd = WeakSet.prototype.add;
    const record = async <T>(run: () => Promise<T>) => {
      registered.length = 0;
      WeakSet.prototype.add = function (this: WeakSet<object>, value: object) {
        if (typeof value === "object" && value !== null && "providerVerificationJobId" in value) registered.push(value);
        return originalAdd.call(this, value);
      };
      try {
        return await run();
      } finally {
        WeakSet.prototype.add = originalAdd;
      }
    };
    // Control: a successful call registers exactly its returned object, so the spy sees registrations.
    const good = clientAnswering(ok(VERIFYING_BODY));
    const issuedAcknowledgement = await record(() => good.client.acknowledgeProviderVerificationVerifying(JOB, PROOF));
    expect(registered).toEqual([issuedAcknowledgement]);
    expect(registered[0]).toBe(issuedAcknowledgement);
    expect(isIssuedProviderVerificationVerifyingAcknowledgement(issuedAcknowledgement)).toBe(true);

    for (const [call, answer, expected] of [
      [CALLS[0]!, { status: 200, body: { lease: { ...LEASE_BODY.lease, fencingCounter: 0 } } }, "MALFORMED_CONTROL_RESPONSE"],
      [CALLS[1]!, { status: 200, body: { ...GRANT_BODY, fencingCounter: 3 } }, "MALFORMED_CONTROL_RESPONSE"],
      [CALLS[2]!, { status: 200, body: { ...VERIFYING_BODY, fencingCounter: 3 } }, "MALFORMED_CONTROL_RESPONSE"],
      [CALLS[2]!, { status: 200, body: { ...VERIFYING_BODY, state: "LEASED" } }, "MALFORMED_CONTROL_RESPONSE"],
      [CALLS[0]!, { status: 409, body: { status: "error" } }, "PROVIDER_VERIFICATION_LEASE_REJECTED"],
      [CALLS[1]!, { status: 409, body: { status: "error" } }, "PROVIDER_VERIFICATION_GRANT_REJECTED"],
      [CALLS[2]!, { status: 409, body: { status: "error" } }, "PROVIDER_VERIFICATION_VERIFYING_REJECTED"],
      [CALLS[2]!, "THROW", "CONTROL_API_UNAVAILABLE"],
    ] as const) {
      const { client } = clientAnswering(answer);
      const outcome = await record(() => call.invoke(client).then(() => undefined, (error: unknown) => error));
      expect(inspectCode(outcome), `${call.name} ${JSON.stringify(answer)}`).toBe(expected);
      // No provenance mutation happened for the failed call.
      expect(registered, `${call.name} ${JSON.stringify(answer)}`).toEqual([]);
    }

    // The would-be answer of a failed VERIFYING call, rebuilt by the pure parser
    // for the fence it carried, is not issued either.
    const candidate = parseProviderVerificationVerifyingResponse({ ...VERIFYING_BODY, fencingCounter: 3 }, { providerVerificationJobId: JOB, fencingCounter: 3 });
    expect(isIssuedProviderVerificationVerifyingAcknowledgement(candidate)).toBe(false);
    // Invalid local input registers nothing and sends nothing.
    const invalid = clientAnswering(ok(VERIFYING_BODY));
    const refused = await record(() => invalid.client.acknowledgeProviderVerificationVerifying(JOB, { fencingCounter: 0, leaseToken: LEASE_TOKEN }).then(() => undefined, (error: unknown) => error));
    expect(inspectCode(refused)).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect(registered).toEqual([]);
    expect(invalid.captured).toHaveLength(0);
  });
});

// m1: every caller-supplied request member is read once, validated, and that
// same validated value is the one sent.
describe("provider verification client reads caller input exactly once", () => {
  // A proof or report whose members are accessors counting their reads and
  // answering from a per-member script (the last answer repeats).
  function scripted<K extends string>(script: Readonly<Record<K, readonly unknown[]>>) {
    const reads = Object.fromEntries(Object.keys(script).map((key) => [key, 0])) as Record<K, number>;
    const value = {} as Record<K, unknown>;
    for (const key of Object.keys(script) as K[]) {
      Object.defineProperty(value, key, {
        enumerable: true,
        get() {
          const answers = script[key];
          const answer = answers[Math.min(reads[key], answers.length - 1)];
          reads[key] += 1;
          return answer;
        },
      });
    }
    return { value, reads };
  }
  const OTHER_TOKEN = "Ab".repeat(21) + "C";

  it("sends exactly the proof values it validated, reading each once", async () => {
    for (const call of CALLS.slice(1)) {
      // Valid on the first read, something else (invalid or different) afterwards.
      const proof = scripted({ fencingCounter: [4, 0], leaseToken: [LEASE_TOKEN, "not a lease token"] });
      const { client, captured } = clientAnswering(ok(call.success));
      const typed = proof.value as unknown as typeof PROOF;
      const invoke =
        call.name === "requestProviderVerificationCredentialGrant"
          ? client.requestProviderVerificationCredentialGrant(JOB, typed)
          : call.name === "acknowledgeProviderVerificationVerifying"
            ? client.acknowledgeProviderVerificationVerifying(JOB, typed)
            : call.name === "deferUnsupportedProviderVerification"
              ? client.deferUnsupportedProviderVerification(JOB, typed, "UNSUPPORTED_POLICY")
              : client.reportProviderVerificationResult(JOB, typed, REPORT);
      await invoke;
      expect(proof.reads, call.name).toEqual({ fencingCounter: 1, leaseToken: 1 });
      expect(captured, call.name).toHaveLength(1);
      const sent = JSON.parse(String(captured[0]!.init.body)) as Record<string, unknown>;
      expect({ fencingCounter: sent.fencingCounter, leaseToken: sent.leaseToken }, call.name).toEqual({ fencingCounter: 4, leaseToken: LEASE_TOKEN });
    }
    // A second valid value after validation is not sent either.
    const switching = scripted({ fencingCounter: [4], leaseToken: [LEASE_TOKEN, OTHER_TOKEN] });
    const { client, captured } = clientAnswering(ok(GRANT_BODY));
    await client.requestProviderVerificationCredentialGrant(JOB, switching.value as unknown as typeof PROOF);
    expect((JSON.parse(String(captured[0]!.init.body)) as { leaseToken: string }).leaseToken).toBe(LEASE_TOKEN);
  });

  it("sends exactly the result pair it validated, reading each member once", async () => {
    const report = scripted({ outcome: ["VERIFIED", "DEFINITIVE_FAILURE"], reasonCode: ["VERIFICATION_SUCCEEDED", "CREDENTIAL_REJECTED"] });
    const { client, captured } = clientAnswering(ok(RESULT_BODY));
    const acknowledgement = await client.reportProviderVerificationResult(JOB, PROOF, report.value as unknown as ProviderVerificationResultReport);
    expect(report.reads).toEqual({ outcome: 1, reasonCode: 1 });
    expect(captured).toHaveLength(1);
    expect(JSON.parse(String(captured[0]!.init.body))).toEqual({ fencingCounter: 4, leaseToken: LEASE_TOKEN, outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
    expect(acknowledgement).toMatchObject({ outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
  });

  it("sends nothing when the single read is invalid, whatever a later read would answer", async () => {
    const proofs = [
      scripted({ fencingCounter: [0, 4], leaseToken: [LEASE_TOKEN] }),
      scripted({ fencingCounter: [4], leaseToken: ["short", LEASE_TOKEN] }),
    ];
    for (const proof of proofs) {
      const { client, captured } = clientAnswering(ok(VERIFYING_BODY));
      expect(await codeOf(client.acknowledgeProviderVerificationVerifying(JOB, proof.value as unknown as typeof PROOF))).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
      expect(captured).toHaveLength(0);
      expect(Object.values(proof.reads).every((count) => count <= 1)).toBe(true);
    }
    const report = scripted({ outcome: ["VERIFIED", "VERIFIED"], reasonCode: ["CREDENTIAL_REJECTED", "VERIFICATION_SUCCEEDED"] });
    const { client, captured } = clientAnswering(ok(RESULT_BODY));
    expect(await codeOf(client.reportProviderVerificationResult(JOB, PROOF, report.value as unknown as ProviderVerificationResultReport))).toBe("PROVIDER_VERIFICATION_REQUEST_INVALID");
    expect(captured).toHaveLength(0);
    expect(report.reads).toEqual({ outcome: 1, reasonCode: 1 });
  });
});

describe("provider verification contract", () => {
  it("classifies admission structurally in the locked precedence, exactly and case-sensitively", () => {
    expect(classifyProviderVerificationLease({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: GOOGLE_POLICY })).toEqual({
      status: "SUPPORTED",
      provider: GOOGLE_PROVIDER_ID,
      verificationPolicyId: GOOGLE_POLICY,
    });
    expect(classifyProviderVerificationLease({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: RUNWAY_POLICY })).toEqual({
      status: "SUPPORTED",
      provider: RUNWAY_PROVIDER_ID,
      verificationPolicyId: RUNWAY_POLICY,
    });
    const refused = (provider: string, verificationPolicyId: string) => classifyProviderVerificationLease({ provider, verificationPolicyId });
    // A provider outside the set wins over every policy problem.
    expect(refused("EXAMPLE_PROVIDER", "OTHER_POLICY")).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_PROVIDER" });
    expect(refused("EXAMPLE_PROVIDER", GOOGLE_POLICY)).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_PROVIDER" });
    expect(refused(GOOGLE_PROVIDER_ID.toLowerCase(), GOOGLE_POLICY)).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_PROVIDER" });
    expect(refused(`${RUNWAY_PROVIDER_ID} `, RUNWAY_POLICY)).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_PROVIDER" });
    // There is no fake verification provider.
    expect(refused(["BUSYBOOKIE", "FAKE"].join("_"), GOOGLE_POLICY)).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_PROVIDER" });
    // Then a policy outside the set.
    expect(refused(GOOGLE_PROVIDER_ID, "OTHER_POLICY")).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_POLICY" });
    expect(refused(RUNWAY_PROVIDER_ID, RUNWAY_POLICY.toLowerCase())).toEqual({ status: "REFUSED", reason: "UNSUPPORTED_POLICY" });
    // Then a supported provider with the other provider's policy.
    expect(refused(GOOGLE_PROVIDER_ID, RUNWAY_POLICY)).toEqual({ status: "REFUSED", reason: "PROVIDER_POLICY_MISMATCH" });
    expect(refused(RUNWAY_PROVIDER_ID, GOOGLE_POLICY)).toEqual({ status: "REFUSED", reason: "PROVIDER_POLICY_MISMATCH" });
    expect(Object.isFrozen(refused(RUNWAY_PROVIDER_ID, GOOGLE_POLICY))).toBe(true);
  });

  it("accepts only a pair from the worker-reportable table", () => {
    for (const outcome of PROVIDER_VERIFICATION_OUTCOMES) {
      for (const reasonCode of PROVIDER_VERIFICATION_REASONS_BY_OUTCOME[outcome]) {
        expect(isProviderVerificationResultReport({ outcome, reasonCode }), `${outcome} ${reasonCode}`).toBe(true);
        for (const other of PROVIDER_VERIFICATION_OUTCOMES.filter((candidate) => candidate !== outcome)) {
          expect(isProviderVerificationResultReport({ outcome: other, reasonCode }), `${other} ${reasonCode}`).toBe(false);
        }
      }
    }
    for (const value of [null, undefined, [], "VERIFIED", { outcome: "VERIFIED", reasonCode: 1 }, { outcome: "INCONCLUSIVE", reasonCode: "WORKER_LOST_DURING_VERIFYING" }]) {
      expect(isProviderVerificationResultReport(value)).toBe(false);
    }
  });

  it("exports frozen vocabulary", () => {
    expect(Object.isFrozen(PROVIDER_VERIFICATION_OUTCOMES)).toBe(true);
    expect(Object.isFrozen(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME)).toBe(true);
    for (const reasons of Object.values(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME)) expect(Object.isFrozen(reasons)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_PROVIDER_VERIFICATION_PAIRS)).toBe(true);
    for (const pair of SUPPORTED_PROVIDER_VERIFICATION_PAIRS) expect(Object.isFrozen(pair)).toBe(true);
  });
});

// Conflict repair C1: there is no literal-versus-constant provider drift test,
// because Phase 5 carries no local provider copy. The provider identity is
// locked structurally (source assertions in boundary.test.ts; identity here).
describe("provider identity (R44B11F Phase 5, conflict repair C1)", () => {
  const contractSource = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "providerVerificationContract.ts"), "utf8");

  it("uses the imported GOOGLE_PROVIDER_ID as the Google pair's provider", () => {
    expect(contractSource).toMatch(/^import \{ GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID \} from "commercial-worker-protocol";$/m);
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[0]).toEqual({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: GOOGLE_POLICY });
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[0]!.provider).toBe(GOOGLE_PROVIDER_ID);
  });

  it("uses the imported RUNWAY_PROVIDER_ID as the Runway pair's provider", () => {
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[1]).toEqual({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: RUNWAY_POLICY });
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[1]!.provider).toBe(RUNWAY_PROVIDER_ID);
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS).toHaveLength(2);
  });

  it("keeps no duplicate local provider-identity literal in the contract module", () => {
    const code = contractSource.replace(/^\s*\/\/.*$/gm, "");
    expect(/["'`](GOOGLE_GENAI|RUNWAY)["'`]/.test(code)).toBe(false);
    expect(code.match(/\bGOOGLE_PROVIDER_ID\b/g)).toHaveLength(2);
    expect(code.match(/\bRUNWAY_PROVIDER_ID\b/g)).toHaveLength(2);
  });
});

// Vocabulary drift (test-only imports; no production import, no protocol
// change). Drift tests 1 and 2 were removed by conflict repair C1.
describe("provider verification vocabulary drift", () => {
  const architecture = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".."), "docs", "commercial", "COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md"), "utf8");
  const flag = (name: string) => architecture.match(new RegExp(`^${name}=(.+)$`, "m"))?.[1];

  it("3. the outcomes exactly equal the commercial-api outcomes, in order", () => {
    expect([...PROVIDER_VERIFICATION_OUTCOMES]).toEqual([...API_OUTCOMES]);
  });

  it("4. every worker reason is worker-reportable, and the table is exactly the Phase 3 table", () => {
    for (const reason of Object.values(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME).flat()) expect(isWorkerReportableVerificationReason(reason), reason).toBe(true);
    expect(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME).toEqual({
      VERIFIED: ["VERIFICATION_SUCCEEDED"],
      DEFINITIVE_FAILURE: ["CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED"],
      INCONCLUSIVE: [
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
      ],
    });
    expect(Object.keys(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME)).toEqual([...API_OUTCOMES]);
  });

  it("5. the WORKER_LOST_* reasons are not worker-reportable and are absent", () => {
    const all: readonly string[] = Object.values(PROVIDER_VERIFICATION_REASONS_BY_OUTCOME).flat();
    for (const reason of ["WORKER_LOST_AFTER_CREDENTIAL_GRANT", "WORKER_LOST_DURING_VERIFYING"]) {
      expect(isWorkerReportableVerificationReason(reason), reason).toBe(false);
      expect(all.includes(reason), reason).toBe(false);
    }
  });

  it("6. the Google pair's policy ID is the locked literal", () => {
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[0]!.verificationPolicyId).toBe("GOOGLE_GENAI_MODELS_LIST_V1BETA");
    expect(flag("R44B11F_GOOGLE_POLICY_ID")).toBe("GOOGLE_GENAI_MODELS_LIST_V1BETA");
  });

  it("7. the Runway pair's policy ID is the locked literal", () => {
    expect(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[1]!.verificationPolicyId).toBe("RUNWAY_ORGANIZATION_GET_V1_2024_11_06");
    expect(flag("R44B11F_RUNWAY_POLICY_ID")).toBe("RUNWAY_ORGANIZATION_GET_V1_2024_11_06");
  });
});
