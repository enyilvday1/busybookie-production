import { describe, expect, it } from "vitest";

import type {
  RuntimeClient,
  TransactionalPool,
} from "../../src/database/runtimePool.js";
import { GenerationAuthorizationClaimError } from "../../src/generationAuthorizations/generationAuthorizationClaimError.js";
import {
  claimGenerationAuthorization,
  type ClaimGenerationAuthorizationResult,
} from "../../src/generationAuthorizations/generationAuthorizationClaimService.js";

// R44B11D non-database contract tests.
//
// The scripted pool records every SQL statement and returns controlled rows so
// that input validation, transaction shape, lock order, exact credential
// binding, replay semantics, refusal mapping and safe error handling can be
// proven without PostgreSQL.
//
// PostgreSQL concurrency, row-lock races, real constraints, database-clock
// boundary behaviour and total rollback are proved separately by the dedicated
// DB suite.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCTION_ID = "33333333-3333-4333-8333-333333333333";
const CONNECTION_ID = "44444444-4444-4444-8444-444444444444";
const GRANT_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "66666666-6666-4666-8666-666666666666";
const CURRENT_VERSION_ID = "77777777-7777-4777-8777-777777777777";
const AUTHORIZATION_ID = "88888888-8888-4888-8888-888888888888";
const JOB_ID = "99999999-9999-4999-8999-999999999999";
const ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CORRELATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PRINCIPAL = Object.freeze({
  userId: USER_ID,
  accountId: ACCOUNT_ID,
});

const CLAIMED_AT = new Date("2026-11-13T20:00:00.000Z");
const EXPIRES_AT = new Date("2099-01-01T00:00:00.000Z");

type AuthorizationRow = {
  id: string;
  account_id: string;
  production_id: string;
  entitlement_grant_id: string;
  billing_mode: string;
  provider: string;
  provider_connection_id: string | null;
  provider_credential_version_id: string | null;
  status: string;
  expires_at: Date;
  claimed_at: Date | null;
};

type JobRow = {
  id: string;
  status: string;
};

type AttemptRow = {
  id: string;
  attempt_number: number;
  state: string;
  lease_fencing_counter: number;
};

type AuditRow = {
  actor_type: string;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
};

type State = {
  user: { status: string } | null;
  account: {
    kind: string;
    owner_user_id: string;
    status: string;
  } | null;
  authorization: AuthorizationRow | null;
  connection: {
    provider: string;
    status: string;
    verification_status: string;
  } | null;
  boundCredential: {
    status: string;
    has_sealed_credential: boolean;
  } | null;
  currentCredentials: { id: string }[];
  production: {
    creation_entitlement_grant_id: string;
    archived_at: Date | null;
  } | null;
  grant: {
    kind: string;
    state: string;
    policy_version: string;
  } | null;
  jobs: JobRow[];
  attempts: AttemptRow[];
  usage: { generation_authorization_id: string }[];
  audits: AuditRow[];
  claimExpired?: boolean;
  failAudit?: boolean;
  failRollback?: boolean;
  failConnect?: boolean;
};

type Statement = Readonly<{
  sql: string;
  params: readonly unknown[];
}>;

function authorization(): AuthorizationRow {
  return {
    id: AUTHORIZATION_ID,
    account_id: ACCOUNT_ID,
    production_id: PRODUCTION_ID,
    entitlement_grant_id: GRANT_ID,
    billing_mode: "USER_BYO",
    provider: "GOOGLE_GENAI",
    provider_connection_id: CONNECTION_ID,
    provider_credential_version_id: VERSION_ID,
    status: "ISSUED",
    expires_at: EXPIRES_AT,
    claimed_at: null,
  };
}

function initialState(): State {
  return {
    user: { status: "ACTIVE" },
    account: {
      kind: "PERSONAL",
      owner_user_id: USER_ID,
      status: "ACTIVE",
    },
    authorization: authorization(),
    connection: {
      provider: "GOOGLE_GENAI",
      status: "ACTIVE",
      verification_status: "VERIFIED",
    },
    boundCredential: {
      status: "ACTIVE",
      has_sealed_credential: true,
    },
    currentCredentials: [],
    production: {
      creation_entitlement_grant_id: GRANT_ID,
      archived_at: null,
    },
    grant: {
      kind: "FREE_BYO",
      state: "AVAILABLE",
      policy_version: "free-byo-v1",
    },
    jobs: [],
    attempts: [],
    usage: [],
    audits: [],
  };
}

