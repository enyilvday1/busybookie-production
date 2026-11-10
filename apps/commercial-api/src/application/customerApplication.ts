import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { authenticate, type AuthenticationAdapter } from "../authentication/authenticationAdapter.js";
import { AuthenticationError } from "../authentication/authenticationError.js";
import { authorizationHeaderValues } from "../authentication/bearerCredential.js";
import type { VerifiedIdentity } from "../authentication/verifiedIdentity.js";
import type { ApplicationRoute, ApplicationRouter } from "../createCommercialApiServer.js";
import type { TransactionalPool } from "../database/runtimePool.js";
import { sendError, sendJson, type ErrorCode } from "../http/jsonResponse.js";
import { readEmptyBody, readJsonObjectBody, RequestBodyError } from "../http/requestBody.js";
import { createFirstProductionForUser } from "../productions/createFirstProductionForUser.js";
import { ProductionCreationError } from "../productions/productionCreationError.js";
import { getProductionForAccount, listProductionsForAccount, type ProductionSummary } from "../productions/productionReadModel.js";
import { ProvisioningError } from "../provisioning/provisioningError.js";
import { provisionPersonalAccountForIdentity } from "../provisioning/provisionPersonalAccountForIdentity.js";
import { PrincipalUnavailableError, resolveActivePrincipalForIdentity } from "./resolveActivePrincipal.js";

// The authenticated customer surface:
//
//   POST /account/bootstrap           explicit, idempotent provisioning
//   POST /productions                 create the first Production
//   GET  /productions                 list the caller's Productions
//   GET  /productions/:productionId   get one of the caller's Productions
//
// Every route authenticates first. Internal authority (user, account) is
// derived only from the verified identity and the database: never from the
// path, query, headers or body. GET routes are read-only and never provision.
//
// The router is built from an injected AuthenticationAdapter and the
// process's single TransactionalPool. No production adapter exists yet, so
// the default process composition installs no router and these paths stay
// 404. A production adapter will be passed to the same factory later without
// changing any domain service.

export type CustomerApplicationServices = Readonly<{
  provision: typeof provisionPersonalAccountForIdentity;
  resolvePrincipal: typeof resolveActivePrincipalForIdentity;
  createProduction: typeof createFirstProductionForUser;
  listProductions: typeof listProductionsForAccount;
  getProduction: typeof getProductionForAccount;
}>;

export type CustomerApplicationOptions = Readonly<{
  authentication: AuthenticationAdapter;
  pool: TransactionalPool;
  // Test seam; defaults to the real services.
  services?: Partial<CustomerApplicationServices>;
  // Server-side diagnostics. Receives failure codes only, never request,
  // identity, credential or database detail.
  reportFailure?: (text: string) => void;
}>;

const BOOTSTRAP_PATH = "/account/bootstrap";
const PRODUCTIONS_PATH = "/productions";
const PRODUCTION_ITEM = /^\/productions\/([^/]+)$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRODUCTION_BODY_MEMBERS: ReadonlySet<string> = new Set(["title", "idempotencyKey"]);

// A typed failure the router maps to one HTTP response.
class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly diagnostic?: string,
  ) {
    super(code);
  }
}

function productionDto(production: ProductionSummary) {
  return {
    id: production.id,
    title: production.title,
    archivedAt: production.archivedAt === null ? null : production.archivedAt.toISOString(),
    createdAt: production.createdAt.toISOString(),
    updatedAt: production.updatedAt.toISOString(),
  };
}

// Maps every known failure to a stable, generic response. 401 never reveals
// whether a credential was missing, malformed, unknown, expired or revoked.
function toHttpFailure(error: unknown): HttpFailure {
  if (error instanceof HttpFailure) return error;
  if (error instanceof AuthenticationError) {
    return error.code === "AUTHENTICATION_UNAVAILABLE"
      ? new HttpFailure(503, "SERVICE_UNAVAILABLE", error.code)
      : new HttpFailure(401, "AUTHENTICATION_REQUIRED");
  }
  if (error instanceof RequestBodyError) {
    const status = error.code === "PAYLOAD_TOO_LARGE" ? 413 : error.code === "UNSUPPORTED_MEDIA_TYPE" ? 415 : 400;
    return new HttpFailure(status, error.code);
  }
  if (error instanceof PrincipalUnavailableError) {
    return new HttpFailure(403, "ACCOUNT_UNAVAILABLE");
  }
  if (error instanceof ProvisioningError) {
    switch (error.code) {
      case "PROVISIONING_REFUSED":
        return new HttpFailure(403, "ACCOUNT_UNAVAILABLE");
      case "PROVISIONING_DATABASE_FAILURE":
        return new HttpFailure(503, "SERVICE_UNAVAILABLE", `${error.code}${error.databaseCode ? `/${error.databaseCode}` : ""}`);
      default:
        return new HttpFailure(500, "INTERNAL_ERROR", error.code);
    }
  }
  if (error instanceof ProductionCreationError) {
    switch (error.code) {
      case "PRODUCTION_INPUT_INVALID":
        return new HttpFailure(400, "INVALID_REQUEST");
      case "PRODUCTION_ACCOUNT_UNAVAILABLE":
        return new HttpFailure(403, "ACCOUNT_UNAVAILABLE");
      case "ENTITLEMENT_NOT_AVAILABLE":
        return new HttpFailure(403, "ENTITLEMENT_NOT_AVAILABLE");
      case "IDEMPOTENCY_KEY_CONFLICT":
        return new HttpFailure(409, "IDEMPOTENCY_KEY_CONFLICT");
      case "ENTITLEMENT_POLICY_UNSUPPORTED":
        return new HttpFailure(503, "SERVICE_UNAVAILABLE", error.code);
      case "PRODUCTION_DATABASE_FAILURE":
        return new HttpFailure(503, "SERVICE_UNAVAILABLE", `${error.code}${error.databaseCode ? `/${error.databaseCode}` : ""}`);
      default:
        return new HttpFailure(500, "INTERNAL_ERROR", error.code);
    }
  }
  // A database error from a read query carries a string SQLSTATE code.
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return new HttpFailure(503, "SERVICE_UNAVAILABLE", `database/${error.code}`);
  }
  return new HttpFailure(500, "INTERNAL_ERROR", "unexpected");
}

