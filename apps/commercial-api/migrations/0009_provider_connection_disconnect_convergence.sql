-- Commercial schema 0009: ProviderConnection disconnect convergence.
--
-- Authority: docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
-- (R44B11E, "Migration 0009 — terminal usage evidence" and
-- "Migration 0009 — convergence indexes").
--
-- Persistence substrate only. This migration adds subordinate terminal usage
-- evidence for already-CLAIMED canonical generation usage and the two bounded
-- indexes required by disconnect convergence. It adds no lifecycle state,
-- mutable convergence marker, worker authority, provider authority or second
-- authorised-usage identity.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

-- Subordinate terminal evidence for the canonical generation usage identity.
-- There is deliberately no surrogate event ID: one event type may occur at
-- most once for one generation authorization.
CREATE TABLE generation_usage_events (
  generation_authorization_id  uuid        NOT NULL,
  event_type                   text        NOT NULL,
  reason_code                  text        NOT NULL,
  -- Database authority: the insert guard always overwrites this value.
  recorded_at                  timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT generation_usage_events_pk
    PRIMARY KEY (generation_authorization_id, event_type),
  CONSTRAINT generation_usage_events_usage_fk
    FOREIGN KEY (generation_authorization_id)
    REFERENCES generation_usage_ledger (generation_authorization_id)
    ON DELETE RESTRICT,
  CONSTRAINT generation_usage_events_event_type_ck
    CHECK (event_type = 'CANCELLED_BEFORE_SUBMISSION'),
  CONSTRAINT generation_usage_events_reason_code_ck
    CHECK (reason_code = 'PROVIDER_CONNECTION_DISCONNECTED')
);

-- recorded_at is always database wall-clock authority, including when a caller
-- supplies a value explicitly.
CREATE FUNCTION generation_usage_events_guard_insert() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION generation_usage_events_guard_insert() FROM PUBLIC;

CREATE TRIGGER generation_usage_events_guard_insert
  BEFORE INSERT ON generation_usage_events
  FOR EACH ROW EXECUTE FUNCTION generation_usage_events_guard_insert();

-- Defence in depth behind runtime privileges: runtime receives SELECT and
-- INSERT only. UPDATE, DELETE and TRUNCATE are rejected for every ordinary
-- role, including the migration/table owner. Row triggers do not fire for
-- TRUNCATE, so it has its own statement-level trigger.
CREATE FUNCTION generation_usage_events_guard_append_only() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'generation_usage_events is append-only: % rejected', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION generation_usage_events_guard_append_only() FROM PUBLIC;

CREATE TRIGGER generation_usage_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON generation_usage_events
  FOR EACH ROW EXECUTE FUNCTION generation_usage_events_guard_append_only();

CREATE TRIGGER generation_usage_events_reject_truncate
  BEFORE TRUNCATE ON generation_usage_events
  FOR EACH STATEMENT EXECUTE FUNCTION generation_usage_events_guard_append_only();

-- Bounded periodic discovery of disconnected ProviderConnections. No
-- lifecycle lock is implied by this index; the reconciler discovers IDs
-- without locking ProviderConnection rows.
CREATE INDEX provider_connections_disconnected_convergence_ix
  ON provider_connections (disconnected_at, id)
  WHERE status = 'DISCONNECTED';

-- Direct connection-scoped scan for still-ISSUED USER_BYO authorizations.
-- provider_connection_id is immutable provenance; convergence must not route
-- this scan indirectly through credential-version identity.
CREATE INDEX generation_authorizations_disconnect_issued_ix
  ON generation_authorizations (provider_connection_id, created_at, id)
  WHERE billing_mode = 'USER_BYO'
    AND status = 'ISSUED'
    AND provider_connection_id IS NOT NULL;
