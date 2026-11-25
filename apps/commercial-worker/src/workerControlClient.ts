import { isProviderExecutionId } from "./providerExecutionContract.js";
import {
  isProviderVerificationResultReport,
  type ProviderVerificationOutcome,
  type ProviderVerificationReasonCode,
  type ProviderVerificationResultReport,
} from "./providerVerificationContract.js";
import { WorkerError, type WorkerErrorCode } from "./workerError.js";

// Outbound-only HTTP client for the commercial-api worker-control routes
// (POST /worker-control/v1/...). It owns no listener and has no database,
// engine or provider access. The machine credential travels only in the
// Authorization header; it never appears in a URL, query string, cookie,
// custom header, log line or error.
//
// Responses are untrusted and parsed strictly against the protocol: exact
// member sets, canonical identifiers and bounded values. Anything else is
// MALFORMED_CONTROL_RESPONSE and is never retried.

export type WorkerLease = Readonly<{
  executionJobId: string;
  executionAttemptId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  generationRequest: Readonly<Record<string, unknown>>;
  generationRequestSha256: string;
  expectedCostCap: Readonly<{ unit: "MICRO_USD" | "PROVIDER_CREDITS"; amount: number }>;
  // Held in memory only, for the lifetime of this lease.
  leaseToken: string;
  fencingCounter: number;
  leaseExpiresAt: Date;
}>;

export type LeaseProof = Readonly<{ fencingCounter: number; leaseToken: string }>;

// The grant as received: the envelope and context are still untrusted here
// and are validated against the credential contract before opening.
export type WorkerCredentialGrant = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  credentialGrantedAt: Date;
  sealedEnvelope: unknown;
  openingContext: unknown;
}>;

// The live SUBMITTING -> SUBMITTED acknowledgement as received (R44B6O
// contract, architecture section 18).
export type WorkerSubmittedAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: "SUBMITTED";
  providerExecutionId: string;
  submittedAt: Date;
}>;

// The fenced LEASED -> SUBMITTING acknowledgement as received (R44B6J
// contract; client locked by R44B6U0, architecture section 15). Only this
// exact acknowledgement grants provider-call authority.
const SUBMITTING_STATE = "SUBMITTING" as const;
export type WorkerSubmittingAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: typeof SUBMITTING_STATE;
  submittingAt: Date;
}>;

// The lease renewal as received (existing heartbeat route; client locked by
// R44B6W0, architecture section 15). The response names neither the attempt
// (bound by the request path) nor a state. leaseExpiresAt is authoritative
// server data, never compared with the local clock here.
export type WorkerHeartbeatAcknowledgement = Readonly<{
  fencingCounter: number;
  leaseExpiresAt: Date;
}>;

// The token-less acceptance-recovery acknowledgement as received (R44B6R
// contract, architecture section 18): the first transition or an idempotent
// replay of the same provider execution ID.
export type AcceptanceRecoveryState = "SUBMITTED" | "SUCCEEDED" | "SUBMITTED_FAILED" | "ABANDONED";
export type WorkerAcceptanceRecoveryAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: AcceptanceRecoveryState;
  providerExecutionId: string;
}>;

// ATTEMPT_STILL_SUBMITTING is an expected lifecycle wait, not an error and
// never an acknowledgement; the startup retry policy decides what follows.
export type WorkerAcceptanceRecoveryResult =
  | Readonly<{ status: "ACKNOWLEDGED"; acknowledgement: WorkerAcceptanceRecoveryAcknowledgement }>
  | Readonly<{ status: "ATTEMPT_STILL_SUBMITTING" }>;

// The closed submission-failure report (R44B6T0 contract; client locked by
// R44B6Y0, architecture section 18). Each outcome admits only its own codes
// and commits exactly one state.
export type SubmissionFailureOutcome = "DEFINITIVELY_REJECTED" | "OUTCOME_UNKNOWN";
export type SubmissionFailureCode =
  | "PROVIDER_REJECTED_DEFINITIVELY"
  | "PROVIDER_SUBMISSION_AMBIGUOUS"
  | "ACCEPTANCE_JOURNAL_WRITE_FAILED"
  | "PROVIDER_EXECUTION_ID_INVALID";
export type SubmissionFailureState = "FAILED_BEFORE_SUBMISSION" | "OUTCOME_UNKNOWN";
export type SubmissionFailureReport = Readonly<{ outcome: SubmissionFailureOutcome; failureCode: SubmissionFailureCode }>;
export type WorkerSubmissionFailedAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: SubmissionFailureState;
  failureCode: SubmissionFailureCode;
}>;

const SUBMISSION_FAILURE_OUTCOMES: Readonly<Record<SubmissionFailureOutcome, Readonly<{ state: SubmissionFailureState; codes: readonly SubmissionFailureCode[] }>>> =
  Object.freeze({
    DEFINITIVELY_REJECTED: Object.freeze({ state: "FAILED_BEFORE_SUBMISSION", codes: Object.freeze(["PROVIDER_REJECTED_DEFINITIVELY"] as const) }),
    OUTCOME_UNKNOWN: Object.freeze({
      state: "OUTCOME_UNKNOWN",
      codes: Object.freeze(["PROVIDER_SUBMISSION_AMBIGUOUS", "ACCEPTANCE_JOURNAL_WRITE_FAILED", "PROVIDER_EXECUTION_ID_INVALID"] as const),
    }),
  });

