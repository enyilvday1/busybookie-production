import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_MIGRATIONS_DIRECTORY } from "../../src/database/migrationFiles.js";
import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

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
    "execution_attempts_submitting_worker_ck",
    "execution_attempts_submitting_worker_fk",
    "execution_attempts_submitting_fencing_ck",
    "execution_attempts_submitting_epoch_ck",
    "execution_attempts_input_failed_worker_fk",
    "execution_attempts_input_failed_pair_ck",
    "execution_attempts_input_failed_state_ck",
    "execution_attempts_input_failed_code_ck",
    "execution_attempts_input_failed_epoch_ck",
  ],
  provider_verification_jobs: [
    "provider_verification_jobs_account_fk",
    "provider_verification_jobs_connection_same_account_fk",
    "provider_verification_jobs_credential_grant_state_ck",
    "provider_verification_jobs_credential_grant_time_ck",
    "provider_verification_jobs_credential_same_connection_fk",
    "provider_verification_jobs_deferred_after_creation_ck",
    "provider_verification_jobs_fencing_counter_ck",
    "provider_verification_jobs_last_unsupported_refusal_ck",
    "provider_verification_jobs_lease_complete_ck",
    "provider_verification_jobs_lease_state_ck",
    "provider_verification_jobs_lease_times_ck",
    "provider_verification_jobs_lease_token_sha256_ck",
    "provider_verification_jobs_lease_worker_fk",
    "provider_verification_jobs_pk",
    "provider_verification_jobs_policy_ck",
    "provider_verification_jobs_requested_by_user_fk",
    "provider_verification_jobs_result_fencing_ck",
    "provider_verification_jobs_result_outcome_ck",
    "provider_verification_jobs_result_pair_ck",
    "provider_verification_jobs_result_requires_verifying_ck",
    "provider_verification_jobs_result_worker_fk",
    "provider_verification_jobs_state_ck",
    "provider_verification_jobs_terminal_reason_ck",
    "provider_verification_jobs_terminal_state_ck",
    "provider_verification_jobs_terminal_time_ck",
    "provider_verification_jobs_unsupported_deferral_count_ck",
    "provider_verification_jobs_unsupported_deferral_presence_ck",
    "provider_verification_jobs_verifying_after_grant_ck",
    "provider_verification_jobs_verifying_fencing_ck",
    "provider_verification_jobs_verifying_pair_ck",
    "provider_verification_jobs_verifying_presence_ck",
    "provider_verification_jobs_verifying_state_ck",
    "provider_verification_jobs_verifying_worker_fk",
  ],
  generation_usage_events: [
    "generation_usage_events_event_type_ck",
    "generation_usage_events_pk",
    "generation_usage_events_reason_code_ck",
    "generation_usage_events_usage_fk",
  ],
  generation_usage_ledger: ["generation_usage_ledger_authorization_same_production_fk", "generation_usage_ledger_pk"],
};

