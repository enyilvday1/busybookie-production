-- Commercial schema 0007: pre-provider input-failure provenance.
--
-- Records which worker principal and which lease epoch (fencing generation)
-- reported a permanent pre-provider input failure
-- (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
-- "input-failed route", revision R44B10P2). That report moves a granted
-- LEASED attempt to FAILED_BEFORE_SUBMISSION without crossing SUBMITTING, and
-- clears the lease, so no reporter identity would otherwise survive for an
-- exact idempotent replay. No lease-token verifier is kept: once the lease is
-- cleared the token is never replay authority (as for submission-failed).
--
-- Like the submitting provenance of migrations 0005 and 0006, both values are
-- derived by the database from the authoritative lease on the first LEASED ->
-- FAILED_BEFORE_SUBMISSION, never chosen by application code; the runtime role
-- receives no UPDATE privilege on them. The counter has the SQL type of
-- lease_fencing_counter.
--
-- Additive only: no table, role, grant, secret or provider-specific column.

ALTER TABLE execution_attempts
  ADD COLUMN input_failed_worker_principal_id uuid NULL;

ALTER TABLE execution_attempts
  ADD COLUMN input_failed_fencing_counter bigint NULL;

ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_input_failed_worker_fk
    FOREIGN KEY (input_failed_worker_principal_id) REFERENCES worker_principals (id) ON DELETE RESTRICT;

-- No backfill. Before this migration no route moves LEASED ->
-- FAILED_BEFORE_SUBMISSION, so any such row (FAILED_BEFORE_SUBMISSION with no
-- SUBMITTING barrier) has no provable reporter or epoch. Any such row aborts
-- the whole migration; nothing is inferred from the failure code, timestamps,
-- the retained counter or audit metadata. An operator resolves such rows first.
DO $$
DECLARE
  unprovable bigint;
BEGIN
  SELECT count(*) INTO unprovable
    FROM execution_attempts
   WHERE state = 'FAILED_BEFORE_SUBMISSION' AND submitting_at IS NULL;
  IF unprovable > 0 THEN
    RAISE EXCEPTION 'migration 0007: % execution attempt(s) failed before submission without crossing SUBMITTING and without provable input-failure provenance', unprovable
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- The reporter and its lease epoch exist together.
ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_input_failed_pair_ck
    CHECK ((input_failed_worker_principal_id IS NULL) = (input_failed_fencing_counter IS NULL));

-- Exactly the pre-provider input failures carry it: FAILED_BEFORE_SUBMISSION
-- with no SUBMITTING barrier. A provider-caused FAILED_BEFORE_SUBMISSION
-- (submitting_at set) never does, so the two producers stay distinct.
ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_input_failed_state_ck
    CHECK ((input_failed_worker_principal_id IS NOT NULL) = (state = 'FAILED_BEFORE_SUBMISSION' AND submitting_at IS NULL));

-- The five closed input-failure codes appear exactly on those rows.
ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_input_failed_code_ck
    CHECK (
      (input_failed_worker_principal_id IS NOT NULL) = (
        failure_code IS NOT NULL
        AND failure_code IN ('INPUT_REFERENCE_INVALID', 'INPUT_OBJECT_NOT_FOUND', 'INPUT_OBJECT_TOO_LARGE',
                             'INPUT_OBJECT_INTEGRITY_MISMATCH', 'INPUT_MEDIA_TYPE_INVALID')
      )
    );

-- The retained fencing counter stays the reporting epoch.
ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_input_failed_epoch_ck
    CHECK (input_failed_fencing_counter IS NULL OR input_failed_fencing_counter = lease_fencing_counter);