// The closed input-failed report (R44B10P2 contract, architecture section 18,
// "input-failed route"): a permanent pre-provider input failure of a granted
// LEASED attempt. Exactly five provider-neutral codes; storage codes never
// cross the route. The only committed state is FAILED_BEFORE_SUBMISSION.
export const INPUT_FAILURE_CODES = Object.freeze([
  "INPUT_REFERENCE_INVALID",
  "INPUT_OBJECT_NOT_FOUND",
  "INPUT_OBJECT_TOO_LARGE",
  "INPUT_OBJECT_INTEGRITY_MISMATCH",
  "INPUT_MEDIA_TYPE_INVALID",
] as const);
export type InputFailureCode = (typeof INPUT_FAILURE_CODES)[number];
export type WorkerInputFailedAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: "FAILED_BEFORE_SUBMISSION";
  failureCode: InputFailureCode;
}>;

export const isInputFailureCode = (value: unknown): value is InputFailureCode =>
  typeof value === "string" && (INPUT_FAILURE_CODES as readonly string[]).includes(value);

const isSubmissionFailureReport = (report: unknown): report is SubmissionFailureReport => {
  if (!isPlainObject(report) || typeof report.outcome !== "string" || !Object.hasOwn(SUBMISSION_FAILURE_OUTCOMES, report.outcome)) return false;
  const codes: readonly string[] = SUBMISSION_FAILURE_OUTCOMES[report.outcome as SubmissionFailureOutcome].codes;
  return typeof report.failureCode === "string" && codes.includes(report.failureCode);
};

export type WorkerControlClient = Readonly<{
  leaseNextAttempt: () => Promise<WorkerLease | null>;
  requestCredentialGrant: (executionAttemptId: string, proof: LeaseProof) => Promise<WorkerCredentialGrant>;
  // R44B6P: capability only. Section 18 requires the durable acceptance
  // journal record to exist before this is called; no execution path calls
  // it yet.
  // R44B6Y: an externally supplied `signal` may abort it, which is a
  // transport failure; the caller owns any retry and deadline.
  reportSubmitted: (executionAttemptId: string, proof: LeaseProof, providerExecutionId: string, signal?: AbortSignal) => Promise<WorkerSubmittedAcknowledgement>;
  // R44B6Y: single-shot report of a failure before any durable acceptance
  // (R44B6Y0). No retry, timeout or lease clock of its own; an externally
  // supplied `signal` may abort it, which is a transport failure.
  reportSubmissionFailed: (
    executionAttemptId: string,
    proof: LeaseProof,
    report: SubmissionFailureReport,
    signal?: AbortSignal,
  ) => Promise<WorkerSubmissionFailedAcknowledgement>;
  // R44B10P2: single-shot report of a permanent pre-provider input failure.
  // No retry, timeout or lease clock of its own; an externally supplied
  // `signal` may abort it, which is a transport failure.
  reportInputFailed: (
    executionAttemptId: string,
    proof: LeaseProof,
    failureCode: InputFailureCode,
    signal?: AbortSignal,
  ) => Promise<WorkerInputFailedAcknowledgement>;
  // R44B6U: capability only; no worker path calls it yet (R44B6U0). One
  // request per call: no retry, no timeout of its own and no lease clock. An
  // externally supplied `signal` may abort it, which is a transport failure.
  // Anything but the exact acknowledgement grants no provider-call authority.
  acknowledgeSubmitting: (executionAttemptId: string, proof: LeaseProof, signal?: AbortSignal) => Promise<WorkerSubmittingAcknowledgement>;
  // R44B6W: capability only; no worker path calls it yet (R44B6W0). A neutral,
  // single-shot lease renewal: no retry, timeout, cadence or lease clock of
  // its own. An externally supplied `signal` may abort it, which is a
  // transport failure. The caller interprets the result.
  heartbeat: (executionAttemptId: string, proof: LeaseProof, signal?: AbortSignal) => Promise<WorkerHeartbeatAcknowledgement>;
  // R44B6S: startup recovery of a durable journal record. Sends no lease
  // token and obtains no lease. `signal` bounds the request by the startup
  // retry budget; its abort is a transport failure.
  recoverAcceptance: (
    executionAttemptId: string,
    fencingCounter: number,
    providerExecutionId: string,
    signal?: AbortSignal,
  ) => Promise<WorkerAcceptanceRecoveryResult>;
}>;

export type WorkerControlClientOptions = Readonly<{
  // Origin of the commercial-api worker-control listener, for example
  // https://control.internal.example; no path, query, fragment or userinfo.
  baseUrl: string;
  // Opaque machine credential (test-only mechanism in this slice).
  machineCredential: string;
  fetchImpl?: typeof fetch;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDER = /^[A-Z][A-Z0-9_]{0,31}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const LEASE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_TOKEN_LENGTH = 4096;

const malformed = () => new WorkerError("MALFORMED_CONTROL_RESPONSE");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw malformed();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw malformed();
  return value;
}

const text = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== "string" || !pattern.test(value)) throw malformed();
  return value;
};

const positiveSafeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw malformed();
  return value;
};

const instant = (value: unknown): Date => {
  const date = new Date(text(value, ISO_INSTANT));
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) throw malformed();
  return date;
};

