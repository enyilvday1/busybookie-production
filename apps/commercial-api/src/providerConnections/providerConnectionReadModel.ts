import type { RuntimeClient, RuntimePool } from "../database/runtimePool.js";

// Customer-safe view of a provider connection. Selected with an explicit
// column list that never includes sealed credentials, fingerprints, key
// references, account IDs or creators.

export type ProviderConnectionView = Readonly<{
  id: string;
  provider: string;
  credentialKind: string;
  label: string | null;
  status: string;
  verificationStatus: string;
  // The newest credential version and its lifecycle state.
  currentCredentialVersion: number | null;
  currentCredentialStatus: string | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export const PROVIDER_CONNECTION_LIST_LIMIT = 100;

type Row = {
  id: string;
  provider: string;
  credential_kind: string;
  label: string | null;
  status: string;
  verification_status: string;
  credential_version: number | null;
  credential_status: string | null;
  disconnected_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const VIEW_SELECT = `
SELECT c.id, c.provider, c.credential_kind, c.label, c.status, c.verification_status,
       v.credential_version, v.status AS credential_status,
       c.disconnected_at, c.created_at, c.updated_at
  FROM provider_connections c
  LEFT JOIN LATERAL (
    SELECT credential_version, status
      FROM provider_credential_versions
     WHERE provider_connection_id = c.id AND account_id = c.account_id
     ORDER BY credential_version DESC
     LIMIT 1
  ) v ON true`;

const toView = (row: Row): ProviderConnectionView =>
  Object.freeze({
    id: row.id,
    provider: row.provider,
    credentialKind: row.credential_kind,
    label: row.label,
    status: row.status,
    verificationStatus: row.verification_status,
    currentCredentialVersion: row.credential_version,
    currentCredentialStatus: row.credential_status,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });

type Queryable = RuntimePool | RuntimeClient;

// Includes disconnected connections; newest first; bounded.
export async function listProviderConnectionsForAccount(pool: Queryable, accountId: string): Promise<readonly ProviderConnectionView[]> {
  const result = await pool.query<Row>(
    `${VIEW_SELECT} WHERE c.account_id = $1 ORDER BY c.created_at DESC, c.id LIMIT ${PROVIDER_CONNECTION_LIST_LIMIT}`,
    [accountId],
  );
  return Object.freeze(result.rows.map(toView));
}

// One owner-scoped query: a foreign connection and a missing one are both null.
export async function getProviderConnectionForAccount(pool: Queryable, accountId: string, connectionId: string): Promise<ProviderConnectionView | null> {
  const result = await pool.query<Row>(`${VIEW_SELECT} WHERE c.account_id = $1 AND c.id = $2`, [accountId, connectionId]);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}