describe("schema catalog (migrations 0001 to 0011)", () => {
  it("contains exactly the fourteen domain tables and schema_migrations", async () => {
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
        "generation_usage_events",
        "generation_usage_ledger",
        "productions",
        "provider_connections",
        "provider_credential_versions",
        "provider_verification_jobs",
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
        indexname: "generation_authorizations_disconnect_issued_ix",
        indexdef:
          "CREATE INDEX generation_authorizations_disconnect_issued_ix ON public.generation_authorizations USING btree (provider_connection_id, created_at, id) WHERE ((billing_mode = 'USER_BYO'::text) AND (status = 'ISSUED'::text) AND (provider_connection_id IS NOT NULL))",
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
        indexname: "provider_connections_disconnected_convergence_ix",
        indexdef:
          "CREATE INDEX provider_connections_disconnected_convergence_ix ON public.provider_connections USING btree (disconnected_at, id) WHERE (status = 'DISCONNECTED'::text)",
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
      {
        indexname: "provider_verification_jobs_connection_ix",
        indexdef:
          "CREATE INDEX provider_verification_jobs_connection_ix ON public.provider_verification_jobs USING btree (account_id, provider_connection_id, created_at DESC, id)",
      },
      {
        indexname: "provider_verification_jobs_credential_obligation_ix",
        indexdef:
          "CREATE INDEX provider_verification_jobs_credential_obligation_ix ON public.provider_verification_jobs USING btree (provider_credential_version_id, state) WHERE ((credential_granted_at IS NOT NULL) AND (state = ANY (ARRAY['LEASED'::text, 'VERIFYING'::text])))",
      },
      {
        // R44B11G (0011): the lease-selection order; queue_ix below is retained.
        indexname: "provider_verification_jobs_eligible_queue_ix",
        indexdef:
          "CREATE INDEX provider_verification_jobs_eligible_queue_ix ON public.provider_verification_jobs USING btree (COALESCE(deferred_until, created_at), id) WHERE (state = 'QUEUED'::text)",
      },
      {
        indexname: "provider_verification_jobs_lease_expiry_ix",
        indexdef:
          "CREATE INDEX provider_verification_jobs_lease_expiry_ix ON public.provider_verification_jobs USING btree (lease_expires_at, id) WHERE (state = ANY (ARRAY['LEASED'::text, 'VERIFYING'::text]))",
      },
      {
        indexname: "provider_verification_jobs_one_open_per_version_uq",
        indexdef:
          "CREATE UNIQUE INDEX provider_verification_jobs_one_open_per_version_uq ON public.provider_verification_jobs USING btree (provider_connection_id, provider_credential_version_id) WHERE (state = ANY (ARRAY['QUEUED'::text, 'LEASED'::text, 'VERIFYING'::text]))",
      },
      {
        indexname: "provider_verification_jobs_queue_ix",
        indexdef:
          "CREATE INDEX provider_verification_jobs_queue_ix ON public.provider_verification_jobs USING btree (created_at, id) WHERE (state = 'QUEUED'::text)",
      },
      {
        indexname: "provider_verification_jobs_worker_lease_ix",
        indexdef:
          "CREATE INDEX provider_verification_jobs_worker_lease_ix ON public.provider_verification_jobs USING btree (lease_worker_principal_id, lease_expires_at) WHERE (state = ANY (ARRAY['LEASED'::text, 'VERIFYING'::text]))",
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
        conname: "execution_attempts_input_failed_worker_fk",
        def: "FOREIGN KEY (input_failed_worker_principal_id) REFERENCES worker_principals(id) ON DELETE RESTRICT",
      },
      {
        conname: "execution_attempts_job_same_authorization_fk",
        def: "FOREIGN KEY (account_id, execution_job_id, generation_authorization_id) REFERENCES execution_jobs(account_id, id, generation_authorization_id) ON DELETE RESTRICT",
      },
      { conname: "execution_attempts_lease_worker_fk", def: "FOREIGN KEY (lease_worker_principal_id) REFERENCES worker_principals(id) ON DELETE RESTRICT" },
      { conname: "execution_attempts_number_uq", def: "UNIQUE (execution_job_id, attempt_number)" },
      {
        conname: "execution_attempts_submitting_worker_fk",
        def: "FOREIGN KEY (submitting_worker_principal_id) REFERENCES worker_principals(id) ON DELETE RESTRICT",
      },
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

  it("records submission-authority provenance (0005): a nullable uuid, a restrictive worker FK, the barrier equivalence and the extended guard", async () => {
    const column = await rows<{ data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'execution_attempts' AND column_name = 'submitting_worker_principal_id'`,
    );
    expect(column).toEqual([{ data_type: "uuid", is_nullable: "YES", column_default: null }]);

    const foreignKey = await rows<{ target: string; columns: string; target_columns: string; on_delete: string; on_update: string }>(
      `SELECT c.confrelid::regclass::text AS target,
              (SELECT string_agg(attname, ',') FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = ANY (c.conkey)) AS columns,
              (SELECT string_agg(attname, ',') FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = ANY (c.confkey)) AS target_columns,
              c.confdeltype AS on_delete, c.confupdtype AS on_update
         FROM pg_constraint c WHERE c.conname = 'execution_attempts_submitting_worker_fk' AND c.contype = 'f'`,
    );
    // 'r' = RESTRICT (never cascade, set null or set default); 'a' = NO ACTION on update.
    expect(foreignKey).toEqual([
      { target: "worker_principals", columns: "submitting_worker_principal_id", target_columns: "id", on_delete: "r", on_update: "a" },
    ]);

    const check = await rows<{ def: string; validated: boolean }>(
      "SELECT pg_get_constraintdef(oid) AS def, convalidated AS validated FROM pg_constraint WHERE conname = 'execution_attempts_submitting_worker_ck'",
    );
    expect(check).toEqual([{ def: "CHECK (((submitting_at IS NULL) = (submitting_worker_principal_id IS NULL)))", validated: true }]);

    const guard = await rows<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE proname = 'execution_attempts_guard'");
    expect(guard).toHaveLength(1);
    expect(guard[0]!.src).toContain("NEW.submitting_worker_principal_id := OLD.lease_worker_principal_id;");
    // R44B6K5/R44B6L1: the provider-call authority barrier uses wall-clock time, never transaction-stable now().
    expect(guard[0]!.src).toContain("OLD.lease_expires_at <= clock_timestamp()");
    expect(guard[0]!.src).not.toMatch(/lease_expires_at\s*(<=|>)\s*now\(\)/);
    // R44B6L2: that refusal has a stable identity the submitting service classifies.
    expect(guard[0]!.src).toContain("CONSTRAINT = 'execution_attempts_submitting_lease_unexpired'");
    // The 0004 rules are still present in the replacement.
    for (const rule of [
      "execution attempt provenance is immutable",
      "execution attempt transition % -> % is not allowed",
      "execution attempt submission and output identity are immutable",
      "execution attempt credential grant cannot be replaced",
      "execution attempt failure code changes only with its state",
      "execution attempt fencing generation must increase for every new lease",
      "a SUBMITTING attempt cannot be leased again",
    ]) {
      expect(guard[0]!.src).toContain(rule);
    }

    const version = await rows<{ version: number; name: string }>("SELECT version, name FROM schema_migrations WHERE version = 5");
    expect(version).toEqual([{ version: 5, name: "submission_authority_provenance" }]);
  });

  it("records submission lease-epoch provenance (0006): a nullable bigint like lease_fencing_counter, two checks and the extended guard", async () => {
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'execution_attempts'
          AND column_name IN ('lease_fencing_counter', 'submitting_fencing_counter') ORDER BY column_name`,
    );
    expect(columns).toEqual([
      { column_name: "lease_fencing_counter", data_type: "bigint", is_nullable: "NO", column_default: "0" },
      { column_name: "submitting_fencing_counter", data_type: "bigint", is_nullable: "YES", column_default: null },
    ]);

    const checks = await rows<{ conname: string; def: string; validated: boolean }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated AS validated FROM pg_constraint
        WHERE conname IN ('execution_attempts_submitting_fencing_ck', 'execution_attempts_submitting_epoch_ck') ORDER BY conname`,
    );
    expect(checks).toEqual([
      {
        conname: "execution_attempts_submitting_epoch_ck",
        def: "CHECK (((state <> 'SUBMITTING'::text) OR (lease_fencing_counter = submitting_fencing_counter)))",
        validated: true,
      },
      { conname: "execution_attempts_submitting_fencing_ck", def: "CHECK (((submitting_at IS NULL) = (submitting_fencing_counter IS NULL)))", validated: true },
    ]);

    const guard = await rows<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE proname = 'execution_attempts_guard'");
    expect(guard).toHaveLength(1);
    expect(guard[0]!.src).toContain("NEW.submitting_fencing_counter := OLD.lease_fencing_counter;");
    // The 0005 rules remain, including the wall-clock barrier and its stable refusal identity.
    expect(guard[0]!.src).toContain("NEW.submitting_worker_principal_id := OLD.lease_worker_principal_id;");
    expect(guard[0]!.src).toContain("OLD.lease_expires_at <= clock_timestamp()");
    expect(guard[0]!.src).toContain("CONSTRAINT = 'execution_attempts_submitting_lease_unexpired'");

    const version = await rows<{ version: number; name: string }>("SELECT version, name FROM schema_migrations WHERE version = 6");
    expect(version).toEqual([{ version: 6, name: "submission_lease_epoch_provenance" }]);
  });

  it("records input-failure provenance (0007): a nullable uuid with a restrictive worker FK, a nullable bigint, four checks and the extended guard", async () => {
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'execution_attempts' AND column_name LIKE 'input_failed_%' ORDER BY column_name`,
    );
    expect(columns).toEqual([
      { column_name: "input_failed_fencing_counter", data_type: "bigint", is_nullable: "YES", column_default: null },
      { column_name: "input_failed_worker_principal_id", data_type: "uuid", is_nullable: "YES", column_default: null },
    ]);

    const foreignKey = await rows<{ target: string; columns: string; target_columns: string; on_delete: string; on_update: string }>(
      `SELECT c.confrelid::regclass::text AS target,
              (SELECT string_agg(attname, ',') FROM pg_attribute WHERE attrelid = c.conrelid AND attnum = ANY (c.conkey)) AS columns,
              (SELECT string_agg(attname, ',') FROM pg_attribute WHERE attrelid = c.confrelid AND attnum = ANY (c.confkey)) AS target_columns,
              c.confdeltype AS on_delete, c.confupdtype AS on_update
         FROM pg_constraint c WHERE c.conname = 'execution_attempts_input_failed_worker_fk' AND c.contype = 'f'`,
    );
    expect(foreignKey).toEqual([
      { target: "worker_principals", columns: "input_failed_worker_principal_id", target_columns: "id", on_delete: "r", on_update: "a" },
    ]);

    const checks = await rows<{ conname: string; def: string; validated: boolean }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated AS validated FROM pg_constraint
        WHERE conname LIKE 'execution_attempts_input_failed_%_ck' ORDER BY conname`,
    );
    expect(checks.map(({ conname, validated }) => [conname, validated])).toEqual([
      ["execution_attempts_input_failed_code_ck", true],
      ["execution_attempts_input_failed_epoch_ck", true],
      ["execution_attempts_input_failed_pair_ck", true],
      ["execution_attempts_input_failed_state_ck", true],
    ]);
    const def = (name: string) => checks.find(({ conname }) => conname === name)!.def;
    expect(def("execution_attempts_input_failed_pair_ck")).toBe("CHECK (((input_failed_worker_principal_id IS NULL) = (input_failed_fencing_counter IS NULL)))");
    expect(def("execution_attempts_input_failed_epoch_ck")).toBe("CHECK (((input_failed_fencing_counter IS NULL) OR (input_failed_fencing_counter = lease_fencing_counter)))");
    expect(def("execution_attempts_input_failed_state_ck")).toContain("'FAILED_BEFORE_SUBMISSION'::text");
    expect(def("execution_attempts_input_failed_state_ck")).toContain("submitting_at IS NULL");
    for (const code of ["INPUT_REFERENCE_INVALID", "INPUT_OBJECT_NOT_FOUND", "INPUT_OBJECT_TOO_LARGE", "INPUT_OBJECT_INTEGRITY_MISMATCH", "INPUT_MEDIA_TYPE_INVALID"]) {
      expect(def("execution_attempts_input_failed_code_ck")).toContain(`'${code}'::text`);
    }
    expect(def("execution_attempts_input_failed_code_ck").match(/'INPUT_[A-Z_]+'/g)).toHaveLength(5);

    const guard = await rows<{ src: string }>("SELECT prosrc AS src FROM pg_proc WHERE proname = 'execution_attempts_guard'");
    expect(guard).toHaveLength(1);
    expect(guard[0]!.src).toContain("NEW.input_failed_worker_principal_id := OLD.lease_worker_principal_id;");
    expect(guard[0]!.src).toContain("NEW.input_failed_fencing_counter := OLD.lease_fencing_counter;");
    expect(guard[0]!.src).toContain("execution attempt input-failure provenance is immutable");
    // The 0005 and 0006 rules remain.
    expect(guard[0]!.src).toContain("NEW.submitting_worker_principal_id := OLD.lease_worker_principal_id;");
    expect(guard[0]!.src).toContain("NEW.submitting_fencing_counter := OLD.lease_fencing_counter;");
    expect(guard[0]!.src).toContain("CONSTRAINT = 'execution_attempts_submitting_lease_unexpired'");

    const version = await rows<{ version: number; name: string }>("SELECT version, name FROM schema_migrations WHERE version = 7");
    expect(version).toEqual([{ version: 7, name: "input_failure_provenance" }]);
  });

  it("records the generation usage ledger (0008): four columns, the authorization PK, the composite RESTRICT FK and its guards", async () => {
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'generation_usage_ledger' ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      { column_name: "generation_authorization_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "account_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "production_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "recorded_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "clock_timestamp()" },
    ]);

    const constraints = await rows<{ conname: string; def: string; target_index: string | null; on_update: string | null }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def,
              CASE WHEN contype = 'f' THEN conindid::regclass::text END AS target_index,
              CASE WHEN contype = 'f' THEN confupdtype::text END AS on_update
         FROM pg_constraint WHERE conrelid = 'public.generation_usage_ledger'::regclass ORDER BY conname`,
    );
    expect(constraints).toEqual([
      {
        conname: "generation_usage_ledger_authorization_same_production_fk",
        def: "FOREIGN KEY (account_id, production_id, generation_authorization_id) REFERENCES generation_authorizations(account_id, production_id, id) ON DELETE RESTRICT",
        // Reuses the existing 0003 target; generation_authorizations is not altered.
        target_index: "generation_authorizations_production_scope_uq",
        on_update: "a",
      },
      { conname: "generation_usage_ledger_pk", def: "PRIMARY KEY (generation_authorization_id)", target_index: null, on_update: null },
    ]);

    const triggers = await rows<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgrelid = 'public.generation_usage_ledger'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers).toEqual([
      {
        tgname: "generation_usage_ledger_guard_insert",
        def: "CREATE TRIGGER generation_usage_ledger_guard_insert BEFORE INSERT ON public.generation_usage_ledger FOR EACH ROW EXECUTE FUNCTION generation_usage_ledger_guard_insert()",
      },
      {
        tgname: "generation_usage_ledger_reject_truncate",
        def: "CREATE TRIGGER generation_usage_ledger_reject_truncate BEFORE TRUNCATE ON public.generation_usage_ledger FOR EACH STATEMENT EXECUTE FUNCTION generation_usage_ledger_guard_append_only()",
      },
      {
        tgname: "generation_usage_ledger_reject_update_delete",
        def: "CREATE TRIGGER generation_usage_ledger_reject_update_delete BEFORE DELETE OR UPDATE ON public.generation_usage_ledger FOR EACH ROW EXECUTE FUNCTION generation_usage_ledger_guard_append_only()",
      },
    ]);

    const functions = await rows<{ proname: string; src: string; security_definer: boolean; public_execute: boolean }>(
      `SELECT proname, prosrc AS src, prosecdef AS security_definer, has_function_privilege('public', oid, 'EXECUTE') AS public_execute
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'generation_usage_ledger_%' ORDER BY proname`,
    );
    expect(functions.map(({ proname, security_definer, public_execute }) => ({ proname, security_definer, public_execute }))).toEqual([
      { proname: "generation_usage_ledger_guard_append_only", security_definer: false, public_execute: false },
      { proname: "generation_usage_ledger_guard_insert", security_definer: false, public_execute: false },
    ]);
    const source = (name: string) => functions.find(({ proname }) => proname === name)!.src;
    expect(source("generation_usage_ledger_guard_append_only")).toContain("generation_usage_ledger is append-only: % rejected");
    const insertGuard = source("generation_usage_ledger_guard_insert");
    for (const clause of [
      "id = NEW.generation_authorization_id",
      "account_id = NEW.account_id",
      "production_id = NEW.production_id",
      "status = 'CLAIMED'",
      "claimed_at IS NOT NULL",
      "NEW.recorded_at := clock_timestamp();",
    ]) {
      expect(insertGuard).toContain(clause);
    }
    expect(insertGuard).not.toMatch(/\bnow\(\)|current_timestamp|transaction_timestamp|statement_timestamp/i);

    const version = await rows<{ version: number; name: string }>("SELECT version, name FROM schema_migrations WHERE version = 8");
    expect(version).toEqual([{ version: 8, name: "generation_usage_ledger" }]);
  });

  it("records disconnect terminal usage evidence (0009): four columns and exact constraints", async () => {
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'generation_usage_events' ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      { column_name: "generation_authorization_id", data_type: "uuid", is_nullable: "NO", column_default: null },
      { column_name: "event_type", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "reason_code", data_type: "text", is_nullable: "NO", column_default: null },
      { column_name: "recorded_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "clock_timestamp()" },
    ]);

    const constraints = await rows<{ conname: string; def: string; target_index: string | null; on_update: string | null }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def,
              CASE WHEN contype = 'f' THEN conindid::regclass::text END AS target_index,
              CASE WHEN contype = 'f' THEN confupdtype::text END AS on_update
         FROM pg_constraint WHERE conrelid = 'public.generation_usage_events'::regclass ORDER BY conname`,
    );
    expect(constraints).toEqual([
      {
        conname: "generation_usage_events_event_type_ck",
        def: "CHECK ((event_type = 'CANCELLED_BEFORE_SUBMISSION'::text))",
        target_index: null,
        on_update: null,
      },
      {
        conname: "generation_usage_events_pk",
        def: "PRIMARY KEY (generation_authorization_id, event_type)",
        target_index: null,
        on_update: null,
      },
      {
        conname: "generation_usage_events_reason_code_ck",
        def: "CHECK ((reason_code = 'PROVIDER_CONNECTION_DISCONNECTED'::text))",
        target_index: null,
        on_update: null,
      },
      {
        conname: "generation_usage_events_usage_fk",
        def: "FOREIGN KEY (generation_authorization_id) REFERENCES generation_usage_ledger(generation_authorization_id) ON DELETE RESTRICT",
        target_index: "generation_usage_ledger_pk",
        on_update: "a",
      },
    ]);

    const triggers = await rows<{ tgname: string; def: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def FROM pg_trigger
        WHERE tgrelid = 'public.generation_usage_events'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers).toEqual([
      {
        tgname: "generation_usage_events_guard_insert",
        def: "CREATE TRIGGER generation_usage_events_guard_insert BEFORE INSERT ON public.generation_usage_events FOR EACH ROW EXECUTE FUNCTION generation_usage_events_guard_insert()",
      },
      {
        tgname: "generation_usage_events_reject_truncate",
        def: "CREATE TRIGGER generation_usage_events_reject_truncate BEFORE TRUNCATE ON public.generation_usage_events FOR EACH STATEMENT EXECUTE FUNCTION generation_usage_events_guard_append_only()",
      },
      {
        tgname: "generation_usage_events_reject_update_delete",
        def: "CREATE TRIGGER generation_usage_events_reject_update_delete BEFORE DELETE OR UPDATE ON public.generation_usage_events FOR EACH ROW EXECUTE FUNCTION generation_usage_events_guard_append_only()",
      },
    ]);

    const functions = await rows<{ proname: string; src: string; security_definer: boolean; public_execute: boolean }>(
      `SELECT proname, prosrc AS src, prosecdef AS security_definer, has_function_privilege('public', oid, 'EXECUTE') AS public_execute
         FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'generation_usage_events_%' ORDER BY proname`,
    );
    expect(functions.map(({ proname, security_definer, public_execute }) => ({ proname, security_definer, public_execute }))).toEqual([
      { proname: "generation_usage_events_guard_append_only", security_definer: false, public_execute: false },
      { proname: "generation_usage_events_guard_insert", security_definer: false, public_execute: false },
    ]);
    const source = (name: string) => functions.find(({ proname }) => proname === name)!.src;
    expect(source("generation_usage_events_guard_append_only")).toContain("generation_usage_events is append-only: % rejected");
    const insertGuard = source("generation_usage_events_guard_insert");
    expect(insertGuard).toContain("NEW.recorded_at := clock_timestamp();");
    expect(insertGuard).not.toMatch(/\bnow\(\)|current_timestamp|transaction_timestamp|statement_timestamp/i);

    const version = await rows<{ version: number; name: string }>("SELECT version, name FROM schema_migrations WHERE version >= 9 ORDER BY version");
    expect(version).toEqual([
      { version: 9, name: "provider_connection_disconnect_convergence" },
      { version: 10, name: "provider_connection_verification_workflow" },
      { version: 11, name: "provider_verification_unsupported_deferral" },
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
    // 24 through 0004, plus execution_attempts_submitting_worker_fk (0005),
    // execution_attempts_input_failed_worker_fk (0007),
    // generation_usage_ledger_authorization_same_production_fk (0008),
    // generation_usage_events_usage_fk (0009), and seven restrictive
    // provider_verification_jobs foreign keys (0010).
    expect(actions).toHaveLength(35);
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
        relname: "generation_usage_events",
        tgname: "generation_usage_events_guard_insert",
        def: "CREATE TRIGGER generation_usage_events_guard_insert BEFORE INSERT ON public.generation_usage_events FOR EACH ROW EXECUTE FUNCTION generation_usage_events_guard_insert()",
      },
      {
        relname: "generation_usage_events",
        tgname: "generation_usage_events_reject_truncate",
        def: "CREATE TRIGGER generation_usage_events_reject_truncate BEFORE TRUNCATE ON public.generation_usage_events FOR EACH STATEMENT EXECUTE FUNCTION generation_usage_events_guard_append_only()",
      },
      {
        relname: "generation_usage_events",
        tgname: "generation_usage_events_reject_update_delete",
        def: "CREATE TRIGGER generation_usage_events_reject_update_delete BEFORE DELETE OR UPDATE ON public.generation_usage_events FOR EACH ROW EXECUTE FUNCTION generation_usage_events_guard_append_only()",
      },
      {
        relname: "generation_usage_ledger",
        tgname: "generation_usage_ledger_guard_insert",
        def: "CREATE TRIGGER generation_usage_ledger_guard_insert BEFORE INSERT ON public.generation_usage_ledger FOR EACH ROW EXECUTE FUNCTION generation_usage_ledger_guard_insert()",
      },
      {
        relname: "generation_usage_ledger",
        tgname: "generation_usage_ledger_reject_truncate",
        def: "CREATE TRIGGER generation_usage_ledger_reject_truncate BEFORE TRUNCATE ON public.generation_usage_ledger FOR EACH STATEMENT EXECUTE FUNCTION generation_usage_ledger_guard_append_only()",
      },
      {
        relname: "generation_usage_ledger",
        tgname: "generation_usage_ledger_reject_update_delete",
        def: "CREATE TRIGGER generation_usage_ledger_reject_update_delete BEFORE DELETE OR UPDATE ON public.generation_usage_ledger FOR EACH ROW EXECUTE FUNCTION generation_usage_ledger_guard_append_only()",
      },
      {
        relname: "provider_credential_versions",
        tgname: "provider_credential_versions_guard_update",
        def: "CREATE TRIGGER provider_credential_versions_guard_update BEFORE UPDATE ON public.provider_credential_versions FOR EACH ROW EXECUTE FUNCTION provider_credential_versions_guard_update()",
      },
      {
        relname: "provider_verification_jobs",
        tgname: "provider_verification_jobs_deferral_guard",
        def: "CREATE TRIGGER provider_verification_jobs_deferral_guard BEFORE INSERT OR UPDATE ON public.provider_verification_jobs FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_deferral_guard()",
      },
      {
        relname: "provider_verification_jobs",
        tgname: "provider_verification_jobs_guard",
        def: "CREATE TRIGGER provider_verification_jobs_guard BEFORE INSERT OR UPDATE ON public.provider_verification_jobs FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_guard()",
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
      { proname: "generation_usage_events_guard_append_only", public_execute: false },
      { proname: "generation_usage_events_guard_insert", public_execute: false },
      { proname: "generation_usage_ledger_guard_append_only", public_execute: false },
      { proname: "generation_usage_ledger_guard_insert", public_execute: false },
      { proname: "provider_credential_versions_guard_update", public_execute: false },
      { proname: "provider_verification_jobs_deferral_guard", public_execute: false },
      { proname: "provider_verification_jobs_guard", public_execute: false },
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

  it("records unsupported-verification deferral (0011): three columns, four checks, the eligible-queue index and a second guard beside the unchanged 0010 guard (S6)", async () => {
    const columns = await rows<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'provider_verification_jobs'
          AND column_name IN ('deferred_until', 'unsupported_deferral_count', 'last_unsupported_refusal') ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      { column_name: "deferred_until", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
      { column_name: "unsupported_deferral_count", data_type: "integer", is_nullable: "NO", column_default: "0" },
      { column_name: "last_unsupported_refusal", data_type: "text", is_nullable: "YES", column_default: null },
    ]);
    // Appended after the 0010 columns; no 0010 column is altered or dropped.
    const attributes = await rows<{ attname: string }>(
      `SELECT attname FROM pg_attribute WHERE attrelid = 'public.provider_verification_jobs'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum`,
    );
    expect(attributes.map((row) => row.attname).slice(-4)).toEqual(["updated_at", "deferred_until", "unsupported_deferral_count", "last_unsupported_refusal"]);
    expect(attributes).toHaveLength(26);

    const checks = await rows<{ conname: string; def: string; validated: boolean }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def, convalidated AS validated FROM pg_constraint
        WHERE conname IN ('provider_verification_jobs_unsupported_deferral_count_ck', 'provider_verification_jobs_last_unsupported_refusal_ck',
                          'provider_verification_jobs_unsupported_deferral_presence_ck', 'provider_verification_jobs_deferred_after_creation_ck')
        ORDER BY conname`,
    );
    expect(checks).toEqual([
      {
        conname: "provider_verification_jobs_deferred_after_creation_ck",
        def: "CHECK (((deferred_until IS NULL) OR (deferred_until > created_at)))",
        validated: true,
      },
      {
        conname: "provider_verification_jobs_last_unsupported_refusal_ck",
        def: "CHECK (((last_unsupported_refusal IS NULL) OR (last_unsupported_refusal = ANY (ARRAY['UNSUPPORTED_PROVIDER'::text, 'UNSUPPORTED_POLICY'::text, 'PROVIDER_POLICY_MISMATCH'::text]))))",
        validated: true,
      },
      { conname: "provider_verification_jobs_unsupported_deferral_count_ck", def: "CHECK ((unsupported_deferral_count >= 0))", validated: true },
      {
        conname: "provider_verification_jobs_unsupported_deferral_presence_ck",
        def: "CHECK ((((unsupported_deferral_count = 0) = (last_unsupported_refusal IS NULL)) AND ((unsupported_deferral_count = 0) = (deferred_until IS NULL))))",
        validated: true,
      },
    ]);

    // Two row guards, fired in name order (deferral guard first); neither modifies NEW.
    const triggers = await rows<{ tgname: string; def: string; enabled: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS def, tgenabled::text AS enabled FROM pg_trigger
        WHERE tgrelid = 'public.provider_verification_jobs'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers).toEqual([
      {
        tgname: "provider_verification_jobs_deferral_guard",
        def: "CREATE TRIGGER provider_verification_jobs_deferral_guard BEFORE INSERT OR UPDATE ON public.provider_verification_jobs FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_deferral_guard()",
        enabled: "O",
      },
      {
        tgname: "provider_verification_jobs_guard",
        def: "CREATE TRIGGER provider_verification_jobs_guard BEFORE INSERT OR UPDATE ON public.provider_verification_jobs FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_guard()",
        enabled: "O",
      },
    ]);

    const functions = await rows<{ proname: string; src: string; language: string; security_definer: boolean; public_execute: boolean }>(
      `SELECT p.proname, p.prosrc AS src, l.lanname AS language, p.prosecdef AS security_definer,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'provider_verification_jobs_%' ORDER BY p.proname`,
    );
    expect(functions.map(({ proname, language, security_definer, public_execute }) => ({ proname, language, security_definer, public_execute }))).toEqual([
      { proname: "provider_verification_jobs_deferral_guard", language: "plpgsql", security_definer: false, public_execute: false },
      { proname: "provider_verification_jobs_guard", language: "plpgsql", security_definer: false, public_execute: false },
    ]);
    // pg_proc.prosrc is exactly the text between the dollar quotes of each committed CREATE FUNCTION:
    // the 0010 guard is byte-identical to baseline and the 0011 guard is the committed one.
    const bodyOf = async (file: string, name: string) => {
      const sql = await readFile(join(DEFAULT_MIGRATIONS_DIRECTORY, file), "utf8");
      const start = sql.indexOf(`CREATE FUNCTION ${name}()`);
      expect(start, name).toBeGreaterThanOrEqual(0);
      const open = sql.indexOf("$$", start) + 2;
      return sql.slice(open, sql.indexOf("$$", open));
    };
    const source = (name: string) => functions.find(({ proname }) => proname === name)!.src;
    expect(source("provider_verification_jobs_guard")).toBe(
      await bodyOf("0010_provider_connection_verification_workflow.sql", "provider_verification_jobs_guard"),
    );
    expect(source("provider_verification_jobs_deferral_guard")).toBe(
      await bodyOf("0011_provider_verification_unsupported_deferral.sql", "provider_verification_jobs_deferral_guard"),
    );
    expect(source("provider_verification_jobs_deferral_guard")).not.toMatch(/\bNEW\.\w+\s*:=|clock_timestamp/);

    const version = await rows<{ version: number; name: string }>("SELECT version, name FROM schema_migrations WHERE version = 11");
    expect(version).toEqual([{ version: 11, name: "provider_verification_unsupported_deferral" }]);
  });
});