export function createCustomerApplication(options: CustomerApplicationOptions): ApplicationRouter {
  const { authentication, pool } = options;
  const services: CustomerApplicationServices = {
    provision: provisionPersonalAccountForIdentity,
    resolvePrincipal: resolveActivePrincipalForIdentity,
    createProduction: createFirstProductionForUser,
    listProductions: listProductionsForAccount,
    getProduction: getProductionForAccount,
    ...options.services,
  };
  const reportFailure = options.reportFailure ?? ((text: string) => process.stderr.write(text));

  // Authenticates, runs the handler, and turns any failure into one safe
  // response. If the request body was not fully read, the connection is
  // closed rather than left with unread bytes.
  const protectedRoute =
    (handler: (request: IncomingMessage, response: ServerResponse, identity: VerifiedIdentity) => Promise<void>) =>
    async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      try {
        const identity = await authenticate(authentication, authorizationHeaderValues(request.rawHeaders));
        await handler(request, response, identity);
      } catch (error) {
        const failure = toHttpFailure(error);
        if (failure.status >= 500) {
          reportFailure(`commercial-api: request failed (${failure.status} ${failure.code}${failure.diagnostic ? ` ${failure.diagnostic}` : ""})\n`);
        }
        const headers: Record<string, string> = {};
        if (failure.status === 401) headers["WWW-Authenticate"] = "Bearer";
        if (!request.complete) headers.Connection = "close";
        sendError(response, failure.status, failure.code, headers);
      }
    };

  const bootstrap = protectedRoute(async (request, response, identity) => {
    await readEmptyBody(request);
    const result = await services.provision(pool, identity, { correlationId: randomUUID() });
    sendJson(response, 200, {
      user: { id: result.user.id },
      account: { id: result.personalAccount.id, kind: result.personalAccount.kind, status: result.personalAccount.status },
      entitlements: {
        freeByo: { state: result.freeByoEntitlementGrant.state },
        hostedTrial: { available: false },
      },
      created: {
        user: result.created.user,
        account: result.created.personalAccount,
        freeByoGrant: result.created.freeByoEntitlementGrant,
      },
    });
  });

  const createProduction = protectedRoute(async (request, response, identity) => {
    const principal = await services.resolvePrincipal(pool, identity);
    const body = await readJsonObjectBody(request, PRODUCTION_BODY_MEMBERS);
    const result = await services.createProduction(
      pool,
      {
        userId: principal.userId,
        title: body.title as string,
        ...(body.idempotencyKey === undefined ? {} : { idempotencyKey: body.idempotencyKey as string }),
      },
      { correlationId: randomUUID() },
    );
    sendJson(response, result.created ? 201 : 200, { production: productionDto(result.production) });
  });

  const listProductions = protectedRoute(async (request, response, identity) => {
    request.resume();
    const principal = await services.resolvePrincipal(pool, identity);
    const productions = await services.listProductions(pool, principal.accountId);
    sendJson(response, 200, { productions: productions.map(productionDto) });
  });

  const getProduction = (productionId: string) =>
    protectedRoute(async (request, response, identity) => {
      request.resume();
      const principal = await services.resolvePrincipal(pool, identity);
      // A malformed ID cannot name any Production; it is answered exactly
      // like a missing or foreign one, without querying.
      const production = UUID_PATTERN.test(productionId) ? await services.getProduction(pool, principal.accountId, productionId) : null;
      if (production === null) {
        throw new HttpFailure(404, "NOT_FOUND");
      }
      sendJson(response, 200, { production: productionDto(production) });
    });

  const productionsCollection: ApplicationRoute = Object.freeze({
    methods: ["GET", "POST"],
    handle: (request: IncomingMessage, response: ServerResponse) =>
      request.method === "POST" ? createProduction(request, response) : listProductions(request, response),
  });
  const bootstrapRoute: ApplicationRoute = Object.freeze({ methods: ["POST"], handle: bootstrap });

  return Object.freeze({
    route: (pathname: string): ApplicationRoute | null => {
      if (pathname === BOOTSTRAP_PATH) return bootstrapRoute;
      if (pathname === PRODUCTIONS_PATH) return productionsCollection;
      const item = PRODUCTION_ITEM.exec(pathname);
      if (item !== null) {
        return Object.freeze({ methods: ["GET"], handle: getProduction(item[1]!) });
      }
      return null;
    },
  });
}