export function parseLeaseResponse(body: unknown): WorkerLease | null {
  const envelope = exactKeys(body, ["lease"]);
  if (envelope.lease === null) return null;
  const lease = exactKeys(envelope.lease, [
    "executionJobId",
    "executionAttemptId",
    "attemptNumber",
    "provider",
    "model",
    "generationRequest",
    "generationRequestSha256",
    "expectedCostCap",
    "leaseToken",
    "fencingCounter",
    "leaseExpiresAt",
  ]);
  const cap = exactKeys(lease.expectedCostCap, ["unit", "amount"]);
  if (cap.unit !== "MICRO_USD" && cap.unit !== "PROVIDER_CREDITS") throw malformed();
  if (!isPlainObject(lease.generationRequest) || Object.keys(lease.generationRequest).length === 0) throw malformed();
  return Object.freeze({
    executionJobId: text(lease.executionJobId, UUID),
    executionAttemptId: text(lease.executionAttemptId, UUID),
    attemptNumber: positiveSafeInteger(lease.attemptNumber),
    provider: text(lease.provider, PROVIDER),
    model: text(lease.model, MODEL),
    generationRequest: Object.freeze({ ...lease.generationRequest }),
    generationRequestSha256: text(lease.generationRequestSha256, SHA256_HEX),
    expectedCostCap: Object.freeze({ unit: cap.unit, amount: positiveSafeInteger(cap.amount) }),
    leaseToken: text(lease.leaseToken, LEASE_TOKEN),
    fencingCounter: positiveSafeInteger(lease.fencingCounter),
    leaseExpiresAt: instant(lease.leaseExpiresAt),
  });
}

