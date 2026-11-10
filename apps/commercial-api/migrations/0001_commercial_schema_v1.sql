-- 0001 commercial schema v1
--
-- Authority: docs/commercial/COMMERCIAL_DOMAIN_PERSISTENCE_ARCHITECTURE.md
--
-- Portable schema only. Runtime-role privileges are environment-specific and
-- are synchronised separately by the runtime-grant command
-- (src/database/runtimeGrants.ts); no role name appears in this file.
--
-- Executed by the migration runner inside one transaction with
-- search_path = public. Must not contain transaction control statements.

-- users: an external identity-provider principal. Identity authority is
-- (idp_issuer, idp_subject); email is an attribute and is never unique.
CREATE TABLE users (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  idp_issuer      text        NOT NULL,
  idp_subject     text        NOT NULL,
  email           text        NULL,
  email_verified  boolean     NOT NULL DEFAULT false,
  status          text        NOT NULL DEFAULT 'ACTIVE',
  disabled_at     timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_pk PRIMARY KEY (id),
  CONSTRAINT users_idp_identity_uq UNIQUE (idp_issuer, idp_subject),
  CONSTRAINT users_idp_issuer_ck CHECK (btrim(idp_issuer) <> '' AND char_length(idp_issuer) <= 512),
  CONSTRAINT users_idp_subject_ck CHECK (btrim(idp_subject) <> '' AND char_length(idp_subject) <= 255),
  CONSTRAINT users_email_ck CHECK (email IS NULL OR (btrim(email) <> '' AND char_length(email) <= 320)),
  CONSTRAINT users_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT users_disabled_ck CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);

