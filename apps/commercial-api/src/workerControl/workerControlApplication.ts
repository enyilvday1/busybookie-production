import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { authorizationHeaderValues } from "../authentication/bearerCredential.js";
import type { ApplicationRoute, ApplicationRouter } from "../createCommercialApiServer.js";
import type { TransactionalPool } from "../database/runtimePool.js";
import { sendError, sendJson, type ErrorCode } from "../http/jsonResponse.js";
import { readEmptyBody, readJsonObjectBody, RequestBodyError } from "../http/requestBody.js";
import { authenticateWorker } from "../workerAuthentication/workerAuthentication.js";
import type { WorkerAuthenticationAdapter } from "../workerAuthentication/workerAuthenticationAdapter.js";
import { WorkerAuthenticationError } from "../workerAuthentication/workerAuthenticationError.js";
import { WORKER_LEASE_TOKEN_PATTERN } from "./workerLeasePolicy.js";
import {
  acquireWorkerLease,
  heartbeatWorkerLease,
  releaseWorkerLease,
  WorkerLeaseError,
  type LeaseProof,
  type WorkerControlContext,
  type WorkerLease,
} from "./workerLeaseService.js";
import { grantWorkerCredential } from "./workerCredentialGrantService.js";
import type { WorkerSecurityEvent, WorkerSecurityEventSink } from "./workerSecurityEvents.js";

// Private worker-control routes, machine-to-machine only:
//
//   POST /worker-control/v1/leases                                lease the next attempt
//   POST /worker-control/v1/attempts/:attemptId/heartbeat         renew the current lease
//   POST /worker-control/v1/attempts/:attemptId/release           return a pre-grant lease
//   POST /worker-control/v1/attempts/:attemptId/credential-grant  the exact sealed credential (R44B6H)
//
// The router exists only when a WorkerAuthenticationAdapter, a
// WorkerSecurityEventSink and the runtime pool are injected in code; the
// default process composes none of them, so these paths stay 404. There is
// no environment switch and no localhost or address trust.
//
// Requests carrying an Origin header (browsers) are refused before
// authentication; there is no CORS and no cookie or session handling.
// Authentication failures map uniformly: missing or rejected -> 401,
// unavailable -> 503. Every lease or fencing failure is the same 409.
//
// The credential grant returns only the sealed envelope and its opening
// context; nothing here decrypts, enters SUBMITTING or calls a provider: the
// highest attempt state these routes can reach is LEASED.

export type WorkerControlApplicationOptions = Readonly<{
  authentication: WorkerAuthenticationAdapter;
  securityEvents: WorkerSecurityEventSink;
  pool: TransactionalPool;
  reportFailure?: (text: string) => void;
}>;

export const WORKER_CONTROL_PREFIX = "/worker-control/v1";
const LEASES_PATH = `${WORKER_CONTROL_PREFIX}/leases`;
const ATTEMPT_ACTION = /^\/worker-control\/v1\/attempts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(heartbeat|release|credential-grant)$/;
const PROOF_MEMBERS: ReadonlySet<string> = new Set(["fencingCounter", "leaseToken"]);

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(code);
  }
}

function leaseDto(lease: WorkerLease) {
  return {
    executionJobId: lease.executionJobId,
    executionAttemptId: lease.executionAttemptId,
    attemptNumber: lease.attemptNumber,
    provider: lease.provider,
    model: lease.model,
    generationRequest: lease.generationRequest,
    generationRequestSha256: lease.generationRequestSha256,
    expectedCostCap: lease.expectedCostCap,
    leaseToken: lease.leaseToken,
    fencingCounter: lease.fencingCounter,
    leaseExpiresAt: lease.leaseExpiresAt.toISOString(),
  };
}

function parseProof(body: Record<string, unknown>): LeaseProof {
  const { fencingCounter, leaseToken } = body;
  if (
    typeof fencingCounter !== "number" ||
    !Number.isSafeInteger(fencingCounter) ||
    fencingCounter < 1 ||
    typeof leaseToken !== "string" ||
    !WORKER_LEASE_TOKEN_PATTERN.test(leaseToken)
  ) {
    throw new RequestBodyError("INVALID_REQUEST");
  }
  return Object.freeze({ fencingCounter, leaseToken });
}

