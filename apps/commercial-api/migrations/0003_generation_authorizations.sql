-- 0003 generation authorizations
--
-- Authority: docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md (section
-- 25-26), docs/commercial/COMMERCIAL_CONTROL_PLANE_ARCHITECTURE.md (section 8)
-- and docs/commercial/COMMERCIAL_PROVIDER_CONNECTION_ARCHITECTURE.md
-- (sections 15, 20 and 21).
--
-- Persistence skeleton only: the authoritative parent that future execution
-- jobs reference. No execution job, attempt, lease, worker, recovery
-- obligation, usage reservation or platform credential exists here, and no
-- application service issues authorizations yet. Provider-neutral: provider
-- and model are shape-checked only.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

-- Composite-FK target so an authorization can prove that its requested
-- provider is the provider of the bound USER_BYO connection. provider is
-- immutable to the runtime role, so this adds no new mutable authority.
ALTER TABLE provider_connections
  ADD CONSTRAINT provider_connections_provider_scope_uq UNIQUE (account_id, id, provider);

-- generation_authorizations: one server-issued authority to run one exact
-- generation request for one Production, funded by one billing mode.
--
-- Credential provenance is the exact provider_credential_version_id, never
-- "the connection's current credential". Whether a version is usable at issue
-- time (for example not DESTROYED) is decided by the future issuance service;
-- historical rows stay referentially valid after rotation, disconnect or
-- destruction.
--
-- entitlement_grant_id is provenance only. Issuing an authorization neither
-- reserves nor consumes the grant; reservation and consumption belong to the
-- future usage authority.
CREATE TABLE generation_authorizations (
  id                              uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                      uuid        NOT NULL,
  production_id                   uuid        NOT NULL,
  entitlement_grant_id            uuid        NOT NULL,
  billing_mode                    text        NOT NULL,
  provider                        text        NOT NULL,
  model                           text        NOT NULL,
  provider_connection_id          uuid        NULL,
  provider_credential_version_id  uuid        NULL,
  -- Frozen generation intent. Identity and ownership authority are the
  -- relational columns, never members of this document.
  generation_request              jsonb       NOT NULL,
  -- Lowercase hex SHA-256 of the issuance service's canonical serialisation
  -- of generation_request. Immutable together with the document.
  generation_request_sha256       text        NOT NULL,
  -- Execution safety ceiling in the provider's native integer unit; not a
  -- price, charge or billing amount.
  expected_cost_cap_unit          text        NOT NULL,
  expected_cost_cap_amount        bigint      NOT NULL,
  status                          text        NOT NULL DEFAULT 'ISSUED',
  expires_at                      timestamptz NOT NULL,
  claimed_at                      timestamptz NULL,
  expired_at                      timestamptz NULL,
  cancelled_at                    timestamptz NULL,
  created_by_user_id              uuid        NOT NULL,
  creation_idempotency_key        text        NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT generation_authorizations_pk PRIMARY KEY (id),
  CONSTRAINT generation_authorizations_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT generation_authorizations_production_same_account_fk
    FOREIGN KEY (account_id, production_id)
    REFERENCES productions (account_id, id) ON DELETE RESTRICT,
  CONSTRAINT generation_authorizations_grant_same_account_fk
    FOREIGN KEY (account_id, entitlement_grant_id)
    REFERENCES entitlement_grants (account_id, id) ON DELETE RESTRICT,
  -- Same account and same provider as the authorization. MATCH SIMPLE: not
  -- checked when provider_connection_id is NULL, which the billing-mode
  -- binding check allows only for PLATFORM_HOSTED.
  CONSTRAINT generation_authorizations_connection_same_account_fk
    FOREIGN KEY (account_id, provider_connection_id, provider)
    REFERENCES provider_connections (account_id, id, provider) ON DELETE RESTRICT,
  -- Same account and same connection as the authorization.
  CONSTRAINT generation_authorizations_credential_version_same_connection_fk
    FOREIGN KEY (account_id, provider_connection_id, provider_credential_version_id)
    REFERENCES provider_credential_versions (account_id, provider_connection_id, id) ON DELETE RESTRICT,
  CONSTRAINT generation_authorizations_created_by_user_fk
    FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  -- Composite-FK targets for future execution jobs.
  CONSTRAINT generation_authorizations_account_scope_uq UNIQUE (account_id, id),
  CONSTRAINT generation_authorizations_production_scope_uq UNIQUE (account_id, production_id, id),
  CONSTRAINT generation_authorizations_billing_mode_ck CHECK (billing_mode IN ('USER_BYO', 'PLATFORM_HOSTED')),
  -- PLATFORM_HOSTED is vocabulary only: no platform credential authority
  -- exists yet. A later reviewed migration adds its credential binding and
  -- removes this check before PLATFORM_HOSTED generation is enabled.
  CONSTRAINT generation_authorizations_v1_issuable_billing_mode_ck CHECK (billing_mode = 'USER_BYO'),
  -- USER_BYO binds an exact user connection and credential version.
  -- PLATFORM_HOSTED binds neither (no fallback in either direction).
  CONSTRAINT generation_authorizations_credential_binding_ck
    CHECK (
      CASE billing_mode
        WHEN 'USER_BYO' THEN provider_connection_id IS NOT NULL AND provider_credential_version_id IS NOT NULL
        ELSE provider_connection_id IS NULL AND provider_credential_version_id IS NULL
      END
    ),
  -- Shape only, matching provider_connections_provider_ck.
  CONSTRAINT generation_authorizations_provider_ck CHECK (provider ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  CONSTRAINT generation_authorizations_model_ck CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
  -- A non-empty bounded object. COALESCE makes a NULL comparison fail.
  CONSTRAINT generation_authorizations_generation_request_ck
    CHECK (
      COALESCE(
        jsonb_typeof(generation_request) = 'object'
        AND generation_request <> '{}'::jsonb
        AND octet_length(generation_request::text) <= 16384,
        false
      )
    ),
  CONSTRAINT generation_authorizations_generation_request_sha256_ck
    CHECK (generation_request_sha256 ~ '^[0-9a-f]{64}$'),
  -- MICRO_USD is integer fixed-point USD; PROVIDER_CREDITS is a provider's
  -- own integer credit unit. Which unit applies to which provider is
  -- application capability policy.
  CONSTRAINT generation_authorizations_expected_cost_cap_unit_ck
    CHECK (expected_cost_cap_unit IN ('MICRO_USD', 'PROVIDER_CREDITS')),
  -- Positive and within the JavaScript safe-integer range.
  CONSTRAINT generation_authorizations_expected_cost_cap_amount_ck
    CHECK (expected_cost_cap_amount BETWEEN 1 AND 9007199254740991),
  CONSTRAINT generation_authorizations_status_ck CHECK (status IN ('ISSUED', 'CLAIMED', 'EXPIRED', 'CANCELLED')),
  CONSTRAINT generation_authorizations_claimed_at_ck CHECK ((status = 'CLAIMED') = (claimed_at IS NOT NULL)),
  CONSTRAINT generation_authorizations_expired_at_ck CHECK ((status = 'EXPIRED') = (expired_at IS NOT NULL)),
  CONSTRAINT generation_authorizations_cancelled_at_ck CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT generation_authorizations_expires_at_ck CHECK (expires_at > created_at),
  -- An authorization is claimable only before it expires, and cannot be
  -- recorded as expired before its expiry.
  CONSTRAINT generation_authorizations_claim_before_expiry_ck CHECK (claimed_at IS NULL OR claimed_at < expires_at),
  CONSTRAINT generation_authorizations_expired_after_expiry_ck CHECK (expired_at IS NULL OR expired_at >= expires_at),
  CONSTRAINT generation_authorizations_creation_idempotency_key_ck
    CHECK (creation_idempotency_key IS NULL OR char_length(creation_idempotency_key) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX generation_authorizations_creation_idempotency_key_uq
  ON generation_authorizations (account_id, production_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

CREATE INDEX generation_authorizations_production_list_ix
  ON generation_authorizations (account_id, production_id, created_at DESC, id);

CREATE INDEX generation_authorizations_credential_version_ix
  ON generation_authorizations (provider_credential_version_id)
  WHERE provider_credential_version_id IS NOT NULL;

CREATE INDEX generation_authorizations_grant_ix
  ON generation_authorizations (entitlement_grant_id);

-- Everything except the lifecycle fields is immutable once issued, and the
-- lifecycle only moves forward from ISSUED to exactly one terminal state.
-- Column-scoped grants already stop the runtime role updating provenance;
-- this trigger additionally makes it impossible for any role without
-- trigger-bypass authority, including the table owner.
CREATE FUNCTION generation_authorizations_guard_update() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.production_id IS DISTINCT FROM OLD.production_id
     OR NEW.entitlement_grant_id IS DISTINCT FROM OLD.entitlement_grant_id
     OR NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.model IS DISTINCT FROM OLD.model
     OR NEW.provider_connection_id IS DISTINCT FROM OLD.provider_connection_id
     OR NEW.provider_credential_version_id IS DISTINCT FROM OLD.provider_credential_version_id
     OR NEW.generation_request IS DISTINCT FROM OLD.generation_request
     OR NEW.generation_request_sha256 IS DISTINCT FROM OLD.generation_request_sha256
     OR NEW.expected_cost_cap_unit IS DISTINCT FROM OLD.expected_cost_cap_unit
     OR NEW.expected_cost_cap_amount IS DISTINCT FROM OLD.expected_cost_cap_amount
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.creation_idempotency_key IS DISTINCT FROM OLD.creation_idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'generation authorization provenance is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'ISSUED'
     AND (NEW.status IS DISTINCT FROM OLD.status
          OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
          OR NEW.expired_at IS DISTINCT FROM OLD.expired_at
          OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at) THEN
    RAISE EXCEPTION 'generation authorization lifecycle is terminal'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION generation_authorizations_guard_update() FROM PUBLIC;

CREATE TRIGGER generation_authorizations_guard_update
  BEFORE UPDATE ON generation_authorizations
  FOR EACH ROW EXECUTE FUNCTION generation_authorizations_guard_update();

-- Audit events may now record generation-authorization lifecycle events. The
-- constraint keeps its name; existing resource types are unchanged.
ALTER TABLE audit_events DROP CONSTRAINT audit_events_resource_type_ck;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_resource_type_ck
  CHECK (resource_type IN ('user', 'account', 'entitlement_grant', 'production', 'provider_connection', 'generation_authorization'));
