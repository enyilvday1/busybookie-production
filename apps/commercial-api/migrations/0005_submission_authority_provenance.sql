-- Commercial schema 0005: submission-authority provenance.
--
-- Records which worker principal crossed the provider-call authority barrier
-- (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md sections 12, 18
-- and 26, revision R44B6K1). It is immutable history, not the current lease
-- owner: it survives the clearing of the lease (SUBMITTING -> OUTCOME_UNKNOWN
-- and later states), so token-less acceptance recovery can be bound to the
-- principal that received provider-call authority.
--
-- The value is derived by the database from the authoritative lease when an
-- attempt first moves LEASED -> SUBMITTING. Application code never names it,
-- and the runtime role receives no UPDATE privilege on it: a BEFORE trigger
-- may assign NEW columns that the statement itself does not name.
--
-- Additive only: no table, role, grant, secret or provider-specific column.

ALTER TABLE execution_attempts
  ADD COLUMN submitting_worker_principal_id uuid NULL;

ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_submitting_worker_fk
    FOREIGN KEY (submitting_worker_principal_id) REFERENCES worker_principals (id) ON DELETE RESTRICT;

-- Backfill only rows that are SUBMITTING now. Migration 0004 forbids changing
-- the lease principal or token while SUBMITTING, so their current lease
-- principal is provably the principal that entered SUBMITTING. The 0004 guard
-- is still installed here and does not inspect the new column. No value is
-- inferred from audit metadata, a later lease or any other state.
UPDATE execution_attempts
   SET submitting_worker_principal_id = lease_worker_principal_id
 WHERE state = 'SUBMITTING';

-- Fail closed: any other row that crossed the barrier has no recoverable
-- provenance (its lease was cleared or replaced). The whole migration
-- transaction aborts; an operator decides.
DO $$
DECLARE
  unrecoverable bigint;
BEGIN
  SELECT count(*) INTO unrecoverable
    FROM execution_attempts
   WHERE submitting_at IS NOT NULL AND submitting_worker_principal_id IS NULL;
  IF unrecoverable > 0 THEN
    RAISE EXCEPTION 'migration 0005: % execution attempt(s) crossed SUBMITTING without recoverable submitting worker provenance', unrecoverable
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- The barrier and its provenance exist together, for every state.
ALTER TABLE execution_attempts
  ADD CONSTRAINT execution_attempts_submitting_worker_ck
    CHECK ((submitting_at IS NULL) = (submitting_worker_principal_id IS NULL));

-- The 0004 guard, unchanged, extended with the submitting-provenance rules:
--   INSERT: submitting_worker_principal_id must be NULL.
--   First LEASED -> SUBMITTING: a live lease, unexpired by wall-clock time
--     (clock_timestamp(), never transaction-stable now(): granting
--     provider-call authority must not outlive the lease inside a long
--     transaction; architecture section 26, R44B6K5); no lease field changes in
--     the same statement; any supplied submitting principal equals the lease
--     principal; the value is then stamped from OLD.lease_worker_principal_id.
--   Every other UPDATE: submitting_worker_principal_id never changes.
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
  ELSIF NEW.submitting_worker_principal_id IS DISTINCT FROM OLD.submitting_worker_principal_id THEN
    RAISE EXCEPTION 'execution attempt submitting worker provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
