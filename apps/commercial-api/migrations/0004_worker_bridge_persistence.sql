-- 0004 worker bridge persistence
--
-- Authority: docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
-- (sections 9-15, 17, 20-24 and 26-27).
--
-- Persistence foundation for the future outbound commercial worker: machine
-- principals, one execution job per generation authorization, and provider
-- submission attempts with lease and fencing state. No worker authentication
-- mechanism, route, lease service, credential grant, opener, journal, object
-- storage or provider call exists. The worker never connects to PostgreSQL:
-- no worker database role is created; the commercial API is its only path.
-- Provider-neutral: provider identifiers are shape-checked only.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

-- Composite-FK targets so an attempt can prove that its billing mode,
-- provider and exact credential version are those of its authorization.
-- Every referenced column is immutable on generation_authorizations.
ALTER TABLE generation_authorizations
  ADD CONSTRAINT generation_authorizations_execution_scope_uq UNIQUE (account_id, id, billing_mode, provider);
ALTER TABLE generation_authorizations
  ADD CONSTRAINT generation_authorizations_credential_scope_uq UNIQUE (account_id, id, provider_credential_version_id);

-- worker_principals: a machine identity for the private worker, never a
-- customer. Authentication material is deliberately absent: the mechanism
-- (signed token, mTLS, workload identity) is undecided and its binding is a
-- later migration. Principals are provisioned by operators, not by the API.
CREATE TABLE worker_principals (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  label        text        NOT NULL,
  status       text        NOT NULL DEFAULT 'ACTIVE',
  disabled_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT worker_principals_pk PRIMARY KEY (id),
  CONSTRAINT worker_principals_label_ck CHECK (char_length(label) BETWEEN 1 AND 100 AND label !~ '^\s' AND label !~ '\s$'),
  CONSTRAINT worker_principals_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT worker_principals_disabled_ck CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);

