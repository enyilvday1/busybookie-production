import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { authenticate, type AuthenticationAdapter } from "../authentication/authenticationAdapter.js";
import { AuthenticationError } from "../authentication/authenticationError.js";
import { authorizationHeaderValues } from "../authentication/bearerCredential.js";
import type { VerifiedIdentity } from "../authentication/verifiedIdentity.js";
import type { ApplicationRoute, ApplicationRouter } from "../createCommercialApiServer.js";
import type { TransactionalPool } from "../database/runtimePool.js";
import { sendError, sendJson, type ErrorCode } from "../http/jsonResponse.js";
import { MAX_CREDENTIAL_JSON_BODY_BYTES, readEmptyBody, readJsonObjectBody, RequestBodyError } from "../http/requestBody.js";
import type { CredentialFingerprinter, CredentialSealer } from "commercial-worker-protocol";
import type { ProviderCapabilityRegistry } from "../providerConnections/providerCapabilityRegistry.js";
import { ProviderConnectionError } from "../providerConnections/providerConnectionError.js";
import {
  getProviderConnectionForAccount,
  listProviderConnectionsForAccount,
  type ProviderConnectionView,
} from "../providerConnections/providerConnectionReadModel.js";
import {
  createProviderConnection,
  disconnectProviderConnection,
  rotateProviderCredential,
  type ProviderConnectionServiceDependencies,
} from "../providerConnections/providerConnectionService.js";
import { PrincipalUnavailableError, resolveActivePrincipalForIdentity } from "./resolveActivePrincipal.js";

// Authenticated ProviderConnection routes:
//
//   POST /provider-connections                              create
//   GET  /provider-connections                              list
//   GET  /provider-connections/:connectionId                get
//   POST /provider-connections/:connectionId/credentials    rotate
//   POST /provider-connections/:connectionId/disconnect     disconnect
//
// The router exists only when a capability registry, a CredentialSealer and
// a CredentialFingerprinter are injected in code. There is no production
// implementation of any of them yet, so the default process installs no
// router and these paths stay 404. No route can open a stored credential:
// the application never receives a CredentialOpener.

export type ProviderConnectionApplicationOptions = Readonly<{
  authentication: AuthenticationAdapter;
  pool: TransactionalPool;
  registry: ProviderCapabilityRegistry;
  sealer: CredentialSealer;
  fingerprinter: CredentialFingerprinter;
  reportFailure?: (text: string) => void;
}>;

const COLLECTION_PATH = "/provider-connections";
const ITEM = /^\/provider-connections\/([^/]+)$/;
const CREDENTIALS = /^\/provider-connections\/([^/]+)\/credentials$/;
const DISCONNECT = /^\/provider-connections\/([^/]+)\/disconnect$/;
const CREATE_MEMBERS: ReadonlySet<string> = new Set(["provider", "label", "credential", "idempotencyKey"]);
const ROTATE_MEMBERS: ReadonlySet<string> = new Set(["credential", "idempotencyKey"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly diagnostic?: string,
  ) {
    super(code);
  }
}

const PROVIDER_CONNECTION_FAILURES: Readonly<Record<string, readonly [number, ErrorCode]>> = {
  PROVIDER_CONNECTION_INPUT_INVALID: [400, "INVALID_REQUEST"],
  PROVIDER_UNSUPPORTED: [400, "PROVIDER_UNSUPPORTED"],
  PROVIDER_CONNECTION_NOT_FOUND: [404, "NOT_FOUND"],
  ACCOUNT_UNAVAILABLE: [403, "ACCOUNT_UNAVAILABLE"],
  IDEMPOTENCY_KEY_CONFLICT: [409, "IDEMPOTENCY_KEY_CONFLICT"],
  DUPLICATE_CREDENTIAL: [409, "DUPLICATE_CREDENTIAL"],
  CREDENTIAL_UNCHANGED: [409, "CREDENTIAL_UNCHANGED"],
  CONNECTION_STATE_CONFLICT: [409, "CONNECTION_STATE_CONFLICT"],
  CONCURRENT_MODIFICATION: [409, "CONCURRENT_MODIFICATION"],
  CREDENTIAL_CRYPTO_UNAVAILABLE: [503, "SERVICE_UNAVAILABLE"],
  PROVIDER_CONNECTION_DATABASE_FAILURE: [503, "SERVICE_UNAVAILABLE"],
  PROVIDER_CONNECTION_INVARIANT_VIOLATION: [500, "INTERNAL_ERROR"],
};

// Every failure becomes one stable, generic response. Diagnostics carry
// codes only, never a credential, body, identity value or SQL detail.
function toHttpFailure(error: unknown): HttpFailure {
  if (error instanceof HttpFailure) return error;
  if (error instanceof AuthenticationError) {
    return error.code === "AUTHENTICATION_UNAVAILABLE" ? new HttpFailure(503, "SERVICE_UNAVAILABLE", error.code) : new HttpFailure(401, "AUTHENTICATION_REQUIRED");
  }
  if (error instanceof RequestBodyError) {
    const status = error.code === "PAYLOAD_TOO_LARGE" ? 413 : error.code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 400;
    return new HttpFailure(status, error.code);
  }
  if (error instanceof PrincipalUnavailableError) return new HttpFailure(403, "ACCOUNT_UNAVAILABLE");
  if (error instanceof ProviderConnectionError) {
    const [status, code] = PROVIDER_CONNECTION_FAILURES[error.code] ?? [500, "INTERNAL_ERROR"];
    return new HttpFailure(status, code, `${error.code}${error.databaseCode ? `/${error.databaseCode}` : ""}`);
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new HttpFailure(503, "SERVICE_UNAVAILABLE", `database/${error.code}`);
  }
  return new HttpFailure(500, "INTERNAL_ERROR", "unexpected");
}