function seedClaimedComposition(
  state: State,
  options: Readonly<{
    jobStatus?: string;
    attemptState?: string;
    fencingCounter?: number;
  }> = {},
): void {
  if (state.authorization === null) {
    throw new Error("authorization fixture is missing");
  }

  state.authorization.status = "CLAIMED";
  state.authorization.claimed_at = CLAIMED_AT;

  state.jobs = [
    {
      id: JOB_ID,
      status: options.jobStatus ?? "QUEUED",
    },
  ];

  state.attempts = [
    {
      id: ATTEMPT_ID,
      attempt_number: 1,
      state: options.attemptState ?? "QUEUED",
      lease_fencing_counter: options.fencingCounter ?? 0,
    },
  ];

  state.usage = [
    {
      generation_authorization_id: AUTHORIZATION_ID,
    },
  ];

  state.audits = [
    {
      actor_type: "USER",
      actor_user_id: USER_ID,
      metadata: {
        executionJobId: JOB_ID,
        initialExecutionAttemptId: ATTEMPT_ID,
        entitlementPolicyVersion: "free-byo-v1",
      },
    },
  ];
}

function scriptedPool(state: State) {
  const statements: Statement[] = [];
  const releases: (Error | undefined)[] = [];
  let connectCount = 0;

  const rows = <T extends object>(value: T | null): { rows: T[] } => ({
    rows: value === null ? [] : [value],
  });

  const client: RuntimeClient = {
    query: async <R extends object>(
      sql: string,
      params: unknown[] = [],
    ): Promise<{ rows: R[] }> => {
      statements.push({ sql, params });

      if (sql === "ROLLBACK" && state.failRollback === true) {
        throw new Error("synthetic rollback failure");
      }

      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) {
        return { rows: [] };
      }

      if (/INSERT INTO audit_events/.test(sql)) {
        if (state.failAudit === true) {
          throw Object.assign(
            new Error("synthetic audit failure secret-marker"),
            { code: "23514" },
          );
        }

        state.audits.push({
          actor_type: "USER",
          actor_user_id: params[1] as string,
          metadata: JSON.parse(params[5] as string) as Record<
            string,
            unknown
          >,
        });

        return { rows: [] };
      }

      if (/INSERT INTO generation_usage_ledger/.test(sql)) {
        state.usage.push({
          generation_authorization_id: params[0] as string,
        });

        return { rows: [] };
      }

      if (/INSERT INTO execution_attempts/.test(sql)) {
        const row: AttemptRow = {
          id: ATTEMPT_ID,
          attempt_number: 1,
          state: "QUEUED",
          lease_fencing_counter: 0,
        };

        state.attempts.push(row);
        return { rows: [row] } as unknown as { rows: R[] };
      }

      if (/INSERT INTO execution_jobs/.test(sql)) {
        const row: JobRow = {
          id: JOB_ID,
          status: "QUEUED",
        };

        state.jobs.push(row);
        return { rows: [row] } as unknown as { rows: R[] };
      }

      if (
        /WITH claim_clock AS MATERIALIZED/.test(sql) &&
        /UPDATE generation_authorizations AS g/.test(sql)
      ) {
        if (
          state.claimExpired === true ||
          state.authorization === null ||
          state.authorization.status !== "ISSUED"
        ) {
          return { rows: [] };
        }

        state.authorization.status = "CLAIMED";
        state.authorization.claimed_at = CLAIMED_AT;

        return {
          rows: [{ claimed_at: CLAIMED_AT }],
        } as unknown as { rows: R[] };
      }

      if (/FROM users/.test(sql)) {
        return rows(state.user) as unknown as { rows: R[] };
      }

      if (/FROM accounts/.test(sql)) {
        return rows(state.account) as unknown as { rows: R[] };
      }

      if (/FROM generation_authorizations/.test(sql)) {
        return rows(state.authorization) as unknown as { rows: R[] };
      }

      if (/FROM provider_connections/.test(sql)) {
        return rows(state.connection) as unknown as { rows: R[] };
      }

      if (/FROM provider_credential_versions/.test(sql)) {
        if (/id <> \$3/.test(sql)) {
          return {
            rows: state.currentCredentials,
          } as unknown as { rows: R[] };
        }

        return rows(state.boundCredential) as unknown as { rows: R[] };
      }

      if (/FROM productions/.test(sql)) {
        return rows(state.production) as unknown as { rows: R[] };
      }

      if (/FROM entitlement_grants/.test(sql)) {
        return rows(state.grant) as unknown as { rows: R[] };
      }

      if (/FROM execution_jobs/.test(sql)) {
        return {
          rows: state.jobs,
        } as unknown as { rows: R[] };
      }

      if (/FROM execution_attempts/.test(sql)) {
        return {
          rows: state.attempts.filter(
            (attempt) => attempt.attempt_number === 1,
          ),
        } as unknown as { rows: R[] };
      }

      if (/FROM generation_usage_ledger/.test(sql)) {
        return {
          rows: state.usage,
        } as unknown as { rows: R[] };
      }

      if (/FROM audit_events/.test(sql)) {
        return {
          rows: state.audits,
        } as unknown as { rows: R[] };
      }

      throw new Error(`unscripted statement: ${sql}`);
    },

    release: (error?: Error) => {
      releases.push(error);
    },
  };

  const pool: TransactionalPool = {
    query: async () => {
      throw new Error(
        "pool.query must never run a claim transaction statement",
      );
    },

    end: async () => undefined,

    connect: async () => {
      connectCount += 1;

      if (state.failConnect === true) {
        throw Object.assign(
          new Error("synthetic connection failure"),
          { code: "ECONNREFUSED" },
        );
      }

      return client;
    },
  };

  return {
    pool,
    statements,
    releases,
    get connectCount() {
      return connectCount;
    },
  };
}