-- execution_jobs: one logical commercial generation job per authorization.
-- Retries are attempts, never further jobs. status is coarse commercial
-- progress; provider submission state belongs to attempts.
CREATE TABLE execution_jobs (
  id                           uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                   uuid        NOT NULL,
  production_id                uuid        NOT NULL,
  generation_authorization_id  uuid        NOT NULL,
  status                       text        NOT NULL DEFAULT 'QUEUED',
  completed_at                 timestamptz NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_jobs_pk PRIMARY KEY (id),
  CONSTRAINT execution_jobs_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  -- Same account, same production, exactly that authorization.
  CONSTRAINT execution_jobs_authorization_same_production_fk
    FOREIGN KEY (account_id, production_id, generation_authorization_id)
    REFERENCES generation_authorizations (account_id, production_id, id) ON DELETE RESTRICT,
  CONSTRAINT execution_jobs_authorization_uq UNIQUE (generation_authorization_id),
  -- Composite-FK target so an attempt inherits exactly its job's authorization.
  CONSTRAINT execution_jobs_attempt_scope_uq UNIQUE (account_id, id, generation_authorization_id),
  CONSTRAINT execution_jobs_status_ck
    CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED')),
  CONSTRAINT execution_jobs_completed_at_ck
    CHECK ((status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (completed_at IS NOT NULL))
);

CREATE INDEX execution_jobs_production_list_ix
  ON execution_jobs (account_id, production_id, created_at DESC, id);

-- execution_attempts: one provider-submission attempt of a job.
--
-- States (worker bridge architecture section 14):
--   QUEUED -> LEASED -> SUBMITTING -> SUBMITTED -> SUCCEEDED, plus
--   FAILED_BEFORE_SUBMISSION, OUTCOME_UNKNOWN, SUBMITTED_FAILED, ABANDONED
--   and CANCELLED. RECOVERING is activity on SUBMITTED, not a state.
--
-- Lease columns describe the CURRENT lease only and are cleared when it ends.
-- The lease token is never stored: lease_token_sha256 is its verifier.
--
-- Obligations are derived, never stored (section 23). For a credential
-- version V:
--   credential retention open  := EXISTS attempt on V WITH
--       (state = 'LEASED' AND credential_granted_at IS NOT NULL)
--       OR state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN')
--   provider recovery open     := EXISTS attempt on V WITH
--       state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN')
-- Terminal states close both: SUCCEEDED requires secured output metadata,
-- and ABANDONED is an explicit decision, never the mere passing of
-- recovery_expires_at, a lease expiry or a disconnect.
CREATE TABLE execution_attempts (
  id                              uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                      uuid        NOT NULL,
  execution_job_id                uuid        NOT NULL,
  generation_authorization_id     uuid        NOT NULL,
  attempt_number                  integer     NOT NULL,
  state                           text        NOT NULL DEFAULT 'QUEUED',
  billing_mode                    text        NOT NULL,
  provider                        text        NOT NULL,
  provider_credential_version_id  uuid        NULL,
  -- Current lease.
  lease_worker_principal_id       uuid        NULL,
  lease_token_sha256              text        NULL,
  lease_fencing_counter           bigint      NOT NULL DEFAULT 0,
  leased_at                       timestamptz NULL,
  lease_expires_at                timestamptz NULL,
  heartbeat_at                    timestamptz NULL,
  -- Credential retention opens here (section 23).
  credential_granted_at           timestamptz NULL,
  -- The durable SUBMITTING barrier; provider recovery opens here.
  submitting_at                   timestamptz NULL,
  provider_execution_id           text        NULL,
  submitted_at                    timestamptz NULL,
  -- Provider-policy recovery deadline; informs abandonment, never closes an
  -- obligation by itself.
  recovery_expires_at             timestamptz NULL,
  failure_code                    text        NULL,
  -- Storage-neutral output identity, recorded once output is secured.
  output_object_key               text        NULL,
  output_sha256                   text        NULL,
  output_byte_count               bigint      NULL,
  output_content_type             text        NULL,
  completed_at                    timestamptz NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT execution_attempts_pk PRIMARY KEY (id),
  CONSTRAINT execution_attempts_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  -- Same account and exactly the job's authorization.
  CONSTRAINT execution_attempts_job_same_authorization_fk
    FOREIGN KEY (account_id, execution_job_id, generation_authorization_id)
    REFERENCES execution_jobs (account_id, id, generation_authorization_id) ON DELETE RESTRICT,
  -- The authorization's billing mode and provider. All columns NOT NULL, so
  -- always checked.
  CONSTRAINT execution_attempts_authorization_provider_fk
    FOREIGN KEY (account_id, generation_authorization_id, billing_mode, provider)
    REFERENCES generation_authorizations (account_id, id, billing_mode, provider) ON DELETE RESTRICT,
  -- The authorization's exact credential version (whose own foreign keys prove
  -- same account and same connection). MATCH SIMPLE skips this only when the
  -- version is NULL, which the binding check permits only for PLATFORM_HOSTED,
  -- whose authorization also has no user credential.
  CONSTRAINT execution_attempts_authorization_credential_fk
    FOREIGN KEY (account_id, generation_authorization_id, provider_credential_version_id)
    REFERENCES generation_authorizations (account_id, id, provider_credential_version_id) ON DELETE RESTRICT,
  CONSTRAINT execution_attempts_lease_worker_fk
    FOREIGN KEY (lease_worker_principal_id) REFERENCES worker_principals (id) ON DELETE RESTRICT,
  CONSTRAINT execution_attempts_number_uq UNIQUE (execution_job_id, attempt_number),
  CONSTRAINT execution_attempts_account_scope_uq UNIQUE (account_id, id),
  CONSTRAINT execution_attempts_number_ck CHECK (attempt_number >= 1),
  CONSTRAINT execution_attempts_state_ck
    CHECK (state IN ('QUEUED', 'LEASED', 'SUBMITTING', 'SUBMITTED', 'SUCCEEDED', 'FAILED_BEFORE_SUBMISSION',
                     'OUTCOME_UNKNOWN', 'SUBMITTED_FAILED', 'ABANDONED', 'CANCELLED')),
  CONSTRAINT execution_attempts_billing_mode_ck CHECK (billing_mode IN ('USER_BYO', 'PLATFORM_HOSTED')),
  CONSTRAINT execution_attempts_credential_binding_ck
    CHECK ((billing_mode = 'USER_BYO') = (provider_credential_version_id IS NOT NULL)),
  CONSTRAINT execution_attempts_provider_ck CHECK (provider ~ '^[A-Z][A-Z0-9_]{0,31}$'),

  -- Lease: all current-lease fields together or none.
  CONSTRAINT execution_attempts_lease_complete_ck
    CHECK (
      (lease_worker_principal_id IS NULL AND lease_token_sha256 IS NULL AND leased_at IS NULL
         AND lease_expires_at IS NULL AND heartbeat_at IS NULL)
      OR (lease_worker_principal_id IS NOT NULL AND lease_token_sha256 IS NOT NULL AND leased_at IS NOT NULL
            AND lease_expires_at IS NOT NULL)
    ),
  -- A lease is required while leased or submitting, optional on SUBMITTED
  -- (recovery), and absent everywhere else.
  CONSTRAINT execution_attempts_lease_state_ck
    CHECK (
      CASE
        WHEN state IN ('LEASED', 'SUBMITTING') THEN lease_worker_principal_id IS NOT NULL
        WHEN state = 'SUBMITTED' THEN true
        ELSE lease_worker_principal_id IS NULL
      END
    ),
  CONSTRAINT execution_attempts_lease_token_sha256_ck
    CHECK (lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[0-9a-f]{64}$'),
  -- Never negative, never beyond the JavaScript safe-integer range (no
  -- wraparound), and at least one generation whenever a lease exists.
  CONSTRAINT execution_attempts_fencing_counter_ck
    CHECK (lease_fencing_counter BETWEEN 0 AND 9007199254740991
           AND (lease_worker_principal_id IS NULL OR lease_fencing_counter >= 1)),
  CONSTRAINT execution_attempts_lease_times_ck
    CHECK (lease_expires_at IS NULL OR lease_expires_at > leased_at),
  CONSTRAINT execution_attempts_heartbeat_ck
    CHECK (heartbeat_at IS NULL OR heartbeat_at >= leased_at),

  -- A credential is granted only under a lease, and every submission had one.
  CONSTRAINT execution_attempts_credential_granted_ck
    CHECK (
      CASE
        WHEN state = 'QUEUED' THEN credential_granted_at IS NULL
        WHEN state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN', 'SUCCEEDED', 'SUBMITTED_FAILED', 'ABANDONED')
          THEN credential_granted_at IS NOT NULL
        ELSE true
      END
    ),
  -- The SUBMITTING barrier exists for every state at or after SUBMITTING.
  -- FAILED_BEFORE_SUBMISSION keeps it for an unambiguous, definitive provider
  -- rejection of the create (sections 14 and 27): the barrier was crossed and
  -- history is preserved. Ambiguous outcomes are OUTCOME_UNKNOWN instead.
  CONSTRAINT execution_attempts_submitting_at_ck
    CHECK (
      CASE
        WHEN state IN ('QUEUED', 'LEASED', 'CANCELLED') THEN submitting_at IS NULL
        WHEN state = 'FAILED_BEFORE_SUBMISSION' THEN true
        ELSE submitting_at IS NOT NULL
      END
    ),
  CONSTRAINT execution_attempts_submitting_after_grant_ck
    CHECK (submitting_at IS NULL OR submitting_at >= credential_granted_at),
  -- Provider identity is known for SUBMITTED and its outcomes, unknown for
  -- OUTCOME_UNKNOWN, and either for ABANDONED (from SUBMITTED or unknown).
  CONSTRAINT execution_attempts_provider_execution_state_ck
    CHECK (
      CASE
        WHEN state IN ('SUBMITTED', 'SUCCEEDED', 'SUBMITTED_FAILED') THEN provider_execution_id IS NOT NULL
        WHEN state = 'ABANDONED' THEN true
        ELSE provider_execution_id IS NULL
      END
    ),
  CONSTRAINT execution_attempts_submitted_at_ck
    CHECK ((provider_execution_id IS NULL) = (submitted_at IS NULL) AND (submitted_at IS NULL OR submitted_at >= submitting_at)),
  -- Bounded visible ASCII; never a URL. (PostgreSQL regular expressions cap
  -- repetition counts at 255, so the length bound is a separate test.)
  CONSTRAINT execution_attempts_provider_execution_id_ck
    CHECK (
      provider_execution_id IS NULL OR (
        char_length(provider_execution_id) BETWEEN 1 AND 256
        AND provider_execution_id ~ '^[\x21-\x7e]+$'
        AND strpos(provider_execution_id, '://') = 0
      )
    ),
  CONSTRAINT execution_attempts_recovery_expires_at_ck
    CHECK (recovery_expires_at IS NULL OR (submitting_at IS NOT NULL AND recovery_expires_at > submitting_at)),

  -- A closed internal code, required exactly where a failure is recorded
  -- (optional reason for CANCELLED).
  CONSTRAINT execution_attempts_failure_code_ck
    CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT execution_attempts_failure_state_ck
    CHECK (
      CASE
        WHEN state IN ('FAILED_BEFORE_SUBMISSION', 'OUTCOME_UNKNOWN', 'SUBMITTED_FAILED', 'ABANDONED') THEN failure_code IS NOT NULL
        WHEN state = 'CANCELLED' THEN true
        ELSE failure_code IS NULL
      END
    ),

  -- Output: complete exactly when SUCCEEDED.
  CONSTRAINT execution_attempts_output_state_ck
    CHECK (
      CASE WHEN state = 'SUCCEEDED'
        THEN output_object_key IS NOT NULL AND output_sha256 IS NOT NULL AND output_byte_count IS NOT NULL AND output_content_type IS NOT NULL
        ELSE output_object_key IS NULL AND output_sha256 IS NULL AND output_byte_count IS NULL AND output_content_type IS NULL
      END
    ),
  -- A relative, storage-neutral key: no scheme, drive letter, leading slash,
  -- backslash, whitespace, query string, empty or dot segment.
  CONSTRAINT execution_attempts_output_object_key_ck
    CHECK (
      output_object_key IS NULL OR (
        char_length(output_object_key) BETWEEN 1 AND 512
        AND output_object_key ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
        AND output_object_key !~ '//'
        AND output_object_key !~ '(^|/)\.\.?(/|$)'
        AND output_object_key !~ '/$'
      )
    ),
  CONSTRAINT execution_attempts_output_sha256_ck CHECK (output_sha256 IS NULL OR output_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT execution_attempts_output_byte_count_ck
    CHECK (output_byte_count IS NULL OR output_byte_count BETWEEN 1 AND 9007199254740991),
  CONSTRAINT execution_attempts_output_content_type_ck
    CHECK (output_content_type IS NULL OR output_content_type ~ '^[a-z0-9][a-z0-9.+-]{0,62}/[a-z0-9][a-z0-9.+-]{0,62}$'),

  CONSTRAINT execution_attempts_completed_at_ck
    CHECK ((state IN ('SUCCEEDED', 'FAILED_BEFORE_SUBMISSION', 'SUBMITTED_FAILED', 'ABANDONED', 'CANCELLED'))
           = (completed_at IS NOT NULL))
);

-- At most one non-terminal attempt per job: never two concurrent paid
-- attempts for the same authorization.
CREATE UNIQUE INDEX execution_attempts_one_open_per_job_uq
  ON execution_attempts (execution_job_id)
  WHERE state IN ('QUEUED', 'LEASED', 'SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN');

-- Within one Account, one provider execution is adopted by at most one
-- attempt, in any state. Global uniqueness across independent customer
-- provider accounts or projects is not assumed: identical opaque identifiers
-- in different Accounts are permitted.
CREATE UNIQUE INDEX execution_attempts_provider_execution_uq
  ON execution_attempts (account_id, provider, provider_execution_id)
  WHERE provider_execution_id IS NOT NULL;

-- Lease queue for FOR UPDATE SKIP LOCKED acquisition.
CREATE INDEX execution_attempts_queue_ix
  ON execution_attempts (created_at, id)
  WHERE state = 'QUEUED';

-- Lease-expiry sweeps.
CREATE INDEX execution_attempts_lease_expiry_ix
  ON execution_attempts (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

-- Obligation lookups by credential version (the future disconnect gate).
CREATE INDEX execution_attempts_credential_version_ix
  ON execution_attempts (provider_credential_version_id, state)
  WHERE provider_credential_version_id IS NOT NULL;

CREATE INDEX execution_attempts_job_ix
  ON execution_attempts (account_id, execution_job_id, attempt_number);

-- Jobs and attempts are created only in their initial state; every later
-- state is reached through the guarded transitions below.
CREATE FUNCTION execution_jobs_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'QUEUED' THEN
      RAISE EXCEPTION 'execution jobs are created QUEUED'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.production_id IS DISTINCT FROM OLD.production_id
     OR NEW.generation_authorization_id IS DISTINCT FROM OLD.generation_authorization_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'execution job provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status IN ('SUCCEEDED', 'FAILED', 'CANCELLED')
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at) THEN
    RAISE EXCEPTION 'execution job lifecycle is terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION execution_jobs_guard() FROM PUBLIC;

CREATE TRIGGER execution_jobs_guard
  BEFORE INSERT OR UPDATE ON execution_jobs
  FOR EACH ROW EXECUTE FUNCTION execution_jobs_guard();

-- Allowed attempt transitions (section 14, 12 and 27):
--   QUEUED          -> LEASED | CANCELLED
--   LEASED          -> QUEUED (lease ended, no provider call)
--                    | SUBMITTING | FAILED_BEFORE_SUBMISSION | CANCELLED
--   SUBMITTING      -> SUBMITTED | OUTCOME_UNKNOWN
--                    | FAILED_BEFORE_SUBMISSION (unambiguous, definitive
--                      provider rejection; never for an ambiguous outcome)
--   SUBMITTED       -> SUCCEEDED | SUBMITTED_FAILED | ABANDONED
--   OUTCOME_UNKNOWN -> SUBMITTED (provider identity later proven) | ABANDONED
-- Terminal states never change. Nothing returns to a submission-capable
-- state after SUBMITTING. Provenance, the barrier, the provider identity and
-- secured output never change once recorded; the fencing counter never
-- decreases and every new lease token takes a higher generation.
CREATE FUNCTION execution_attempts_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'QUEUED' OR NEW.lease_fencing_counter <> 0 THEN
      RAISE EXCEPTION 'execution attempts are created QUEUED with fencing generation 0'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.execution_job_id IS DISTINCT FROM OLD.execution_job_id
     OR NEW.generation_authorization_id IS DISTINCT FROM OLD.generation_authorization_id
     OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
     OR NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_credential_version_id IS DISTINCT FROM OLD.provider_credential_version_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'execution attempt provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'QUEUED' AND NEW.state IN ('LEASED', 'CANCELLED'))
    OR (OLD.state = 'LEASED' AND NEW.state IN ('QUEUED', 'SUBMITTING', 'FAILED_BEFORE_SUBMISSION', 'CANCELLED'))
    OR (OLD.state = 'SUBMITTING' AND NEW.state IN ('SUBMITTED', 'OUTCOME_UNKNOWN', 'FAILED_BEFORE_SUBMISSION'))
    OR (OLD.state = 'SUBMITTED' AND NEW.state IN ('SUCCEEDED', 'SUBMITTED_FAILED', 'ABANDONED'))
    OR (OLD.state = 'OUTCOME_UNKNOWN' AND NEW.state IN ('SUBMITTED', 'ABANDONED'))
  ) THEN
    RAISE EXCEPTION 'execution attempt transition % -> % is not allowed', OLD.state, NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.submitting_at IS NOT NULL AND NEW.submitting_at IS DISTINCT FROM OLD.submitting_at)
     OR (OLD.provider_execution_id IS NOT NULL AND NEW.provider_execution_id IS DISTINCT FROM OLD.provider_execution_id)
     OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
     OR (OLD.recovery_expires_at IS NOT NULL AND NEW.recovery_expires_at IS DISTINCT FROM OLD.recovery_expires_at)
     OR (OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at)
     OR (OLD.output_object_key IS NOT NULL AND NEW.output_object_key IS DISTINCT FROM OLD.output_object_key)
     OR (OLD.output_sha256 IS NOT NULL AND NEW.output_sha256 IS DISTINCT FROM OLD.output_sha256)
     OR (OLD.output_byte_count IS NOT NULL AND NEW.output_byte_count IS DISTINCT FROM OLD.output_byte_count)
     OR (OLD.output_content_type IS NOT NULL AND NEW.output_content_type IS DISTINCT FROM OLD.output_content_type) THEN
    RAISE EXCEPTION 'execution attempt submission and output identity are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- A grant belongs to the current pre-submission lease: it is cleared only
  -- when that lease ends without a provider call (LEASED -> QUEUED), and is
  -- otherwise never replaced.
  IF OLD.credential_granted_at IS NOT NULL
     AND NEW.credential_granted_at IS DISTINCT FROM OLD.credential_granted_at
     AND NOT (OLD.state = 'LEASED' AND NEW.state = 'QUEUED' AND NEW.credential_granted_at IS NULL) THEN
    RAISE EXCEPTION 'execution attempt credential grant cannot be replaced'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.failure_code IS DISTINCT FROM OLD.failure_code AND NEW.state = OLD.state THEN
    RAISE EXCEPTION 'execution attempt failure code changes only with its state'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.lease_fencing_counter < OLD.lease_fencing_counter
     OR (NEW.lease_token_sha256 IS NOT NULL
         AND NEW.lease_token_sha256 IS DISTINCT FROM OLD.lease_token_sha256
         AND NEW.lease_fencing_counter <= OLD.lease_fencing_counter) THEN
    RAISE EXCEPTION 'execution attempt fencing generation must increase for every new lease'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Once SUBMITTING, no new worker may take over the in-flight submission.
  IF OLD.state = 'SUBMITTING' AND NEW.state = 'SUBMITTING'
     AND (NEW.lease_token_sha256 IS DISTINCT FROM OLD.lease_token_sha256
          OR NEW.lease_worker_principal_id IS DISTINCT FROM OLD.lease_worker_principal_id) THEN
    RAISE EXCEPTION 'a SUBMITTING attempt cannot be leased again'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION execution_attempts_guard() FROM PUBLIC;

CREATE TRIGGER execution_attempts_guard
  BEFORE INSERT OR UPDATE ON execution_attempts
  FOR EACH ROW EXECUTE FUNCTION execution_attempts_guard();

-- Machine principals are disabled, never re-enabled or renamed in place.
CREATE FUNCTION worker_principals_guard_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.label IS DISTINCT FROM OLD.label THEN
    RAISE EXCEPTION 'worker principal identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'DISABLED'
     AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at) THEN
    RAISE EXCEPTION 'a disabled worker principal cannot be re-enabled'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION worker_principals_guard_update() FROM PUBLIC;

CREATE TRIGGER worker_principals_guard_update
  BEFORE UPDATE ON worker_principals
  FOR EACH ROW EXECUTE FUNCTION worker_principals_guard_update();

-- Audit events may now record job, attempt and worker-principal events. The
-- constraint keeps its name; existing resource types are unchanged.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_resource_type_ck;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_resource_type_ck
  CHECK (resource_type IN ('user', 'account', 'entitlement_grant', 'production', 'provider_connection',
                           'generation_authorization', 'execution_job', 'execution_attempt', 'worker_principal'));
