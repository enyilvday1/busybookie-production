# Commercial Control-Plane Architecture Lock

COMMERCIAL_CONTROL_PLANE_ARCHITECTURE_LOCK_2026_11_09

**Status:** LOCKED for commercial control-plane planning.
**Authority revision:** `b7db7b96bc148dcf3b26b6f9b4d8b79226d4b982`
**Source:** R44B0A commercial product architecture discovery.
**Implementation authority:** None. This document records architecture
decisions only. It does not authorise application code, packages, databases,
migrations, authentication, routes, dependencies, provider calls, generation,
billing, or changes to the operator console or production runtime.

The commercial strategy itself is recorded in
`docs/commercial/BUSYBOOKIE_FREE_BYO_HOSTED_TRIAL_BACKLOG.md`. This document
does not change it. Unresolved commercial values in that backlog remain
unresolved here.

---

## 1. Purpose

Define the architecture through which the commercial product adds customer
accounts, entitlements, production ownership, provider connections and,
eventually, tightly bounded Hosted Trial execution, without exposing the
private operator surface and without creating a second production authority.

---

## 2. Architecture decision

The commercial product is split into three planes.

### 2.1 Public marketing plane

`apps/commercial-web`

- Static public marketing frontend.
- No operator credentials.
- No provider credentials.
- No production filesystem access.
- No direct production-engine access.

### 2.2 Commercial control plane

Future service: `apps/commercial-api`

Responsibilities:

- authenticated customer identity;
- Account authority;
- entitlement authority;
- production ownership;
- provider-connection metadata;
- generation authorizations;
- Hosted Trial reservations;
- usage and accounting records;
- the customer-facing API.

It is a separate service from the private operator server. It lives under
`apps/`, outside the root `tsconfig` include set, so it is not part of the
engine's compiled `dist` or its portable release identity.

### 2.3 Private execution plane

The existing BusyBookie production runtime plus a future commercial execution
worker.

The worker:

- runs on the private production side;
- polls outward for authorised jobs;
- is the only commercial component permitted to invoke the production engine;
- preserves the engine's single-writer and durable-lifecycle safety;
- reports state back to the commercial control plane;
- requires no public inbound port on the private engine host.

### 2.4 Selected option

The selected direction is a separate commercial API service in this
repository, combined with an outbound-polling execution worker bridge.

Rejected alternatives:

- **Extend the operator server.** Rejected; see section 3.
- **Separate commercial repository.** Rejected for now. It would duplicate
  schemas and lifecycle vocabulary, require two release identities and allow
  the contract between them to drift, without a security gain over enforced
  import boundaries. It remains available as a later split.
- **Engine-exposed private RPC called synchronously by the API.** Rejected.
  It requires inbound access to the private host and couples customer web
  requests to the single production writer.

---

## 3. Operator server is not the public commercial API

`src/operatorServer/*` is **not** the future public commercial API.

Reasons:

- it is loopback-only by design (`127.0.0.1`, Host and Origin allowlists);
- its authentication is a launch-scoped operator token printed to the
  attached terminal;
- it assumes a single trusted operator;
- it runs in close proximity to the private production runtime;
- it has no multi-user isolation;
- exposing it publicly would collapse the existing trust boundary.

The commercial API must not import or expose the operator server.

The private deployment runbook (`deployment/README.md`) independently states
that the operator API is loopback-only and is not the future public SaaS API.
Port 4381 must never become the public SaaS API.

---

## 4. Current engine limitations

The following blockers to commercial generation exist in the current engine:

- production inputs live in Git/repository-controlled structures
  (`episodes/EP##/episode.json`, bound to the repository root by input
  binding);
- production identities use BusyBookie-specific `EP##` / scene / shot
  conventions;
- execution storage has no commercial tenant namespace;
- provider credentials are process-oriented and global
  (`RUNWAYML_API_SECRET`, `GEMINI_API_KEY` from the process environment);
- no account or customer ownership exists inside engine lifecycle data;
- current media-root records may contain absolute filesystem paths;
- one trusted operator owns the production context.

Therefore:

**No customer BYO or Hosted Trial generation is authorised until the engine
bridge solves these boundaries.**

These limitations do not block the control-plane foundation.

---

## 5. Locked dependency sequence

1. Commercial account/authentication contract.
2. Entitlement domain.
3. `FREE_BYO` issuance.
4. Production ownership.
5. Authenticated customer application shell.
6. Provider-connection lifecycle.
7. Commercial engine bridge.
8. BYO generation authority plus usage ledger.
9. Hosted Trial reservation/consumption.
10. Billing and paid Creator.

`HOSTED_TRIAL` and `CREATOR` may exist as domain vocabulary before they can be
issued.

