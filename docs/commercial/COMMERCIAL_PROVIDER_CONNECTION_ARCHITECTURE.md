# Commercial Provider Connection Architecture Lock

COMMERCIAL_PROVIDER_CONNECTION_ARCHITECTURE_LOCK_2026_11_10

- **Status:** LOCKED for commercial BYO provider-connection planning.
- **Authority revision:** `64a9091f5573b0be9b204dc944bf1b24aa6f5f5a`
- **Parent architecture:**
  `docs/commercial/COMMERCIAL_CONTROL_PLANE_ARCHITECTURE.md` and
  `docs/commercial/COMMERCIAL_DOMAIN_PERSISTENCE_ARCHITECTURE.md`
- **Source:** R44B5A provider-connection security and lifecycle discovery.

**Implementation authority:** None. This document records architecture
decisions only. It does not authorise migrations, tables, sealing code, key
management integration, secret storage, HTTP routes, provider verification,
engine changes, provider calls or generation.

Provider-specific statements in this document are marked as **current
external capability**. They inform the provider capability policy; they are
not permanent BusyBookie invariants.

---

## 1. Domain ownership

- A `ProviderConnection` is owned by an `Account`. It is not owned by a User,
  a Production or a GenerationAuthorization.
- An Account may own several ProviderConnections, including several to the
  same provider (for example different provider projects or budgets).
- No numeric connection limit is established here.
- Productions and future GenerationAuthorizations may reference a connection;
  they never own the credential.
- Cross-account use is forbidden both structurally (composite foreign keys,
  section 21) and at the application layer (owner-scoped queries).

---

## 2. Connection versus credential version

Two separate concepts.

### 2.1 ProviderConnection

Stable logical identity carrying only non-secret metadata. Conceptually:

- `id` (opaque UUID);
- `account_id`;
- `provider`;
- `credential_kind`;
- user-supplied label;
- connection lifecycle state;
- verification metadata;
- `created_by_user_id`;
- timestamps.

### 2.2 ProviderCredentialVersion

Versioned secret material belonging to one ProviderConnection. Conceptually:

- `id` (opaque UUID);
- `account_id`;
- `provider_connection_id`;
- version number;
- version lifecycle state;
- sealed envelope (ciphertext) or external secret reference;
- sealing metadata (key reference and version, algorithm identifier,
  associated-data version);
- keyed fingerprint;
- timestamps.

A credential version's secret material is immutable once written. Rotation
never replaces the ProviderConnection ID; it creates a new credential version
(section 14).

---

## 3. Credential kinds

- ProviderConnection is provider-neutral and credential-form-neutral.
- There is no `api_key` column. A credential-kind dimension is required.
- The first commercial implementation may support only API-key-like
  credentials, but the design must admit future mechanisms such as provider
  OAuth without changing the ownership model.
- Customer-supplied service-account private-key JSON is not supported. Google
  Gemini authorization keys are service-account-backed on Google's side but
  remain API-key credentials from BusyBookie's perspective.

---

## 4. Provider vocabulary and capability registry

- Provider names are controlled server-side vocabulary. Arbitrary
  customer-supplied provider strings are rejected.
- Commercial provider support is controlled by a versioned application
  capability registry, so changing which providers are commercially supported
  does not require a database migration.
- The registry will define, per provider:
  - supported credential kinds;
  - commercial enablement;
  - verification capability;
  - recovery behaviour;
  - recovery horizon;
  - supported models and capabilities;
  - provider identity/project metadata capability.