// The grant must answer exactly the attempt and fencing generation asked for.
export function parseCredentialGrantResponse(body: unknown, expected: Readonly<{ executionAttemptId: string; fencingCounter: number }>): WorkerCredentialGrant {
  const grant = exactKeys(body, ["executionAttemptId", "fencingCounter", "credentialGrantedAt", "credential"]);
  const credential = exactKeys(grant.credential, ["sealedEnvelope", "openingContext"]);
  const executionAttemptId = text(grant.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(grant.fencingCounter);
  if (executionAttemptId !== expected.executionAttemptId || fencingCounter !== expected.fencingCounter) throw malformed();
  return Object.freeze({
    executionAttemptId,
    fencingCounter,
    credentialGrantedAt: instant(grant.credentialGrantedAt),
    sealedEnvelope: credential.sealedEnvelope,
    openingContext: credential.openingContext,
  });
}

// The acknowledgement must answer exactly the attempt, fencing generation and
// provider execution ID reported, in state SUBMITTED.
export function parseSubmittedResponse(
  body: unknown,
  expected: Readonly<{ executionAttemptId: string; fencingCounter: number; providerExecutionId: string }>,
): WorkerSubmittedAcknowledgement {
  const acknowledgement = exactKeys(body, ["executionAttemptId", "fencingCounter", "state", "providerExecutionId", "submittedAt"]);
  const executionAttemptId = text(acknowledgement.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (
    executionAttemptId !== expected.executionAttemptId ||
    fencingCounter !== expected.fencingCounter ||
    acknowledgement.state !== "SUBMITTED" ||
    acknowledgement.providerExecutionId !== expected.providerExecutionId
  ) {
    throw malformed();
  }
  return Object.freeze({
    executionAttemptId,
    fencingCounter,
    state: "SUBMITTED",
    providerExecutionId: expected.providerExecutionId,
    submittedAt: instant(acknowledgement.submittedAt),
  });
}

// The acknowledgement must answer exactly the attempt and fencing generation
// presented, in state SUBMITTING, with a canonical server timestamp.
export function parseSubmittingResponse(
  body: unknown,
  expected: Readonly<{ executionAttemptId: string; fencingCounter: number }>,
): WorkerSubmittingAcknowledgement {
  const acknowledgement = exactKeys(body, ["executionAttemptId", "fencingCounter", "state", "submittingAt"]);
  const executionAttemptId = text(acknowledgement.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (executionAttemptId !== expected.executionAttemptId || fencingCounter !== expected.fencingCounter || acknowledgement.state !== SUBMITTING_STATE) {
    throw malformed();
  }
  return Object.freeze({ executionAttemptId, fencingCounter, state: SUBMITTING_STATE, submittingAt: instant(acknowledgement.submittingAt) });
}

// The renewal must answer exactly the fencing generation presented, with a
// canonical server expiry. No attempt or state is present to check.
export function parseHeartbeatResponse(body: unknown, expected: Readonly<{ fencingCounter: number }>): WorkerHeartbeatAcknowledgement {
  const renewal = exactKeys(body, ["fencingCounter", "leaseExpiresAt"]);
  const fencingCounter = positiveSafeInteger(renewal.fencingCounter);
  if (fencingCounter !== expected.fencingCounter) throw malformed();
  return Object.freeze({ fencingCounter, leaseExpiresAt: instant(renewal.leaseExpiresAt) });
}

const RECOVERY_STATES: ReadonlySet<unknown> = new Set(["SUBMITTED", "SUCCEEDED", "SUBMITTED_FAILED", "ABANDONED"]);

// The acknowledgement must answer exactly the attempt, original fencing
// counter and provider execution ID recovered, in one of the four states.
export function parseAcceptanceRecoveryResponse(
  body: unknown,
  expected: Readonly<{ executionAttemptId: string; fencingCounter: number; providerExecutionId: string }>,
): WorkerAcceptanceRecoveryAcknowledgement {
  const acknowledgement = exactKeys(body, ["executionAttemptId", "fencingCounter", "state", "providerExecutionId"]);
  const executionAttemptId = text(acknowledgement.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (
    executionAttemptId !== expected.executionAttemptId ||
    fencingCounter !== expected.fencingCounter ||
    !RECOVERY_STATES.has(acknowledgement.state) ||
    acknowledgement.providerExecutionId !== expected.providerExecutionId
  ) {
    throw malformed();
  }
  return Object.freeze({
    executionAttemptId,
    fencingCounter,
    state: acknowledgement.state as AcceptanceRecoveryState,
    providerExecutionId: expected.providerExecutionId,
  });
}

// The only 409 bodies the recovery route answers: {"status":"error","code":...}
// with ATTEMPT_STILL_SUBMITTING (wait) or the uniform LEASE_REJECTED (refusal).
export function parseAcceptanceRecoveryConflict(body: unknown): "ATTEMPT_STILL_SUBMITTING" | "LEASE_REJECTED" {
  const conflict = exactKeys(body, ["status", "code"]);
  if (conflict.status !== "error" || (conflict.code !== "ATTEMPT_STILL_SUBMITTING" && conflict.code !== "LEASE_REJECTED")) throw malformed();
  return conflict.code;
}

// The acknowledgement must answer exactly the attempt and fencing counter
// presented, in the one state the outcome commits, with the code reported.
export function parseSubmissionFailedResponse(
  body: unknown,
  expected: Readonly<{ executionAttemptId: string; fencingCounter: number; report: SubmissionFailureReport }>,
): WorkerSubmissionFailedAcknowledgement {
  const acknowledgement = exactKeys(body, ["executionAttemptId", "fencingCounter", "state", "failureCode"]);
  const executionAttemptId = text(acknowledgement.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  const state = SUBMISSION_FAILURE_OUTCOMES[expected.report.outcome].state;
  if (
    executionAttemptId !== expected.executionAttemptId ||
    fencingCounter !== expected.fencingCounter ||
    acknowledgement.state !== state ||
    acknowledgement.failureCode !== expected.report.failureCode
  ) {
    throw malformed();
  }
  return Object.freeze({ executionAttemptId, fencingCounter, state, failureCode: expected.report.failureCode });
}

// The acknowledgement must answer exactly the attempt, fencing counter and
// input-failure code reported, in state FAILED_BEFORE_SUBMISSION.
export function parseInputFailedResponse(
  body: unknown,
  expected: Readonly<{ executionAttemptId: string; fencingCounter: number; failureCode: InputFailureCode }>,
): WorkerInputFailedAcknowledgement {
  const acknowledgement = exactKeys(body, ["executionAttemptId", "fencingCounter", "state", "failureCode"]);
  const executionAttemptId = text(acknowledgement.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (
    executionAttemptId !== expected.executionAttemptId ||
    fencingCounter !== expected.fencingCounter ||
    acknowledgement.state !== "FAILED_BEFORE_SUBMISSION" ||
    acknowledgement.failureCode !== expected.failureCode
  ) {
    throw malformed();
  }
  return Object.freeze({ executionAttemptId, fencingCounter, state: "FAILED_BEFORE_SUBMISSION", failureCode: expected.failureCode });
}

function controlUrl(options: WorkerControlClientOptions): URL {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  return base;
}

// The shared outbound transport of every worker-control client in this
// module (R44B11F Phase 5 shares it rather than copying it): base-URL and
// machine-credential validation, the single Bearer-authenticated request with
// redirects refused, and the status mapping.
function controlTransport(options: WorkerControlClientOptions) {
  const base = controlUrl(options);
  const credential = options.machineCredential;
  if (typeof credential !== "string" || credential.length === 0 || credential.length > MAX_TOKEN_LENGTH || !TOKEN68.test(credential)) {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  // The single outbound request. A transport failure, including an abort by
  // the caller's signal, is UNAVAILABLE.
  async function send(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetchImpl(new URL(path, base), {
        method: "POST",
        headers:
          body === undefined
            ? { Authorization: `Bearer ${credential}` }
            : { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new WorkerError("CONTROL_API_UNAVAILABLE");
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw malformed();
    }
  }

  // Status mapping. 401 and 403 are never retried; 409 is the protocol's
  // uniform lease/grant refusal; 5xx and transport failures are UNAVAILABLE.
  async function post(path: string, body: unknown, rejected: WorkerErrorCode, signal?: AbortSignal): Promise<unknown> {
    const response = await send(path, body, signal);
    if (response.status === 200) {
      try {
        return await response.json();
      } catch {
        throw malformed();
      }
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403) throw new WorkerError("WORKER_AUTHENTICATION_REJECTED");
    if (response.status === 409) throw new WorkerError(rejected);
    if (response.status >= 500) throw new WorkerError("CONTROL_API_UNAVAILABLE");
    throw malformed();
  }

  return { send, readJson, post };
}

export function createHttpWorkerControlClient(options: WorkerControlClientOptions): WorkerControlClient {
  const { send, readJson, post } = controlTransport(options);

  return Object.freeze({
    leaseNextAttempt: async () => parseLeaseResponse(await post("/worker-control/v1/leases", undefined, "LEASE_REJECTED")),
    requestCredentialGrant: async (executionAttemptId: string, proof: LeaseProof) => {
      if (!UUID.test(executionAttemptId)) throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/credential-grant`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken },
        "CREDENTIAL_GRANT_REJECTED",
      );
      return parseCredentialGrantResponse(body, { executionAttemptId, fencingCounter: proof.fencingCounter });
    },
    // Exactly one request (R44B6U0): the caller owns any retry and deadline,
    // and only the control plane decides lease expiry. A 409 is the route's
    // uniform refusal and never proves that SUBMITTING did not commit.
    acknowledgeSubmitting: async (executionAttemptId: string, proof: LeaseProof, signal?: AbortSignal) => {
      // As for the credential grant, nothing outside the proof shape is sent.
      if (
        !UUID.test(executionAttemptId) ||
        typeof proof.fencingCounter !== "number" ||
        !Number.isSafeInteger(proof.fencingCounter) ||
        proof.fencingCounter < 1 ||
        typeof proof.leaseToken !== "string" ||
        !LEASE_TOKEN.test(proof.leaseToken)
      ) {
        throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      }
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/submitting`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken },
        "SUBMITTING_REJECTED",
        signal,
      );
      return parseSubmittingResponse(body, { executionAttemptId, fencingCounter: proof.fencingCounter });
    },
    // Exactly one request (R44B6W0): callers own any retry, deadline and
    // cadence, and only the control plane decides lease expiry. A 409 never
    // proves that an earlier heartbeat did not renew.
    heartbeat: async (executionAttemptId: string, proof: LeaseProof, signal?: AbortSignal) => {
      // As for the credential grant, nothing outside the proof shape is sent.
      if (
        !UUID.test(executionAttemptId) ||
        typeof proof.fencingCounter !== "number" ||
        !Number.isSafeInteger(proof.fencingCounter) ||
        proof.fencingCounter < 1 ||
        typeof proof.leaseToken !== "string" ||
        !LEASE_TOKEN.test(proof.leaseToken)
      ) {
        throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      }
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/heartbeat`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken },
        "HEARTBEAT_REJECTED",
        signal,
      );
      return parseHeartbeatResponse(body, { fencingCounter: proof.fencingCounter });
    },
    reportSubmitted: async (executionAttemptId: string, proof: LeaseProof, providerExecutionId: string, signal?: AbortSignal) => {
      // Nothing malformed is sent: the request is exactly the published contract.
      if (
        !UUID.test(executionAttemptId) ||
        !Number.isSafeInteger(proof.fencingCounter) ||
        proof.fencingCounter < 1 ||
        typeof proof.leaseToken !== "string" ||
        !LEASE_TOKEN.test(proof.leaseToken) ||
        !isProviderExecutionId(providerExecutionId)
      ) {
        throw new WorkerError("SUBMITTED_REPORT_INVALID");
      }
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/submitted`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken, providerExecutionId },
        "SUBMITTED_REPORT_REJECTED",
        signal,
      );
      return parseSubmittedResponse(body, { executionAttemptId, fencingCounter: proof.fencingCounter, providerExecutionId });
    },
    // Exactly one request (R44B6Y0): the caller owns any retry and deadline,
    // and only the control plane decides lease expiry. A 409 is the route's
    // uniform refusal and never proves anything about the lease.
    reportSubmissionFailed: async (executionAttemptId: string, proof: LeaseProof, report: SubmissionFailureReport, signal?: AbortSignal) => {
      // Nothing outside the published contract is sent.
      if (
        !UUID.test(executionAttemptId) ||
        typeof proof.fencingCounter !== "number" ||
        !Number.isSafeInteger(proof.fencingCounter) ||
        proof.fencingCounter < 1 ||
        typeof proof.leaseToken !== "string" ||
        !LEASE_TOKEN.test(proof.leaseToken) ||
        !isSubmissionFailureReport(report)
      ) {
        throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      }
      const fixed: SubmissionFailureReport = Object.freeze({ outcome: report.outcome, failureCode: report.failureCode });
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/submission-failed`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken, outcome: fixed.outcome, failureCode: fixed.failureCode },
        "SUBMISSION_FAILED_REJECTED",
        signal,
      );
      return parseSubmissionFailedResponse(body, { executionAttemptId, fencingCounter: proof.fencingCounter, report: fixed });
    },
    // Exactly one request (R44B10P2): the caller owns any retry and deadline,
    // and only the control plane decides lease expiry. A 409 is the route's
    // uniform refusal and never proves anything about the lease.
    reportInputFailed: async (executionAttemptId: string, proof: LeaseProof, failureCode: InputFailureCode, signal?: AbortSignal) => {
      // Nothing outside the published contract is sent.
      if (
        !UUID.test(executionAttemptId) ||
        typeof proof.fencingCounter !== "number" ||
        !Number.isSafeInteger(proof.fencingCounter) ||
        proof.fencingCounter < 1 ||
        typeof proof.leaseToken !== "string" ||
        !LEASE_TOKEN.test(proof.leaseToken) ||
        !isInputFailureCode(failureCode)
      ) {
        throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      }
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/input-failed`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken, failureCode },
        "INPUT_FAILED_REJECTED",
        signal,
      );
      return parseInputFailedResponse(body, { executionAttemptId, fencingCounter: proof.fencingCounter, failureCode });
    },
    // The one route whose 409 body is read: it separates the expected
    // ATTEMPT_STILL_SUBMITTING wait from the uniform refusal. Every other
    // status maps exactly as post() does.
    recoverAcceptance: async (executionAttemptId: string, fencingCounter: number, providerExecutionId: string, signal?: AbortSignal) => {
      // The identity comes from a strictly validated journal record; anything
      // else is unresolved evidence and nothing is sent.
      if (
        !UUID.test(executionAttemptId) ||
        typeof fencingCounter !== "number" ||
        !Number.isSafeInteger(fencingCounter) ||
        fencingCounter < 1 ||
        !isProviderExecutionId(providerExecutionId)
      ) {
        throw new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED");
      }
      const response = await send(
        `/worker-control/v1/attempts/${executionAttemptId}/acceptance-recovery`,
        { fencingCounter, providerExecutionId },
        signal,
      );
      const expected = { executionAttemptId, fencingCounter, providerExecutionId };
      if (response.status === 200) {
        const acknowledgement = parseAcceptanceRecoveryResponse(await readJson(response), expected);
        return Object.freeze({ status: "ACKNOWLEDGED" as const, acknowledgement });
      }
      if (response.status === 409) {
        if (parseAcceptanceRecoveryConflict(await readJson(response)) === "ATTEMPT_STILL_SUBMITTING") {
          return Object.freeze({ status: "ATTEMPT_STILL_SUBMITTING" as const });
        }
        throw new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED");
      }
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 401 || response.status === 403) throw new WorkerError("WORKER_AUTHENTICATION_REJECTED");
      if (response.status >= 500) throw new WorkerError("CONTROL_API_UNAVAILABLE");
      throw malformed();
    },
  });
}

// R44B11F Phase 5: the provider-verification control client (architecture
// "Client surface", "Worker-local wire types", "Issued-object provenance").
// A separate client type, so generation composers and their
// Pick<WorkerControlClient, ...> surfaces cannot reach verification methods.
// It shares the transport above, sends exactly one request per invocation,
// never retries and owns no timer, deadline or lease clock; the only deadline
// is the caller's optional AbortSignal.

export type ProviderVerificationLease = Readonly<{
  providerVerificationJobId: string;
  provider: string;
  verificationPolicyId: string;
  // Held in memory only, for the lifetime of this lease.
  leaseToken: string;
  fencingCounter: number;
  leaseExpiresAt: Date;
}>;

// The envelope and context stay untrusted here; only the verification
// credential-opening module validates them.
export type ProviderVerificationCredentialGrant = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  credentialGrantedAt: Date;
  sealedEnvelope: unknown;
  openingContext: unknown;
}>;

export type ProviderVerificationVerifyingAcknowledgement = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  state: "VERIFYING";
  verifyingAt: Date;
}>;