Paid Creator is not implementable until billing and the related commercial
decisions are resolved.

Generation-facing steps (7 to 9) are additionally subject to the backlog's
implementation-timing condition: the core engine must first demonstrate
reliable execution and recovery.

---

## 6. Minimum commercial domain

### 6.1 User

Represents an external identity-provider subject.

- Immutable external subject identifier.
- Email is an attribute, not identity.
- Account state remains server-authoritative.

### 6.2 Account

The commercial ownership boundary.

Owns:

- productions;
- entitlement grants;
- future provider connections.

Teams are not implemented. Future memberships must be addable without
migrating production ownership away from Account.

### 6.3 EntitlementGrant

A server-authoritative commercial grant.

Initial kinds:

- `FREE_BYO`
- `HOSTED_TRIAL`
- `CREATOR`

Only `FREE_BYO` is intended to be issued in the first foundation slice.

### 6.4 Production

A commercial customer production.

- Opaque commercial identifier (UUID).
- `ownerAccountId`.
- Title and basic metadata.
- Entitlement/grant association where appropriate.

Commercial Production IDs must never be BusyBookie `EP##` IDs.

### 6.5 AuditEvent

An append-only commercial control-plane audit record.

It must capture material account, entitlement and production transitions.

---

## 7. Entities deliberately deferred

Not required in schema v1 unless later discovery proves otherwise:

- Workspace;
- Membership;
- Subscription;
- billing/customer payment objects;
- ProviderConnection;
- GenerationAuthorization;
- UsageLedgerEntry.

ProviderConnection, GenerationAuthorization and UsageLedgerEntry are planned
future domain concepts, but they are not necessary for the first schema
foundation.

Hosted Trial does not require a separate `HostedTrialEntitlement` table at
this stage. It is represented through entitlement/grant semantics unless later
transaction design demonstrates otherwise.

---

## 8. Separate commercial axes

Three independent concepts. They must not be collapsed into one `plan` enum.

### 8.1 Access entitlement

Examples: `FREE_BYO`, `CREATOR`.

Controls commercial workflow and features.

### 8.2 Generation billing mode

Examples: `USER_BYO`, `PLATFORM_HOSTED`.

Records who economically funds a particular generation.

### 8.3 Generation execution authority

A future per-generation server-side authorization. It will bind:

- account;
- production;
- entitlement/grant;
- billing mode;
- credential source;
- provider;
- model/policy;
- cost ceiling where applicable;
- idempotency identity.

`HOSTED_TRIAL` is primarily a bounded grant/authorization source, not a
permanent access tier. An account with a `FREE_BYO` access entitlement may
also hold a `HOSTED_TRIAL` grant, and a future `CREATOR` account may fund
generations under either billing mode.

---

## 9. Entitlement lifecycle

The domain must be able to represent:

- `AVAILABLE`
- `RESERVED`
- `CONSUMED`
- `REVOKED`
- `EXPIRED`

Not every grant kind must traverse every state.

State transitions are server-authoritative and transactional, and each
material transition produces an AuditEvent.

The browser never supplies a trusted:

- plan;
- entitlement;
- account role;
- billing mode;
- generation permission.

---

## 10. FREE_BYO principle

- First-production value is the current preferred free model.
- Provider generation is user-funded.
- The provider bills the user directly.
- The commercial platform controls entitlement, not provider billing.
- Exact runtime, shot and other numeric limits remain unresolved.
- Recovery of an already-created provider job must not consume a fresh
  entitlement.
- Watermark, sharing and export rules remain open.

This document approves no numeric limit. Where a decision depends on an
unresolved limit, the control plane fails closed.

---

## 11. Production cardinality

The database schema must permit multiple Productions per Account.

The first commercial entitlement may initially authorise only the bounded
first-production flow, and that policy may fail closed around additional
productions.

No permanent unique constraint may limit an Account to one Production.

Production cardinality is commercial policy, enforced by entitlement logic,
not a property of the ownership structure.

---

## 12. Provider-secret invariants

No KMS, secret manager or cryptographic product is selected here.

Invariants:

- provider secrets enter only over TLS;
- no provider secret in Git;
- no provider secret in frontend storage;
- no provider secret in logs, analytics or audit payloads;
- no provider secret returned from the public API;
- no plaintext persistent provider secret;
- no credential may cross Account boundaries;
- BYO credentials and platform Hosted Trial credentials must never fall back
  to one another;
- stored customer credentials must not be broadly decryptable by the public
  internet-facing application process;
- decryption authority belongs at the narrowest execution-side boundary
  practical.

Recovery of a provider execution must use the same credential source that
created it. The future provider-connection design must account for this when
defining disconnect and revocation.

