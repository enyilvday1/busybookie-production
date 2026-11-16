-- 0010 provider connection verification workflow
--
-- Authority: docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
-- R44B11F.
--
-- Durable provider-credential verification work. Verification is independent
-- from generation execution: this table has no execution-job, execution-attempt
-- or generation-authorization identity.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

CREATE TABLE provider_verification_jobs (
  id                              uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                      uuid        NOT NULL,
  provider_connection_id          uuid        NOT NULL,
  provider_credential_version_id  uuid        NOT NULL,
  verification_policy_id          text        NOT NULL,
  requested_by_user_id            uuid        NOT NULL,

  state                           text        NOT NULL DEFAULT 'QUEUED',

  -- Current verification lease. The plaintext token never reaches storage.
  lease_worker_principal_id       uuid        NULL,
  lease_token_sha256              text        NULL,
  lease_fencing_counter           bigint      NOT NULL DEFAULT 0,
  leased_at                       timestamptz NULL,
  lease_expires_at                timestamptz NULL,

  -- Credential retention opens when this is stamped.
  credential_granted_at           timestamptz NULL,

  -- Durable provider-call authority barrier.
  verifying_at                    timestamptz NULL,
  verifying_worker_principal_id   uuid        NULL,
  verifying_fencing_counter       bigint      NULL,

  -- Terminal result provenance. CANCELLED has no provider result outcome.
  result_outcome                  text        NULL,
  terminal_reason_code            text        NULL,
  result_worker_principal_id      uuid        NULL,
  result_fencing_counter          bigint      NULL,
  completed_at                    timestamptz NULL,

  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_verification_jobs_pk
    PRIMARY KEY (id),

  CONSTRAINT provider_verification_jobs_account_fk
    FOREIGN KEY (account_id)
    REFERENCES accounts (id)
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_connection_same_account_fk
    FOREIGN KEY (account_id, provider_connection_id)
    REFERENCES provider_connections (account_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_credential_same_connection_fk
    FOREIGN KEY (
      account_id,
      provider_connection_id,
      provider_credential_version_id
    )
    REFERENCES provider_credential_versions (
      account_id,
      provider_connection_id,
      id
    )
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_requested_by_user_fk
    FOREIGN KEY (requested_by_user_id)
    REFERENCES users (id)
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_lease_worker_fk
    FOREIGN KEY (lease_worker_principal_id)
    REFERENCES worker_principals (id)
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_verifying_worker_fk
    FOREIGN KEY (verifying_worker_principal_id)
    REFERENCES worker_principals (id)
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_result_worker_fk
    FOREIGN KEY (result_worker_principal_id)
    REFERENCES worker_principals (id)
    ON DELETE RESTRICT,

  CONSTRAINT provider_verification_jobs_policy_ck
    CHECK (
      char_length(verification_policy_id) BETWEEN 1 AND 128
      AND verification_policy_id ~ '^[A-Z][A-Z0-9_]*$'
    ),

  CONSTRAINT provider_verification_jobs_state_ck
    CHECK (
      state IN (
        'QUEUED',
        'LEASED',
        'VERIFYING',
        'COMPLETED',
        'CANCELLED'
      )
    ),

  CONSTRAINT provider_verification_jobs_lease_complete_ck
    CHECK (
      (
        lease_worker_principal_id IS NULL
        AND lease_token_sha256 IS NULL
        AND leased_at IS NULL
        AND lease_expires_at IS NULL
      )
      OR
      (
        lease_worker_principal_id IS NOT NULL
        AND lease_token_sha256 IS NOT NULL
        AND leased_at IS NOT NULL
        AND lease_expires_at IS NOT NULL
      )
    ),

  CONSTRAINT provider_verification_jobs_lease_state_ck
    CHECK (
      (state IN ('LEASED', 'VERIFYING'))
      =
      (lease_worker_principal_id IS NOT NULL)
    ),

  CONSTRAINT provider_verification_jobs_lease_token_sha256_ck
    CHECK (
      lease_token_sha256 IS NULL
      OR lease_token_sha256 ~ '^[0-9a-f]{64}$'
    ),

  CONSTRAINT provider_verification_jobs_fencing_counter_ck
    CHECK (
      lease_fencing_counter BETWEEN 0 AND 9007199254740991
      AND (
        lease_worker_principal_id IS NULL
        OR lease_fencing_counter >= 1
      )
    ),

  CONSTRAINT provider_verification_jobs_lease_times_ck
    CHECK (
      lease_expires_at IS NULL
      OR lease_expires_at > leased_at
    ),

  CONSTRAINT provider_verification_jobs_credential_grant_state_ck
    CHECK (
      CASE
        WHEN state = 'QUEUED'
          THEN credential_granted_at IS NULL
        WHEN state IN ('VERIFYING', 'COMPLETED')
          THEN credential_granted_at IS NOT NULL
        ELSE true
      END
    ),

  CONSTRAINT provider_verification_jobs_credential_grant_time_ck
    CHECK (
      credential_granted_at IS NULL
      OR leased_at IS NULL
      OR credential_granted_at >= leased_at
    ),

  CONSTRAINT provider_verification_jobs_verifying_pair_ck
    CHECK (
      (verifying_worker_principal_id IS NULL)
      =
      (verifying_fencing_counter IS NULL)
    ),

  CONSTRAINT provider_verification_jobs_verifying_presence_ck
    CHECK (
      (verifying_at IS NULL)
      =
      (verifying_worker_principal_id IS NULL)
    ),

  CONSTRAINT provider_verification_jobs_verifying_fencing_ck
    CHECK (
      verifying_fencing_counter IS NULL
      OR verifying_fencing_counter BETWEEN 1 AND 9007199254740991
    ),

  CONSTRAINT provider_verification_jobs_verifying_after_grant_ck
    CHECK (
      verifying_at IS NULL
      OR (
        credential_granted_at IS NOT NULL
        AND verifying_at >= credential_granted_at
      )
    ),

  CONSTRAINT provider_verification_jobs_verifying_state_ck
    CHECK (
      CASE
        WHEN state IN ('QUEUED', 'LEASED', 'CANCELLED')
          THEN verifying_at IS NULL
        WHEN state = 'VERIFYING'
          THEN verifying_at IS NOT NULL
        ELSE true
      END
    ),

  CONSTRAINT provider_verification_jobs_result_outcome_ck
    CHECK (
      result_outcome IS NULL
      OR result_outcome IN (
        'VERIFIED',
        'DEFINITIVE_FAILURE',
        'INCONCLUSIVE'
      )
    ),

  CONSTRAINT provider_verification_jobs_terminal_reason_ck
    CHECK (
      terminal_reason_code IS NULL
      OR (
        char_length(terminal_reason_code) BETWEEN 1 AND 64
        AND terminal_reason_code ~ '^[A-Z][A-Z0-9_]*$'
      )
    ),

  CONSTRAINT provider_verification_jobs_result_pair_ck
    CHECK (
      (result_worker_principal_id IS NULL)
      =
      (result_fencing_counter IS NULL)
    ),

  CONSTRAINT provider_verification_jobs_result_fencing_ck
    CHECK (
      result_fencing_counter IS NULL
      OR result_fencing_counter BETWEEN 1 AND 9007199254740991
    ),

  CONSTRAINT provider_verification_jobs_result_requires_verifying_ck
    CHECK (
      result_outcome NOT IN ('VERIFIED', 'DEFINITIVE_FAILURE')
      OR verifying_at IS NOT NULL
    ),

  CONSTRAINT provider_verification_jobs_terminal_time_ck
    CHECK (
      completed_at IS NULL
      OR (
        completed_at >= created_at
        AND (
          verifying_at IS NULL
          OR completed_at >= verifying_at
        )
      )
    ),

  CONSTRAINT provider_verification_jobs_terminal_state_ck
    CHECK (
      CASE
        WHEN state = 'COMPLETED' THEN
          result_outcome IS NOT NULL
          AND terminal_reason_code IS NOT NULL
          AND result_worker_principal_id IS NOT NULL
          AND result_fencing_counter IS NOT NULL
          AND completed_at IS NOT NULL

        WHEN state = 'CANCELLED' THEN
          result_outcome IS NULL
          AND terminal_reason_code IS NOT NULL
          AND result_worker_principal_id IS NULL
          AND result_fencing_counter IS NULL
          AND completed_at IS NOT NULL

        ELSE
          result_outcome IS NULL
          AND terminal_reason_code IS NULL
          AND result_worker_principal_id IS NULL
          AND result_fencing_counter IS NULL
          AND completed_at IS NULL
      END
    )
);

CREATE UNIQUE INDEX provider_verification_jobs_one_open_per_version_uq
  ON provider_verification_jobs (
    provider_connection_id,
    provider_credential_version_id
  )
  WHERE state IN ('QUEUED', 'LEASED', 'VERIFYING');

CREATE INDEX provider_verification_jobs_queue_ix
  ON provider_verification_jobs (created_at, id)
  WHERE state = 'QUEUED';

CREATE INDEX provider_verification_jobs_lease_expiry_ix
  ON provider_verification_jobs (lease_expires_at, id)
  WHERE state IN ('LEASED', 'VERIFYING');

CREATE INDEX provider_verification_jobs_credential_obligation_ix
  ON provider_verification_jobs (
    provider_credential_version_id,
    state
  )
  WHERE credential_granted_at IS NOT NULL
    AND state IN ('LEASED', 'VERIFYING');

CREATE INDEX provider_verification_jobs_connection_ix
  ON provider_verification_jobs (
    account_id,
    provider_connection_id,
    created_at DESC,
    id
  );

CREATE INDEX provider_verification_jobs_worker_lease_ix
  ON provider_verification_jobs (
    lease_worker_principal_id,
    lease_expires_at
  )
  WHERE state IN ('LEASED', 'VERIFYING');

CREATE FUNCTION provider_verification_jobs_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'QUEUED'
       OR NEW.lease_fencing_counter <> 0
       OR NEW.lease_worker_principal_id IS NOT NULL
       OR NEW.lease_token_sha256 IS NOT NULL
       OR NEW.leased_at IS NOT NULL
       OR NEW.lease_expires_at IS NOT NULL
       OR NEW.credential_granted_at IS NOT NULL
       OR NEW.verifying_at IS NOT NULL
       OR NEW.verifying_worker_principal_id IS NOT NULL
       OR NEW.verifying_fencing_counter IS NOT NULL
       OR NEW.result_outcome IS NOT NULL
       OR NEW.terminal_reason_code IS NOT NULL
       OR NEW.result_worker_principal_id IS NOT NULL
       OR NEW.result_fencing_counter IS NOT NULL
       OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION
        'provider verification jobs are created QUEUED with fencing generation 0'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.provider_connection_id IS DISTINCT FROM OLD.provider_connection_id
     OR NEW.provider_credential_version_id IS DISTINCT FROM OLD.provider_credential_version_id
     OR NEW.verification_policy_id IS DISTINCT FROM OLD.verification_policy_id
     OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'provider verification job provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state IN ('COMPLETED', 'CANCELLED')
     AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION
      'provider verification job lifecycle is terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'QUEUED'
        AND NEW.state IN ('LEASED', 'CANCELLED'))
    OR (OLD.state = 'LEASED'
        AND NEW.state IN ('QUEUED', 'VERIFYING', 'COMPLETED', 'CANCELLED'))
    OR (OLD.state = 'VERIFYING'
        AND NEW.state = 'COMPLETED')
  ) THEN
    RAISE EXCEPTION
      'provider verification job transition % -> % is not allowed',
      OLD.state,
      NEW.state
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.lease_fencing_counter IS DISTINCT FROM OLD.lease_fencing_counter THEN
    IF NOT (
      OLD.state = 'QUEUED'
      AND NEW.state = 'LEASED'
      AND NEW.lease_fencing_counter = OLD.lease_fencing_counter + 1
    ) THEN
      RAISE EXCEPTION
        'provider verification fencing generation changes only on lease acquisition'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.state IN ('LEASED', 'VERIFYING')
     AND NEW.state IN ('LEASED', 'VERIFYING')
     AND (
       NEW.lease_worker_principal_id IS DISTINCT FROM OLD.lease_worker_principal_id
       OR NEW.lease_token_sha256 IS DISTINCT FROM OLD.lease_token_sha256
       OR NEW.leased_at IS DISTINCT FROM OLD.leased_at
       OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
     ) THEN
    RAISE EXCEPTION
      'provider verification live lease identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'LEASED'
     AND NEW.state = 'QUEUED'
     AND OLD.credential_granted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'provider verification job cannot requeue after credential grant'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.credential_granted_at IS NULL
     AND NEW.credential_granted_at IS NOT NULL
     AND NOT (
       OLD.state = 'LEASED'
       AND NEW.state = 'LEASED'
     ) THEN
    RAISE EXCEPTION
      'provider verification credential grant is stamped only while leased'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.credential_granted_at IS NOT NULL
     AND NEW.credential_granted_at IS DISTINCT FROM OLD.credential_granted_at THEN
    RAISE EXCEPTION
      'provider verification credential grant is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.verifying_at IS NULL
     AND NEW.verifying_at IS NOT NULL THEN
    IF NOT (
      OLD.state = 'LEASED'
      AND NEW.state = 'VERIFYING'
      AND OLD.credential_granted_at IS NOT NULL
      AND NEW.verifying_worker_principal_id IS NOT DISTINCT FROM OLD.lease_worker_principal_id
      AND NEW.verifying_fencing_counter IS NOT DISTINCT FROM OLD.lease_fencing_counter
    ) THEN
      RAISE EXCEPTION
        'provider verification barrier provenance must match the live lease'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.verifying_at IS NOT NULL
     AND (
       NEW.verifying_at IS DISTINCT FROM OLD.verifying_at
       OR NEW.verifying_worker_principal_id IS DISTINCT FROM OLD.verifying_worker_principal_id
       OR NEW.verifying_fencing_counter IS DISTINCT FROM OLD.verifying_fencing_counter
     ) THEN
    RAISE EXCEPTION
      'provider verification barrier provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'LEASED'
     AND NEW.state = 'COMPLETED'
     AND NOT (
       OLD.credential_granted_at IS NOT NULL
       AND NEW.result_outcome = 'INCONCLUSIVE'
       AND NEW.terminal_reason_code = 'WORKER_LOST_AFTER_CREDENTIAL_GRANT'
       AND NEW.result_worker_principal_id IS NOT DISTINCT FROM OLD.lease_worker_principal_id
       AND NEW.result_fencing_counter IS NOT DISTINCT FROM OLD.lease_fencing_counter
     ) THEN
    RAISE EXCEPTION
      'provider verification leased completion is only worker-loss convergence'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.state = 'VERIFYING'
     AND NEW.state = 'COMPLETED'
     AND (
       NEW.result_worker_principal_id IS DISTINCT FROM OLD.verifying_worker_principal_id
       OR NEW.result_fencing_counter IS DISTINCT FROM OLD.verifying_fencing_counter
     ) THEN
    RAISE EXCEPTION
      'provider verification result provenance must match the verifying epoch'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.result_outcome IS NOT NULL
     AND NEW.result_outcome IS DISTINCT FROM OLD.result_outcome THEN
    RAISE EXCEPTION
      'provider verification result outcome is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.terminal_reason_code IS NOT NULL
     AND NEW.terminal_reason_code IS DISTINCT FROM OLD.terminal_reason_code THEN
    RAISE EXCEPTION
      'provider verification terminal reason is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.result_worker_principal_id IS NOT NULL
     AND (
       NEW.result_worker_principal_id IS DISTINCT FROM OLD.result_worker_principal_id
       OR NEW.result_fencing_counter IS DISTINCT FROM OLD.result_fencing_counter
     ) THEN
    RAISE EXCEPTION
      'provider verification result provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.completed_at IS NOT NULL
     AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    RAISE EXCEPTION
      'provider verification completion timestamp is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION provider_verification_jobs_guard() FROM PUBLIC;

CREATE TRIGGER provider_verification_jobs_guard
  BEFORE INSERT OR UPDATE ON provider_verification_jobs
  FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_guard();
