import type { VerifiedIdentity } from "../authentication/verifiedIdentity.js";
import type { RuntimePool } from "../database/runtimePool.js";

// The internal authority for a request, derived only from a verified external
// identity and the database. Never from request input.
export type ActivePrincipal = Readonly<{
  userId: string;
  accountId: string;
}>;

export type PrincipalUnavailableReason = "USER_NOT_FOUND" | "USER_DISABLED" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_DISABLED";

export class PrincipalUnavailableError extends Error {
  override readonly name = "PrincipalUnavailableError";

  constructor(readonly reason: PrincipalUnavailableReason) {
    super("No active account is available for this identity.");
  }
}

// Read-only: resolves the User strictly by (idp_issuer, idp_subject), never by
// email, then that User's PERSONAL Account, in one statement (one snapshot).
// Requires both to be ACTIVE. It provisions nothing, refreshes nothing, writes
// nothing and records no audit event; an identity that has never been
// bootstrapped is simply USER_NOT_FOUND.
export async function resolveActivePrincipalForIdentity(pool: RuntimePool, identity: VerifiedIdentity): Promise<ActivePrincipal> {
  const result = await pool.query<{
    user_id: string;
    user_status: string;
    account_id: string | null;
    account_status: string | null;
  }>(
    `SELECT u.id AS user_id, u.status AS user_status, a.id AS account_id, a.status AS account_status
       FROM users u
       LEFT JOIN accounts a ON a.owner_user_id = u.id AND a.kind = 'PERSONAL'
      WHERE u.idp_issuer = $1 AND u.idp_subject = $2`,
    [identity.issuer, identity.subject],
  );

  const row = result.rows[0];
  if (row === undefined) throw new PrincipalUnavailableError("USER_NOT_FOUND");
  if (row.user_status !== "ACTIVE") throw new PrincipalUnavailableError("USER_DISABLED");
  if (row.account_id === null) throw new PrincipalUnavailableError("ACCOUNT_NOT_FOUND");
  if (row.account_status !== "ACTIVE") throw new PrincipalUnavailableError("ACCOUNT_DISABLED");

  return Object.freeze({ userId: row.user_id, accountId: row.account_id });
}