export type ProviderVerificationResultAcknowledgement = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  state: "COMPLETED";
  outcome: ProviderVerificationOutcome;
  reasonCode: ProviderVerificationReasonCode;
  completedAt: Date;
}>;

// R44B11G: the admission refusals a worker may report for a lease it cannot
// serve. Closed; the refusal is diagnostic and grants no authority.
export const PROVIDER_VERIFICATION_REFUSALS = Object.freeze(["UNSUPPORTED_PROVIDER", "UNSUPPORTED_POLICY", "PROVIDER_POLICY_MISMATCH"] as const);
export type ProviderVerificationRefusal = (typeof PROVIDER_VERIFICATION_REFUSALS)[number];

// R44B11G: the committed deferral. The job is QUEUED again with the same
// fencing counter, and is not leasable before deferredUntil (database time).
export type ProviderVerificationDeferralAcknowledgement = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  state: "QUEUED";
  deferredUntil: Date;
}>;

export type ProviderVerificationControlClient = Readonly<{
  leaseProviderVerification: (signal?: AbortSignal) => Promise<ProviderVerificationLease | null>;
  requestProviderVerificationCredentialGrant: (
    providerVerificationJobId: string,
    proof: LeaseProof,
    signal?: AbortSignal,
  ) => Promise<ProviderVerificationCredentialGrant>;
  acknowledgeProviderVerificationVerifying: (
    providerVerificationJobId: string,
    proof: LeaseProof,
    signal?: AbortSignal,
  ) => Promise<ProviderVerificationVerifyingAcknowledgement>;
  reportProviderVerificationResult: (
    providerVerificationJobId: string,
    proof: LeaseProof,
    report: ProviderVerificationResultReport,
    signal?: AbortSignal,
  ) => Promise<ProviderVerificationResultAcknowledgement>;
  // R44B11G: the one deferral request for a refused lease. Exactly one request,
  // never retried; no duration, schedule or time member is ever sent.
  deferUnsupportedProviderVerification: (
    providerVerificationJobId: string,
    proof: LeaseProof,
    refusal: ProviderVerificationRefusal,
    signal?: AbortSignal,
  ) => Promise<ProviderVerificationDeferralAcknowledgement>;
}>;