- Engine provider names (for example `RUNWAY`, `VEO`, `GOOGLE_GENAI` in the
  engine's execution policy) and commercial provider enablement are separate
  concerns.

---

## 5. Secret handling

`PLAINTEXT_SECRET_IN_DATABASE=NO`

A provider credential is never persisted in plaintext in:

- PostgreSQL;
- audit events;
- logs;
- analytics;
- engine evidence;
- browser storage;
- HTTP responses;
- exception or error text.

- The browser sends a credential only over TLS, in a request body. Never in a
  URL or query string. Never in localStorage or sessionStorage.
- The public API accepts plaintext only long enough to validate its shape,
  compute its fingerprint and seal it.
- Node.js cannot guarantee memory zeroisation. The guarantee is:
  **plaintext is not intentionally retained or persisted after sealing.**

---

## 6. Mandatory sealing

`SECRET_SEALING_REQUIRED=YES`

Production storage requires a cryptographic sealing abstraction with two
conceptually separate capabilities:

```text
seal(plaintext, context) -> sealed envelope
open(envelope, context)  -> plaintext          (execution side only)
```

- Sealing uses authenticated encryption supplied by a vetted platform, key
  management service or library.
- No custom or home-grown cryptography.

---

## 7. Public API decrypt authority

`PUBLIC_API_ROUTINE_DECRYPT_AUTHORITY=NO`

The internet-facing commercial API may:

- receive a new customer credential;
- fingerprint it;
- seal it;
- persist the envelope and its metadata.

It has no ordinary authority to open stored provider credentials. Opening
belongs to the private execution worker or a narrowly scoped execution-side
key service.

Future OAuth callback and token-exchange behaviour is outside this lock. It may
need a narrowly defined exception for exchanging an ephemeral authorization
code, but it must not grant the public API broad authority to decrypt stored
secrets.

---

## 8. Encryption context binding

Sealing binds authenticated associated data containing at least:

- `accountId`;
- `providerConnectionId`;
- `provider`;
- `credentialVersion`;
- a versioned purpose, for example `provider-credential`.

- An envelope copied to another Account, connection, provider or credential
  version must fail authentication when opened.
- The canonical encoding of the associated data is specified before
  implementation (R44B5C) and is itself versioned.

---

## 9. Key management capabilities

No key-management or secrets vendor is selected. The production mechanism
must provide:

- encryption or sealing;
- opening or decryption;
- separate permissions for the public API (seal only) and the execution side
  (open);
- key versioning;
- rotation without losing access to earlier versions;
- auditability of opening operations;
- high availability;
- controlled key deletion;
- region and residency controls;
- defined backup and disaster-recovery behaviour;
- workload identity or an equivalent non-static credential for the API and
  worker;
- fail-closed behaviour when unavailable.

The production vendor remains open until the hosting and deployment
architecture is chosen. A development/test implementation exposes the same
interface, uses generated fixture values only and cannot be selected in
production by an environment switch.

---

## 10. Fingerprinting

- Fingerprints use a keyed MAC (for example HMAC-SHA-256) with a key distinct
  from every encryption key.
- Raw SHA-256 of a credential is prohibited: credential formats are
  predictable enough to make offline guessing feasible.
- Purpose: duplicate detection within one Account, operational diagnostics,
  safe connection matching.
- A fingerprint is never authentication authority and the full fingerprint is
  never exposed to the browser.
- Credentials are opaque secrets. The fingerprint is computed over the exact
  accepted credential representation. No trimming, lowercasing, case folding
  or other generic normalisation, unless a provider-specific credential
  specification explicitly defines a canonical form.

---

## 11. Duplicate credentials

- Duplicate detection is Account-scoped.
- There is no global uniqueness rule across Accounts: such a rule could reveal
  that another customer uses the same provider credential.
- Within one Account, a duplicate active credential may be refused by
  fingerprint comparison and policy.

---

## 12. Lifecycle

Connection state and credential-version state are separate axes. One state
field never represents both.

### 12.1 ProviderConnection

At minimum, conceptually:

- pending / unverified;
- active;
- invalid;
- disconnected;
- disabled;
- destroyed (a non-secret historical record).

### 12.2 ProviderCredentialVersion

At minimum, conceptually:

- active;
- superseded;
- retained for recovery;
- destroyed.

The exact database vocabulary is locked before the migration is implemented
(R44B5D). Every material transition records an audit event (section 25).

---

## 13. Verification

```text
stored          != provider verified
provider verified != guaranteed usable for generation
```

- Verification is never performed by creating a generation.
- Verification uses only a provider-specific, allowlisted, non-generating
  operation whose cost and side effects have been confirmed.
- If no safe verification operation is confirmed for a provider, the
  connection may remain unverified until execution policy decides otherwise.
- Verification that requires opening the credential happens on the execution
  side, never through routine public-API decryption.
- Verification calls go only to fixed provider endpoints defined in code,
  never to customer-supplied URLs.
- Exact verification endpoints remain open (section 30).

---

## 14. Rotation

`CREDENTIAL_VERSIONING_REQUIRED=YES`

- Rotation keeps the ProviderConnection ID stable and creates a new credential
  version.
- New generations use the latest eligible version.
- Earlier versions are retained only while already-authorised work or recovery
  needs them, then destroyed.
- Rotation never rewrites the credential provenance of an existing
  GenerationAuthorization.

---

## 15. Generation provenance

`GENERATION_BINDS_EXACT_CREDENTIAL_VERSION=YES`

Every future `USER_BYO` GenerationAuthorization records:

- the ProviderConnection ID;
- the credential version ID actually selected at authorization/submission;
- the provider;
- the billing mode.

This version is immutable provenance.

---

## 16. Recovery credential rule

1. The credential version used for submission is permanently recorded as
   provenance.
2. Recovery uses that exact version by default.
3. No substitute credential is ever selected silently.
4. A different credential version may be considered in future only when all
   of the following hold:
   - it belongs to the same ProviderConnection;
   - BusyBookie can prove both versions identify the same provider project or
     account;
   - provider documentation or testing establishes that recovery with another
     key of that project or account is valid;
   - an explicit provider capability policy allows it;
   - the substitution is recorded and audited as a recovery rebinding.
5. Until those conditions are implemented and proven, recovery remains pinned
   to the original credential version.

- `RECOVERY_DEFAULTS_TO_ORIGINAL_VERSION=YES`
- `RECOVERY_CREDENTIAL_SUBSTITUTION_SILENT=NO`
- `RECOVERY_CREDENTIAL_SUBSTITUTION_CURRENTLY_ENABLED=NO`

---

## 17. Disconnect

`DISCONNECT_CAN_BREAK_OPEN_RECOVERY=NO`

Disconnect is logical. When a customer disconnects:

- the connection immediately stops being eligible for new generation
  authorizations;
- queued but unclaimed work is cancelled where safe;
- only the credential versions required by already authorised, claimed,
  submitted or recovery work are retained, and are marked recovery-only;
- the UI and API may report the connection as disconnected immediately;
- retained credential material is destroyed once those recovery obligations
  are terminal or expired.

A credential is never physically destroyed while authorised open recovery
still depends on it.

---

## 18. Disconnect versus provider revocation

These are separate facts with separate state and event semantics:

- **Customer disconnect** is a BusyBookie-side lifecycle action taken by the
  customer.
- **Provider revocation** is the provider rejecting or disabling the
  credential externally.

A provider-revoked credential may become invalid without BusyBookie ever
receiving a disconnect request.

---

## 19. Secret destruction

1. The connection or version is disabled for new use.
2. It is retained only for already-bound recovery, where necessary.
3. All recovery obligations complete or expire.
4. The envelope, or the external secret reference and its secret, is
   destroyed.
5. Non-secret provenance and audit metadata remain.

- The fingerprint is destroyed with the secret unless later policy establishes
  a concrete reason to retain it.
- Immediate erasure from backups is not claimed. Backup retention and privacy
  terms remain future policy.

---

## 20. USER_BYO versus PLATFORM_HOSTED

Future GenerationAuthorization records encode the billing and credential
source so that the database structurally enforces:

| Billing mode | User ProviderConnection | User credential version | Platform credential reference |
|---|---|---|---|
| `USER_BYO` | required | required | NULL |
| `PLATFORM_HOSTED` | NULL | NULL | required |

- `USER_BYO_CAN_FALL_BACK_TO_PLATFORM_CREDENTIAL=NO`
- `PLATFORM_HOSTED_CAN_FALL_BACK_TO_USER_CREDENTIAL=NO`

There is no fallback logic. The execution side resolves a credential only from
the authorization's binding.

---

## 21. Cross-account enforcement

`PROVIDER_CONNECTION_CROSS_ACCOUNT_USE=NO`

- Future schema uses Account provenance and composite foreign keys comparable
  to the existing Production/EntitlementGrant model.
- A GenerationAuthorization cannot bind Account A's Production to Account B's
  ProviderConnection or credential version.
- Queries remain owner-scoped to the authenticated Account.

---

## 22. Worker access

The worker receives only what the claimed authorization requires:

- the authorization/job ID;
- the provider;
- the approved model and policy;
- the ProviderConnection ID;
- the credential version ID or reference;
- the account context needed to validate the associated data.

The worker never receives:

- an Account-wide secret inventory;
- browser authentication credentials;
- identity-provider tokens;
- unrelated ProviderConnections;
- other customers' credentials.

A decrypted credential exists only in worker or key-service memory for the
duration of the provider operation or recovery.

---

## 23. Engine bridge requirements

R44B6 removes the global-environment credential assumption from commercial
execution. It must:

- inject a per-authorization credential;
- create a tenant-scoped execution namespace;
- accept Production inputs from outside Git;
- record commercial credential provenance;
- preserve existing provider execution and recovery behaviour where safe.

Existing CLI paths that read `RUNWAYML_API_SECRET` and `GEMINI_API_KEY`
remain valid for private operator workflows but are unsafe as the commercial
multi-tenant execution mechanism. They are not modified in R44B5.

---

## 24. Engine evidence

Future commercial execution evidence includes non-secret provenance such as:

- the billing mode;
- the ProviderConnection ID;
- the original credential version ID;
- the platform credential reference for hosted runs;
- the provider;
- the provider execution ID or its hash.

Raw credentials, access tokens and refresh tokens are never persisted. Evidence
schema changes belong to R44B6 and must be additive and versioned, because the
current evidence schemas are strict.

---

## 25. Audit events

Future vocabulary, at minimum:

- `provider_connection.created`
- `provider_connection.verified`
- `provider_connection.verification_failed`
- `provider_connection.credential_rotated`
- `provider_connection.invalidated`
- `provider_connection.disconnected`
- `provider_connection.disabled`
- `provider_connection.secret_destroyed`

- Metadata contains only safe identifiers and reason codes.
- No credential, no fingerprint, no provider access token.
- Per-decrypt events belong to the key-management/security audit, not to
  control-plane AuditEvents.

---

## 26. Persistence direction

Two tables, conceptually:

- `provider_connections`
- `provider_credential_versions`

No SQL is defined here. The later migration (0002):

- is additive; migration 0001 is not modified;
- widens `audit_events_resource_type_ck` to include `provider_connection`;
- extends the runtime-role grant manifest with narrowly scoped SELECT, INSERT
  and column-scoped UPDATE, and no DELETE or DDL.

---

## 27. Boundary-test implication

The current commercial-api boundary test forbids provider-name words (Runway,
Veo, Gemini, GenAI) and secret vocabulary such as `API_KEY` and `API_SECRET`
anywhere in commercial-api source. R44B5 implementation must narrow that test
deliberately, as a reviewed change, not remove it.

Allowed after the change:

- provider names as controlled commercial data and vocabulary.

Still forbidden:

- provider SDK imports;
- engine provider modules;
- `loadEnvironment`;
- provider credential environment-variable names;
- operator and provider execution implementations.

---

## 28. Future HTTP direction (design only)

- `POST /provider-connections`
- `GET /provider-connections`
- `GET /provider-connections/:id`
- `POST /provider-connections/:id/credentials` (rotation)
- `POST /provider-connections/:id/verify`
- `POST /provider-connections/:id/disconnect`

- Disconnect is an explicit POST rather than DELETE, because it is logical and
  secret destruction may be deferred.
- Every route is authenticated and Account-scoped.
- Missing and foreign connection IDs are indistinguishable.
- Responses never contain a secret or a fingerprint.
- These routes are not implemented by this lock.

---

## 29. Current external capability

These facts were established from official provider documentation during
R44B5A. They inform the capability registry and may change; they are not
BusyBookie invariants.

- **Runway:** API keys sent as bearer tokens; keys are scoped to a Runway API
  project, shown only once, and disabled rather than rotated; no customer
  OAuth flow is documented; a read-only organisation-information endpoint
  exists, but its cost and side effects are unconfirmed.
- **Google Gemini API (the engine's current Google path):** API keys sent in
  the `x-goog-api-key` header; Google distinguishes standard keys from
  service-account-bound authorization keys, makes authorization keys the
  default for new keys and rejects unrestricted standard keys; OAuth is
  documented as a developer setup, not as a third-party customer flow; Google
  advises against user-managed service-account keys; Files API objects expire
  after 48 hours.
- **BusyBookie engine (repository fact):** uses the Gemini Developer API with
  API keys, not Vertex AI, OAuth or service accounts; its automated Google
  recovery horizon is 24 hours from submission.

---

## 30. Open decisions

- production key-management or secrets vendor;
- hosting/cloud vendor;
- region;
- exact provider-verification endpoints and their confirmed cost and side
  effects;
- whether unverified connections can be used for generation;
- Runway recovery horizon;
- provider-specific support for recovery with rotated credentials
  (section 16);
- Google OAuth support;
- whether a default connection per provider exists;
- retention of provider project or account identifiers;
- audit retention;
- commercially enabled providers;
- session transport and its CSRF implications.

---

## 31. Threat-model invariants

| Threat | Mitigation boundary |
|---|---|
| Stolen database dump | Only sealed envelopes and keyed fingerprints are stored; key-management keys are not in the database |
| Public API compromise | Seal-only authority: stored credentials cannot be opened; credentials submitted during the compromise are exposed; opening is audited |
| Worker compromise | Opening scoped to claimed authorizations by associated data and a narrow role; audit; plaintext held only for the operation; worker isolation |
| Telemetry or log leakage | No body logging on credential routes; logs carry codes only; redaction tests |
| Cross-account access | Owner-scoped queries; identical not-found responses; composite foreign keys |
| Ciphertext transplant | Associated data binds account, connection, provider, version and purpose; opening fails |
| Key rotation during in-flight work | Authorizations pinned to the exact credential version |
| Disconnect during recovery | Logical disconnect with retain-for-recovery; destruction only after obligations end |
| Key-management outage | Fail closed for credential creation and execution; non-secret metadata stays readable |
| Provider credential leak or revocation | Detected as invalid; customer rotates; revocation kept distinct from disconnect |
| SSRF through verification | Fixed provider endpoints in code; no customer-supplied URLs |
| Replay of create or rotate requests | Idempotency keys and Account-scoped fingerprint duplicate checks |
| USER_BYO / platform credential mix-up | Billing-mode constraint plus no fallback path |

---

## 32. Implementation order after this lock

### R44B5C

Sealing and fingerprinting interfaces, a deterministic test-only
implementation and context-binding tests. No database, no routes, no provider
calls.

### R44B5D

Migration 0002: `provider_connections`, `provider_credential_versions`, the
audit resource-type widening, runtime grant changes, and catalog and privilege
tests.

### R44B5E

ProviderConnection domain services and HTTP routes: create, list, get, rotate,
disconnect. Only the injected test sealer, in test compositions. No production
key management. No provider calls.

### R44B5F

Select and implement the production key-management sealer after the hosting
decision.

### R44B6

Commercial engine bridge and worker-side credential opening.

### R44B7

GenerationAuthorization and the usage ledger.

COMMERCIAL_PROVIDER_CONNECTION_ARCHITECTURE_LOCK_END_2026_11_10