-- accounts: the commercial ownership boundary. Only PERSONAL accounts are
-- valid in schema v1; one per owning user.
CREATE TABLE accounts (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  kind           text        NOT NULL,
  owner_user_id  uuid        NOT NULL,
  status         text        NOT NULL DEFAULT 'ACTIVE',
  disabled_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT accounts_pk PRIMARY KEY (id),
  CONSTRAINT accounts_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT accounts_kind_ck CHECK (kind IN ('PERSONAL')),
  CONSTRAINT accounts_status_ck CHECK (status IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT accounts_disabled_ck CHECK ((status = 'DISABLED') = (disabled_at IS NOT NULL))
);

CREATE UNIQUE INDEX accounts_personal_owner_uq
  ON accounts (owner_user_id)
  WHERE kind = 'PERSONAL';

-- entitlement_grants: server-authoritative commercial grants. HOSTED_TRIAL
-- and CREATOR are vocabulary only; entitlement_grants_v1_issuable_kind_ck
-- prevents inserting them until a later reviewed migration removes it.
CREATE TABLE entitlement_grants (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL,
  kind            text        NOT NULL,
  state           text        NOT NULL,
  source          text        NOT NULL,
  issuance_key    text        NOT NULL,
  policy_version  text        NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  reserved_at     timestamptz NULL,
  consumed_at     timestamptz NULL,
  revoked_at      timestamptz NULL,
  expired_at      timestamptz NULL,
  expires_at      timestamptz NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT entitlement_grants_pk PRIMARY KEY (id),
  CONSTRAINT entitlement_grants_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT entitlement_grants_account_scope_uq UNIQUE (account_id, id),
  CONSTRAINT entitlement_grants_issuance_uq UNIQUE (account_id, kind, source, issuance_key),
  CONSTRAINT entitlement_grants_kind_ck CHECK (kind IN ('FREE_BYO', 'HOSTED_TRIAL', 'CREATOR')),
  CONSTRAINT entitlement_grants_v1_issuable_kind_ck CHECK (kind = 'FREE_BYO'),
  CONSTRAINT entitlement_grants_state_ck CHECK (state IN ('AVAILABLE', 'RESERVED', 'CONSUMED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT entitlement_grants_source_ck CHECK (source IN ('ACCOUNT_PROVISIONING')),
  CONSTRAINT entitlement_grants_issuance_key_ck CHECK (issuance_key ~ '^[a-z0-9][a-z0-9:._-]{0,127}$'),
  CONSTRAINT entitlement_grants_policy_version_ck CHECK (btrim(policy_version) <> '' AND char_length(policy_version) <= 64),
  CONSTRAINT entitlement_grants_reserved_at_ck CHECK (state <> 'RESERVED' OR reserved_at IS NOT NULL),
  CONSTRAINT entitlement_grants_consumed_at_ck CHECK (state <> 'CONSUMED' OR consumed_at IS NOT NULL),
  CONSTRAINT entitlement_grants_revoked_at_ck CHECK (state <> 'REVOKED' OR revoked_at IS NOT NULL),
  CONSTRAINT entitlement_grants_expired_at_ck CHECK (state <> 'EXPIRED' OR expired_at IS NOT NULL)
);

-- At most one account-provisioned FREE_BYO grant per account, in every state:
-- consumption, revocation, expiry or a different issuance_key never reopen it.
CREATE UNIQUE INDEX entitlement_grants_initial_free_byo_uq
  ON entitlement_grants (account_id)
  WHERE kind = 'FREE_BYO' AND source = 'ACCOUNT_PROVISIONING';

-- productions: account-owned commercial productions. Many per account; the
-- first-production restriction is entitlement policy, not a constraint here.
-- The composite foreign key makes a production under another account's grant
-- structurally impossible.
CREATE TABLE productions (
  id                             uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id                     uuid        NOT NULL,
  title                          text        NOT NULL,
  creation_entitlement_grant_id  uuid        NOT NULL,
  created_by_user_id             uuid        NOT NULL,
  creation_idempotency_key       text        NULL,
  archived_at                    timestamptz NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT productions_pk PRIMARY KEY (id),
  CONSTRAINT productions_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT productions_creation_grant_same_account_fk
    FOREIGN KEY (account_id, creation_entitlement_grant_id)
    REFERENCES entitlement_grants (account_id, id) ON DELETE RESTRICT,
  CONSTRAINT productions_created_by_user_fk FOREIGN KEY (created_by_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT productions_account_scope_uq UNIQUE (account_id, id),
  -- Non-empty, at most 200 characters, no leading or trailing whitespace.
  CONSTRAINT productions_title_ck CHECK (char_length(title) BETWEEN 1 AND 200 AND title !~ '^\s' AND title !~ '\s$'),
  CONSTRAINT productions_creation_idempotency_key_ck
    CHECK (creation_idempotency_key IS NULL OR char_length(creation_idempotency_key) BETWEEN 1 AND 128)
);

CREATE UNIQUE INDEX productions_creation_idempotency_key_uq
  ON productions (account_id, creation_idempotency_key)
  WHERE creation_idempotency_key IS NOT NULL;

CREATE INDEX productions_account_list_ix
  ON productions (account_id, created_at DESC, id);

CREATE INDEX productions_creation_grant_ix
  ON productions (creation_entitlement_grant_id);

-- audit_events: operationally append-only control-plane audit evidence.
-- sequence is stable navigation order only, not proof of commit order.
CREATE TABLE audit_events (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  sequence        bigint      GENERATED ALWAYS AS IDENTITY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  account_id      uuid        NULL,
  actor_type      text        NOT NULL,
  actor_user_id   uuid        NULL,
  event_type      text        NOT NULL,
  resource_type   text        NOT NULL,
  resource_id     uuid        NOT NULL,
  correlation_id  uuid        NOT NULL,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT audit_events_pk PRIMARY KEY (id),
  CONSTRAINT audit_events_sequence_uq UNIQUE (sequence),
  CONSTRAINT audit_events_account_fk FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_type_ck CHECK (actor_type IN ('USER', 'SYSTEM')),
  CONSTRAINT audit_events_actor_ck CHECK ((actor_type = 'USER') = (actor_user_id IS NOT NULL)),
  CONSTRAINT audit_events_event_type_ck
    CHECK (char_length(event_type) <= 100 AND event_type ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  CONSTRAINT audit_events_resource_type_ck
    CHECK (resource_type IN ('user', 'account', 'entitlement_grant', 'production')),
  CONSTRAINT audit_events_metadata_ck
    CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 4096)
);

CREATE INDEX audit_events_account_ix ON audit_events (account_id, sequence);
CREATE INDEX audit_events_resource_ix ON audit_events (resource_type, resource_id);
CREATE INDEX audit_events_correlation_ix ON audit_events (correlation_id);

-- Defence in depth behind privileges: the runtime role is never granted
-- UPDATE, DELETE or TRUNCATE on audit_events. These triggers additionally
-- reject those operations for every other role, but the table owner,
-- migration owner or a superuser can still disable or drop them. This is
-- operational append-only protection, not cryptographic tamper evidence.
CREATE FUNCTION audit_events_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % rejected', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION audit_events_reject_mutation() FROM PUBLIC;

CREATE TRIGGER audit_events_reject_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation();

CREATE TRIGGER audit_events_reject_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_reject_mutation();

COMMENT ON TABLE audit_events IS
  'Append-only control-plane audit evidence. sequence is navigation order, not commit order. Never store secrets, tokens, credentials, paths or customer email in metadata.';
