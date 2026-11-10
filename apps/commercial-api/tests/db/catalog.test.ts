import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

let clients: GuardedClients;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await clients.close();
});

async function rows<T extends object>(sql: string): Promise<T[]> {
  return (await clients.migrator.query<T>(sql)).rows;
}

const EXPECTED_CONSTRAINTS: Readonly<Record<string, readonly string[]>> = {
  users: [
    "users_disabled_ck",
    "users_email_ck",
    "users_idp_identity_uq",
    "users_idp_issuer_ck",
    "users_idp_subject_ck",
    "users_pk",
    "users_status_ck",
  ],
  accounts: ["accounts_disabled_ck", "accounts_kind_ck", "accounts_owner_user_fk", "accounts_pk", "accounts_status_ck"],
  entitlement_grants: [
    "entitlement_grants_account_fk",
    "entitlement_grants_account_scope_uq",
    "entitlement_grants_consumed_at_ck",
    "entitlement_grants_expired_at_ck",
    "entitlement_grants_issuance_key_ck",
    "entitlement_grants_issuance_uq",
    "entitlement_grants_kind_ck",
    "entitlement_grants_pk",
    "entitlement_grants_policy_version_ck",
    "entitlement_grants_reserved_at_ck",
    "entitlement_grants_revoked_at_ck",
    "entitlement_grants_source_ck",
    "entitlement_grants_state_ck",
    "entitlement_grants_v1_issuable_kind_ck",
  ],
  productions: [
    "productions_account_fk",
    "productions_account_scope_uq",
    "productions_created_by_user_fk",
    "productions_creation_grant_same_account_fk",
    "productions_creation_idempotency_key_ck",
    "productions_pk",
    "productions_title_ck",
  ],
  audit_events: [
    "audit_events_account_fk",
    "audit_events_actor_ck",
    "audit_events_actor_type_ck",
    "audit_events_actor_user_fk",
    "audit_events_event_type_ck",
    "audit_events_metadata_ck",
    "audit_events_pk",
    "audit_events_resource_type_ck",
    "audit_events_sequence_uq",
  ],
  schema_migrations: ["schema_migrations_name_ck", "schema_migrations_pk", "schema_migrations_sha256_ck", "schema_migrations_version_ck"],
};