// R44B11G S2-S7: database enforcement of the unsupported deferral, exercised by
// the table owner (triggers bind every role) inside rolled-back transactions.
// Within one transaction now() is fixed, so the bounds below are exact.
describe("unsupported-verification deferral enforcement (migration 0011)", () => {
  const CHECK_VIOLATION = "23514";
  const SHAPE = /unsupported deferral requires a live ungranted lease, one increment, a refusal and a future deferral/;
  const BOUND = /unsupported deferral exceeds its backoff bound/;
  const CREATED = /created with no unsupported deferral/;
  const CLEAR_LEASE = "lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL";
  const d = (n: number) => (n >= 5 ? 3600 : 300 * 2 ** (n - 1));

  type Connection = Readonly<{ accountId: string; userId: string; connectionId: string; versionId: string; workerId: string }>;
  type Job = Readonly<{ jobId: string; workerId: string }>;

  async function connection(subject: string): Promise<Connection> {
    const q = async (sql: string, params: unknown[]) => (await clients.migrator.query<{ id: string }>(sql, params)).rows[0]!.id;
    const owner = await insertAccountWithFreeGrant(clients.migrator, subject);
    const workerId = await q("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`${subject}-worker`]);
    const connectionId = await q(
      "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, 'EXAMPLE_PROVIDER', 'API_KEY', $2) RETURNING id",
      [owner.accountId, owner.userId],
    );
    const versionId = await q(
      `INSERT INTO provider_credential_versions
         (account_id, provider_connection_id, credential_version, status, sealed_credential,
          fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, 1, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', repeat('a', 43), $3) RETURNING id`,
      [owner.accountId, connectionId, owner.userId],
    );
    return { accountId: owner.accountId, userId: owner.userId, connectionId, versionId, workerId };
  }

  const INSERT_JOB = `INSERT INTO provider_verification_jobs
      (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
    VALUES ($1, $2, $3, 'EXAMPLE_METADATA_V1', $4) RETURNING id`;

  async function job(subject: string): Promise<Job> {
    const c = await connection(subject);
    const inserted = await clients.migrator.query<{ id: string }>(INSERT_JOB, [c.accountId, c.connectionId, c.versionId, c.userId]);
    return { jobId: inserted.rows[0]!.id, workerId: c.workerId };
  }

  // QUEUED -> LEASED exactly as the 0010 guard requires (fence + 1).
  async function lease(target: Job, expires = "now() + interval '30 seconds'", leasedAt = "now()"): Promise<void> {
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = repeat('a', 64),
              lease_fencing_counter = lease_fencing_counter + 1, leased_at = ${leasedAt}, lease_expires_at = ${expires}, updated_at = now()
        WHERE id = $1`,
      [target.jobId, target.workerId],
    );
  }

  function deferral(
    options: Partial<Readonly<{ increment: string; refusal: string; deferredUntil: string; state: string; clearLease: boolean; extra: string }>> = {},
  ): string {
    const {
      increment = "1",
      refusal = "'UNSUPPORTED_PROVIDER'",
      deferredUntil = "now() + interval '300 seconds'",
      state = "'QUEUED'",
      clearLease = true,
      extra = "",
    } = options;
    return `UPDATE provider_verification_jobs
        SET state = ${state}, ${clearLease ? `${CLEAR_LEASE}, ` : ""}${extra}
            unsupported_deferral_count = unsupported_deferral_count + ${increment},
            last_unsupported_refusal = ${refusal}, deferred_until = ${deferredUntil}, updated_at = now()
      WHERE id = $1`;
  }

  async function expectGuardRejection(sql: string, params: readonly unknown[], message: RegExp): Promise<void> {
    await clients.migrator.query("SAVEPOINT deferral_probe");
    let caught: unknown;
    try {
      await clients.migrator.query(sql, params as unknown[]);
    } catch (error) {
      caught = error;
    }
    await clients.migrator.query("ROLLBACK TO SAVEPOINT deferral_probe");
    expect(caught, `expected ${message} from: ${sql}`).toBeInstanceOf(Error);
    expect(caught).toMatchObject({ code: CHECK_VIOLATION });
    expect((caught as Error).message).toMatch(message);
  }

  async function columnsOf(jobId: string) {
    return (
      await clients.migrator.query<{
        state: string;
        fence: string;
        count: number;
        refusal: string | null;
        deferred_until: Date | null;
        offset_seconds: string | null;
      }>(
        `SELECT state, lease_fencing_counter AS fence, unsupported_deferral_count AS count, last_unsupported_refusal AS refusal,
                deferred_until, extract(epoch FROM deferred_until - now())::text AS offset_seconds
           FROM provider_verification_jobs WHERE id = $1`,
        [jobId],
      )
    ).rows[0]!;
  }

  it("S2: each deferral CHECK rejects its own violation (the guard, which rejects these first, disabled for this rolled-back probe)", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const queued = await job("deferral-s2");
      await clients.migrator.query("ALTER TABLE provider_verification_jobs DISABLE TRIGGER provider_verification_jobs_deferral_guard");
      const set = (assignments: string) => `UPDATE provider_verification_jobs SET ${assignments} WHERE id = $1`;
      const later = "deferred_until = now() + interval '1 hour'";

      await expectSqlError(clients.migrator, set(`unsupported_deferral_count = -1, last_unsupported_refusal = 'UNSUPPORTED_PROVIDER', ${later}`), [queued.jobId], {
        code: CHECK_VIOLATION,
        constraint: "provider_verification_jobs_unsupported_deferral_count_ck",
      });
      await expectSqlError(clients.migrator, set(`unsupported_deferral_count = 1, last_unsupported_refusal = 'UNSUPPORTED_MODEL', ${later}`), [queued.jobId], {
        code: CHECK_VIOLATION,
        constraint: "provider_verification_jobs_last_unsupported_refusal_ck",
      });
      for (const assignments of [
        `unsupported_deferral_count = 1, last_unsupported_refusal = NULL, ${later}`,
        "unsupported_deferral_count = 0, last_unsupported_refusal = 'UNSUPPORTED_POLICY', deferred_until = NULL",
        "unsupported_deferral_count = 1, last_unsupported_refusal = 'UNSUPPORTED_POLICY', deferred_until = NULL",
        `unsupported_deferral_count = 0, last_unsupported_refusal = NULL, ${later}`,
      ]) {
        await expectSqlError(clients.migrator, set(assignments), [queued.jobId], {
          code: CHECK_VIOLATION,
          constraint: "provider_verification_jobs_unsupported_deferral_presence_ck",
        });
      }
      await expectSqlError(
        clients.migrator,
        set("unsupported_deferral_count = 1, last_unsupported_refusal = 'PROVIDER_POLICY_MISMATCH', deferred_until = created_at"),
        [queued.jobId],
        { code: CHECK_VIOLATION, constraint: "provider_verification_jobs_deferred_after_creation_ck" },
      );
      // Control: the same shape one microsecond after creation satisfies every CHECK.
      await clients.migrator.query(
        set("unsupported_deferral_count = 1, last_unsupported_refusal = 'PROVIDER_POLICY_MISMATCH', deferred_until = created_at + interval '1 microsecond'"),
        [queued.jobId],
      );
    });
  });

  it("S3: a job is inserted with 0 / NULL / NULL, and any non-default deferral column on INSERT is rejected", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const c = await connection("deferral-s3");
      const insert = (columns: string, values: string) =>
        `INSERT INTO provider_verification_jobs
           (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id, ${columns})
         VALUES ($1, $2, $3, 'EXAMPLE_METADATA_V1', $4, ${values})`;
      const params = [c.accountId, c.connectionId, c.versionId, c.userId];

      await expectGuardRejection(insert("unsupported_deferral_count", "1"), params, CREATED);
      await expectGuardRejection(insert("last_unsupported_refusal", "'UNSUPPORTED_PROVIDER'"), params, CREATED);
      await expectGuardRejection(insert("deferred_until", "now() + interval '1 minute'"), params, CREATED);
      await expectGuardRejection(
        insert("unsupported_deferral_count, last_unsupported_refusal, deferred_until", "1, 'UNSUPPORTED_PROVIDER', now() + interval '1 minute'"),
        params,
        CREATED,
      );

      const inserted = await clients.migrator.query<{ id: string }>(INSERT_JOB, params);
      expect(await columnsOf(inserted.rows[0]!.id)).toMatchObject({ state: "QUEUED", fence: "0", count: 0, refusal: null, deferred_until: null });
    });
  });

  it("S4: accepts the deferral only from a live ungranted lease with one increment, a refusal and now() < x <= now() + d(n); each predicate negated alone is rejected", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const live = await job("deferral-s4-live");
      await lease(live);
      const params = [live.jobId];

      // OLD.state = 'LEASED' negated: a QUEUED job.
      const queued = await job("deferral-s4-queued");
      await expectGuardRejection(deferral(), [queued.jobId], SHAPE);
      // NEW.state = 'QUEUED' negated: the lease is kept.
      await expectGuardRejection(deferral({ state: "'LEASED'", clearLease: false }), params, SHAPE);
      // OLD.credential_granted_at IS NULL negated: a granted lease.
      const granted = await job("deferral-s4-granted");
      await lease(granted);
      await clients.migrator.query("UPDATE provider_verification_jobs SET credential_granted_at = now() WHERE id = $1", [granted.jobId]);
      await expectGuardRejection(deferral(), [granted.jobId], SHAPE);
      // OLD.lease_expires_at > now() negated: a lease ending exactly at transaction start.
      const expired = await job("deferral-s4-expired");
      await lease(expired, "now()", "now() - interval '2 minutes'");
      await expectGuardRejection(deferral(), [expired.jobId], SHAPE);
      // NEW.count = OLD.count + 1 negated: no increment, and two.
      await expectGuardRejection(deferral({ increment: "0" }), params, SHAPE);
      await expectGuardRejection(deferral({ increment: "2" }), params, SHAPE);
      // NEW.last_unsupported_refusal IS NOT NULL negated.
      await expectGuardRejection(deferral({ refusal: "NULL" }), params, SHAPE);
      // NEW.deferred_until > now() negated: now(), the past and NULL.
      await expectGuardRejection(deferral({ deferredUntil: "now()" }), params, SHAPE);
      await expectGuardRejection(deferral({ deferredUntil: "now() - interval '1 second'" }), params, SHAPE);
      await expectGuardRejection(deferral({ deferredUntil: "NULL" }), params, SHAPE);
      // NEW.deferred_until <= now() + d(1) negated by one microsecond.
      await expectGuardRejection(deferral({ deferredUntil: "now() + interval '300 seconds' + interval '1 microsecond'" }), params, BOUND);

      // The bound is inclusive: exactly now() + d(1) is accepted.
      await clients.migrator.query(deferral({ deferredUntil: "now() + interval '300 seconds'" }), params);
      const row = await columnsOf(live.jobId);
      expect(row).toMatchObject({ state: "QUEUED", fence: "1", count: 1, refusal: "UNSUPPORTED_PROVIDER" });
      expect(Number(row.offset_seconds)).toBe(300);
    });
  });

  it("S4/N6: bounds step n by d(n) = 300, 600, 1200, 2400 and then 3600 through n = 50, and accepts any shorter future deferral", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const target = await job("deferral-s4-schedule");
      const refusals = ["'UNSUPPORTED_PROVIDER'", "'UNSUPPORTED_POLICY'", "'PROVIDER_POLICY_MISMATCH'"];

      for (let n = 1; n <= 50; n += 1) {
        await lease(target);
        const refusal = refusals[n % refusals.length]!;
        const bound = `now() + make_interval(secs => ${d(n)})`;
        await expectGuardRejection(deferral({ refusal, deferredUntil: `${bound} + interval '1 microsecond'` }), [target.jobId], BOUND);
        await expectGuardRejection(deferral({ refusal, deferredUntil: "now()" }), [target.jobId], SHAPE);
        // Upper bound only: n = 2 takes a one-second deferral; every other step takes exactly d(n).
        await clients.migrator.query(deferral({ refusal, deferredUntil: n === 2 ? "now() + interval '1 second'" : bound }), [target.jobId]);

        const row = await columnsOf(target.jobId);
        expect(row).toMatchObject({ state: "QUEUED", fence: String(n), count: n, refusal: refusal.slice(1, -1) });
        expect(Number(row.offset_seconds), `n = ${n}`).toBe(n === 2 ? 1 : d(n));
      }
      expect([1, 2, 3, 4, 5, 6, 7, 50].map(d)).toEqual([300, 600, 1200, 2400, 3600, 3600, 3600, 3600]);
    });
  });

  it("S5/N4: no other transition changes the deferral columns, none can make a job terminal, and requeue, lease and cancellation preserve them", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const target = await job("deferral-s5");
      await lease(target);
      await clients.migrator.query(deferral({ refusal: "'UNSUPPORTED_POLICY'" }), [target.jobId]);
      const deferred = await columnsOf(target.jobId);
      const kept = { count: 1, refusal: "UNSUPPORTED_POLICY", deferred_until: deferred.deferred_until };
      const set = (assignments: string) => `UPDATE provider_verification_jobs SET ${assignments}, updated_at = now() WHERE id = $1`;

      // QUEUED: no column may be edited, reset or cleared outside a deferral.
      for (const assignments of [
        "deferred_until = now() + interval '1 second'",
        "deferred_until = NULL, unsupported_deferral_count = 0, last_unsupported_refusal = NULL",
        "last_unsupported_refusal = 'PROVIDER_POLICY_MISMATCH'",
        "unsupported_deferral_count = unsupported_deferral_count + 1, deferred_until = now() + interval '1 second'",
      ]) {
        await expectGuardRejection(set(assignments), [target.jobId], SHAPE);
      }
      // A lease that also touches the columns is rejected; a plain lease keeps them.
      await expectGuardRejection(
        `UPDATE provider_verification_jobs
            SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = repeat('a', 64), lease_fencing_counter = lease_fencing_counter + 1,
                leased_at = now(), lease_expires_at = now() + interval '30 seconds', deferred_until = NULL, updated_at = now()
          WHERE id = $1`,
        [target.jobId, target.workerId],
        SHAPE,
      );
      await lease(target);
      expect(await columnsOf(target.jobId)).toMatchObject({ state: "LEASED", fence: "2", ...kept });

      // Worker-loss style completion and lifecycle cancellation from LEASED may not carry a deferral change.
      await expectGuardRejection(set(`state = 'CANCELLED', ${CLEAR_LEASE}, terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE', completed_at = now(), deferred_until = NULL, unsupported_deferral_count = 0, last_unsupported_refusal = NULL`), [target.jobId], SHAPE);
      await expectGuardRejection(set(`state = 'CANCELLED', ${CLEAR_LEASE}, terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE', completed_at = now(), unsupported_deferral_count = unsupported_deferral_count + 1, last_unsupported_refusal = 'UNSUPPORTED_PROVIDER', deferred_until = now() + interval '300 seconds'`), [target.jobId], SHAPE);
      // Natural-expiry style requeue (no deferral column written) keeps the columns.
      await clients.migrator.query(set(`state = 'QUEUED', ${CLEAR_LEASE}`), [target.jobId]);
      expect(await columnsOf(target.jobId)).toMatchObject({ state: "QUEUED", fence: "2", ...kept });

      // A granted lease may not change the columns on its way to VERIFYING, and may not be deferred.
      await lease(target);
      await clients.migrator.query(set("credential_granted_at = now()"), [target.jobId]);
      await expectGuardRejection(deferral(), [target.jobId], SHAPE);
      await expectGuardRejection(
        set(`state = 'VERIFYING', verifying_at = now(), verifying_worker_principal_id = '${target.workerId}', verifying_fencing_counter = 3, deferred_until = NULL`),
        [target.jobId],
        SHAPE,
      );
      await clients.migrator.query(
        set(`state = 'VERIFYING', verifying_at = now(), verifying_worker_principal_id = '${target.workerId}', verifying_fencing_counter = 3`),
        [target.jobId],
      );
      await expectGuardRejection(
        set(`state = 'COMPLETED', ${CLEAR_LEASE}, result_outcome = 'VERIFIED', terminal_reason_code = 'CREDENTIAL_ACCEPTED',
             result_worker_principal_id = '${target.workerId}', result_fencing_counter = 3, completed_at = now(), unsupported_deferral_count = 0,
             last_unsupported_refusal = NULL, deferred_until = NULL`),
        [target.jobId],
        SHAPE,
      );
      await clients.migrator.query(
        set(`state = 'COMPLETED', ${CLEAR_LEASE}, result_outcome = 'VERIFIED', terminal_reason_code = 'CREDENTIAL_ACCEPTED',
             result_worker_principal_id = '${target.workerId}', result_fencing_counter = 3, completed_at = now()`),
        [target.jobId],
      );
      // N2 at the schema level: the deferral columns persist on the COMPLETED row, which is then immutable.
      expect(await columnsOf(target.jobId)).toMatchObject({ state: "COMPLETED", fence: "3", ...kept });
      for (const assignments of ["deferred_until = NULL", "unsupported_deferral_count = 0", "last_unsupported_refusal = 'UNSUPPORTED_PROVIDER'"]) {
        await expectSqlError(clients.migrator, set(assignments), [target.jobId], { code: CHECK_VIOLATION });
      }

      // N3 at the schema level: lifecycle cancellation of a deferred QUEUED job preserves the columns; the terminal row is immutable.
      const cancelled = await job("deferral-s5-cancelled");
      await lease(cancelled);
      await clients.migrator.query(deferral({ refusal: "'PROVIDER_POLICY_MISMATCH'" }), [cancelled.jobId]);
      const before = await columnsOf(cancelled.jobId);
      await clients.migrator.query(
        set("state = 'CANCELLED', terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE', completed_at = now()"),
        [cancelled.jobId],
      );
      expect(await columnsOf(cancelled.jobId)).toMatchObject({
        state: "CANCELLED",
        count: 1,
        refusal: "PROVIDER_POLICY_MISMATCH",
        deferred_until: before.deferred_until,
      });
      await expectSqlError(clients.migrator, set("deferred_until = NULL"), [cancelled.jobId], { code: CHECK_VIOLATION });
    });
  });

  it("S7: a deferral leaves the fencing counter unchanged and cannot change it", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const target = await job("deferral-s7");
      await lease(target);
      expect((await columnsOf(target.jobId)).fence).toBe("1");

      // The deferral shape is valid, but the 0010 fence rule refuses any fence change outside QUEUED -> LEASED.
      await expectSqlError(clients.migrator, deferral({ extra: "lease_fencing_counter = lease_fencing_counter + 1," }), [target.jobId], {
        code: CHECK_VIOLATION,
      });
      await clients.migrator.query(deferral(), [target.jobId]);
      expect(await columnsOf(target.jobId)).toMatchObject({ state: "QUEUED", fence: "1", count: 1 });
    });
  });
});
