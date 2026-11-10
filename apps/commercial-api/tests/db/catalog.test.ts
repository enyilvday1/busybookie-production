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
  provider_connections: [
    "provider_connections_account_fk",
    "provider_connections_account_scope_uq",
    "provider_connections_created_by_user_fk",
    "provider_connections_creation_idempotency_key_ck",
    "provider_connections_credential_kind_ck",
    "provider_connections_disabled_at_ck",
    "provider_connections_disconnected_at_ck",
    "provider_connections_label_ck",
    "provider_connections_pk",
    "provider_connections_provider_ck",
    "provider_connections_provider_scope_uq",
    "provider_connections_status_ck",
    "provider_connections_verification_attempt_ck",
    "provider_connections_verification_status_ck",
    "provider_connections_verified_at_ck",
  ],
  provider_credential_versions: [
    "provider_credential_versions_active_clean_ck",
    "provider_credential_versions_connection_same_account_fk",
    "provider_credential_versions_created_by_user_fk",
    "provider_credential_versions_destroyed_at_ck",
    "provider_credential_versions_fingerprint_algorithm_ck",
    "provider_credential_versions_fingerprint_key_ref_ck",
    "provider_credential_versions_fingerprint_presence_ck",
    "provider_credential_versions_fingerprint_value_ck",
    "provider_credential_versions_pk",
    "provider_credential_versions_retained_at_ck",
    "provider_credential_versions_rotation_idempotency_key_ck",
    "provider_credential_versions_scope_uq",
    "provider_credential_versions_sealed_credential_ck",
    "provider_credential_versions_secret_presence_ck",
    "provider_credential_versions_status_ck",
    "provider_credential_versions_superseded_at_ck",
    "provider_credential_versions_version_ck",
    "provider_credential_versions_version_uq",
  ],
  generation_authorizations: [
    "generation_authorizations_account_fk",
    "generation_authorizations_account_scope_uq",
    "generation_authorizations_billing_mode_ck",
    "generation_authorizations_cancelled_at_ck",
    "generation_authorizations_claim_before_expiry_ck",
    "generation_authorizations_claimed_at_ck",
    "generation_authorizations_connection_same_account_fk",
    "generation_authorizations_created_by_user_fk",
    "generation_authorizations_creation_idempotency_key_ck",
    "generation_authorizations_credential_binding_ck",
    "generation_authorizations_credential_scope_uq",
    "generation_authorizations_credential_version_same_connection_fk",
    "generation_authorizations_execution_scope_uq",
    "generation_authorizations_expected_cost_cap_amount_ck",
    "generation_authorizations_expected_cost_cap_unit_ck",
    "generation_authorizations_expired_after_expiry_ck",
    "generation_authorizations_expired_at_ck",
    "generation_authorizations_expires_at_ck",
    "generation_authorizations_generation_request_ck",
    "generation_authorizations_generation_request_sha256_ck",
    "generation_authorizations_grant_same_account_fk",
    "generation_authorizations_model_ck",
    "generation_authorizations_pk",
    "generation_authorizations_production_same_account_fk",
    "generation_authorizations_production_scope_uq",
    "generation_authorizations_provider_ck",
    "generation_authorizations_status_ck",
    "generation_authorizations_v1_issuable_billing_mode_ck",
  ],
  worker_principals: ["worker_principals_disabled_ck", "worker_principals_label_ck", "worker_principals_pk", "worker_principals_status_ck"],
  execution_jobs: [
    "execution_jobs_account_fk",
    "execution_jobs_attempt_scope_uq",
    "execution_jobs_authorization_same_production_fk",
    "execution_jobs_authorization_uq",
    "execution_jobs_completed_at_ck",
    "execution_jobs_pk",
    "execution_jobs_status_ck",
  ],
  execution_attempts: [
    "execution_attempts_account_fk",
    "execution_attempts_account_scope_uq",
    "execution_attempts_authorization_credential_fk",
    "execution_attempts_authorization_provider_fk",
    "execution_attempts_billing_mode_ck",
    "execution_attempts_completed_at_ck",
    "execution_attempts_credential_binding_ck",
    "execution_attempts_credential_granted_ck",
    "execution_attempts_failure_code_ck",
    "execution_attempts_failure_state_ck",
    "execution_attempts_fencing_counter_ck",
    "execution_attempts_heartbeat_ck",
    "execution_attempts_job_same_authorization_fk",
    "execution_attempts_lease_complete_ck",
    "execution_attempts_lease_state_ck",
    "execution_attempts_lease_times_ck",
    "execution_attempts_lease_token_sha256_ck",
    "execution_attempts_lease_worker_fk",
    "execution_attempts_number_ck",
    "execution_attempts_number_uq",
    "execution_attempts_output_byte_count_ck",
    "execution_attempts_output_content_type_ck",
    "execution_attempts_output_object_key_ck",
    "execution_attempts_output_sha256_ck",
    "execution_attempts_output_state_ck",
    "execution_attempts_pk",
    "execution_attempts_provider_ck",
    "execution_attempts_provider_execution_id_ck",
    "execution_attempts_provider_execution_state_ck",
    "execution_attempts_recovery_expires_at_ck",
    "execution_attempts_state_ck",
    "execution_attempts_submitted_at_ck",
    "execution_attempts_submitting_after_grant_ck",
    "execution_attempts_submitting_at_ck",
  ],
};