The future provider-connection design will select OAuth, envelope encryption,
KMS, Vault, sealed credential storage or another concrete mechanism.

---

## 13. Hosted Trial invariants

- Optional and availability-dependent.
- Bounded.
- Not recurring free hosted generation.
- Eligibility is server-authoritative.
- Reservation is atomic.
- Idempotent retries return the same authorization.
- Once execution has been claimed by the worker, the entitlement cannot be
  automatically returned.
- Acceptance uncertainty permits recovery only.
- Recovery targets the same provider execution.
- Recovery does not consume another trial.
- No automatic replacement generation after uncertain provider acceptance.

The engine's existing reservation, submission, completion and recovery records
remain authoritative inside the execution plane. The control plane wraps them
with grant and authorization state; it does not replace them.

Final provider, model, monetary amount, duration and detailed eligibility
remain unresolved.

---

## 14. Production ownership

Every commercial operation is scoped from the authenticated Account.

An account ID supplied by the browser is never authorization.

For owned resources:

- load the authenticated Account from server-side identity/session;
- scope every query by that Account;
- do not reveal whether a foreign production exists;
- never expose filesystem paths to customer APIs.

A later engine bridge maps commercial Production IDs to private execution
namespaces.

---

## 15. Persistence

A transactional relational database is required for the commercial control
plane.

Preferred technical baseline: **PostgreSQL**.

Technical reasons:

- atomic entitlement + production + audit transactions;
- uniqueness constraints;
- concurrent customer requests;
- owner-scoped queries;
- transactional reservation;
- idempotency enforcement;
- row locking;
- future transactional-outbox / `SKIP LOCKED` job polling;
- mature migration tooling.

Not selected here:

- database hosting vendor;
- managed versus self-hosted deployment;
- ORM/migration library.

The production engine's existing durable filesystem lifecycle remains
authoritative inside the execution plane. Engine persistence is not migrated
into PostgreSQL in this phase.

---

## 16. Authentication contract

Any future identity provider must support:

- an immutable stable subject;
- server-side verification;
- issuer/audience/expiry validation;
- session/token expiry;
- verified-email state where required;
- account disabling;
- future MFA capability.

The commercial API remains authoritative for:

- Account status;
- entitlement;
- ownership;
- commercial permissions.

Client-provided plan or role claims are never trusted.

The identity vendor is not selected here. The final product name and domain
are a dependency of production authentication deployment.

---

## 17. Deployment topology

```text
Browser
  |
  +--> commercial-web / future customer web UI
  |
  +--> commercial-api
           |
           +--> PostgreSQL
           |
           +--> future credential/key boundary
           |
           +--> durable commercial job authority
                       ^
                       |
                outbound polling
                       |
             private execution worker
                       |
                BusyBookie engine
                       |
                production media root
                       |
                   providers
```

- The private operator server remains private.
- Port 4381 must never become the public SaaS API.
- The production media root is never served publicly. Customer output delivery
  requires a separate later design.

---

## 18. First authenticated slice

The first real authenticated commercial slice should eventually provide:

- an authentication adapter;
- User provisioning;
- Account provisioning;
- an idempotent `FREE_BYO` grant;
- create/list/get of an owned Production shell;
- audit events;
- a customer view of entry mode and entitlement state.

Explicitly excluded:

- provider credentials;
- generation;
- Hosted Trial consumption;
- checkout;
- billing;
- Creator issuance;
- public production launch.

The first slice initially remains development/private-staging only.

---

## 19. Current blockers

### 19.1 Block generation, not the control-plane foundation

- tenant-safe engine bridge;
- production inputs outside Git;
- commercial execution namespace;
- per-execution credentials;
- current engine reliability/live recovery gate;
- final Free limits;
- Hosted Trial provider/model/amount.

### 19.2 Block provider-credential implementation

- concrete secret-management design.

### 19.3 Block production public signup

- final commercial identity/domain;
- production identity-provider configuration;
- privacy/terms/compliance review.

### 19.4 Block Creator

- billing architecture;
- pricing;
- commercial entitlements.

### 19.5 Non-blocking

- team design;
- final watermark policy;
- final social-publishing policy;
- final production limits for the schema foundation.

---

## 20. Explicit exclusions

This architecture lock does not authorise:

- code under `apps/commercial-api`;
- database creation;
- schema migrations;
- authentication implementation;
- signup;
- public API routes;
- provider connection;
- provider API calls;
- generation;
- Hosted Trial issuance;
- billing;
- changes to the operator console;
- changes to the production runtime.

COMMERCIAL_CONTROL_PLANE_ARCHITECTURE_LOCK_END_2026_11_09