function claim(
  state: State,
  authorizationId: unknown = AUTHORIZATION_ID,
  options: Readonly<{
    principal?: { userId: string; accountId: string };
    correlationId?: string;
  }> = {},
) {
  const scripted = scriptedPool(state);

  const result = claimGenerationAuthorization(
    { pool: scripted.pool },
    options.principal ?? PRINCIPAL,
    authorizationId,
    {
      correlationId: options.correlationId ?? CORRELATION_ID,
    },
  );

  return { scripted, result };
}

async function expectClaimError(
  promise: Promise<unknown>,
  code: string,
): Promise<GenerationAuthorizationClaimError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(GenerationAuthorizationClaimError);
  expect((error as GenerationAuthorizationClaimError).code).toBe(code);

  return error as GenerationAuthorizationClaimError;
}

function writes(statements: readonly Statement[]): Statement[] {
  return statements.filter(({ sql }) =>
    /UPDATE generation_authorizations AS g|INSERT INTO execution_jobs|INSERT INTO execution_attempts|INSERT INTO generation_usage_ledger|INSERT INTO audit_events/.test(
      sql,
    ),
  );
}

function statementOrder(statements: readonly Statement[]): string[] {
  return statements.map(({ sql }) => {
    if (sql === "BEGIN ISOLATION LEVEL READ COMMITTED") return "BEGIN";

    if (/FROM users[\s\S]*FOR SHARE/.test(sql)) {
      return "USER FOR SHARE";
    }

    if (/FROM accounts[\s\S]*FOR NO KEY UPDATE/.test(sql)) {
      return "ACCOUNT FOR NO KEY UPDATE";
    }

    if (
      /FROM generation_authorizations/.test(sql) &&
      /FOR UPDATE/.test(sql)
    ) {
      return "AUTHORIZATION FOR UPDATE";
    }

    if (/FROM generation_authorizations/.test(sql)) {
      return "AUTHORIZATION READ";
    }

    if (/FROM provider_connections[\s\S]*FOR UPDATE/.test(sql)) {
      return "CONNECTION FOR UPDATE";
    }

    if (
      /FROM provider_credential_versions/.test(sql) &&
      /id <> \$3/.test(sql)
    ) {
      return "DISTINCT ACTIVE CREDENTIAL";
    }

    if (/FROM provider_credential_versions/.test(sql)) {
      return "BOUND CREDENTIAL FOR SHARE";
    }

    if (/FROM productions[\s\S]*FOR SHARE/.test(sql)) {
      return "PRODUCTION FOR SHARE";
    }

    if (/FROM entitlement_grants[\s\S]*FOR SHARE/.test(sql)) {
      return "GRANT FOR SHARE";
    }

    if (/UPDATE generation_authorizations AS g/.test(sql)) {
      return "CLAIM UPDATE";
    }

    if (/INSERT INTO execution_jobs/.test(sql)) {
      return "JOB INSERT";
    }

    if (/INSERT INTO execution_attempts/.test(sql)) {
      return "ATTEMPT INSERT";
    }

    if (/INSERT INTO generation_usage_ledger/.test(sql)) {
      return "USAGE INSERT";
    }

    if (/INSERT INTO audit_events/.test(sql)) {
      return "AUDIT INSERT";
    }

    if (/FROM execution_jobs/.test(sql)) {
      return "REPLAY JOB";
    }

    if (/FROM execution_attempts/.test(sql)) {
      return "REPLAY ATTEMPT";
    }

    if (/FROM generation_usage_ledger/.test(sql)) {
      return "REPLAY USAGE";
    }

    if (/FROM audit_events/.test(sql)) {
      return "REPLAY AUDIT";
    }

    if (sql === "COMMIT") return "COMMIT";
    if (sql === "ROLLBACK") return "ROLLBACK";

    return sql;
  });
}