describe("schema catalog (migrations 0001 to 0004)", () => {
  it("contains exactly the eleven domain tables and schema_migrations", async () => {
    const tables = await rows<{ relname: string; relkind: string }>(
      `SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f') ORDER BY c.relname`,
    );
    expect(tables).toEqual(
      [
        "accounts",
        "audit_events",
        "entitlement_grants",
        "execution_attempts",
        "execution_jobs",
        "generation_authorizations",
        "productions",
        "provider_connections",
        "provider_credential_versions",
        "schema_migrations",
        "users",
        "worker_principals",
      ].map((relname) => ({
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
        indexname: "execution_attempts_credential_version_ix",
        indexdef:
          "CREATE INDEX execution_attempts_credential_version_ix ON public.execution_attempts USING btree (provider_credential_version_id, state) WHERE (provider_credential_version_id IS NOT NULL)",
      },
      {
        indexname: "execution_attempts_job_ix",
        indexdef: "CREATE INDEX execution_attempts_job_ix ON public.execution_attempts USING btree (account_id, execution_job_id, attempt_number)",
      },
      {
        indexname: "execution_attempts_lease_expiry_ix",
        indexdef:
          "CREATE INDEX execution_attempts_lease_expiry_ix ON public.execution_attempts USING btree (lease_expires_at) WHERE (lease_expires_at IS NOT NULL)",
      },
      {
        // Never two concurrent paid attempts for one authorization.
        indexname: "execution_attempts_one_open_per_job_uq",
        indexdef:
          "CREATE UNIQUE INDEX execution_attempts_one_open_per_job_uq ON public.execution_attempts USING btree (execution_job_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'LEASED'::text, 'SUBMITTING'::text, 'SUBMITTED'::text, 'OUTCOME_UNKNOWN'::text]))",
      },
      {
        indexname: "execution_attempts_provider_execution_uq",
        indexdef:
          "CREATE UNIQUE INDEX execution_attempts_provider_execution_uq ON public.execution_attempts USING btree (account_id, provider, provider_execution_id) WHERE (provider_execution_id IS NOT NULL)",
      },
      {
        indexname: "execution_attempts_queue_ix",
        indexdef: "CREATE INDEX execution_attempts_queue_ix ON public.execution_attempts USING btree (created_at, id) WHERE (state = 'QUEUED'::text)",
      },
      {
        indexname: "execution_jobs_production_list_ix",
        indexdef: "CREATE INDEX execution_jobs_production_list_ix ON public.execution_jobs USING btree (account_id, production_id, created_at DESC, id)",
      },
      {
        indexname: "generation_authorizations_creation_idempotency_key_uq",
        indexdef:
          "CREATE UNIQUE INDEX generation_authorizations_creation_idempotency_key_uq ON public.generation_authorizations USING btree (account_id, production_id, creation_idempotency_key) WHERE (creation_idempotency_key IS NOT NULL)",
      },
      {
        indexname: "generation_authorizations_credential_version_ix",
        indexdef:
          "CREATE INDEX generation_authorizations_credential_version_ix ON public.generation_authorizations USING btree (provider_credential_version_id) WHERE (provider_credential_version_id IS NOT NULL)",
      },
      {
        indexname: "generation_authorizations_grant_ix",
        indexdef: "CREATE INDEX generation_authorizations_grant_ix ON public.generation_authorizations USING btree (entitlement_grant_id)",
      },
      {
        indexname: "generation_authorizations_production_list_ix",
        indexdef:
          "CREATE INDEX generation_authorizations_production_list_ix ON public.generation_authorizations USING btree (account_id, production_id, created_at DESC, id)",
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
      {
        indexname: "provider_connections_account_list_ix",
        indexdef: "CREATE INDEX provider_connections_account_list_ix ON public.provider_connections USING btree (account_id, created_at DESC, id)",
      },
      {
        indexname: "provider_connections_creation_idempotency_key_uq",
        indexdef:
          "CREATE UNIQUE INDEX provider_connections_creation_idempotency_key_uq ON public.provider_connections USING btree (account_id, creation_idempotency_key) WHERE (creation_idempotency_key IS NOT NULL)",
      },
      {
        // Deliberately not unique: duplicate policy is Account-scoped application logic.
        indexname: "provider_credential_versions_fingerprint_ix",
        indexdef:
          "CREATE INDEX provider_credential_versions_fingerprint_ix ON public.provider_credential_versions USING btree (account_id, fingerprint_key_ref, fingerprint_value) WHERE (fingerprint_value IS NOT NULL)",
      },
      {
        indexname: "provider_credential_versions_one_active_uq",
        indexdef:
          "CREATE UNIQUE INDEX provider_credential_versions_one_active_uq ON public.provider_credential_versions USING btree (provider_connection_id) WHERE (status = 'ACTIVE'::text)",
      },
      {
        indexname: "provider_credential_versions_rotation_idempotency_key_uq",
        indexdef:
          "CREATE UNIQUE INDEX provider_credential_versions_rotation_idempotency_key_uq ON public.provider_credential_versions USING btree (provider_connection_id, rotation_idempotency_key) WHERE (rotation_idempotency_key IS NOT NULL)",
      },
    ]);
  });

  it("enforces credential-version provenance through a same-account composite foreign key", async () => {
    const definitions = await rows<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('provider_credential_versions_connection_same_account_fk', 'provider_connections_account_scope_uq',
                          'provider_credential_versions_scope_uq', 'provider_credential_versions_version_uq')
        ORDER BY conname`,
    );
    expect(definitions).toEqual([
      { conname: "provider_connections_account_scope_uq", def: "UNIQUE (account_id, id)" },
      {
        conname: "provider_credential_versions_connection_same_account_fk",
        def: "FOREIGN KEY (account_id, provider_connection_id) REFERENCES provider_connections(account_id, id) ON DELETE RESTRICT",
      },
      { conname: "provider_credential_versions_scope_uq", def: "UNIQUE (account_id, provider_connection_id, id)" },
      { conname: "provider_credential_versions_version_uq", def: "UNIQUE (provider_connection_id, credential_version)" },
    ]);
  });

  it("widens the audit resource-type check through 0004 under the same name", async () => {
    const check = await rows<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'audit_events_resource_type_ck'");
    expect(check).toEqual([
      {
        def: "CHECK ((resource_type = ANY (ARRAY['user'::text, 'account'::text, 'entitlement_grant'::text, 'production'::text, 'provider_connection'::text, 'generation_authorization'::text, 'execution_job'::text, 'execution_attempt'::text, 'worker_principal'::text])))",
      },
    ]);
  });

  it("binds jobs and attempts to their authorization through composite foreign keys", async () => {
    const definitions = await rows<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid IN ('public.execution_jobs'::regclass, 'public.execution_attempts'::regclass) AND contype IN ('f', 'u')
           OR conname IN ('generation_authorizations_execution_scope_uq', 'generation_authorizations_credential_scope_uq')
        ORDER BY conname`,
    );
    expect(definitions).toEqual([
      { conname: "execution_attempts_account_fk", def: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT" },
      { conname: "execution_attempts_account_scope_uq", def: "UNIQUE (account_id, id)" },
      {
        conname: "execution_attempts_authorization_credential_fk",
        def: "FOREIGN KEY (account_id, generation_authorization_id, provider_credential_version_id) REFERENCES generation_authorizations(account_id, id, provider_credential_version_id) ON DELETE RESTRICT",
      },
      {
        conname: "execution_attempts_authorization_provider_fk",
        def: "FOREIGN KEY (account_id, generation_authorization_id, billing_mode, provider) REFERENCES generation_authorizations(account_id, id, billing_mode, provider) ON DELETE RESTRICT",
      },
      {
        conname: "execution_attempts_job_same_authorization_fk",
        def: "FOREIGN KEY (account_id, execution_job_id, generation_authorization_id) REFERENCES execution_jobs(account_id, id, generation_authorization_id) ON DELETE RESTRICT",
      },
      { conname: "execution_attempts_lease_worker_fk", def: "FOREIGN KEY (lease_worker_principal_id) REFERENCES worker_principals(id) ON DELETE RESTRICT" },
      { conname: "execution_attempts_number_uq", def: "UNIQUE (execution_job_id, attempt_number)" },
      { conname: "execution_jobs_account_fk", def: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT" },
      { conname: "execution_jobs_attempt_scope_uq", def: "UNIQUE (account_id, id, generation_authorization_id)" },
      {
        conname: "execution_jobs_authorization_same_production_fk",
        def: "FOREIGN KEY (account_id, production_id, generation_authorization_id) REFERENCES generation_authorizations(account_id, production_id, id) ON DELETE RESTRICT",
      },
      { conname: "execution_jobs_authorization_uq", def: "UNIQUE (generation_authorization_id)" },
      { conname: "generation_authorizations_credential_scope_uq", def: "UNIQUE (account_id, id, provider_credential_version_id)" },
      { conname: "generation_authorizations_execution_scope_uq", def: "UNIQUE (account_id, id, billing_mode, provider)" },
    ]);
  });

  it("stores no secret, sealed credential, fingerprint or plaintext lease token on worker-bridge tables", async () => {
    const columns = await rows<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('worker_principals', 'execution_jobs', 'execution_attempts')`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names.filter((name) => /secret|plaintext|password|api_key|sealed|fingerprint|bearer|url|path/.test(name))).toEqual([]);
    expect(names.filter((name) => /token/.test(name))).toEqual(["lease_token_sha256"]);
  });

  it("binds generation-authorization provenance through same-account composite foreign keys", async () => {
    const definitions = await rows<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.generation_authorizations'::regclass AND contype IN ('f', 'u')
           OR conname = 'provider_connections_provider_scope_uq'
        ORDER BY conname`,
    );
    expect(definitions).toEqual([
      { conname: "generation_authorizations_account_fk", def: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT" },
      { conname: "generation_authorizations_account_scope_uq", def: "UNIQUE (account_id, id)" },
      {
        conname: "generation_authorizations_connection_same_account_fk",
        def: "FOREIGN KEY (account_id, provider_connection_id, provider) REFERENCES provider_connections(account_id, id, provider) ON DELETE RESTRICT",
      },
      { conname: "generation_authorizations_created_by_user_fk", def: "FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT" },
      // Added by 0004 as composite-FK targets for execution attempts.
      { conname: "generation_authorizations_credential_scope_uq", def: "UNIQUE (account_id, id, provider_credential_version_id)" },
      {
        conname: "generation_authorizations_credential_version_same_connection_fk",
        def: "FOREIGN KEY (account_id, provider_connection_id, provider_credential_version_id) REFERENCES provider_credential_versions(account_id, provider_connection_id, id) ON DELETE RESTRICT",
      },
      { conname: "generation_authorizations_execution_scope_uq", def: "UNIQUE (account_id, id, billing_mode, provider)" },
      {
        conname: "generation_authorizations_grant_same_account_fk",
        def: "FOREIGN KEY (account_id, entitlement_grant_id) REFERENCES entitlement_grants(account_id, id) ON DELETE RESTRICT",
      },
      {
        conname: "generation_authorizations_production_same_account_fk",
        def: "FOREIGN KEY (account_id, production_id) REFERENCES productions(account_id, id) ON DELETE RESTRICT",
      },
      { conname: "generation_authorizations_production_scope_uq", def: "UNIQUE (account_id, production_id, id)" },
      { conname: "provider_connections_provider_scope_uq", def: "UNIQUE (account_id, id, provider)" },
    ]);

    const nullability = await rows<{ attname: string; attnotnull: boolean }>(
      `SELECT attname, attnotnull FROM pg_attribute
        WHERE attrelid = 'public.generation_authorizations'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    );
    expect(nullability).toEqual(
      [
        ["id", true],
        ["account_id", true],
        ["production_id", true],
        ["entitlement_grant_id", true],
        ["billing_mode", true],
        ["provider", true],
        ["model", true],
        ["provider_connection_id", false],
        ["provider_credential_version_id", false],
        ["generation_request", true],
        ["generation_request_sha256", true],
        ["expected_cost_cap_unit", true],
        ["expected_cost_cap_amount", true],
        ["status", true],
        ["expires_at", true],
        ["claimed_at", false],
        ["expired_at", false],
        ["cancelled_at", false],
        ["created_by_user_id", true],
        ["creation_idempotency_key", false],
        ["created_at", true],
        ["updated_at", true],
      ].map(([attname, attnotnull]) => ({ attname, attnotnull })),
    );
  });

  it("keeps PLATFORM_HOSTED as non-issuable vocabulary with no platform credential column", async () => {
    const checks = await rows<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname IN ('generation_authorizations_billing_mode_ck', 'generation_authorizations_v1_issuable_billing_mode_ck')
        ORDER BY conname`,
    );
    expect(checks).toEqual([
      {
        conname: "generation_authorizations_billing_mode_ck",
        def: "CHECK ((billing_mode = ANY (ARRAY['USER_BYO'::text, 'PLATFORM_HOSTED'::text])))",
      },
      { conname: "generation_authorizations_v1_issuable_billing_mode_ck", def: "CHECK ((billing_mode = 'USER_BYO'::text))" },
    ]);
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'generation_authorizations'`,
    );
    expect(columns.map((column) => column.column_name).filter((name) => /platform|secret|plaintext|token|api_key|lease|fencing|attempt/.test(name))).toEqual([]);
  });

  it("has no plaintext credential column and no provider-brand vocabulary", async () => {
    const columns = await rows<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name IN ('provider_connections', 'provider_credential_versions')
        ORDER BY table_name, ordinal_position`,
    );
    const names = columns.map((column) => column.column_name);
    expect(names).not.toContain("api_key");
    expect(names.filter((name) => /secret|plaintext|password|token|api_key/.test(name))).toEqual([]);
    expect(columns.find((column) => column.column_name === "sealed_credential")?.data_type).toBe("jsonb");
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
    expect(actions).toHaveLength(24);
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

    const otherTriggers = await rows<{ relname: string; tgname: string; def: string }>(
      `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal AND c.relname <> 'audit_events'
        ORDER BY c.relname, t.tgname`,
    );
    expect(otherTriggers).toEqual([
      {
        relname: "execution_attempts",
        tgname: "execution_attempts_guard",
        def: "CREATE TRIGGER execution_attempts_guard BEFORE INSERT OR UPDATE ON public.execution_attempts FOR EACH ROW EXECUTE FUNCTION execution_attempts_guard()",
      },
      {
        relname: "execution_jobs",
        tgname: "execution_jobs_guard",
        def: "CREATE TRIGGER execution_jobs_guard BEFORE INSERT OR UPDATE ON public.execution_jobs FOR EACH ROW EXECUTE FUNCTION execution_jobs_guard()",
      },
      {
        relname: "generation_authorizations",
        tgname: "generation_authorizations_guard_update",
        def: "CREATE TRIGGER generation_authorizations_guard_update BEFORE UPDATE ON public.generation_authorizations FOR EACH ROW EXECUTE FUNCTION generation_authorizations_guard_update()",
      },
      {
        relname: "provider_credential_versions",
        tgname: "provider_credential_versions_guard_update",
        def: "CREATE TRIGGER provider_credential_versions_guard_update BEFORE UPDATE ON public.provider_credential_versions FOR EACH ROW EXECUTE FUNCTION provider_credential_versions_guard_update()",
      },
      {
        relname: "worker_principals",
        tgname: "worker_principals_guard_update",
        def: "CREATE TRIGGER worker_principals_guard_update BEFORE UPDATE ON public.worker_principals FOR EACH ROW EXECUTE FUNCTION worker_principals_guard_update()",
      },
    ]);

    const functions = await rows<{ proname: string; public_execute: boolean }>(
      `SELECT proname, has_function_privilege('public', oid, 'EXECUTE') AS public_execute
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname`,
    );
    expect(functions).toEqual([
      { proname: "audit_events_reject_mutation", public_execute: false },
      { proname: "execution_attempts_guard", public_execute: false },
      { proname: "execution_jobs_guard", public_execute: false },
      { proname: "generation_authorizations_guard_update", public_execute: false },
      { proname: "provider_credential_versions_guard_update", public_execute: false },
      { proname: "worker_principals_guard_update", public_execute: false },
    ]);
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
