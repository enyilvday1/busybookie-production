import type { RuntimePool } from "../database/runtimePool.js";

// Owner-scoped Production reads. The account ID always comes from the
// resolved principal, never from request input. Only control-plane-safe
// fields are selected: no grant, policy, creator or engine data.

export type ProductionSummary = Readonly<{
  id: string;
  title: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

// No pagination contract exists yet; the list is capped rather than unbounded.
export const PRODUCTION_LIST_LIMIT = 100;

type Row = { id: string; title: string; archived_at: Date | null; created_at: Date; updated_at: Date };

const toSummary = (row: Row): ProductionSummary =>
  Object.freeze({ id: row.id, title: row.title, archivedAt: row.archived_at, createdAt: row.created_at, updatedAt: row.updated_at });

// Archived Productions are included (archival is history; archivedAt tells
// them apart). Ordered newest first, matching productions_account_list_ix.
export async function listProductionsForAccount(pool: RuntimePool, accountId: string): Promise<readonly ProductionSummary[]> {
  const result = await pool.query<Row>(
    `SELECT id, title, archived_at, created_at, updated_at
       FROM productions
      WHERE account_id = $1
      ORDER BY created_at DESC, id
      LIMIT ${PRODUCTION_LIST_LIMIT}`,
    [accountId],
  );
  return Object.freeze(result.rows.map(toSummary));
}

// One owner-scoped query: a Production of another account and a nonexistent
// one are indistinguishable (both null).
export async function getProductionForAccount(pool: RuntimePool, accountId: string, productionId: string): Promise<ProductionSummary | null> {
  const result = await pool.query<Row>(
    "SELECT id, title, archived_at, created_at, updated_at FROM productions WHERE account_id = $1 AND id = $2",
    [accountId, productionId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toSummary(row);
}