describe("R44B11D claim input boundary", () => {
  it("refuses malformed authorization identity before pool checkout or SQL", async () => {
    const state = initialState();
    const { scripted, result } = claim(state, "not-a-uuid");

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_INPUT_INVALID",
    );

    expect(scripted.connectCount).toBe(0);
    expect(scripted.statements).toEqual([]);
  });

  it("refuses malformed trusted principal before pool checkout or SQL", async () => {
    const state = initialState();

    const { scripted, result } = claim(state, AUTHORIZATION_ID, {
      principal: {
        userId: "bad-user",
        accountId: ACCOUNT_ID,
      },
    });

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_INPUT_INVALID",
    );

    expect(scripted.connectCount).toBe(0);
    expect(scripted.statements).toEqual([]);
  });

  it("refuses malformed correlation ID before pool checkout or SQL", async () => {
    const state = initialState();

    const { scripted, result } = claim(state, AUTHORIZATION_ID, {
      correlationId: "bad-correlation",
    });

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_INPUT_INVALID",
    );

    expect(scripted.connectCount).toBe(0);
    expect(scripted.statements).toEqual([]);
  });
});

describe("R44B11D new claim transaction", () => {
  it("uses the locked lock order and exact atomic write order", async () => {
    const state = initialState();
    const { scripted, result } = claim(state);

    const claimed = await result;

    expect(claimed).toEqual({
      generationAuthorizationId: AUTHORIZATION_ID,
      claimedAt: CLAIMED_AT,
      executionJob: {
        id: JOB_ID,
        status: "QUEUED",
      },
      initialExecutionAttempt: {
        id: ATTEMPT_ID,
        attemptNumber: 1,
        state: "QUEUED",
        leaseFencingCounter: 0,
      },
      created: true,
      correlationId: CORRELATION_ID,
    });

    expect(statementOrder(scripted.statements)).toEqual([
      "BEGIN",
      "USER FOR SHARE",
      "ACCOUNT FOR NO KEY UPDATE",
      "AUTHORIZATION READ",
      "CONNECTION FOR UPDATE",
      "AUTHORIZATION READ",
      "BOUND CREDENTIAL FOR SHARE",
      "PRODUCTION FOR SHARE",
      "GRANT FOR SHARE",
      "AUTHORIZATION FOR UPDATE",
      "CLAIM UPDATE",
      "JOB INSERT",
      "ATTEMPT INSERT",
      "USAGE INSERT",
      "AUDIT INSERT",
      "COMMIT",
    ]);

    expect(state.authorization).toMatchObject({
      id: AUTHORIZATION_ID,
      status: "CLAIMED",
      claimed_at: CLAIMED_AT,
      provider_credential_version_id: VERSION_ID,
    });

    expect(state.jobs).toEqual([
      {
        id: JOB_ID,
        status: "QUEUED",
      },
    ]);

    expect(state.attempts).toEqual([
      {
        id: ATTEMPT_ID,
        attempt_number: 1,
        state: "QUEUED",
        lease_fencing_counter: 0,
      },
    ]);

    expect(state.usage).toEqual([
      {
        generation_authorization_id: AUTHORIZATION_ID,
      },
    ]);

    expect(state.audits).toEqual([
      {
        actor_type: "USER",
        actor_user_id: USER_ID,
        metadata: {
          executionJobId: JOB_ID,
          initialExecutionAttemptId: ATTEMPT_ID,
          entitlementPolicyVersion: "free-byo-v1",
        },
      },
    ]);

    expect(scripted.releases).toEqual([undefined]);
  });

  it("checks sealed-material existence without returning the credential envelope", async () => {
    const state = initialState();
    const { scripted, result } = claim(state);

    await result;

    const credentialStatements = scripted.statements.filter(
      ({ sql }) =>
        /FROM provider_credential_versions/.test(sql) &&
        !/id <> \$3/.test(sql),
    );

    expect(credentialStatements).toHaveLength(1);
    expect(credentialStatements[0]!.sql).toContain(
      "(sealed_credential IS NOT NULL) AS has_sealed_credential",
    );
    expect(credentialStatements[0]!.sql).not.toContain(
      "SELECT status, sealed_credential",
    );
  });

  it("uses one database clock expression for strict expiry admission and claimed_at", async () => {
    const state = initialState();
    const { scripted, result } = claim(state);

    await result;

    const transition = scripted.statements.find(({ sql }) =>
      /UPDATE generation_authorizations AS g/.test(sql),
    );

    expect(transition).toBeDefined();
    expect(transition!.sql).toContain(
      "SELECT clock_timestamp() AS at",
    );
    expect(transition!.sql).toContain(
      "claimed_at = claim_clock.at",
    );
    expect(transition!.sql).toContain(
      "claim_clock.at < g.expires_at",
    );

    expect(
      transition!.params.some((value) => value instanceof Date),
    ).toBe(false);
  });

  it("refuses a database-clock expiry without creating claim composition", async () => {
    const state = initialState();
    state.claimExpired = true;

    const { scripted, result } = claim(state);

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_EXPIRED",
    );

    expect(
      writes(scripted.statements).map(({ sql }) =>
        /UPDATE generation_authorizations AS g/.test(sql)
          ? "CLAIM UPDATE"
          : sql,
      ),
    ).toEqual(["CLAIM UPDATE"]);

    expect(state.jobs).toEqual([]);
    expect(state.attempts).toEqual([]);
    expect(state.usage).toEqual([]);
    expect(state.audits).toEqual([]);

    expect(statementOrder(scripted.statements).at(-1)).toBe(
      "ROLLBACK",
    );
  });
});

