-- 0002 provider connections
--
-- Authority: docs/commercial/COMMERCIAL_PROVIDER_CONNECTION_ARCHITECTURE.md
--
-- Account-owned BYO provider connections and their versioned, sealed
-- credentials. Additive to 0001. Provider-neutral: provider identifiers are
-- shape-checked only; which providers are commercially supported is
-- application policy. No plaintext credential column exists anywhere.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

-- provider_connections: stable, non-secret identity of one customer
-- connection. Connection state, verification state and credential-version
-- state are separate axes. Connections are never physically deleted.
CREATE TABLE provider_connections (
  id                            uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                    uuid        NOT NULL,
  provider                      text        NOT NULL,
  credential_kind               text        NOT NULL,
  label                         text        NULL,
  status                        text        NOT NULL DEFAULT 'PENDING_VERIFICATION',
  verification_status           text        NOT NULL DEFAULT 'UNVERIFIED',
  last_verification_attempt_at  timestamptz NULL,
  verified_at                   timestamptz NULL,
  created_by_user_id            uuid        NOT NULL,
  creation_idempotency_key      text        NULL,
  disconnected_at               timestamptz NULL,
  disabled_at                   timestamptz NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_connections_pk PRIMARY KEY (id),
  CONSTRAINT provider_connections_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT provider_connections_created_by_user_fk FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  -- Composite-FK target so child rows (and future generation authorizations)
  -- can prove same-account provenance structurally.
  CONSTRAINT provider_connections_account_scope_uq UNIQUE (account_id, id),
  -- Shape only, matching the credential-crypto context rule.
  CONSTRAINT provider_connections_provider_ck CHECK (provider ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  -- Fail closed: only API-key-like credentials in v1. OAuth widens this later.
  CONSTRAINT provider_connections_credential_kind_ck CHECK (credential_kind IN ('API_KEY')),
  CONSTRAINT provider_connections_label_ck
    CHECK (label IS NULL OR (char_length(label) BETWEEN 1 AND 100 AND label !~ '^\s' AND label !~ '\s$')),
  CONSTRAINT provider_connections_status_ck
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'INVALID', 'DISCONNECTED', 'DISABLED')),
  CONSTRAINT provider_connections_verification_status_ck
    CHECK (verification_status IN ('UNVERIFIED', 'VERIFIED', 'FAILED')),
  CONSTRAINT provider_connections_verified_at_ck
    CHECK (verification_status <> 'VERIFIED' OR verified_at IS NOT NULL),
  CONSTRAINT provider_connections_verification_attempt_ck
    CHECK (verification_status = 'UNVERIFIED' OR last_verification_attempt_at IS NOT NULL),
  CONSTRAINT provider_connections_disconnected_at_ck CHECK (status <> 'DISCONNECTED' OR disconnected_at IS NOT NULL),
  CONSTRAINT provider_connections_disabled_at_ck CHECK (status <> 'DISABLED' OR disabled_at IS NOT NULL),
  CONSTRAINT provider_connections_creation_idempotency_key_ck
    CHECK (creation_idempotency_key IS NULL OR char_length(creation_idempotency_key) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX provider_connections_creation_idempotency_key_uq
  ON provider_connections (account_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

CREATE INDEX provider_connections_account_list_ix
  ON provider_connections (account_id, created_at DESC, id);

-- provider_credential_versions: one sealed credential per row. Rotation
-- inserts a new version; a version's secret material is never replaced. On
-- destruction the sealed credential and fingerprint become NULL while the
-- non-secret provenance row remains.
CREATE TABLE provider_credential_versions (
  id                        uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                uuid        NOT NULL,
  provider_connection_id    uuid        NOT NULL,
  credential_version        integer     NOT NULL,
  status                    text        NOT NULL DEFAULT 'ACTIVE',
  -- A vendor-neutral sealed-envelope document (format-tagged object). Parsed
  -- by the application's envelope parser; never plaintext.
  sealed_credential         jsonb       NULL,
  fingerprint_algorithm     text        NULL,
  fingerprint_key_ref       text        NULL,
  fingerprint_value         text        NULL,
  rotation_idempotency_key  text        NULL,
  created_by_user_id        uuid        NOT NULL,
  superseded_at             timestamptz NULL,
  retained_for_recovery_at  timestamptz NULL,
  destroyed_at              timestamptz NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provider_credential_versions_pk PRIMARY KEY (id),
  CONSTRAINT provider_credential_versions_connection_same_account_fk
    FOREIGN KEY (account_id, provider_connection_id)
    REFERENCES provider_connections (account_id, id) ON DELETE RESTRICT,
  CONSTRAINT provider_credential_versions_created_by_user_fk
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  -- Composite-FK target for future generation authorizations, proving the
  -- version belongs to that account and that connection.
  CONSTRAINT provider_credential_versions_scope_uq UNIQUE (account_id, provider_connection_id, id),
  CONSTRAINT provider_credential_versions_version_uq UNIQUE (provider_connection_id, credential_version),
  CONSTRAINT provider_credential_versions_version_ck CHECK (credential_version BETWEEN 1 AND 1000000),
  CONSTRAINT provider_credential_versions_status_ck
    CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'RETAINED_FOR_RECOVERY', 'DESTROYED')),
  -- Secret material exists exactly while the version is not destroyed.
  CONSTRAINT provider_credential_versions_secret_presence_ck
    CHECK ((status = 'DESTROYED') = (sealed_credential IS NULL)),
  CONSTRAINT provider_credential_versions_fingerprint_presence_ck
    CHECK (
      CASE WHEN status = 'DESTROYED'
        THEN fingerprint_algorithm IS NULL AND fingerprint_key_ref IS NULL AND fingerprint_value IS NULL
        ELSE fingerprint_algorithm IS NOT NULL AND fingerprint_key_ref IS NOT NULL AND fingerprint_value IS NOT NULL
      END
    ),
  -- Bounded, format-tagged object. 16384 bytes leaves room for an 8192-byte
  -- credential as base64url ciphertext (about 10923 characters) plus
  -- key-management envelope metadata such as a wrapped data key. COALESCE
  -- makes a missing "format" key fail rather than evaluate to NULL (which a
  -- CHECK would accept).
  CONSTRAINT provider_credential_versions_sealed_credential_ck
    CHECK (
      sealed_credential IS NULL OR COALESCE(
        jsonb_typeof(sealed_credential) = 'object'
        AND jsonb_typeof(sealed_credential -> 'format') = 'string'
        AND octet_length(sealed_credential::text) <= 16384,
        false
      )
    ),
  CONSTRAINT provider_credential_versions_fingerprint_algorithm_ck
    CHECK (fingerprint_algorithm IS NULL OR fingerprint_algorithm IN ('HMAC-SHA-256')),
  CONSTRAINT provider_credential_versions_fingerprint_key_ref_ck
    CHECK (fingerprint_key_ref IS NULL OR fingerprint_key_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  -- base64url HMAC-SHA-256 output.
  CONSTRAINT provider_credential_versions_fingerprint_value_ck
    CHECK (fingerprint_value IS NULL OR fingerprint_value ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT provider_credential_versions_destroyed_at_ck CHECK ((status = 'DESTROYED') = (destroyed_at IS NOT NULL)),
  CONSTRAINT provider_credential_versions_superseded_at_ck CHECK (status <> 'SUPERSEDED' OR superseded_at IS NOT NULL),
  CONSTRAINT provider_credential_versions_retained_at_ck
    CHECK (status <> 'RETAINED_FOR_RECOVERY' OR retained_for_recovery_at IS NOT NULL),
  CONSTRAINT provider_credential_versions_active_clean_ck
    CHECK (status <> 'ACTIVE' OR (superseded_at IS NULL AND retained_for_recovery_at IS NULL)),
  CONSTRAINT provider_credential_versions_rotation_idempotency_key_ck
    CHECK (rotation_idempotency_key IS NULL OR char_length(rotation_idempotency_key) BETWEEN 1 AND 128)
);

-- At most one ACTIVE credential version per connection.
CREATE UNIQUE INDEX provider_credential_versions_one_active_uq
  ON provider_credential_versions (provider_connection_id)
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX provider_credential_versions_rotation_idempotency_key_uq
  ON provider_credential_versions (provider_connection_id, rotation_idempotency_key)
  WHERE rotation_idempotency_key IS NOT NULL;

-- Account-scoped duplicate lookup (deliberately not unique: duplicate policy
-- belongs to the application, and no cross-account uniqueness may exist).
CREATE INDEX provider_credential_versions_fingerprint_ix
  ON provider_credential_versions (account_id, fingerprint_key_ref, fingerprint_value)
  WHERE fingerprint_value IS NOT NULL;

-- Credential versions are immutable except for lifecycle fields and one-way
-- destruction. Column-scoped grants already stop the runtime role updating
-- identity columns; this trigger additionally makes it impossible, for any
-- role without trigger-bypass authority, to replace secret material or a
-- fingerprint with a different value, or to move a version back to ACTIVE or
-- out of DESTROYED. Secret and fingerprint fields may only stay the same or
-- become NULL, and the presence checks above allow NULL only when DESTROYED.
CREATE FUNCTION provider_credential_versions_guard_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.provider_connection_id IS DISTINCT FROM OLD.provider_connection_id
     OR NEW.credential_version IS DISTINCT FROM OLD.credential_version
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.rotation_idempotency_key IS DISTINCT FROM OLD.rotation_idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'provider credential version identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW.sealed_credential IS NOT NULL AND NEW.sealed_credential IS DISTINCT FROM OLD.sealed_credential)
     OR (NEW.fingerprint_algorithm IS NOT NULL AND NEW.fingerprint_algorithm IS DISTINCT FROM OLD.fingerprint_algorithm)
     OR (NEW.fingerprint_key_ref IS NOT NULL AND NEW.fingerprint_key_ref IS DISTINCT FROM OLD.fingerprint_key_ref)
     OR (NEW.fingerprint_value IS NOT NULL AND NEW.fingerprint_value IS DISTINCT FROM OLD.fingerprint_value) THEN
    RAISE EXCEPTION 'provider credential material cannot be replaced'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.status = 'DESTROYED' AND NEW.status <> 'DESTROYED')
     OR (OLD.status <> 'ACTIVE' AND NEW.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'provider credential version lifecycle cannot move backwards'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION provider_credential_versions_guard_update() FROM PUBLIC;

CREATE TRIGGER provider_credential_versions_guard_update
  BEFORE UPDATE ON provider_credential_versions
  FOR EACH ROW EXECUTE FUNCTION provider_credential_versions_guard_update();

-- Audit events may now record provider-connection lifecycle events. The
-- constraint keeps its name; existing resource types are unchanged.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_resource_type_ck;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_resource_type_ck
  CHECK (resource_type IN ('user', 'account', 'entitlement_grant', 'production', 'provider_connection'));