describe("schema v1 catalog", () => {
  it("contains exactly the five domain tables and schema_migrations", async () => {
    const tables = await rows<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f') ORDER BY c.relname`,
    );
    expect(tables).toEqual(
      ["accounts", "audit_events", "entitlement_grants", "productions", "schema_migrations", "users"].map((relname) => ({
        relname,
        relkind: "r",
      })),
    );
  });

  it("is owned entirely by the migration role", async () => {
    const owners = await rows<{ owner: string }>(
      `SELECT DISTINCT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'`,
    );
    expect(owners).toEqual([{ owner: "busybookie_commercial_test_migrator" }]);
  });

  it("has only the audit identity sequence", async () => {
    const sequences = await rows<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'S'`,
    );
    expect(sequences).toEqual([{ relname: "audit_events_sequence_seq" }]);
  });

  it.each(Object.entries(EXPECTED_CONSTRAINTS))("names exactly the expected constraints on %s", async (table, expected) => {
    const constraints = await rows<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'public.${table}'::regclass ORDER BY conname`,
    );
    expect(constraints.map((row) => row.conname)).toEqual([...expected].sort());
  });

  it("defines the partial unique and secondary indexes exactly", async () => {
    const indexes = await rows<{ indexname: string; indexdef: string }>(
      `SELECT i.indexname, i.indexdef FROM pg_indexes i
        WHERE i.schemaname = 'public'
          AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conname = i.indexname)
        ORDER BY i.indexname`,
    );
    expect(indexes).toEqual([
      {
        indexname: "accounts_personal_owner_uq",
        indexdef:
          "CREATE UNIQUE INDEX accounts_personal_owner_uq ON public.accounts USING btree (owner_user_id) WHERE (kind = 'PERSONAL'::text)",
      },
      { indexname: "audit_events_account_ix", indexdef: "CREATE INDEX audit_events_account_ix ON public.audit_events USING btree (account_id, sequence)" },
      {
        indexname: "audit_events_correlation_ix",
        indexdef: "CREATE INDEX audit_events_correlation_ix ON public.audit_events USING btree (correlation_id)",
      },
      {
        indexname: "audit_events_resource_ix",
        indexdef: "CREATE INDEX audit_events_resource_ix ON public.audit_events USING btree (resource_type, resource_id)",
      },
      {
        indexname: "entitlement_grants_initial_free_byo_uq",
        indexdef:
          "CREATE UNIQUE INDEX entitlement_grants_initial_free_byo_uq ON public.entitlement_grants USING btree (account_id) WHERE ((kind = 'FREE_BYO'::text) AND (source = 'ACCOUNT_PROVISIONING'::text))",
      },
      {
        indexname: "productions_account_list_ix",
        indexdef: "CREATE INDEX productions_account_list_ix ON public.productions USING btree (account_id, created_at DESC, id)",
      },
      {
        indexname: "productions_creation_grant_ix",
        indexdef: "CREATE INDEX productions_creation_grant_ix ON public.productions USING btree (creation_entitlement_grant_id)",
      },
      {
        indexname: "productions_creation_idempotency_key_uq",
        indexdef:
          "CREATE UNIQUE INDEX productions_creation_idempotency_key_uq ON public.productions USING btree (account_id, creation_idempotency_key) WHERE (creation_idempotency_key IS NOT NULL)",
      },
    ]);
  });

  it("enforces production grant provenance through a same-account composite foreign key", async () => {
    const definition = await rows<{ def: string }>(
      "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'productions_creation_grant_same_account_fk'",
    );
    expect(definition).toEqual([
      {
        def: "FOREIGN KEY (account_id, creation_entitlement_grant_id) REFERENCES entitlement_grants(account_id, id) ON DELETE RESTRICT",
      },
    ]);

    const notNull = await rows<{ attnotnull: boolean }>(
      `SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.productions'::regclass AND attname = 'creation_entitlement_grant_id'`,
    );
    expect(notNull).toEqual([{ attnotnull: true }]);
  });

  it("uses ON DELETE RESTRICT for every foreign key", async () => {
    const actions = await rows<{ conname: string; confdeltype: string }>(
      "SELECT conname, confdeltype FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY conname",
    );
    expect(actions).toHaveLength(7);
    for (const action of actions) {
      expect(action.confdeltype, action.conname).toBe("r");
    }
  });

  it("keeps the v1 issuable-kind and title rules exactly as reviewed", async () => {
    const checks = await rows<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('entitlement_grants_v1_issuable_kind_ck', 'productions_title_ck') ORDER BY conname`,
    );
    expect(checks).toEqual([
      { conname: "entitlement_grants_v1_issuable_kind_ck", def: "CHECK ((kind = 'FREE_BYO'::text))" },
      {
        conname: "productions_title_ck",
        def: "CHECK ((((char_length(title) >= 1) AND (char_length(title) <= 200)) AND (title !~ '^\\s'::text) AND (title !~ '\\s$'::text)))",
      },
    ]);
  });

  it("has exactly the audit immutability triggers and function", async () => {
    const triggers = await rows<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgrelid = 'public.audit_events'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers).toEqual([
      {
        tgname: "audit_events_reject_truncate",
        def: "CREATE TRIGGER audit_events_reject_truncate BEFORE TRUNCATE ON public.audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_mutation()",
      },
      {
        tgname: "audit_events_reject_update_delete",
        def: "CREATE TRIGGER audit_events_reject_update_delete BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation()",
      },
    ]);

    const otherTriggers = await rows<{ count: string }>(
      `SELECT count(*) AS count FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND c.relname <> 'audit_events'`,
    );
    expect(otherTriggers).toEqual([{ count: "0" }]);

    const functions = await rows<{ proname: string; public_execute: boolean }>(
      `SELECT proname, has_function_privilege('public', oid, 'EXECUTE') AS public_execute
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace`,
    );
    expect(functions).toEqual([{ proname: "audit_events_reject_mutation", public_execute: false }]);
  });

  it("stores no engine, filesystem or provider identity on productions", async () => {
    const columns = await rows<{ attname: string }>(
      `SELECT attname FROM pg_attribute WHERE attrelid = 'public.productions'::regclass AND attnum > 0 AND NOT attisdropped
        ORDER BY attnum`,
    );
    expect(columns.map((column) => column.attname)).toEqual([
      "id",
      "account_id",
      "title",
      "creation_entitlement_grant_id",
      "created_by_user_id",
      "creation_idempotency_key",
      "archived_at",
      "created_at",
      "updated_at",
    ]);
  });
});