describe("R44B11D active principal and immutable authority", () => {
  it("revalidates User and Account under the locked principal rows", async () => {
    const disabledUser = initialState();
    disabledUser.user = { status: "DISABLED" };

    const first = claim(disabledUser);
    const userError = await expectClaimError(
      first.result,
      "PRINCIPAL_UNAVAILABLE",
    );

    expect(userError.reason).toBe("USER_DISABLED");
    expect(writes(first.scripted.statements)).toEqual([]);

    const disabledAccount = initialState();
    disabledAccount.account = {
      kind: "PERSONAL",
      owner_user_id: USER_ID,
      status: "DISABLED",
    };

    const second = claim(disabledAccount);
    const accountError = await expectClaimError(
      second.result,
      "PRINCIPAL_UNAVAILABLE",
    );

    expect(accountError.reason).toBe("ACCOUNT_DISABLED");
    expect(writes(second.scripted.statements)).toEqual([]);

    const foreignOwner = initialState();
    foreignOwner.account = {
      kind: "PERSONAL",
      owner_user_id: CURRENT_VERSION_ID,
      status: "ACTIVE",
    };

    const third = claim(foreignOwner);
    const ownershipError = await expectClaimError(
      third.result,
      "PRINCIPAL_UNAVAILABLE",
    );

    expect(ownershipError.reason).toBe("ACCOUNT_NOT_OWNED");
    expect(writes(third.scripted.statements)).toEqual([]);
  });

  it("makes missing authorization unavailable without revealing another account", async () => {
    const state = initialState();
    state.authorization = null;

    const { scripted, result } = claim(state);

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_UNAVAILABLE",
    );

    expect(writes(scripted.statements)).toEqual([]);
  });

  it.each(["CANCELLED", "EXPIRED"])(
    "refuses terminal authorization status %s",
    async (status) => {
      const state = initialState();
      state.authorization!.status = status;

      const { scripted, result } = claim(state);

      await expectClaimError(
        result,
        "GENERATION_AUTHORIZATION_NOT_CLAIMABLE",
      );

      expect(writes(scripted.statements)).toEqual([]);
    },
  );

  it("refuses archived Production and mismatched creation-grant provenance", async () => {
    const archived = initialState();
    archived.production!.archived_at = new Date();

    const first = claim(archived);

    await expectClaimError(
      first.result,
      "PRODUCTION_UNAVAILABLE",
    );

    expect(writes(first.scripted.statements)).toEqual([]);

    const mismatched = initialState();
    mismatched.production!.creation_entitlement_grant_id =
      CURRENT_VERSION_ID;

    const second = claim(mismatched);

    await expectClaimError(
      second.result,
      "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION",
    );

    expect(writes(second.scripted.statements)).toEqual([]);
  });

  it("requires the exact AVAILABLE FREE_BYO grant and supported policy", async () => {
    const revoked = initialState();
    revoked.grant!.state = "REVOKED";

    const first = claim(revoked);

    await expectClaimError(
      first.result,
      "ENTITLEMENT_NOT_AVAILABLE",
    );

    expect(writes(first.scripted.statements)).toEqual([]);

    const wrongKind = initialState();
    wrongKind.grant!.kind = "OTHER";

    const second = claim(wrongKind);

    await expectClaimError(
      second.result,
      "ENTITLEMENT_NOT_AVAILABLE",
    );

    expect(writes(second.scripted.statements)).toEqual([]);

    const unsupported = initialState();
    unsupported.grant!.policy_version = "unknown-policy-v99";

    const third = claim(unsupported);

    await expectClaimError(
      third.result,
      "ENTITLEMENT_POLICY_UNSUPPORTED",
    );

    expect(writes(third.scripted.statements)).toEqual([]);
  });
});

