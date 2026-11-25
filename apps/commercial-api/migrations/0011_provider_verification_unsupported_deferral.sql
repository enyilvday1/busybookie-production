-- 0011 provider verification unsupported deferral
--
-- Authority: docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
-- R44B11G sections 2.1 to 2.9.
--
-- A worker admission refusal moves a verification job LEASED -> QUEUED with
-- a bounded deferral. A refusal is never terminal authority: this migration
-- adds no terminal reason, no terminal threshold and no backfill. The 0010
-- guard function and trigger are unchanged.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.
-- Grants nothing: runtime privileges are applied by the runtime-grant command.

ALTER TABLE provider_verification_jobs
  ADD COLUMN deferred_until timestamptz NULL,
  ADD COLUMN unsupported_deferral_count integer NOT NULL DEFAULT 0,
  ADD COLUMN last_unsupported_refusal text NULL,

  ADD CONSTRAINT provider_verification_jobs_unsupported_deferral_count_ck
    CHECK (unsupported_deferral_count >= 0),

  ADD CONSTRAINT provider_verification_jobs_last_unsupported_refusal_ck
    CHECK (
      last_unsupported_refusal IS NULL
      OR last_unsupported_refusal IN (
        'UNSUPPORTED_PROVIDER',
        'UNSUPPORTED_POLICY',
        'PROVIDER_POLICY_MISMATCH'
      )
    ),

  ADD CONSTRAINT provider_verification_jobs_unsupported_deferral_presence_ck
    CHECK (
      ((unsupported_deferral_count = 0) = (last_unsupported_refusal IS NULL))
      AND ((unsupported_deferral_count = 0) = (deferred_until IS NULL))
    ),

  ADD CONSTRAINT provider_verification_jobs_deferred_after_creation_ck
    CHECK (
      deferred_until IS NULL
      OR deferred_until > created_at
    );

-- Lease selection order: COALESCE(deferred_until, created_at), then id.
-- provider_verification_jobs_queue_ix (0010) is retained.
CREATE INDEX provider_verification_jobs_eligible_queue_ix
  ON provider_verification_jobs ((COALESCE(deferred_until, created_at)), id)
  WHERE state = 'QUEUED';

-- Backoff d(n), n = count after the increment:
--   300 * 2^(n-1) s for n <= 4 (300, 600, 1200, 2400); 3600 s for n >= 5.
-- The guard enforces a strictly future lower bound and the d(n) upper bound;
-- it never modifies NEW.
CREATE FUNCTION provider_verification_jobs_deferral_guard() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  bound_seconds integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.unsupported_deferral_count IS DISTINCT FROM 0
       OR NEW.last_unsupported_refusal IS NOT NULL
       OR NEW.deferred_until IS NOT NULL THEN
      RAISE EXCEPTION
        'provider verification jobs are created with no unsupported deferral'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
  END IF;

  IF (NEW.unsupported_deferral_count, NEW.last_unsupported_refusal, NEW.deferred_until)
     IS NOT DISTINCT FROM
     (OLD.unsupported_deferral_count, OLD.last_unsupported_refusal, OLD.deferred_until) THEN
    RETURN NEW;
  END IF;

  IF (
       OLD.state = 'LEASED'
       AND NEW.state = 'QUEUED'
       AND OLD.credential_granted_at IS NULL
       AND OLD.lease_expires_at > now()
       AND NEW.unsupported_deferral_count = OLD.unsupported_deferral_count + 1
       AND NEW.last_unsupported_refusal IS NOT NULL
       AND NEW.deferred_until > now()
     ) IS NOT TRUE THEN
    RAISE EXCEPTION
      'provider verification unsupported deferral requires a live ungranted lease, one increment, a refusal and a future deferral'
      USING ERRCODE = 'check_violation';
  END IF;

  bound_seconds := CASE
    WHEN NEW.unsupported_deferral_count >= 5 THEN 3600
    ELSE 300 * (1 << (NEW.unsupported_deferral_count - 1))
  END;

  IF (NEW.deferred_until <= now() + make_interval(secs => bound_seconds)) IS NOT TRUE THEN
    RAISE EXCEPTION
      'provider verification unsupported deferral exceeds its backoff bound'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION provider_verification_jobs_deferral_guard() FROM PUBLIC;

CREATE TRIGGER provider_verification_jobs_deferral_guard
  BEFORE INSERT OR UPDATE ON provider_verification_jobs
  FOR EACH ROW EXECUTE FUNCTION provider_verification_jobs_deferral_guard();
