-- Commercial schema 0008: generation usage ledger.
--
-- Authority: docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
-- (section 36, "Generation usage-ledger persistence", revision R44B11B).
--
-- Persistence substrate only for the canonical CLAIMED authorised-usage
-- record that the R44B11P1 claim boundary requires. The usage identity is
-- exactly the generation authorization ID. A future claim transaction locks an
-- ISSUED authorization, moves it to CLAIMED and inserts its one ledger row; no
-- issuance, claim, worker or provider code exists here.
--
-- The ledger is accounting provenance, not quota, entitlement-consumption,
-- billing-balance, provider-invoice or provider-completion authority. It
-- copies no authorization provenance (grant, billing mode, provider, model,
-- connection, credential version, request, hash, cost cap or creator) and
-- holds no execution job, attempt, worker, lease, fencing or provider
-- execution identity. No backfill: the table is created empty.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

-- generation_usage_ledger: zero or one canonical CLAIMED usage row per
-- generation authorization. The primary key is the at-most-one authority; the
-- composite FK proves identity, account scope and production scope through the
-- existing generation_authorizations_production_scope_uq target.
CREATE TABLE generation_usage_ledger (
  generation_authorization_id  uuid        NOT NULL,
  account_id                   uuid        NOT NULL,
  production_id                uuid        NOT NULL,
  -- Database authority: the insert guard always overwrites it.
  recorded_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT generation_usage_ledger_pk PRIMARY KEY (generation_authorization_id),
  CONSTRAINT generation_usage_ledger_authorization_same_production_fk
    FOREIGN KEY (account_id, production_id, generation_authorization_id)
    REFERENCES generation_authorizations (account_id, production_id, id) ON DELETE RESTRICT
);

-- Lifecycle admission and recorded_at authority. The composite FK proves
-- identity and scope but not lifecycle state, so a row is admitted only for
-- the exact same-account, same-production authorization in CLAIMED with
-- claimed_at set. CLAIMED is terminal under generation_authorizations_guard_update,
-- so an admitted row can never later reference a non-CLAIMED authorization.
-- The lookup sees the inserting transaction's own ISSUED -> CLAIMED update.
-- recorded_at is set from clock_timestamp(), never from a caller-supplied or
-- transaction-stable value.
CREATE FUNCTION generation_usage_ledger_guard_insert() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM generation_authorizations
     WHERE id = NEW.generation_authorization_id
       AND account_id = NEW.account_id
       AND production_id = NEW.production_id
       AND status = 'CLAIMED'
       AND claimed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'generation usage requires the exact CLAIMED generation authorization'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION generation_usage_ledger_guard_insert() FROM PUBLIC;

CREATE TRIGGER generation_usage_ledger_guard_insert
  BEFORE INSERT ON generation_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION generation_usage_ledger_guard_insert();

-- Defence in depth behind privileges: the runtime role is never granted
-- UPDATE, DELETE or TRUNCATE on generation_usage_ledger. These triggers
-- additionally reject those operations for every other role, including the
-- table owner. Row-level triggers do not fire for TRUNCATE, so it has its own
-- statement-level trigger.
CREATE FUNCTION generation_usage_ledger_guard_append_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'generation_usage_ledger is append-only: % rejected', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION generation_usage_ledger_guard_append_only() FROM PUBLIC;

CREATE TRIGGER generation_usage_ledger_reject_update_delete
  BEFORE UPDATE OR DELETE ON generation_usage_ledger
  FOR EACH ROW EXECUTE FUNCTION generation_usage_ledger_guard_append_only();

CREATE TRIGGER generation_usage_ledger_reject_truncate
  BEFORE TRUNCATE ON generation_usage_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION generation_usage_ledger_guard_append_only();