describe("R44B11D credential lifecycle admission", () => {
  it.each(["INVALID", "DISCONNECTED", "DISABLED"])(
    "refuses ProviderConnection status %s",
    async (status) => {
      const state = initialState();
      state.connection!.status = status;

      const { scripted, result } = claim(state);

      await expectClaimError(
        result,
        "PROVIDER_CONNECTION_UNAVAILABLE",
      );

      expect(writes(scripted.statements)).toEqual([]);
    },
  );

  it.each(["RETAINED_FOR_RECOVERY", "DESTROYED"])(
    "refuses bound credential status %s",
    async (status) => {
      const state = initialState();
      state.boundCredential!.status = status;

      const { scripted, result } = claim(state);

      await expectClaimError(
        result,
        "CREDENTIAL_UNAVAILABLE",
      );

      expect(writes(scripted.statements)).toEqual([]);
    },
  );

  it("refuses a bound credential whose sealed material no longer exists", async () => {
    const state = initialState();
    state.boundCredential!.has_sealed_credential = false;

    const { scripted, result } = claim(state);

    await expectClaimError(
      result,
      "CREDENTIAL_UNAVAILABLE",
    );

    expect(writes(scripted.statements)).toEqual([]);
  });

  it("allows the exact SUPERSEDED bound credential on an otherwise eligible active verified connection", async () => {
    const state = initialState();
    state.boundCredential!.status = "SUPERSEDED";

    const { result } = claim(state);

    await expect(result).resolves.toMatchObject({
      created: true,
      generationAuthorizationId: AUTHORIZATION_ID,
    });

    expect(state.authorization!.provider_credential_version_id).toBe(
      VERSION_ID,
    );
  });

  it("allows PENDING_VERIFICATION only for the narrow SUPERSEDED rotation exception with a distinct ACTIVE version", async () => {
    const state = initialState();

    state.connection = {
      provider: "GOOGLE_GENAI",
      status: "PENDING_VERIFICATION",
      verification_status: "UNVERIFIED",
    };

    state.boundCredential = {
      status: "SUPERSEDED",
      has_sealed_credential: true,
    };

    state.currentCredentials = [
      {
        id: CURRENT_VERSION_ID,
      },
    ];

    const { scripted, result } = claim(state);

    const claimed = await result;

    expect(claimed.created).toBe(true);
    expect(
      state.authorization!.provider_credential_version_id,
    ).toBe(VERSION_ID);

    expect(statementOrder(scripted.statements)).toContain(
      "DISTINCT ACTIVE CREDENTIAL",
    );
  });

  it("does not apply the PENDING_VERIFICATION exception to an ACTIVE bound version", async () => {
    const state = initialState();

    state.connection = {
      provider: "GOOGLE_GENAI",
      status: "PENDING_VERIFICATION",
      verification_status: "UNVERIFIED",
    };

    state.boundCredential = {
      status: "ACTIVE",
      has_sealed_credential: true,
    };

    state.currentCredentials = [
      {
        id: CURRENT_VERSION_ID,
      },
    ];

    const { scripted, result } = claim(state);

    await expectClaimError(
      result,
      "PROVIDER_CONNECTION_UNAVAILABLE",
    );

    expect(writes(scripted.statements)).toEqual([]);
  });

  it("requires a distinct ACTIVE version for the PENDING_VERIFICATION SUPERSEDED exception", async () => {
    const state = initialState();

    state.connection = {
      provider: "GOOGLE_GENAI",
      status: "PENDING_VERIFICATION",
      verification_status: "UNVERIFIED",
    };

    state.boundCredential = {
      status: "SUPERSEDED",
      has_sealed_credential: true,
    };

    state.currentCredentials = [];

    const { scripted, result } = claim(state);

    await expectClaimError(
      result,
      "PROVIDER_CONNECTION_UNAVAILABLE",
    );

    expect(writes(scripted.statements)).toEqual([]);
  });
});