const VERIFICATION_POLICY_ID = /^[A-Z][A-Z0-9_]{0,127}$/;

// A lease is parsed structurally only: whether its provider and policy are
// supported is admission, not parsing, so an unsupported lease is returned.
export function parseProviderVerificationLeaseResponse(body: unknown): ProviderVerificationLease | null {
  const envelope = exactKeys(body, ["lease"]);
  if (envelope.lease === null) return null;
  const lease = exactKeys(envelope.lease, ["providerVerificationJobId", "provider", "verificationPolicyId", "leaseToken", "fencingCounter", "leaseExpiresAt"]);
  return Object.freeze({
    providerVerificationJobId: text(lease.providerVerificationJobId, UUID),
    provider: text(lease.provider, PROVIDER),
    verificationPolicyId: text(lease.verificationPolicyId, VERIFICATION_POLICY_ID),
    leaseToken: text(lease.leaseToken, LEASE_TOKEN),
    fencingCounter: positiveSafeInteger(lease.fencingCounter),
    leaseExpiresAt: instant(lease.leaseExpiresAt),
  });
}

// The grant must answer exactly the job and fencing generation asked for.
export function parseProviderVerificationCredentialGrantResponse(
  body: unknown,
  expected: Readonly<{ providerVerificationJobId: string; fencingCounter: number }>,
): ProviderVerificationCredentialGrant {
  const grant = exactKeys(body, ["providerVerificationJobId", "fencingCounter", "credentialGrantedAt", "credential"]);
  const credential = exactKeys(grant.credential, ["sealedEnvelope", "openingContext"]);
  const providerVerificationJobId = text(grant.providerVerificationJobId, UUID);
  const fencingCounter = positiveSafeInteger(grant.fencingCounter);
  if (providerVerificationJobId !== expected.providerVerificationJobId || fencingCounter !== expected.fencingCounter) throw malformed();
  return Object.freeze({
    providerVerificationJobId,
    fencingCounter,
    credentialGrantedAt: instant(grant.credentialGrantedAt),
    sealedEnvelope: credential.sealedEnvelope,
    openingContext: credential.openingContext,
  });
}