-- The 0006 guard, unchanged, extended with the input-failure provenance rules:
--   INSERT: both input-failure provenance columns must be NULL.
--   First LEASED -> FAILED_BEFORE_SUBMISSION: a lease and a credential grant
--     are required; any supplied value equals the lease principal or lease
--     fencing generation; both are then stamped from OLD.
--   Every other UPDATE: neither value ever changes.
CREATE OR REPLACE FUNCTION execution_attempts_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'QUEUED' OR NEW.lease_fencing_counter <> 0 THEN
      RAISE EXCEPTION 'execution attempts are created QUEUED with fencing generation 0'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.submitting_worker_principal_id IS NOT NULL THEN
      RAISE EXCEPTION 'execution attempts are created without submitting worker provenance'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.submitting_fencing_counter IS NOT NULL THEN
      RAISE EXCEPTION 'execution attempts are created without submitting lease-epoch provenance'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.input_failed_worker_principal_id IS NOT NULL OR NEW.input_failed_fencing_counter IS NOT NULL THEN
      RAISE EXCEPTION 'execution attempts are created without input-failure provenance'
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

  -- Migration 0005: the point-of-no-return transition is taken by the current,
  -- unexpired lease, unchanged in the same statement, and its principal is
  -- recorded as immutable submitting provenance.
  IF OLD.state = 'LEASED' AND NEW.state = 'SUBMITTING' THEN
    IF OLD.lease_worker_principal_id IS NULL THEN
      RAISE EXCEPTION 'an execution attempt enters SUBMITTING only under a lease'
        USING ERRCODE = 'check_violation';
    END IF;
    -- The one expected lifecycle refusal at this barrier (a lease that expired
    -- in real time after the service's own check). Its stable identity is
    -- SQLSTATE 23514 plus the error's constraint name below, which the
    -- submitting service translates into the ordinary 409 LEASE_REJECTED.
    -- It names this guard rule, not a pg_constraint row.
    IF OLD.lease_expires_at IS NULL OR OLD.lease_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION 'an execution attempt cannot enter SUBMITTING under an expired lease'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'execution_attempts_submitting_lease_unexpired';
    END IF;
    IF NEW.lease_worker_principal_id IS DISTINCT FROM OLD.lease_worker_principal_id
       OR NEW.lease_token_sha256 IS DISTINCT FROM OLD.lease_token_sha256
       OR NEW.lease_fencing_counter IS DISTINCT FROM OLD.lease_fencing_counter
       OR NEW.leased_at IS DISTINCT FROM OLD.leased_at
       OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
       OR NEW.heartbeat_at IS DISTINCT FROM OLD.heartbeat_at THEN
      RAISE EXCEPTION 'the lease cannot change while an execution attempt enters SUBMITTING'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.submitting_worker_principal_id IS NOT NULL
       AND NEW.submitting_worker_principal_id IS DISTINCT FROM OLD.lease_worker_principal_id THEN
      RAISE EXCEPTION 'the submitting worker must be the lease worker'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.submitting_worker_principal_id := OLD.lease_worker_principal_id;
    -- Migration 0006: the lease epoch that held provider-call authority.
    IF NEW.submitting_fencing_counter IS NOT NULL
       AND NEW.submitting_fencing_counter IS DISTINCT FROM OLD.lease_fencing_counter THEN
      RAISE EXCEPTION 'the submitting lease epoch must be the lease fencing generation'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.submitting_fencing_counter := OLD.lease_fencing_counter;
  ELSIF NEW.submitting_worker_principal_id IS DISTINCT FROM OLD.submitting_worker_principal_id THEN
    RAISE EXCEPTION 'execution attempt submitting worker provenance is immutable'
      USING ERRCODE = 'check_violation';
  ELSIF NEW.submitting_fencing_counter IS DISTINCT FROM OLD.submitting_fencing_counter THEN
    RAISE EXCEPTION 'execution attempt submitting lease-epoch provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Migration 0007: a permanent pre-provider input failure is reported by the
  -- current lease after a credential grant, never by caller-chosen metadata.
  -- The reporter and its lease epoch are stamped from that lease; the checks
  -- above keep them on FAILED_BEFORE_SUBMISSION without a SUBMITTING barrier,
  -- with one of the five input-failure codes and the retained counter.
  IF OLD.state = 'LEASED' AND NEW.state = 'FAILED_BEFORE_SUBMISSION' THEN
    IF OLD.lease_worker_principal_id IS NULL THEN
      RAISE EXCEPTION 'an execution attempt fails on its input only under a lease'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.credential_granted_at IS NULL THEN
      RAISE EXCEPTION 'an execution attempt fails on its input only after a credential grant'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.input_failed_worker_principal_id IS NOT NULL
       AND NEW.input_failed_worker_principal_id IS DISTINCT FROM OLD.lease_worker_principal_id THEN
      RAISE EXCEPTION 'the input-failure reporter must be the lease worker'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.input_failed_fencing_counter IS NOT NULL
       AND NEW.input_failed_fencing_counter IS DISTINCT FROM OLD.lease_fencing_counter THEN
      RAISE EXCEPTION 'the input-failure lease epoch must be the lease fencing generation'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.input_failed_worker_principal_id := OLD.lease_worker_principal_id;
    NEW.input_failed_fencing_counter := OLD.lease_fencing_counter;
  ELSIF NEW.input_failed_worker_principal_id IS DISTINCT FROM OLD.input_failed_worker_principal_id
     OR NEW.input_failed_fencing_counter IS DISTINCT FROM OLD.input_failed_fencing_counter THEN
    RAISE EXCEPTION 'execution attempt input-failure provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