describe("R44B11D claim replay", () => {
  it("returns the existing composition without any lifecycle or composition write", async () => {
    const state = initialState();

    seedClaimedComposition(state, {
      jobStatus: "RUNNING",
      attemptState: "SUBMITTED",
      fencingCounter: 3,
    });

    // Later dynamic eligibility changes must not invalidate replay.
    state.connection = {
      provider: "GOOGLE_GENAI",
      status: "DISCONNECTED",
      verification_status: "VERIFIED",
    };
    state.boundCredential = {
      status: "DESTROYED",
      has_sealed_credential: false,
    };
    state.production!.archived_at = new Date();
    state.grant!.state = "REVOKED";

    const { scripted, result } = claim(state);

    const replay = await result;

    expect(replay).toEqual({
      generationAuthorizationId: AUTHORIZATION_ID,
      claimedAt: CLAIMED_AT,
      executionJob: {
        id: JOB_ID,
        status: "RUNNING",
      },
      initialExecutionAttempt: {
        id: ATTEMPT_ID,
        attemptNumber: 1,
        state: "SUBMITTED",
        leaseFencingCounter: 3,
      },
      created: false,
      correlationId: CORRELATION_ID,
    });

    expect(writes(scripted.statements)).toEqual([]);

    expect(statementOrder(scripted.statements)).toEqual([
      "BEGIN",
      "USER FOR SHARE",
      "ACCOUNT FOR NO KEY UPDATE",
      "AUTHORIZATION READ",
      "REPLAY JOB",
      "REPLAY ATTEMPT",
      "REPLAY USAGE",
      "REPLAY AUDIT",
      "COMMIT",
    ]);

    expect(
      scripted.statements.some(({ sql }) =>
        /FROM provider_connections/.test(sql),
      ),
    ).toBe(false);

    expect(
      scripted.statements.some(({ sql }) =>
        /FROM productions/.test(sql),
      ),
    ).toBe(false);

    expect(
      scripted.statements.some(({ sql }) =>
        /FROM entitlement_grants/.test(sql),
      ),
    ).toBe(false);
  });

  it.each([
    "job",
    "attempt",
    "usage",
    "audit",
  ])(
    "fails closed and does not repair CLAIMED composition missing %s",
    async (missing) => {
      const state = initialState();
      seedClaimedComposition(state);

      if (missing === "job") state.jobs = [];
      if (missing === "attempt") state.attempts = [];
      if (missing === "usage") state.usage = [];
      if (missing === "audit") state.audits = [];

      const { scripted, result } = claim(state);

      await expectClaimError(
        result,
        "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION",
      );

      expect(writes(scripted.statements)).toEqual([]);
      expect(statementOrder(scripted.statements).at(-1)).toBe(
        "ROLLBACK",
      );
    },
  );

  it("fails closed on duplicate or conflicting replay composition instead of repairing it", async () => {
    const duplicateJob = initialState();
    seedClaimedComposition(duplicateJob);
    duplicateJob.jobs.push({
      id: CURRENT_VERSION_ID,
      status: "QUEUED",
    });

    const first = claim(duplicateJob);

    await expectClaimError(
      first.result,
      "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION",
    );

    expect(writes(first.scripted.statements)).toEqual([]);

    const badAudit = initialState();
    seedClaimedComposition(badAudit);
    badAudit.audits[0]!.metadata = {
      executionJobId: JOB_ID,
      initialExecutionAttemptId: ATTEMPT_ID,
      entitlementPolicyVersion: "free-byo-v1",
      unexpected: true,
    };

    const second = claim(badAudit);

    await expectClaimError(
      second.result,
      "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION",
    );

    expect(writes(second.scripted.statements)).toEqual([]);
  });
});