function connectionDto(view: ProviderConnectionView) {
  return {
    id: view.id,
    provider: view.provider,
    credentialKind: view.credentialKind,
    label: view.label,
    status: view.status,
    verificationStatus: view.verificationStatus,
    currentCredentialVersion: view.currentCredentialVersion,
    currentCredentialStatus: view.currentCredentialStatus,
    disconnectedAt: view.disconnectedAt === null ? null : view.disconnectedAt.toISOString(),
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

export function createProviderConnectionApplication(options: ProviderConnectionApplicationOptions): ApplicationRouter {
  const { authentication, pool } = options;
  const services: ProviderConnectionServiceDependencies = Object.freeze({
    pool,
    registry: options.registry,
    sealer: options.sealer,
    fingerprinter: options.fingerprinter,
  });
  const reportFailure = options.reportFailure ?? ((text: string) => process.stderr.write(text));

  const protectedRoute =
    (handler: (request: IncomingMessage, response: ServerResponse, identity: VerifiedIdentity) => Promise<void>) =>
    async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      try {
        const identity = await authenticate(authentication, authorizationHeaderValues(request.rawHeaders));
        await handler(request, response, identity);
      } catch (error) {
        const failure = toHttpFailure(error);
        if (failure.status >= 500) {
          reportFailure(`commercial-api: provider connection request failed (${failure.status} ${failure.code}${failure.diagnostic ? ` ${failure.diagnostic}` : ""})\n`);
        }
        const headers: Record<string, string> = {};
        if (failure.status === 401) headers["WWW-Authenticate"] = "Bearer";
        if (!request.complete) headers.Connection = "close";
        sendError(response, failure.status, failure.code, headers);
      }
    };

  const principalFor = (identity: VerifiedIdentity) => resolveActivePrincipalForIdentity(pool, identity);

  // A malformed ID cannot name any connection: answered exactly like a
  // missing or foreign one, before any query or body read.
  const requireConnectionId = (connectionId: string) => {
    if (!UUID_PATTERN.test(connectionId)) throw new HttpFailure(404, "NOT_FOUND");
  };

  const create = protectedRoute(async (request, response, identity) => {
    const principal = await principalFor(identity);
    const body = await readJsonObjectBody(request, CREATE_MEMBERS, MAX_CREDENTIAL_JSON_BODY_BYTES);
    const result = await createProviderConnection(services, principal, body, { correlationId: randomUUID() });
    sendJson(response, result.created ? 201 : 200, { providerConnection: connectionDto(result.providerConnection) });
  });

  const list = protectedRoute(async (request, response, identity) => {
    request.resume();
    const principal = await principalFor(identity);
    const connections = await listProviderConnectionsForAccount(pool, principal.accountId);
    sendJson(response, 200, { providerConnections: connections.map(connectionDto) });
  });

  const get = (connectionId: string) =>
    protectedRoute(async (request, response, identity) => {
      request.resume();
      const principal = await principalFor(identity);
      requireConnectionId(connectionId);
      const view = await getProviderConnectionForAccount(pool, principal.accountId, connectionId);
      if (view === null) throw new HttpFailure(404, "NOT_FOUND");
      sendJson(response, 200, { providerConnection: connectionDto(view) });
    });

  const rotate = (connectionId: string) =>
    protectedRoute(async (request, response, identity) => {
      const principal = await principalFor(identity);
      requireConnectionId(connectionId);
      const body = await readJsonObjectBody(request, ROTATE_MEMBERS, MAX_CREDENTIAL_JSON_BODY_BYTES);
      const result = await rotateProviderCredential(services, principal, connectionId, body, { correlationId: randomUUID() });
      sendJson(response, result.created ? 201 : 200, {
        providerConnection: connectionDto(result.providerConnection),
        credentialVersion: result.credentialVersion,
      });
    });

  const disconnect = (connectionId: string) =>
    protectedRoute(async (request, response, identity) => {
      const principal = await principalFor(identity);
      requireConnectionId(connectionId);
      await readEmptyBody(request);
      const result = await disconnectProviderConnection(services, principal, connectionId, { correlationId: randomUUID() });
      sendJson(response, 200, { providerConnection: connectionDto(result.providerConnection) });
    });

  const collection: ApplicationRoute = Object.freeze({
    methods: ["GET", "POST"],
    handle: (request: IncomingMessage, response: ServerResponse) => (request.method === "POST" ? create(request, response) : list(request, response)),
  });

  return Object.freeze({
    route: (pathname: string): ApplicationRoute | null => {
      if (pathname === COLLECTION_PATH) return collection;
      const credentials = CREDENTIALS.exec(pathname);
      if (credentials !== null) return Object.freeze({ methods: ["POST"], handle: rotate(credentials[1]!) });
      const disconnectMatch = DISCONNECT.exec(pathname);
      if (disconnectMatch !== null) return Object.freeze({ methods: ["POST"], handle: disconnect(disconnectMatch[1]!) });
      const item = ITEM.exec(pathname);
      if (item !== null) return Object.freeze({ methods: ["GET"], handle: get(item[1]!) });
      return null;
    },
  });
}