export function createWorkerControlApplication(options: WorkerControlApplicationOptions): ApplicationRouter {
  // A reachable worker route must never silently drop required security events.
  if (options.authentication === undefined || options.securityEvents === undefined || options.pool === undefined) {
    throw new Error("Worker-control routes require a worker authentication adapter, a security event sink and the runtime pool.");
  }
  const { authentication, securityEvents, pool } = options;
  const reportFailure = options.reportFailure ?? ((text: string) => process.stderr.write(text));

  const record = (event: Omit<WorkerSecurityEvent, "occurredAt">) =>
    securityEvents.record(Object.freeze({ ...event, occurredAt: new Date().toISOString() }));

  const route =
    (
      handler: (request: IncomingMessage, response: ServerResponse, context: WorkerControlContext, attemptId: string | null) => Promise<void>,
      attemptId: string | null,
      // Credential-grant refusals are logged as their own event type; the
      // response stays the same uniform 409 (or 401) as every other route.
      credentialGrant = false,
    ) =>
    async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      const correlationId = randomUUID();
      const attempt = attemptId === null ? {} : { executionAttemptId: attemptId };
      try {
        if (request.headers.origin !== undefined) {
          await record({ type: "WORKER_ORIGIN_REJECTED", reason: "ORIGIN_PRESENT", correlationId, ...attempt });
          throw new HttpFailure(403, "ORIGIN_NOT_ALLOWED");
        }

        let workerPrincipalId: string;
        try {
          workerPrincipalId = (await authenticateWorker({ adapter: authentication, database: pool }, authorizationHeaderValues(request.rawHeaders))).workerPrincipalId;
        } catch (error) {
          if (!(error instanceof WorkerAuthenticationError)) throw error;
          const type =
            error.code === "WORKER_AUTHENTICATION_REQUIRED"
              ? "WORKER_AUTH_REQUIRED"
              : error.code === "WORKER_AUTHENTICATION_REJECTED"
                ? "WORKER_AUTH_REJECTED"
                : "WORKER_AUTH_UNAVAILABLE";
          await record({ type, reason: error.reason, correlationId, ...attempt });
          throw error.code === "WORKER_AUTHENTICATION_UNAVAILABLE"
            ? new HttpFailure(503, "SERVICE_UNAVAILABLE")
            : new HttpFailure(401, "AUTHENTICATION_REQUIRED");
        }

        const context: WorkerControlContext = Object.freeze({ workerPrincipalId, correlationId });
        try {
          await handler(request, response, context, attemptId);
        } catch (error) {
          if (!(error instanceof WorkerLeaseError)) throw error;
          if (error.code === "WORKER_NOT_ACTIVE") {
            const type = credentialGrant ? "WORKER_CREDENTIAL_GRANT_REJECTED" : "WORKER_LEASE_REJECTED";
            await record({ type, reason: "WORKER_NOT_ACTIVE", correlationId, workerPrincipalId, ...attempt });
            throw new HttpFailure(401, "AUTHENTICATION_REQUIRED");
          }
          if (error.code === "LEASE_REJECTED") {
            const reason = error.reason ?? "NOT_LEASED";
            const type = credentialGrant
              ? "WORKER_CREDENTIAL_GRANT_REJECTED"
              : reason === "FENCING_MISMATCH" || reason === "TOKEN_MISMATCH"
                ? "WORKER_FENCING_REJECTED"
                : "WORKER_LEASE_REJECTED";
            await record({ type, reason, correlationId, workerPrincipalId, ...attempt });
            throw new HttpFailure(409, "LEASE_REJECTED");
          }
          throw error;
        }
      } catch (error) {
        let failure: HttpFailure;
        if (error instanceof HttpFailure) {
          failure = error;
        } else if (error instanceof RequestBodyError) {
          failure = new HttpFailure(error.code === "PAYLOAD_TOO_LARGE" ? 413 : error.code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 400, error.code);
        } else {
          // Database failures, a failing security sink, anything unexpected:
          // fail closed. Diagnostics carry a class name only, never details.
          const kind = error instanceof WorkerLeaseError ? error.code : error instanceof Error ? error.name : "unknown";
          reportFailure(`commercial-api: worker-control request failed (${kind})\n`);
          failure = new HttpFailure(503, "SERVICE_UNAVAILABLE");
        }
        const headers: Record<string, string> = {};
        if (failure.status === 401) headers["WWW-Authenticate"] = "Bearer";
        if (!request.complete) headers.Connection = "close";
        if (!response.headersSent) sendError(response, failure.status, failure.code, headers);
      }
    };

  const lease = route(async (request, response, context) => {
    await readEmptyBody(request);
    const acquired = await acquireWorkerLease(pool, context);
    sendJson(response, 200, { lease: acquired === null ? null : leaseDto(acquired) });
  }, null);

  const heartbeat = (attemptId: string) =>
    route(async (request, response, context) => {
      const proof = parseProof(await readJsonObjectBody(request, PROOF_MEMBERS));
      const renewed = await heartbeatWorkerLease(pool, context, attemptId, proof);
      sendJson(response, 200, { fencingCounter: renewed.fencingCounter, leaseExpiresAt: renewed.leaseExpiresAt.toISOString() });
    }, attemptId);

  const release = (attemptId: string) =>
    route(async (request, response, context) => {
      const proof = parseProof(await readJsonObjectBody(request, PROOF_MEMBERS));
      await releaseWorkerLease(pool, context, attemptId, proof);
      sendJson(response, 200, { released: true });
    }, attemptId);

  const credentialGrant = (attemptId: string) =>
    route(
      async (request, response, context) => {
        const proof = parseProof(await readJsonObjectBody(request, PROOF_MEMBERS));
        const grant = await grantWorkerCredential(pool, context, attemptId, proof);
        sendJson(response, 200, {
          executionAttemptId: grant.executionAttemptId,
          fencingCounter: grant.fencingCounter,
          credentialGrantedAt: grant.credentialGrantedAt.toISOString(),
          credential: { sealedEnvelope: grant.sealedEnvelope, openingContext: grant.openingContext },
        });
      },
      attemptId,
      true,
    );

  const leasesRoute: ApplicationRoute = Object.freeze({ methods: ["POST"], handle: lease });

  return Object.freeze({
    route: (pathname: string): ApplicationRoute | null => {
      if (pathname === LEASES_PATH) return leasesRoute;
      const match = ATTEMPT_ACTION.exec(pathname);
      if (match === null) return null;
      const [, attemptId, action] = match as unknown as [string, string, "heartbeat" | "release" | "credential-grant"];
      const handle = action === "heartbeat" ? heartbeat(attemptId) : action === "release" ? release(attemptId) : credentialGrant(attemptId);
      return Object.freeze({ methods: ["POST"], handle });
    },
  });
}