describe("R44B11D database error boundary", () => {
  it("maps pool checkout failure to the fixed database error surface", async () => {
    const state = initialState();
    state.failConnect = true;

    const { scripted, result } = claim(state);

    const error = await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE",
    );

    expect(error.databaseCode).toBe("ECONNREFUSED");
    expect(error.message).toBe(
      "The generation authorization claim could not be completed.",
    );

    expect(scripted.statements).toEqual([]);
    expect(scripted.releases).toEqual([]);
  });

  it("rolls back when the audit write fails and does not expose the database error message", async () => {
    const state = initialState();
    state.failAudit = true;

    const { scripted, result } = claim(state);

    const error = await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE",
    );

    expect(error.databaseCode).toBe("23514");
    expect(error.message).toBe(
      "The generation authorization claim could not be completed.",
    );
    expect(error.message).not.toContain("secret-marker");

    expect(statementOrder(scripted.statements).at(-1)).toBe(
      "ROLLBACK",
    );
    expect(scripted.releases).toEqual([undefined]);
  });

  it("destroys the checked-out connection when rollback itself cannot be confirmed", async () => {
    const state = initialState();
    state.failAudit = true;
    state.failRollback = true;

    const { scripted, result } = claim(state);

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE",
    );

    expect(scripted.releases).toHaveLength(1);
    expect(scripted.releases[0]).toBeInstanceOf(Error);
  });
});

describe("R44B11D result invariants", () => {
  it("refuses an invalid initial attempt identity returned by persistence", async () => {
    const state = initialState();

    const scripted = scriptedPool(state);

    const originalConnect = scripted.pool.connect;

    const pool: TransactionalPool = {
      ...scripted.pool,
      connect: async () => {
        const client = await originalConnect();

        return {
          ...client,
          query: async <R extends object>(
            sql: string,
            params?: unknown[],
          ) => {
            const result = await client.query<R>(sql, params);

            if (/INSERT INTO execution_attempts/.test(sql)) {
              return {
                rows: [
                  {
                    ...(result.rows[0] as object),
                    attempt_number: 2,
                  } as R,
                ],
              };
            }

            return result;
          },
        };
      },
    };

    const result: Promise<ClaimGenerationAuthorizationResult> =
      claimGenerationAuthorization(
        { pool },
        PRINCIPAL,
        AUTHORIZATION_ID,
        { correlationId: CORRELATION_ID },
      );

    await expectClaimError(
      result,
      "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION",
    );
  });
});