// The barrier acknowledgement must answer exactly the job and fencing
// generation presented, in state VERIFYING, with a canonical server instant.
export function parseProviderVerificationVerifyingResponse(
  body: unknown,
  expected: Readonly<{ providerVerificationJobId: string; fencingCounter: number }>,
): ProviderVerificationVerifyingAcknowledgement {
  const acknowledgement = exactKeys(body, ["providerVerificationJobId", "fencingCounter", "state", "verifyingAt"]);
  const providerVerificationJobId = text(acknowledgement.providerVerificationJobId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (providerVerificationJobId !== expected.providerVerificationJobId || fencingCounter !== expected.fencingCounter || acknowledgement.state !== "VERIFYING") {
    throw malformed();
  }
  return Object.freeze({ providerVerificationJobId, fencingCounter, state: "VERIFYING", verifyingAt: instant(acknowledgement.verifyingAt) });
}

// The result acknowledgement must answer exactly the job, fencing generation,
// outcome and reason code reported, in state COMPLETED.
export function parseProviderVerificationResultResponse(
  body: unknown,
  expected: Readonly<{ providerVerificationJobId: string; fencingCounter: number; report: ProviderVerificationResultReport }>,
): ProviderVerificationResultAcknowledgement {
  const acknowledgement = exactKeys(body, ["providerVerificationJobId", "fencingCounter", "state", "outcome", "reasonCode", "completedAt"]);
  const providerVerificationJobId = text(acknowledgement.providerVerificationJobId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (
    providerVerificationJobId !== expected.providerVerificationJobId ||
    fencingCounter !== expected.fencingCounter ||
    acknowledgement.state !== "COMPLETED" ||
    acknowledgement.outcome !== expected.report.outcome ||
    acknowledgement.reasonCode !== expected.report.reasonCode
  ) {
    throw malformed();
  }
  return Object.freeze({
    providerVerificationJobId,
    fencingCounter,
    state: "COMPLETED",
    outcome: expected.report.outcome,
    reasonCode: expected.report.reasonCode,
    completedAt: instant(acknowledgement.completedAt),
  });
}

// R44B11G: the deferral acknowledgement must answer exactly the job and fencing
// generation presented, in state QUEUED, with a canonical server instant.
export function parseProviderVerificationDeferralResponse(
  body: unknown,
  expected: Readonly<{ providerVerificationJobId: string; fencingCounter: number }>,
): ProviderVerificationDeferralAcknowledgement {
  const acknowledgement = exactKeys(body, ["providerVerificationJobId", "fencingCounter", "state", "deferredUntil"]);
  const providerVerificationJobId = text(acknowledgement.providerVerificationJobId, UUID);
  const fencingCounter = positiveSafeInteger(acknowledgement.fencingCounter);
  if (providerVerificationJobId !== expected.providerVerificationJobId || fencingCounter !== expected.fencingCounter || acknowledgement.state !== "QUEUED") {
    throw malformed();
  }
  return Object.freeze({ providerVerificationJobId, fencingCounter, state: "QUEUED", deferredUntil: instant(acknowledgement.deferredUntil) });
}

// Issued-object provenance: exact object identity. Only the frozen objects a
// client method itself produced from a 200 response of the matching route are
// registered; the exported parsers never register, and a copy or look-alike
// is never in a set. Module-private and never exported or mutated elsewhere.
const issuedLeases = new WeakSet<object>();
const issuedGrants = new WeakSet<object>();
const issuedVerifyingAcknowledgements = new WeakSet<object>();

const issued = <T extends object>(registry: WeakSet<object>, value: T): T => {
  registry.add(value);
  return value;
};

export const isIssuedProviderVerificationLease = (value: unknown): value is ProviderVerificationLease =>
  typeof value === "object" && value !== null && issuedLeases.has(value);
export const isIssuedProviderVerificationCredentialGrant = (value: unknown): value is ProviderVerificationCredentialGrant =>
  typeof value === "object" && value !== null && issuedGrants.has(value);
export const isIssuedProviderVerificationVerifyingAcknowledgement = (value: unknown): value is ProviderVerificationVerifyingAcknowledgement =>
  typeof value === "object" && value !== null && issuedVerifyingAcknowledgements.has(value);

const invalidVerificationRequest = () => new WorkerError("PROVIDER_VERIFICATION_REQUEST_INVALID");

// Nothing outside the contract is sent: a canonical lowercase job ID and a
// proof of the existing shape, else PROVIDER_VERIFICATION_REQUEST_INVALID.
// Each caller-supplied member is read exactly once into a local, the local is
// validated, and only that validated local is ever sent, so an accessor cannot
// answer validation and request construction differently.
function verificationProof(providerVerificationJobId: unknown, proof: unknown): LeaseProof {
  if (typeof providerVerificationJobId !== "string" || !UUID.test(providerVerificationJobId)) throw invalidVerificationRequest();
  if (typeof proof !== "object" || proof === null) throw invalidVerificationRequest();
  const fencingCounter: unknown = (proof as Record<string, unknown>).fencingCounter;
  const leaseToken: unknown = (proof as Record<string, unknown>).leaseToken;
  if (
    typeof fencingCounter !== "number" ||
    !Number.isSafeInteger(fencingCounter) ||
    fencingCounter < 1 ||
    typeof leaseToken !== "string" ||
    !LEASE_TOKEN.test(leaseToken)
  ) {
    throw invalidVerificationRequest();
  }
  return Object.freeze({ fencingCounter, leaseToken });
}

// The same single read for the result pair: the frozen snapshot is validated
// and is the only source of the sent outcome and reason code.
function verificationReport(report: unknown): ProviderVerificationResultReport {
  if (typeof report !== "object" || report === null || Array.isArray(report)) throw invalidVerificationRequest();
  const outcome: unknown = (report as Record<string, unknown>).outcome;
  const reasonCode: unknown = (report as Record<string, unknown>).reasonCode;
  const snapshot = Object.freeze({ outcome, reasonCode });
  if (!isProviderVerificationResultReport(snapshot)) throw invalidVerificationRequest();
  return snapshot;
}

// R44B11G: the refusal, read once as an argument and checked against the
// closed vocabulary before anything is sent.
function verificationRefusal(refusal: unknown): ProviderVerificationRefusal {
  if (typeof refusal !== "string" || !(PROVIDER_VERIFICATION_REFUSALS as readonly string[]).includes(refusal)) throw invalidVerificationRequest();
  return refusal as ProviderVerificationRefusal;
}

export function createHttpProviderVerificationControlClient(options: WorkerControlClientOptions): ProviderVerificationControlClient {
  const { post } = controlTransport(options);

  return Object.freeze({
    leaseProviderVerification: async (signal?: AbortSignal) => {
      const body = await post("/worker-control/v1/provider-verifications/lease", undefined, "PROVIDER_VERIFICATION_LEASE_REJECTED", signal);
      const lease = parseProviderVerificationLeaseResponse(body);
      return lease === null ? null : issued(issuedLeases, lease);
    },
    requestProviderVerificationCredentialGrant: async (providerVerificationJobId: string, proof: LeaseProof, signal?: AbortSignal) => {
      const { fencingCounter, leaseToken } = verificationProof(providerVerificationJobId, proof);
      const body = await post(
        `/worker-control/v1/provider-verifications/${providerVerificationJobId}/credential-grant`,
        { fencingCounter, leaseToken },
        "PROVIDER_VERIFICATION_GRANT_REJECTED",
        signal,
      );
      return issued(issuedGrants, parseProviderVerificationCredentialGrantResponse(body, { providerVerificationJobId, fencingCounter }));
    },
    acknowledgeProviderVerificationVerifying: async (providerVerificationJobId: string, proof: LeaseProof, signal?: AbortSignal) => {
      const { fencingCounter, leaseToken } = verificationProof(providerVerificationJobId, proof);
      const body = await post(
        `/worker-control/v1/provider-verifications/${providerVerificationJobId}/verifying`,
        { fencingCounter, leaseToken },
        "PROVIDER_VERIFICATION_VERIFYING_REJECTED",
        signal,
      );
      return issued(issuedVerifyingAcknowledgements, parseProviderVerificationVerifyingResponse(body, { providerVerificationJobId, fencingCounter }));
    },
    reportProviderVerificationResult: async (
      providerVerificationJobId: string,
      proof: LeaseProof,
      report: ProviderVerificationResultReport,
      signal?: AbortSignal,
    ) => {
      const { fencingCounter, leaseToken } = verificationProof(providerVerificationJobId, proof);
      const fixed = verificationReport(report);
      const body = await post(
        `/worker-control/v1/provider-verifications/${providerVerificationJobId}/result`,
        { fencingCounter, leaseToken, outcome: fixed.outcome, reasonCode: fixed.reasonCode },
        "PROVIDER_VERIFICATION_RESULT_REJECTED",
        signal,
      );
      return parseProviderVerificationResultResponse(body, { providerVerificationJobId, fencingCounter, report: fixed });
    },
    deferUnsupportedProviderVerification: async (
      providerVerificationJobId: string,
      proof: LeaseProof,
      refusal: ProviderVerificationRefusal,
      signal?: AbortSignal,
    ) => {
      const { fencingCounter, leaseToken } = verificationProof(providerVerificationJobId, proof);
      const reported = verificationRefusal(refusal);
      const body = await post(
        `/worker-control/v1/provider-verifications/${providerVerificationJobId}/unsupported`,
        { fencingCounter, leaseToken, refusal: reported },
        "PROVIDER_VERIFICATION_DEFERRAL_REJECTED",
        signal,
      );
      return parseProviderVerificationDeferralResponse(body, { providerVerificationJobId, fencingCounter });
    },
  });
}
