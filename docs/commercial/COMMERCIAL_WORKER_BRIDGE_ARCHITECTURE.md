# Commercial Worker Bridge Architecture Lock

COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE_LOCK_2026_11_10

- **Status:** LOCKED for the commercial-to-private-engine worker bridge.
- **Authority revision:** `71ff252e6c92d493fbf5b32907ba50cf6ec27bf6`
- **Parent architecture:**
  `docs/commercial/COMMERCIAL_CONTROL_PLANE_ARCHITECTURE.md`,
  `docs/commercial/COMMERCIAL_DOMAIN_PERSISTENCE_ARCHITECTURE.md` and
  `docs/commercial/COMMERCIAL_PROVIDER_CONNECTION_ARCHITECTURE.md`
- **Source:** R44B6A commercial-to-private-engine bridge discovery.
- **Revisions:** R44B6D1 (definitive provider rejection and provider
  execution ID scope); R44B6K (submission lifecycle and durable
  provider-acceptance journal, revised at `e18b59b521881b9c78fffe5bc28e32196a3db375`:
  sections 10, 12, 15 to 18, 23, 24, 26, 27, 29 to 31, 36 and 37);
  R44B6K1 (token-less recovery only from `OUTCOME_UNKNOWN`, the migration
  0005 contract, the exact `recordSha256` preimage, the provider-create
  retry prohibition and cross-reference corrections: introduction, sections
  12, 13, 16 to 18, 26, 30, 31, 36 and 37); R44B6K5 (wall-clock
  provider-call authority barrier erratum: sections 12, 26, 36 and 37);
  R44B6M2 (`SUBMITTED` heartbeat lease-epoch authority: sections 10, 12, 18,
  36 and 37); R44B6N (migration 0006 lease-epoch provenance implemented and
  `SUBMITTED` heartbeat enabled for the exact live-route epoch only: sections
  10, 12, 18, 36 and 37); R44B6O1 (live `submitted` route implemented by
  R44B6O, with no worker flow calling it yet: sections 10, 18, 36 and 37);
  R44B6P1 (acceptance journal v1 and the worker `submitted` client
  implemented by R44B6P, not yet invoked by execution code, plus the
  exact-record retry rule: sections 17, 18, 36 and 37); R44B6Q1 (R44B6Q
  local startup journal reconciliation and the fail-closed new-work gate
  implemented, with acceptance recovery then deferred: introduction,
  sections 17, 18, 31, 36 and 37); R44B6R1 (R44B6R control-plane
  acceptance-recovery route implemented, preserving the original submission
  epoch and two-transaction expiry handoff; worker recovery wiring still
  deferred: introduction, sections 10, 17, 18, 30, 31, 36 and 37);
  R44B6S0 (worker startup acceptance-recovery retry policy locked for future
  R44B6S implementation; no runtime change: introduction, sections 17, 31
  and 37).

```text
ARCHITECTURE_STATUS=LOCKED
BRIDGE_DIRECTION=PRIVATE_WORKER_OUTBOUND_TO_COMMERCIAL_CONTROL_PLANE
PUBLIC_INBOUND_ENGINE_PORT_REQUIRED=NO
```

**Implementation authority:** None. This document records architecture
decisions only. It does not authorise migrations, tables, routes, packages,
worker code, key-management integration, object storage, provider calls,
credential validation calls or generation. Each implementation step in
section 36 requires its own explicitly authorised gate.

### How to read this document

- **Repository fact** marks something R44B6A observed in the code at the
  authority revision. Facts can change; when they do, the dependent decision
  must be re-reviewed.
- **Locked decision** marks a binding design rule for R44B6 and later
  implementation steps.
- **Deferred** marks a decision deliberately left open, with the gate that
  must close it.
- **Open provider fact** marks external provider behaviour that R44B6A did
  not prove. Open provider facts are never implementation assumptions.

Where this document and a parent authority appear to conflict, the parent
authority's security invariants win and the conflict is resolved by a
deliberate architecture revision, never by silent divergence.

---

## 1. Fundamental topology

**Locked decision.**

```text
Customer Browser
        |
        v
Public commercial-api
        |
        +---- PostgreSQL
        |
        +---- object-storage control metadata
        ^
        |
        | outbound HTTPS polling only
        |
Private commercial-worker
        |
        +---- credential opener / future KMS authority
        |
        +---- BusyBookie provider-level engine modules
        |
        +---- provider HTTPS
        |
        +---- object storage upload/download
```

- The worker initiates every bridge exchange. The control plane never opens
  a connection to the worker or engine host.
- No engine or operator port is made reachable from the internet.
- Port 4381 remains private loopback operator infrastructure.

**Repository fact.** The operator server binds the hard-coded host
`127.0.0.1` (default port 4381; only the port is configurable), enforces Host
and Origin allowlists and per-launch tokens. No other engine listener exists.
The bridge therefore needs only outbound HTTPS from the worker host.

```text
WORKER_DIRECTION=OUTBOUND_ONLY
PUBLIC_INBOUND_ENGINE_PORT_REQUIRED=NO
```

**Rationale.** An inbound engine endpoint would expose the private host that
holds operator media, provider modules and, during execution, plaintext
credentials. Outbound polling keeps that host unaddressable and lets the
control plane remain the single public surface.

---

## 2. Process and package boundary

**Locked decision.**

```text
WORKER_PROCESS=apps/commercial-worker
COMMERCIAL_API_IMPORTS_ENGINE=NO
```

`apps/commercial-worker` is a separate process and package. It is not
implemented inside `apps/commercial-api`.

The worker may depend on:

- the shared worker protocol package (section 3);
- narrowly selected engine provider-level modules (section 5);
- worker-specific infrastructure (journal, opener, object-storage client,
  worker authentication client).

`apps/commercial-api` remains prohibited from importing:

- root engine modules (`src/**`);
- operator server modules;
- provider SDKs;
- provider credential environment loaders (`dotenv`, `loadEnvironment`,
  `requireRunwayCredentials`, `requireGeminiApiKey` or equivalents);
- `apps/commercial-worker`.

`apps/commercial-worker` must not import `apps/commercial-api` runtime
modules. Neither application imports the other's implementation; they share
only the protocol package.

**Repository fact.** `apps/commercial-api/src` currently imports no root
engine module, provider SDK, `dotenv` or operator module, and its only
runtime dependency is `pg`. Its boundary test already forbids these imports.

**Required boundary tests when the worker is introduced:**

- commercial-api: no import of `commercial-worker`, engine paths, provider
  SDKs, credential loaders or any credential opener;
- commercial-worker: no import of commercial-api runtime modules, `dotenv`,
  `loadEnvironment` or the operator credential helpers;
- protocol package: no import of either application, the engine, provider
  SDKs, database clients or KMS implementations;
- planted-violation tests for each pattern, so the scanner is proven live.

---

## 3. Shared protocol package

**Locked decision.**

```text
WORKER_PROTOCOL_PACKAGE=packages/commercial-worker-protocol
```

**Repository fact.** No `packages/` directory and no npm workspaces exist at
the authority revision. Each app under `apps/` is an independent package.
The root `tsconfig.json` includes only `src`, `tests` and `scripts`, and the
root build includes only `src`, so a new `packages/` tree is outside the
engine's compiled `dist` and portable release identity. Nothing in the
repository makes this location impossible.

The package must be:

- dependency-free, or dependency-light with each dependency separately
  approved;
- independent of the commercial-api runtime;
- independent of the engine;
- free of provider SDKs;
- free of KMS implementations;
- free of database access.

`apps/commercial-api` and `apps/commercial-worker` may both depend on it.

**Deferred.** The consumption mechanism (relative source import, `file:`
dependency, or a later workspace introduction) is an implementation
decision for the step that creates the package. It must not add the package
to the root engine build.

---

## 4. Protocol scope

**Locked decision.** The protocol defines wire-level concepts only:

- worker identity (as presented to the control plane);
- job lease;
- execution payload;
- credential grant;
- submission intent (`SUBMITTING`);
- provider submission accepted;
- heartbeat;
- completion;
- failure;
- lease fencing;
- closed error and failure codes.

The protocol never carries:

- PostgreSQL rows or database-internal identifiers of locking state;
- engine filesystem paths;
- raw provider SDK objects;
- provider credential plaintext;
- provider response payloads.

Wire messages are versioned. Unknown members are rejected, as in the
existing commercial-api request contracts.

---

## 5. Worker entry boundary

**Repository fact.**

- `executeSingleShot` requires a full `EpisodeManifest`, character bible,
  production rules, routing policy, an approved reference-asset registry, an
  absolute media root and BusyBookie `EP##`/`S##` identities bound to
  repository-controlled files. It cannot express a commercial shot.
- The operator CLIs read credentials from the process environment through
  `.env`.
- Engine lifecycle records are keyed by `EP`/`S` (and scene/attempt) paths
  under the media root.
- The provider-level functions already accept credentials by injection:
  - Runway: `createRunwayClient(source)`, `runRunwayGen45Transaction`,
    `executeRunwayGen45(client, …)`, `resumeRunwayGen45Task(client, …)`;
  - Google GenAI: `createGoogleGenAiSingleShotProductionInteractionCreator(apiKey)`,
    `submitGoogleGenAiSingleShot`,
    `createGoogleGenAiSingleShotSecureProductionRecovery(apiKey)`,
    `reconcileGoogleGenAiExecutionLifecycle`;
  - Veo: `createVeoClient(apiKey)` and the Veo transaction runner.

**Locked decision.** The worker integrates at provider-level,
credential-injected functions through a new small worker adapter that
accepts a commercial job-shaped input.

The worker does not use:

- `executeSingleShot`;
- operator CLI entry points;
- `.env`-driven execution;
- persisted commercial request files under the existing `EP`/`S` namespace.

**Rationale.** The provider-level seam is the narrowest existing code that
already takes an injected credential and already contains the paid-call
safety behaviour (single create, no SDK retry on create, the accepted
checkpoint). Wrapping the episode orchestrator would import operator
production concepts into every commercial job.

---

## 6. Worker adapter input

**Locked decision.** The conceptual adapter input contains only:

- `jobId`;
- `attemptId`;
- provider;
- model;
- prompt;
- reference-image object reference, when the provider operation needs one;
- duration;
- aspect ratio, resolution or equivalent provider parameters;
- expected-cost cap;
- server-generated execution namespace;
- exact credential version identity;
- the plaintext credential, injected transiently after worker-side opening.

It never contains:

- a customer filesystem path;
- an arbitrary media root;
- an arbitrary output path;
- an Account-supplied namespace;
- a browser-supplied local path.

The execution namespace is generated by the control plane from server-side
identifiers and resolved by the worker under its own private root. Existing
engine path guards (for example the reference-inside-root check and the
provider-ID filename sanitising) are reused where applicable, not relaxed.

---

## 7. Worker environment rule

**Repository fact.** Both installed provider SDKs fall back to the process
environment when no key is supplied:

- `@runwayml/sdk` 4.20.0 defaults `apiKey` to `RUNWAYML_API_SECRET`;
- `@google/genai` 2.24.0 falls back to `GOOGLE_API_KEY`, then
  `GEMINI_API_KEY`.

**Locked decision.**

```text
COMMERCIAL_WORKER_PROVIDER_ENV_FALLBACK=FORBIDDEN
```

- At startup the worker fails closed if any of `RUNWAYML_API_SECRET`,
  `GEMINI_API_KEY` or `GOOGLE_API_KEY` is present in its environment,
  including when empty.
- The worker does not load `dotenv`, does not call `loadEnvironment` and does
  not call the operator credential helper functions.
- The adapter passes an explicit non-empty credential to every client it
  constructs; an absent credential fails the attempt before any provider call.

**Rationale.** A commercial job whose bound credential is missing must fail.
It must never silently run on an operator key, which would bill the wrong
party and break credential provenance.

---

## 8. Worker concurrency

**Locked decision.**

```text
INITIAL_WORKER_CONCURRENCY=1
```

- One worker host.
- One active provider execution attempt at a time.

**Repository fact.** The engine's execution guard is an exclusive file on a
local fixed drive and refuses network filesystems; it is a single-host lock,
not a distributed one. Provider concurrency or rate limits are not encoded
in the repository.

This setting stands until concurrency safety is separately validated and
locked. No provider concurrency limit is inferred here.

---

## 9. Worker authentication interface

**Locked decision.** Required properties of the worker authentication
mechanism:

- a distinct machine principal;
- never a customer identity, and never able to impersonate one;
- not browser-usable: requests carrying an `Origin` header are rejected, no
  cookies are accepted, and no CORS is offered on worker routes;
- scope limited to worker routes;
- immediate revocation;
- credential or key rotation;
- short-lived authorization where practical;
- every authentication decision auditable.

Candidate mechanisms for a later gate: a signed short-lived worker token
(worker-held private key), mTLS, or workload identity if the components are
later co-hosted. A static long-lived bearer secret is not the preferred
production design.

```text
WORKER_AUTH_MECHANISM_VENDOR_SPECIFIC=DEFERRED
WORKER_AUTH_MECHANISM=UNDECIDED
```

---

## 10. Worker routes

**Locked decision.** Worker routes live in a dedicated namespace inside
commercial-api, composed as a separate router with separate authentication.

Conceptual operations:

1. lease the next job;
2. obtain the exact credential grant;
3. mark submission intent (`SUBMITTING`);
4. report provider submission accepted;
5. heartbeat;
6. report completion;
7. report closed failure.

Exact URL spelling is an implementation detail, except where a later
revision locks it.

**Locked decision (revision R44B6K).** The submission routes, all `POST`
under `/worker-control/v1`, all with exact closed JSON bodies:

| Route | Body | Status |
|---|---|---|
| `leases` | none | Implemented (R44B6G). |
| `attempts/:attemptId/heartbeat` | `{fencingCounter, leaseToken}` | Implemented for `LEASED` and `SUBMITTING` (R44B6M), and for `SUBMITTED` only on the exact live-route lease epoch (section 12, R44B6N). |
| `attempts/:attemptId/release` | `{fencingCounter, leaseToken}` | Implemented; `LEASED` without a grant only. |
| `attempts/:attemptId/credential-grant` | `{fencingCounter, leaseToken}` | Implemented (R44B6H). |
| `attempts/:attemptId/submitting` | `{fencingCounter, leaseToken}` | Implemented (R44B6J). |
| `attempts/:attemptId/submitted` | `{fencingCounter, leaseToken, providerExecutionId}` | Implemented (R44B6O, section 18). No worker flow calls it yet. |
| `attempts/:attemptId/acceptance-recovery` | `{fencingCounter, providerExecutionId}` | Implemented (R44B6R, section 18). Worker client and startup wiring remain unimplemented. |
| `attempts/:attemptId/submission-failed` | `{fencingCounter, leaseToken, outcome, failureCode}` | Future (section 18). |

No route accepts a client-supplied timestamp, Account, connection,
credential version, provider or job identifier; the server derives them.

- Customer authentication never authorises worker routes.
- Worker authentication never authorises customer routes.
- Worker routes follow the existing fail-closed composition rule: they exist
  only when their authentication adapter and dependencies are injected in
  code, never through environment variables.

---

## 11. Job delivery semantics

**Locked decision.**

```text
CONTROL_PLANE_DELIVERY=AT_LEAST_ONCE
```

Exactly-once distributed delivery is not claimed. A lease prevents two
legitimate workers from owning the same attempt concurrently, but network
replay of requests and responses remains possible. Every mutation step is
therefore idempotent per attempt and step: a replay of an already applied
step returns the recorded result and changes nothing.

---

## 12. Lease model

**Locked decision.** Each attempt lease records at minimum:

- worker principal ID;
- an opaque lease token, stored only as a secure server-side verifier
  (for example a hash), never in plaintext;
- a monotonically increasing fencing counter;
- lease expiration;
- heartbeat timestamp;
- attempt number.

Database locking semantics are not exposed on the wire.

### Lease acquisition

The control plane atomically selects one runnable job, using
`FOR UPDATE SKIP LOCKED` or an equivalent transactional lease mechanism.

The mechanism guarantees:

- one current lease owner;
- one current fencing generation;
- bounded lease duration;
- explicit heartbeat renewal;
- stale-worker rejection.

### Re-lease after expiry

- An expired lease on an attempt that never reached `SUBMITTING` may be
  released and the job leased again.
- An expired lease on a `SUBMITTING` attempt that has no durable provider
  execution ID moves the attempt to `OUTCOME_UNKNOWN`.
- An expired lease on a `SUBMITTED` attempt permits only recovery of the
  same provider execution ID with the original credential version. It never
  permits a new submission for that attempt.

### Lease during SUBMITTING and SUBMITTED

**Locked decision (revision R44B6K).** The lease that obtained provider-call
authority stays active through `SUBMITTING`. The worker that received the
`SUBMITTING` acknowledgement keeps owning the attempt while it performs the
provider create call.

- **Heartbeat in `SUBMITTING`: allowed.** It requires the same current proof
  as every lease-scoped mutation: the authenticated worker principal, the
  attempt ID, the matching lease token and the exact current fencing counter,
  with an unexpired lease.
- A heartbeat writes only `heartbeat_at`, `lease_expires_at` and
  `updated_at`. It never changes the fencing counter, the token verifier, the
  principal or the state. Migration 0004 already forbids a new principal or
  token while `SUBMITTING`.
- **Heartbeat in `SUBMITTED`: allowed only for the exact live-route lease
  epoch** (revision R44B6N). This is the lease that entered `SUBMITTED`
  through the live route (section 18), so that worker can continue polling
  under fencing. The epoch is proven by durable lease-epoch provenance (see
  "SUBMITTED heartbeat lease-epoch authority" below).
- **Heartbeat in `OUTCOME_UNKNOWN` and every terminal state: forbidden.**
  These states carry no lease.
- **Release from `SUBMITTING`: forbidden.** A voluntary release would hand
  back provider-call authority after it may already have been used. Release
  remains possible only for `LEASED` without a credential grant (R44B6G and
  R44B6H). Release of a `SUBMITTED` lease is also forbidden in v1. Handing
  recovery to another worker belongs to the recovery-lease gate (section 36).
- A heartbeat failure never authorises the worker to abandon a provider call
  that is already in flight. The worker finishes the call, journals any
  acceptance (section 17) and reports through the route that its remaining
  authority permits (section 18).
- The worker heartbeats at most every third of the server lease duration
  (currently 40 seconds of a 120-second lease). The worker never chooses the
  duration.

```text
SUBMITTING_HEARTBEAT_ALLOWED=YES
SUBMITTING_HEARTBEAT_CHANGES_FENCING=NO
SUBMITTING_RELEASE_ALLOWED=NO
```

### SUBMITTED heartbeat lease-epoch authority (revisions R44B6M2 and R44B6N)

**Repository fact (R44B6M1).** Migrations 0004 and 0005 forbid a new lease
principal or token only while `SUBMITTING`. In `SUBMITTED`, a lease is
optional, and a replacement needs only a strictly higher fencing counter.
The runtime role's existing column privileges permit such a replacement,
including one for the **same** worker principal:

```text
live-route lease:          worker = W, fence = N,   token = T1
replacement/recovery lease: worker = W, fence = N+1, token = T2
```

A heartbeat check that proves the current proof (N+1, T2) and requires
`lease_worker_principal_id = submitting_worker_principal_id` accepts the
replacement. R44B6M1 demonstrated this against the database and then
removed `SUBMITTED` from the renewable states.

**Locked decision (revision R44B6N, superseding R44B6M2's interim set).**
The implemented heartbeat state set is exactly:

- `LEASED`;
- `SUBMITTING`;
- `SUBMITTED`, only for the exact live-route lease epoch.

Between R44B6M1 and R44B6N, `SUBMITTED` was excluded because no durable
discriminator existed.

**SUBMITTED heartbeat.** The live `submitted` route keeps its lease (section
18), and that lease is renewable. Renewal is permitted only when the control
plane durably proves that the current lease is the **exact lease epoch** that
crossed into `SUBMITTING` and then `SUBMITTED` through the live route.

- **Same principal is not enough.** A future recovery lease may be issued
  to the same worker principal; with one worker it usually will be. So
  `lease_worker_principal_id = submitting_worker_principal_id` alone never
  authorises `SUBMITTED` heartbeat.
- **Durable discriminator (implemented, migration 0006, R44B6N):** the
  immutable `submitting_fencing_counter`, the same SQL type as
  `lease_fencing_counter` (`bigint`):
  - the database guard stamps it from `OLD.lease_fencing_counter` on the
    first `LEASED -> SUBMITTING`, exactly as migration 0005 stamps the
    submitting principal. A supplied value that differs is rejected;
  - application code never writes it. The runtime role has no UPDATE
    privilege on it, and it never changes once set;
  - it is non-NULL exactly when `submitting_at` is
    (`execution_attempts_submitting_fencing_ck`);
  - while `SUBMITTING`, `lease_fencing_counter = submitting_fencing_counter`
    (`execution_attempts_submitting_epoch_ck`), so the generation cannot move
    during the in-flight submission;
  - every replacement lease or token needs a strictly higher fencing
    counter (migration 0004).

  A `SUBMITTED` heartbeat requires the usual exact current proof (worker,
  fencing counter, token) and an unexpired lease. It also requires both:
  - `lease_fencing_counter = submitting_fencing_counter`;
  - `lease_worker_principal_id = submitting_worker_principal_id`.

  That pair holds only for the live-route epoch. Otherwise the heartbeat is
  refused as `LEASE_REJECTED` with security reason
  `SUBMITTED_LEASE_EPOCH_MISMATCH`.
- **No backfill.** Migration 0006 does not backfill. Under migrations 0004
  and 0005 a `SUBMITTING` attempt's fencing counter could still rise without
  a new token, so no existing post-barrier row proves its entry epoch. Any
  row with `submitting_at` set therefore aborts the migration. A stronger
  mechanism may replace this design only through a deliberate revision.
- **Not proof of the live-route epoch:**
  - the same worker principal, or worker identity alone;
  - `leased_at < submitting_at`, or any other lease timing, because the
    runtime role can write lease timing fields;
  - the current token merely being valid;
  - audit metadata;
  - any caller assertion.
- **Recovery leases get no renewal authority from this rule.** A future
  recovery lease on an expired `SUBMITTED` attempt (section 12, "Re-lease
  after expiry") is for recovery of the same provider execution ID only. It
  never inherits live-route `SUBMITTED` heartbeat authority. Any renewal
  rule for recovery leases belongs to the recovery-lease gate (section 36).
- **Schema status.** Migration 0006
  (`0006_submission_lease_epoch_provenance.sql`) provides the discriminator.
  Migrations 0001 to 0005 are unchanged.

```text
CURRENT_HEARTBEAT_LEASED=YES
CURRENT_HEARTBEAT_SUBMITTING=YES
CURRENT_HEARTBEAT_SUBMITTED=YES
FUTURE_SUBMITTED_HEARTBEAT_REQUIRES_EXACT_LIVE_ROUTE_LEASE_EPOCH=YES
SAME_WORKER_PRINCIPAL_SUFFICIENT_FOR_SUBMITTED_HEARTBEAT=NO
FUTURE_RECOVERY_LEASE_MAY_USE_SAME_WORKER_PRINCIPAL=YES
SUBMITTED_HEARTBEAT_NEEDS_DURABLE_LEASE_EPOCH_PROVENANCE=YES
SUBMITTING_FENCING_COUNTER_PREFERRED_DISCRIMINATOR=YES
SUBMITTING_FENCING_COUNTER_IMPLEMENTED=YES
RECOVERY_LEASE_AUTOMATICALLY_GETS_SUBMITTED_HEARTBEAT_AUTHORITY=NO
SUBMITTED_HEARTBEAT_DISCRIMINATOR_MIGRATION=0006
```

### Expired SUBMITTING lease

**Locked decision (revision R44B6K).** The published semantic is kept:

```text
SUBMITTING + lease expiry -> OUTCOME_UNKNOWN
```

An expired `SUBMITTING` attempt never becomes `QUEUED`, is never leased by
another worker for another submission, and never becomes
`FAILED_BEFORE_SUBMISSION` automatically. Only separate authoritative
evidence that no provider side effect exists could justify
`FAILED_BEFORE_SUBMISSION` (section 14), and lease expiry is never such
evidence.

- **Owner.** Only the control plane performs this transition. A worker
  cannot be trusted to be alive to report its own expiry.
- **Mechanism (revised R44B6K1).** One sweep function, invoked in three
  places with identical semantics:
  - opportunistically inside the lease-acquisition transaction, beside the
    existing pre-grant reclaim and with the same bounded batch;
  - scoped to the single named attempt, as its own committed transaction at
    the start of every `acceptance-recovery` request (section 18). A worker
    that is blocked by an unresolved journal requests no leases, so this
    invocation prevents a deadlock;
  - by a future explicit reconciliation operation.

  Every invocation applies the same server-clock rule,
  `lease_expires_at <= now()`. None shortens, ends early or otherwise
  bypasses a live lease, whatever the caller reports about a restart.
  Transaction-stable `now()` is correct here (revision R44B6K5). A sweep can
  at worst recognise an expiry one transaction later; it never grants
  authority. Only the `LEASED -> SUBMITTING` grant of provider-call
  authority uses `clock_timestamp()` (section 26).
- **Transaction.** READ COMMITTED. Candidate rows are selected with
  `state = 'SUBMITTING' AND lease_expires_at <= now()`,
  `FOR UPDATE SKIP LOCKED`, in a bounded batch. Each row is updated with:
  - `state = 'OUTCOME_UNKNOWN'`;
  - `failure_code = 'WORKER_LEASE_EXPIRED_DURING_SUBMISSION'`;
  - every current-lease field cleared, as migration 0004 requires for
    `OUTCOME_UNKNOWN`;
  - `updated_at = now()`.

  `lease_fencing_counter`, `credential_granted_at`, `submitting_at` and
  `submitting_worker_principal_id` (migration 0005, section 26) are kept.
  The parent job moves `RUNNING -> NEEDS_ATTENTION`.
- **Fencing.** Clearing the lease invalidates the old token. Every later
  token-proven mutation by that worker is refused as `LEASE_REJECTED`.
  Recovery of durable acceptance evidence then uses the acceptance-recovery
  route (section 18), which is bound to the submitting principal and the
  retained fencing counter, never to the cleared token.
- **Duplicate sweepers.** `SKIP LOCKED` plus the state predicate in the
  `UPDATE` means exactly one transaction converts a given attempt. A
  concurrent or later sweeper finds the row locked, or no longer
  `SUBMITTING`, and does nothing. A live-lease `submitted` transaction that
  holds the row lock first wins, and the sweep then finds a `SUBMITTED` row
  and does nothing. `acceptance-recovery` never transitions a `SUBMITTING`
  row, so it cannot race the sweep for one.
- **Audit.** One `execution_attempt.outcome_unknown` event per converted
  attempt, with metadata `attemptNumber`, `fencingCounter`,
  `workerPrincipalId` (the expired lease holder) and `failureCode`.
- **No provider conclusion.** The failure code names only the control-plane
  fact (the lease expired after the barrier). It asserts nothing about
  provider acceptance.
- The credential-retention and provider-recovery obligations stay open
  (`OUTCOME_UNKNOWN`), so the exact credential version is retained.

```text
EXPIRED_SUBMITTING_OUTCOME=OUTCOME_UNKNOWN
EXPIRED_SUBMITTING_AUTO_REQUEUED=NO
EXPIRED_SUBMITTING_CAN_AUTO_RESUBMIT=NO
EXPIRED_SUBMITTING_TRANSITION_OWNER=CONTROL_PLANE
EXPIRED_SUBMITTING_FAILURE_CODE=WORKER_LEASE_EXPIRED_DURING_SUBMISSION
```

---

## 13. Fencing

**Locked decision.** Every worker mutation after lease acquisition proves:

- the authenticated worker principal;
- the attempt ID;
- a live lease;
- the current lease and fencing generation.

A worker holding an expired or stale lease cannot obtain credentials, mark
`SUBMITTING`, report provider acceptance, heartbeat, or complete or fail the
attempt.

```text
STALE_WORKER_MUTATION=DENIED
```

Stale-worker rejections are recorded in the security log (section 30).

The token-less `acceptance-recovery` route (section 18, revision R44B6K1) is
not an exception to this rule:

- it newly transitions only an `OUTCOME_UNKNOWN` attempt, which has no
  lease left to be stale against;
- it never acts on a `SUBMITTING` attempt, whose lease is still the
  authority.

---

## 14. Attempt state machine

**Locked decision.**

```text
QUEUED
  ↓
LEASED
  ↓
SUBMITTING
  ↓
SUBMITTED
  ↓
SUCCEEDED
```

Permitted terminal and exception states:

- `FAILED_BEFORE_SUBMISSION`
- `OUTCOME_UNKNOWN`
- `SUBMITTED_FAILED`
- `ABANDONED`
- `CANCELLED`

`RECOVERING` is not a durable top-level state in v1. It is operational
activity on a `SUBMITTED` attempt.

**Repository fact.** The engine's own lifecycle has `NOTHING`,
`RESERVED_ONLY`, `SUBMITTED` and `COMPLETED`, and surfaces `RESERVED_ONLY` as
`RESERVED_ONLY_INTERVENTION_REQUIRED` without automatic resolution. The
commercial `OUTCOME_UNKNOWN` state is the counterpart of that intervention
state.

### Cancellation boundary

`CANCELLED` is permitted only before `SUBMITTING`. After `SUBMITTING`, the
system can no longer assert that the provider did not charge, so
cancellation cannot turn the attempt into a clean, retryable pre-submission
state.

### FAILED_BEFORE_SUBMISSION semantics

**Locked decision (revision R44B6D1).** `FAILED_BEFORE_SUBMISSION` means:
the system has authoritative evidence that no accepted or outstanding
provider-side generation side effect exists.

It covers exactly two cases:

1. the attempt failed before any provider submission call; or
2. a provider submission call was made after entering `SUBMITTING`, and the
   provider returned an unambiguous, definitive rejection proving that the
   generation was not accepted.

It never covers a timeout, a connection reset, an ambiguous transport
failure, an ambiguous provider 5xx, a malformed or uncertain response, a
worker crash while the submission is in flight, or any other situation in
which acceptance cannot be ruled out. Those become `OUTCOME_UNKNOWN`.

Case 2 is the transition `SUBMITTING -> FAILED_BEFORE_SUBMISSION`. Its
history is preserved: `submitting_at` remains recorded because the
provider-call barrier was crossed. The record never pretends that no
submission was attempted.

The database cannot inspect a provider response. The service chooses the
transition from its closed classification of the outcome; the persistence
model permits only the semantically valid transitions.

```text
DEFINITIVE_PROVIDER_REJECTION_CAN_BE_FAILED_BEFORE_SUBMISSION=YES
FAILED_BEFORE_SUBMISSION_REQUIRES_NO_PROVIDER_CALL=NO
FAILED_BEFORE_SUBMISSION_REQUIRES_NO_OUTSTANDING_PROVIDER_SIDE_EFFECT=YES
AMBIGUOUS_PROVIDER_OUTCOME=OUTCOME_UNKNOWN
SUBMITTING_TO_FAILED_BEFORE_SUBMISSION=ALLOWED
SUBMITTING_AT_PRESERVED_ON_DEFINITIVE_REJECTION=YES
```

---

## 15. SUBMITTING barrier

**Locked decision.** Before the provider submission call begins, the control
plane durably records `SUBMITTING` under the active lease and fencing
generation. The worker does not call the provider until that write is
acknowledged.

A provider call may occur only after the worker receives a successful
control-plane acknowledgement that its current fenced attempt entered
`SUBMITTING`. A lease that ends before that acknowledgement (including
`LEASED -> QUEUED`, which also clears the lease-scoped
`credential_granted_at`) leaves that worker with no authority to call the
provider, even if it still holds plaintext.

After `SUBMITTING`:

- automatic provider resubmission of that attempt is forbidden;
- loss of the lease or an ambiguous submission outcome becomes
  `OUTCOME_UNKNOWN`, unless a durable provider execution ID proves
  acceptance.

```text
SUBMITTING_BARRIER_REQUIRED=YES
PROVIDER_AUTOMATIC_RESUBMISSION_AFTER_SUBMITTING=NO
```

### Core safety property

**Locked decision (revision R44B6K).**

> Once an attempt has entered `SUBMITTING`, BusyBookie never automatically
> starts another provider submission for that same attempt unless it has
> authoritative evidence that no accepted or outstanding provider-side effect
> exists.

An ambiguous crash, lease expiry or transport failure after `SUBMITTING`
therefore never results in automatic resubmission. Nothing returns an attempt
to a submission-capable state after `SUBMITTING` (migration 0004 enforces
this). A further provider submission for the same job needs a new attempt,
which the one-open-attempt-per-job index refuses while this attempt is
`SUBMITTING`, `SUBMITTED` or `OUTCOME_UNKNOWN`. It also needs a new policy
decision, never an automatic retry.

### Provider-call ordering

**Locked decision (revision R44B6K).** The exact worker ordering for one
attempt:

```text
lease
-> credential grant
-> credential open (worker memory only)
-> journal-root preflight (section 17)
-> SUBMITTING acknowledgement
-> heartbeat, as needed, throughout
-> provider create call (exactly one)
-> definitive provider acceptance
-> acceptance journal record durably committed (section 17)
-> acceptance handler resolves (section 18)
-> report SUBMITTED (section 18)
```

- No provider call moves earlier than the committed `SUBMITTING`
  acknowledgement.
- No `SUBMITTED` report moves earlier than durable journal acceptance.
- The journal-root preflight comes before `SUBMITTING`. A worker that cannot
  currently journal must not create provider authority it could not record.

```text
PROVIDER_CALL_REQUIRES_COMMITTED_SUBMITTING=YES
SUBMITTED_REPORT_REQUIRES_DURABLE_JOURNAL=YES
```

**Rationale.** Without a durable pre-call mark, a crash during the paid call
is indistinguishable from a crash before it, and a retry could buy the same
generation twice.

---

## 16. Provider-side exactly-once

**Repository fact.**

- Runway: `imageToVideo.create` runs with `maxRetries: 0`. The SDK supports a
  per-request `idempotencyKey` option, but no idempotency header is
  configured for this client, so none is sent.
- Veo: `generateVideos` runs with `retryOptions.attempts: 1` and no
  idempotency key.
- Google GenAI: `interactions.create` runs with `maxRetries: 0`, a 60-second
  timeout and no idempotency key.
- The adapters' failure texts state that a failed or timed-out create may
  still have been accepted and must not be resubmitted automatically.

**Locked decision.**

```text
PROVIDER_SIDE_EFFECT_EXACTLY_ONCE_ASSUMED=NO
PROVIDER_SUBMISSION_PER_ATTEMPT_AUTOMATIC_RETRY=NO
```

Provider effects are at most once per attempt, enforced by the `SUBMITTING`
barrier. Any future use of provider idempotency requires separate research
and a separate lock (section 33).

### Terminology

**Locked decision (revision R44B6K).** BusyBookie never claims provider
exactly-once execution. The precise guarantees are:

- control-plane delivery to workers is at least once (section 11);
- provider create is invoked **at most once per attempt by BusyBookie's
  automatic behaviour**, after the `SUBMITTING` barrier;
- ambiguous outcomes are never automatically resubmitted;
- duplicate provider-side execution cannot be universally ruled out. A
  provider may itself violate its own semantics, or a network path outside
  BusyBookie's control may duplicate a request. BusyBookie neither detects
  nor prevents that in v1.

```text
PROVIDER_EXACTLY_ONCE_CLAIMED=NO
BUSYBOOKIE_AUTOMATIC_PROVIDER_CREATE_AT_MOST_ONCE_PER_ATTEMPT=YES
```

### Provider-create retry prohibition (revision R44B6K1)

**Locked decision.** After a committed `SUBMITTING` acknowledgement,
BusyBookie invokes provider create **at most once** for that attempt.
"At most once per attempt" holds only because every layer beneath the
adapter is also prevented from repeating the create.

- **No adapter retry.** A provider-create adapter never retries the create
  after any of the following:
  - a timeout;
  - a connection reset;
  - an ambiguous HTTP failure (including an ambiguous 5xx);
  - a malformed or uncertain response;
  - any other condition in which acceptance cannot be ruled out.
- **No SDK or HTTP retry.** Automatic retry is disabled for every
  provider-create call. Each create client is constructed with its retry
  setting at the "no retry" value, in code, never from configuration. The
  repository already does this (section 16 repository fact):
  - Runway `maxRetries: 0`;
  - Veo `retryOptions.attempts: 1`;
  - Google GenAI `maxRetries: 0`.

  The commercial adapter asserts this setting. A boundary test pins it,
  because changing it would void this invariant.
- **Ambiguous result.** An ambiguous result after the create invocation
  begins maps to `OUTCOME_UNKNOWN` (section 18). It never causes another
  automatic create for the same attempt.
- **Lifting the rule.** Only a later provider-specific architecture lock may
  lift this rule. That lock must prove a provider-supported idempotency
  mechanism that makes a retried create provably safe (section 33). Until
  then, no idempotency key is relied on, even where an SDK offers one.

This rule covers provider **create** only. The following are separate
operations with their own idempotent or recoverable contracts, and are
never a retried create:

- retrying a control-plane acknowledgement (`submitting`, `submitted`,
  `acceptance-recovery`, `submission-failed` replays);
- polling or retrieving an already-known provider execution;
- recovering or downloading output.

```text
PROVIDER_CREATE_AUTOMATIC_TRANSPORT_RETRY=NO
PROVIDER_CREATE_SDK_RETRY_DISABLED=YES
AMBIGUOUS_PROVIDER_CREATE_RESULT=OUTCOME_UNKNOWN
AMBIGUOUS_PROVIDER_CREATE_AUTO_RESUBMIT=NO
```

---

## 17. Local durable acceptance journal

**Locked decision.**

```text
WORKER_LOCAL_ACCEPTANCE_JOURNAL_REQUIRED=YES
```

The worker keeps a small local durable journal for the ambiguity window
around provider acceptance. It does not rely on volatile memory.

### Implementation status (revision R44B6Q1)

**Repository fact (R44B6P).** The private worker implements this section's
journal `v1`:

- the closed record schema, canonical bytes and `recordSha256`, with an
  independently computed test vector;
- the strict reader and writer;
- the exclusive-hard-link publication algorithm, with no rename, copy or
  direct-write fallback;
- `EEXIST` byte comparison;
- corruption and conflict detection, failing closed;
- quarantine of invalid temporary files;
- state-root validation (link probe, and directory-fsync probe under the
  required policy).

The provider execution ID rule is shared with the control plane through the
protocol package.

The worker also has a strict client for the live `submitted` route (section
18).

**Repository fact (R44B6Q).** The worker now prepares and reconciles the
journal before the credential-opening run may request a lease. Only a
`CLEAR` local startup result permits fresh work. The implemented local
phase and its limits are recorded under "Startup reconciliation" below.

**What is not implemented.** No provider submission flow writes a new
acceptance record or calls the `submitted` client. The required chain is
still unwired:

```text
provider definitively accepts
-> acceptance record becomes durable (this section)
-> SingleShotSubmissionAcceptedHandler may resolve (section 18)
-> worker may report submitted (section 18)
```

The control-plane `acceptance-recovery` route is implemented (R44B6R,
section 18). Its worker client and startup wiring, `submission-failed` and
provider execution of any kind (fake or real) remain unimplemented.
R44B6Q still makes no provider call and does not automatically resolve
valid published acceptance evidence.

**State root.** R44B6P takes the state root as explicit worker composition
input. No environment variable is read or locked here. The deployment
binding remains a later composition decision (section 36).

**Temporary files and evidence:**

- an incomplete or invalid temporary file is never acceptance evidence, and
  is quarantined;
- a valid temporary file is not yet **published** acceptance evidence. It is
  never quarantined; startup can finish publishing exactly its record,
  then remove the temporary only after the exact final is published;
- only a valid published final record is acceptance evidence;
- a corrupt published record fails closed and is left for an operator.

```text
ACCEPTANCE_JOURNAL_IMPLEMENTED=YES
ACCEPTANCE_JOURNAL_FORMAT=v1
ACCEPTANCE_JOURNAL_RETRY_REUSES_EXACT_RECORD=YES
WORKER_SUBMITTED_CLIENT_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_USED_BY_LIVE_EXECUTION=NO
STARTUP_JOURNAL_RECONCILIATION_IMPLEMENTED=YES
```

### Purpose

The journal closes this crash window:

```text
provider accepted
-> provider returned execution ID
-> worker crashes or loses its lease before the control plane records SUBMITTED
```

Without durable local evidence, BusyBookie cannot distinguish "the provider
accepted and the response or report was lost" from "the provider did not
accept". The journal records the accepted provider identity before the
acceptance handler is considered complete (section 18). A journal record
only ever lets the worker report the **same** provider execution ID. It never
authorises a provider create call.

```text
PROVIDER_ACCEPTANCE_REQUIRES_DURABLE_JOURNAL=YES
VALID_JOURNAL_CAN_AUTHORIZE_SECOND_PROVIDER_CREATE=NO
```

### Technology

**Locked decision (revision R44B6K).** The journal is **one immutable JSON
record per attempt**, published by an exclusive hard link from a fully
written, fsynced temporary file in the same directory. It adds no
dependency.

| Option | Assessment |
|---|---|
| One immutable JSON record per attempt | **Chosen.** Atomic creation by exclusive link; no in-place mutation, so no torn update of earlier evidence; deterministic lookup by filename; idempotent replay by byte comparison; matches the engine's proven immutable-record publication (`persistGoogleGenAiSingleShotCompletion`, `editorialGovernanceStore`). |
| Append-only JSON Lines | Rejected. Concurrent records share one file, so a torn tail can hide or corrupt the previous entry; lookup needs a scan; deletion needs compaction, which is a rewrite. |
| SQLite | Rejected for v1. New native dependency and a second storage engine for a few records per day at concurrency 1. Its durability depends on journal-mode and sync pragmas that would themselves need locking. |
| Engine `createExecutionSubmission` record writer | Rejected for reuse. It writes with `wx` and publishes with `copyFile(COPYFILE_EXCL)` **without any fsync**, so it does not meet this durability requirement. It also stores prompts and absolute paths. |

The implementation reuses the pattern of the engine's existing fsync-and-link
publication. It does not import engine modules, because the worker stays
behind the boundary of section 2. The exFAT direct-write fallback in
`persistGoogleGenAiSingleShotCompletion` is **not** adopted: a directly
written final file can be observed torn after a crash.

```text
ACCEPTANCE_JOURNAL_TECHNOLOGY=IMMUTABLE_JSON_RECORD_PER_ATTEMPT
ACCEPTANCE_JOURNAL_NEW_DEPENDENCY=NO
JOURNAL_RECORD_IMMUTABLE=YES
```

### Location and layout

**Locked decision (revision R44B6K).** The journal lives under a private,
worker-owned **state root**. The worker composition receives it as an
explicit configuration value. No machine path or environment-variable name
is locked by this document. R44B6Q continues to accept the root only through
explicit worker composition; the production/deployment binding remains a
later decision.

The state root must be:

- an absolute path on a local fixed volume that supports hard links;
- not a network filesystem;
- not exFAT or FAT. The worker probes link support at startup and refuses
  to start on an unsuitable volume;
- outside every Git working tree;
- outside the BusyBookie media root and its episode evidence;
- outside `apps/commercial-worker/src`;
- never served over HTTP;
- owner-only: POSIX `0700` directories and `0600` files, or the equivalent
  owner-only ACL on Windows.

Logical layout:

```text
<worker-state-root>/
  acceptance-journal/
    v1/
      <executionAttemptId>.json                  published, immutable record
      <executionAttemptId>.<32 hex>.tmp          in-flight temporary (same directory)
    quarantine/
      <name>                                     operator-moved evidence (section 17, corruption)
```

`<executionAttemptId>` is the canonical lowercase UUID. The directory holds
nothing else. Any other entry fails the startup scan closed.

### Record schema

**Locked decision (revision R44B6K).** Format `v1`: a closed JSON object
with exactly these members, serialised canonically. Members appear in the
order below, with no insignificant whitespace, UTF-8 encoding and one
trailing LF.

| Member | Value |
|---|---|
| `format` | The literal `"busybookie.commercial-worker.acceptance/v1"`. |
| `executionAttemptId` | Canonical lowercase UUID; equals the filename stem. |
| `executionJobId` | Canonical lowercase UUID, from the lease. |
| `accountId` | Canonical lowercase UUID, from the credential grant's opening context. |
| `attemptNumber` | Integer 1 to 2^53-1, from the lease. |
| `fencingCounter` | Integer 1 to 2^53-1; the generation that received the `SUBMITTING` acknowledgement. |
| `provider` | `^[A-Z][A-Z0-9_]{0,31}$`; equals the lease provider and the acceptance provider. |
| `generationRequestSha256` | 64 lowercase hex, from the lease. |
| `submittingAt` | ISO-8601 UTC with milliseconds, as acknowledged by the control plane. |
| `providerExecutionId` | Opaque, 1 to 256 visible ASCII characters (`0x21`-`0x7e`), never containing `://`: the migration 0004 constraint. |
| `providerAcceptedAt` | ISO-8601 UTC with milliseconds; the worker clock when acceptance was observed. Informational only. |
| `recordedAt` | ISO-8601 UTC with milliseconds; the worker clock when the record was serialised. Informational only. |
| `recordSha256` | 64 lowercase hex SHA-256 of the digest preimage defined below. It is never part of its own preimage. |

### Canonical bytes and `recordSha256` (revision R44B6K1)

**Locked decision.** Every string value is ASCII; the schema admits nothing
else. Canonical serialisation of a member list is exactly:

- `{`;
- then, for each member in the order of the table above, separated by a
  single `,`: the ECMAScript `JSON.stringify` of the member name, then `:`,
  then the value;
- then `}`.

Values are serialised as follows:

- a string is the ECMAScript `JSON.stringify` of the string, which escapes
  `"` and `\`;
- an integer is the ECMAScript `JSON.stringify` of the safe integer: plain
  decimal, with no sign, exponent, fraction or leading zero.

There is no whitespace anywhere.

1. **Preimage.** The canonical serialisation of the first twelve members,
   `format` through `recordedAt`, in table order. `recordSha256` is
   excluded. There is no trailing LF.
2. **Digest.** SHA-256 over exactly those UTF-8 bytes, hence ASCII bytes,
   encoded as 64 lowercase hexadecimal characters.
3. **Stored file.** The canonical serialisation of all thirteen members, with
   `recordSha256` last and set to that digest, followed by exactly one LF.
   Equivalently, the preimage with its closing `}` replaced by
   `,"recordSha256":"<digest>"}`, followed by LF.
4. **Read.** The file must:
   - be ASCII and end in exactly one LF;
   - parse as one JSON object that passes the closed schema;
   - re-serialise canonically, all thirteen members plus LF, to bytes
     identical to the file;
   - have its digest, recomputed from the same twelve-member preimage, equal
     to the stored `recordSha256`.

   Any difference makes the record corrupt (`ACCEPTANCE_JOURNAL_CORRUPT`).
   No normalisation, alternate key order, alternate escaping or alternate
   number form is accepted.

**Repository fact.** The engine's own canonical JSON
(`canonicalCharacterIdentityJson`, byte-compatible with the editorial
canonicaliser) sorts keys. It is not adopted here, for two reasons:

- a closed record with a fixed, documented member order is equally
  deterministic;
- the worker may not import engine modules (section 2).

The fixed order is the contract. A parity of algorithms is not.

```text
JOURNAL_RECORD_SHA256_PREIMAGE_EXCLUDES_RECORD_SHA256=YES
JOURNAL_RECORD_SHA256_CANONICAL_UTF8=YES
```

Identity binding:

- Every identity member comes from the immutable lease, grant and
  `SUBMITTING` acknowledgement of the attempt that made the call. None is
  derived from mutable current state.
- The record never grants authority. The control plane re-derives Account,
  provider, credential version and job from its own immutable rows, and
  checks the reported values against them (section 18).

**Credential version.** The exact credential version is **omitted**. It is
immutable provenance of the attempt row (migration 0004 trigger), the control
plane derives it for every recovery grant, and the worker never chooses it.
Repeating it locally adds no recovery capability. It would only add a second
copy that could disagree. This revises the earlier minimum list of this
section, which named the credential version ID.

```text
JOURNAL_CONTAINS_CREDENTIAL_VERSION=NO
```

### Secret exclusions

A journal record never contains:

- plaintext provider credential;
- sealed credential envelope or its opening context;
- credential fingerprint;
- lease token or lease-token hash;
- the worker machine credential or any bearer token;
- KMS or key material;
- provider request authorisation headers;
- provider request or response bodies;
- prompts, reference media, URLs or local paths.

The closed schema makes any such member a validation failure.

```text
JOURNAL_CONTAINS_PLAINTEXT_CREDENTIAL=NO
JOURNAL_CONTAINS_SEALED_CREDENTIAL=NO
JOURNAL_CONTAINS_LEASE_TOKEN=NO
```

### Provider execution ID

The provider execution ID is opaque:

- no URL, format or global-uniqueness assumption;
- control-plane uniqueness stays Account plus provider plus ID (section 26);
- no normalisation: an ID that does not already satisfy the schema is not
  trimmed or rewritten, and the acceptance is handled as invalid (section
  18);
- once published, a record's ID is never changed, replaced or re-derived.

### Write algorithm

**Locked decision (revision R44B6K).**

1. Validate the acceptance and build the record. Compute `recordSha256`
   from the twelve-member preimage, then serialise the stored file bytes
   (section 17, canonical bytes).
2. Create `<attemptId>.<32 random hex>.tmp` in `acceptance-journal/v1/`.
   Use exclusive creation (`wx`: `O_CREAT|O_EXCL`), owner-only mode.
3. Write all bytes, call `FileHandle.sync()` (fsync / `FlushFileBuffers`),
   then close the handle.
4. `link(temporary, final)`. This is atomic, and it fails with `EEXIST`
   rather than overwrite. **No rename** is used, because a POSIX rename and
   Node's Windows rename both replace an existing target. There is no copy
   fallback and no direct-write fallback.
5. On `EEXIST`, read the final record and validate it fully:
   - byte-identical -> idempotent success;
   - anything else -> `ACCEPTANCE_JOURNAL_CONFLICT`, fail closed. The
     existing record is never overwritten.
6. Make the directory entry durable (see the platform rules below).
7. Unlink the temporary file. Failure here is logged but harmless, because
   the startup scan handles leftovers.

Only after step 6 succeeds has the journal record been durably committed.

**Exact-record retry (revision R44B6P1).** `recordedAt` is part of the
canonical record and of its digest. So the record for one provider
acceptance is constructed **once**, from the acceptance input, when it is
first written. Every later attempt to publish that acceptance reuses that
**exact** record, including:

- a retry after a failed or interrupted write;
- completion from a valid temporary file;
- republication after a crash between steps 4 and 7.

The original `recordedAt`, and therefore the original `recordSha256`, are
kept. A caller never regenerates `recordedAt`, or builds a new record, for
the same provider acceptance merely because publication is retried.

Step 5 stays authoritative. `EEXIST` succeeds only when the existing final
file is **byte-identical**. A record that is semantically similar but
byte-different, including one that differs only in `recordedAt`, is
`ACCEPTANCE_JOURNAL_CONFLICT`. It is never resolved by comparing fields.

```text
ACCEPTANCE_JOURNAL_RETRY_REUSES_EXACT_RECORD=YES
```

```text
CONFLICTING_JOURNAL_RECORD_OVERWRITTEN=NO
ACCEPTANCE_JOURNAL_PUBLICATION=EXCLUSIVE_HARD_LINK_AFTER_FSYNC
```

### Platform durability

- **Linux (deployment target).** After the link, open the containing
  directory read-only and `fsync` it. A failure there is a journal-write
  failure. The production composition probes directory fsync at startup and
  refuses to start without it.
- **Windows (development).** Node cannot open a directory handle for
  `FlushFileBuffers`. The engine's own store tolerates that failure. File
  data is flushed in step 3. NTFS journals the link metadata, but its
  durability across power loss is not guaranteed until the NTFS log flushes.
  A Windows worker is therefore **development-only** for durability claims.
  Directory-sync failure is tolerated only in the development composition.
  R44B6P implements this as two explicit policies:
  - the required policy (Linux deployment), the durability standard;
  - a development best-effort policy, which reports that the directory was
    not flushed rather than claiming Linux-equivalent durability.

  Node applies file modes on Windows only as the read-only attribute, so
  owner-only access there depends on the state root's ACL.
- **Safety under a lost link.** If a platform loses a published link after
  power loss, the record is simply absent. That is restart case A (section
  31): `OUTCOME_UNKNOWN`, never resubmission. A durability gap can lose
  evidence. It can never cause a second provider create, because no
  `SUBMITTED` report precedes step 6.

### Validation on every read

Every read validates the record against the closed schema and rejects:

- missing or extra members;
- wrong member order or non-canonical bytes;
- a malformed UUID, timestamp or hash;
- an unknown `format`;
- an empty or non-conforming provider execution ID;
- a filename stem that differs from `executionAttemptId`;
- a `recordSha256` mismatch;
- a fencing counter or attempt number outside range;
- a provider or request hash that differs from the identity the caller
  expects.

No best-effort parsing is permitted.

### Corruption and I/O failure

| Condition | Behaviour |
|---|---|
| Published record malformed, truncated, unknown format, digest mismatch or unreadable | `ACCEPTANCE_JOURNAL_CORRUPT`. Fail closed. The worker takes no new submission work until an operator investigates and moves the record to `quarantine/`. |
| Published record conflicts with the acceptance being written, or with the control plane's provider execution ID | `ACCEPTANCE_JOURNAL_CONFLICT`. Fail closed, as above. |
| Temporary file valid and complete, final absent (crash between steps 3 and 4) | Complete publication from step 4, then reconcile. The provider ID is the one the provider returned. |
| Temporary file invalid or partial (crash during step 3) | Move it to `quarantine/` (exclusive link, then unlink). Log `ACCEPTANCE_JOURNAL_CORRUPT`. It never authorises anything, and nothing is stranded, because the handler never resolved; the attempt reaches `OUTCOME_UNKNOWN` by the section 12 sweep. |
| Filesystem I/O error while writing | Journal-write failure (section 18). |
| Filesystem I/O error while scanning | Fail closed. No new work. Retry the scan. |

A corrupt, conflicting or unreadable journal never authorises a provider
create call. The control-plane outcome for such an attempt is
`OUTCOME_UNKNOWN`, which needs operator attention.

### Retention

**Locked decision (revision R44B6K).**

- **Minimum.** A record may be deleted only after the worker has received a
  successful control-plane response that shows the attempt durably committed
  with the **same** provider execution ID. That response comes from
  `submitted`, from `acceptance-recovery`, or from their idempotent replays.
  A transport success, a timeout or an unconfirmed send never permits
  deletion.
- **v1 policy.** Retain the record until the control plane reports the
  attempt terminal (`SUCCEEDED`, `SUBMITTED_FAILED` or `ABANDONED` with the
  same ID). Then unlink it and fsync the directory. The record contains no
  secret, which makes this forensic retention acceptable. A confirmed,
  retained record never blocks new work.
- Quarantined files are deleted only by an operator.

### Startup reconciliation

**Implemented local phase (R44B6Q; recorded by R44B6Q1).** The existing
credential-opening workflow requires an explicitly composed acceptance
journal. Startup ordering is:

```text
environment/startup checks
-> acceptance journal prepare
-> acceptance journal reconciliation
-> CLEAR required
-> lease acquisition permitted
-> credential grant
-> credential open
```

The worker never requests fresh work before reconciliation completes
successfully. `prepare()` is reused for state-root preparation and startup
refusal, including link-support probing and the directory-sync policy.
Preparation failure prevents leasing. Deployment requires `REQUIRED`;
Windows development may explicitly use `DEVELOPMENT_BEST_EFFORT`, without
claiming equivalent durability (see "Platform durability" above).

The local reconciler uses the journal's existing strict readers and
inspection APIs; it does not duplicate canonical JSON, digest, path or
provider-execution-ID validation. Enumeration accepts only the canonical
final and temporary filenames in the layout above, with full-name matches.
Unexpected filenames, directories, symlinks in the records directory, or
scan/enumeration failure fail closed. Arbitrary entries are never interpreted
as acceptance evidence. A discovered entry disappearing during inspection
also fails closed.

Entries are inspected in stable lexical filename order, independent of
filesystem enumeration order. The entire snapshot is inspected before
publication. Conflicting valid records are preserved; lexical order never
selects one as authoritative. If corruption or conflict is detected during
inspection, startup blocks without completing temporary publication.

| Local condition | Implemented startup behavior |
|---|---|
| No unresolved evidence or other blocking condition | `CLEAR`; fresh lease acquisition may proceed. |
| Valid published final | Durable provider-acceptance evidence; retain unchanged as `UNRESOLVED_ACCEPTANCE`. Do not delete, overwrite or regenerate it. Fresh work stays blocked until later worker recovery wiring reconciles it through the implemented control-plane route. |
| Valid complete temporary | Not yet published acceptance evidence. Complete publication through `publish(record)` using the exact existing record, preserving its original `recordedAt`, `recordSha256` and canonical bytes. Never regenerate it through `write(input)`. Remove the source temporary only after verifying the same exact final is published. The resulting final remains unresolved and blocks fresh work. |
| Invalid or partial temporary | Never provider-acceptance evidence. Preserve its bytes through the existing exclusive-link quarantine mechanism and log the safe corruption code. After successful quarantine it does not by itself represent unresolved acceptance; startup may become `CLEAR` if nothing else blocks it. |
| Quarantine, publication or temporary-cleanup failure | Fail closed. Quarantine failure is never `CLEAR`; conflicting quarantine evidence is `CONFLICT`, and other unsafe I/O failures are `CORRUPT`. |
| Corrupt published final | `CORRUPT`; retain in place for operator attention. Never treat it as `NOT_FOUND`, overwrite it or regenerate it. Fresh work stays blocked. |
| Conflicting valid evidence | `CONFLICT`; preserve the evidence without automatically choosing a winner. Fresh work stays blocked. |

**Interrupted quarantine.** If a prior process created the quarantine
hard-link but crashed before unlinking the source invalid temporary,
startup accepts the existing quarantine entry only when its bytes match
exactly. It then completes directory sync and source unlink safely. A
different existing quarantine entry is a conflict and is never overwritten.
There is no rename or copy fallback, no duplicate evidence and no silent
discard.

**Repeated startup.** With unchanged state, `CLEAR` stays `CLEAR`; a valid
final stays unresolved; a valid temporary may become the same exact final;
an invalid temporary is quarantined once without repeated evidence
mutation; a corrupt final stays fail-closed. Startup manufactures no
duplicate acceptance records and introduces no garbage collection.

**CLEAR gate.** Only `CLEAR` permits lease acquisition. The other local
results are `UNRESOLVED_ACCEPTANCE`, `CORRUPT` and `CONFLICT`; each means:

```text
NEW_WORK_ALLOWED=NO
LEASE_REQUESTS=0
CREDENTIAL_GRANT_REQUESTS=0
CREDENTIAL_OPENS=0
PROVIDER_CALLS=0
```

Startup refusal uses closed worker codes: `STATE_ROOT_UNSUITABLE`,
`ACCEPTANCE_RECONCILIATION_FAILED` for unresolved acceptance,
`ACCEPTANCE_JOURNAL_CORRUPT` and `ACCEPTANCE_JOURNAL_CONFLICT`. Logs use safe
codes, never raw filesystem messages, state-root paths, credentials, tokens,
provider payloads or provider execution IDs (section 29).

```text
STARTUP_RECONCILIATION_RUNS_BEFORE_LEASE=YES
UNRESOLVED_ACCEPTANCE_BLOCKS_NEW_WORK=YES
CORRUPT_JOURNAL_BLOCKS_NEW_WORK=YES
CONFLICTING_JOURNAL_BLOCKS_NEW_WORK=YES
VALID_TEMP_REUSES_EXACT_RECORD=YES
VALID_TEMP_REGENERATES_RECORDED_AT=NO
```

### Future worker acceptance-recovery integration after local startup checks

**Boundary.** R44B6Q does not call `acceptance-recovery`, transition
`OUTCOME_UNKNOWN -> SUBMITTED`, create recovery leases or resolve valid
published acceptance. All such acceptance remains blocking in the worker.
R44B6R implements the control-plane route (section 18), but no worker client
or startup call to it exists yet. The following worker integration remains
a locked future contract, separate from the implemented local phase.

**Locked decision (revision R44B6K).** Once the worker acceptance-recovery
client and startup wiring are implemented, startup extends the local checks
as follows, still before requesting any lease:

1. validates the state root (absolute, local, link-capable, owner-only, and
   directory-fsync-capable in production);
2. scans `acceptance-journal/v1/` and applies the corruption table above;
3. for each valid published record, calls `acceptance-recovery` (section 18)
   with the record's fencing counter and provider execution ID, and then:
   - an exact acknowledgement matching the record's attempt, fencing counter
     and provider execution ID in `SUBMITTED`, `SUCCEEDED`,
     `SUBMITTED_FAILED` or `ABANDONED` -> reconciled for this startup pass;
     delete it if terminal, keep it otherwise. Never regress terminal state;
   - `ATTEMPT_STILL_SUBMITTING` (revisions R44B6K1 and R44B6R1) means the
     attempt is still `SUBMITTING` after the scoped sweep transaction. This
     includes expiry between that transaction and the recovery transaction.
     The restarted worker cannot prove the lost lease token. It therefore
     stays blocked and makes no provider create.
     It retries `acceptance-recovery` only within the per-record policy below,
     waiting for authoritative expiry to move the attempt to `OUTCOME_UNKNOWN`
     so the same ID can be recovered. Nothing in this path shortens the lease
     or permits the worker clock to declare expiry;
   - a refusal (state conflict, ID conflict, principal or fencing mismatch,
     or an incompatible terminal state) -> `ACCEPTANCE_RECONCILIATION_FAILED`;
     fail closed and wait for an operator;
   - transport/network failure or HTTP 5xx -> retry within the same bounded
     policy using the existing `CONTROL_API_UNAVAILABLE` classification and
     stay blocked;
4. only when all unresolved valid records have exact successful
   acknowledgements and no other blocking condition remains, becomes `CLEAR`
   and starts leasing. Quarantine of invalid temporary bytes follows the
   local corruption table; it cannot resolve valid acceptance evidence.

No step in reconciliation calls a provider create.

### Startup acceptance-recovery retry policy (revision R44B6S0)

**Architecture decision only.** This locks the policy required by R44B6S;
the worker acceptance-recovery client and startup calls remain unimplemented.
Section 37 records the authoritative numeric and classification flags.

**Eligibility authority.** Only the control-plane database determines
recovery eligibility and authoritative lease expiry. The worker retry clock
only bounds how long startup retries; it cannot declare a lease expired.
This policy replaces the previous ambiguous "never longer than the server
lease duration" wording with a fixed local retry budget, independent of the
server's lease-expiry decision.

**Per-record budget and schedule.** Process unresolved valid records in
deterministic lexical order. Each record gets its own budget, beginning
immediately before its first request. Attempt 1 is immediate (0 ms initial
request delay) and counts toward the maximum of 18 attempts. No nineteenth
request may start within that budget. The maximum elapsed duration is
150000 ms (150 seconds), including network/request duration and waits.
Measure elapsed duration using an injected monotonic worker clock; do not
use wall-clock timestamps where a monotonic clock is available.

After a retryable result, delays use exponential backoff: initial 1000 ms,
multiplier 2, capped at 10000 ms. The delay sequence is therefore
`1000, 2000, 4000, 8000, 10000, 10000, ...` ms. No delay exceeds 10 seconds.
Before scheduling any retry, check whether 18 attempts have already been
made, check monotonic elapsed time, then compute the next capped backoff.
Check elapsed time again after waiting and before starting the next request:
no request may start when elapsed time is at least 150000 ms. There is no
requirement to start a request exactly at the boundary.

With negligible request latency, the 18 request start times are approximately
`0, 1, 3, 7, 15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125, 135, 145`
seconds. This schedule is deliberate. A record acknowledged immediately
consumes no retry delay.

**No jitter.** Jitter is `NONE`; R44B6S must not add random jitter. Recovery
is a private startup reconciliation path, deterministic crash/restart
behavior is preferred, retry frequency is already bounded and low, and
jitter is unnecessary for the current single-concurrency recovery model.
A future architecture revision may reconsider this if deployment topology
changes materially.

**Retryable outcomes.** `ATTEMPT_STILL_SUBMITTING` is retryable but is not
recovery success. Durable journal evidence remains authoritative, new work
stays blocked, and no provider operation may occur. Retry the exact same
identity without inferring expiry locally. Transport/network failure and
HTTP 5xx are retryable within this same budget through the existing worker
`CONTROL_API_UNAVAILABLE` classification; do not add an overlapping
availability error taxonomy.

**Definitive outcomes.** Do not retry authentication or authorization
rejection, definitive acceptance-recovery rejection, incompatible identity
or epoch, conflicting provider execution identity, malformed success
responses, unexpected response shapes, or other non-special 4xx responses.
`ATTEMPT_STILL_SUBMITTING` is the explicit lifecycle exception. These
failures block startup; no response body or unsafe detail is surfaced.

**Exact identity and durable evidence.** Every retry reuses exactly the
same `executionAttemptId`, `fencingCounter` and `providerExecutionId` from
the same durable journal record. Retries must not mutate the fence, obtain
a lease, send a live lease token, generate another provider execution ID,
reconstruct a replacement record, or regenerate `recordedAt` or
`recordSha256`. Until exact successful acknowledgement, the journal record
remains present and new work remains prohibited.

**Exhaustion.** If attempts reach 18 or monotonic elapsed time reaches
150000 ms before exact successful acknowledgement, reconciliation fails
closed and startup surfaces a safe recovery-exhausted failure. Preserve
the valid published record intact: do not delete, quarantine or otherwise
discard it. Fresh lease acquisition, credential grants, credential opening
and provider execution remain prohibited. Stop at that record; do not
continue to fresh work or run an infinite retry loop. A later process
restart may begin a new bounded per-record budget against the same durable
evidence. Successful exact acknowledgement of every unresolved valid
record is required before startup can become `CLEAR`.

**Testing contract for R44B6S.** Inject the monotonic clock and waiting/sleep
function; tests must not sleep for production retry durations. Pin immediate
attempt 1, the delay sequence, the 10-second cap, the maximum 18 attempts,
the 150-second elapsed bound including request time, no jitter, retryable
and definitive non-retryable classifications, exact-identity reuse, and
fail-closed exhaustion with evidence retained. This architecture revision
does not modify or implement those tests.

### Unresolved journal blocks new work

**Locked decision (revision R44B6K).** With `INITIAL_WORKER_CONCURRENCY=1`, a
worker that holds any unresolved acceptance record does not request a new
lease until that record is reconciled or escalated. The same applies to a
record that is unconfirmed, corrupt or conflicting. This keeps provider
evidence from being stranded while new paid side effects begin. The rule
also applies at runtime, after a failed `submitted` report (section 18).
Raising concurrency requires revisiting this rule.

```text
UNRESOLVED_ACCEPTANCE_JOURNAL_BLOCKS_NEW_SUBMISSION_WORK=YES
```

---

## 18. Submission-accepted hook

**Repository fact.** `SingleShotSubmissionAcceptedHandler` fires once, after
the provider returns an execution ID and before polling. The orchestrator
rejects a second call, a provider mismatch and an empty ID. The Runway, Veo
and Google adapters stop and refuse to resubmit if the handler throws.

**Locked decision.** This handler is the sole provider-accepted checkpoint in
the worker's engine adapter. The commercial worker extends its behaviour:

1. validate the provider acceptance result;
2. write and flush the local journal entry;
3. only then report acceptance upstream;
4. never continue as if acceptance were durable if local journaling failed.

No second, independent acceptance path is created.

### Acceptance checkpoint (revision R44B6K)

**Locked decision.** The precise sequence inside the commercial worker's
acceptance handler:

1. The provider returns a definitive accepted execution ID.
2. The handler validates it, with no normalisation:
   - the provider equals the lease provider;
   - the ID satisfies the record schema;
   - the handler was not already called once.
3. The handler builds the journal record (section 17).
4. The handler durably commits the record: write algorithm steps 2 to 6 of
   section 17.
5. Only after step 4 succeeds does the handler resolve.
6. The worker then reports `SUBMITTED` (below).
7. The control plane commits `provider_execution_id` and `submitted_at`.

The Runway, Veo and Google adapters already stop and refuse to resubmit when
the handler throws. That behaviour is relied on unchanged.

```text
ACCEPTANCE_HANDLER_RESOLVES_BEFORE_DURABLE_JOURNAL=NO
```

**Journal persistence failure.** If step 2 rejects the ID, or step 4 fails:

- the handler throws and never claims durable acceptance;
- the provider may already have accepted, so the outcome is ambiguous. The
  worker reports `submission-failed` with outcome `OUTCOME_UNKNOWN` and
  failure code `ACCEPTANCE_JOURNAL_WRITE_FAILED` or
  `PROVIDER_EXECUTION_ID_INVALID`. If it cannot report, the section 12 sweep
  reaches the same state;
- the worker does **not** report `SUBMITTED`, because `SUBMITTED` requires
  durable local evidence. The in-memory ID is not sent upstream in v1;
- the worker treats a journal-write failure as a host fault. It halts new
  submission work until its state root passes the startup checks again;
- the attempt is never retried automatically.

### Definitive rejection and ambiguous outcomes

- **Definitive rejection.** An unambiguous provider refusal proving the
  generation was not accepted is reported as `submission-failed` with outcome
  `DEFINITIVELY_REJECTED` and a closed failure code. The result is
  `SUBMITTING -> FAILED_BEFORE_SUBMISSION`. `submitting_at` is kept, no
  journal record is created and the lease is cleared. A timeout, a
  connection reset, an ambiguous 5xx or an uncertain response is never
  definitive (section 14).
- **Ambiguous outcome.** A timeout, reset, ambiguous 5xx, malformed response
  that cannot rule out acceptance, or journal failure is reported as
  `submission-failed` with outcome `OUTCOME_UNKNOWN`. The result is
  `SUBMITTING -> OUTCOME_UNKNOWN`, with the lease cleared and the parent job
  set to `NEEDS_ATTENTION`. A worker crash during the call reaches the same
  state through the section 12 sweep. There is never automatic resubmission.
- **Provider accepted.** After step 4, `SUBMITTING -> SUBMITTED` with exactly
  the journalled ID.

### `submitted` route (live lease)

**Locked decision (implemented, R44B6O).**
`POST /worker-control/v1/attempts/:attemptId/submitted` with exactly
`{fencingCounter, leaseToken, providerExecutionId}`. It exists only in the
explicitly composed worker-control router; the default process answers 404.

**Status.** The route exists, but the worker submission flow does not.
- **Implemented (R44B6P):** the acceptance journal (section 17) and a strict
  worker client for this route.
- **Implemented (R44B6Q):** local startup journal reconciliation and the
  fail-closed new-work gate before lease acquisition (section 17).
- **Implemented (R44B6R):** the separate control-plane acceptance-recovery
  route below; its worker client and startup wiring remain unimplemented.
- **Not wired:** no provider submission flow writes new acceptance records
  or calls the `submitted` client.
- **Not implemented:** worker provider execution and `submission-failed`.
  Valid published acceptance remains unresolved in the worker until its
  acceptance-recovery client and startup wiring exist.

The required worker ordering still stands:

```text
provider accepts
-> durable acceptance journal (section 17)
-> submission-accepted handler resolves
-> worker reports submitted
```

The route's existence does not mean the crash-safe submission path is
complete.

- **Authority.** The route requires the same live proof as `submitting`:
  - an authenticated worker, re-checked ACTIVE `FOR SHARE`;
  - the attempt locked `FOR UPDATE`;
  - the exact current worker principal, fencing counter and lease token
    (compared in constant time), with an unexpired lease.

  In addition it requires the exact live-route lease epoch (migrations 0005
  and 0006):
  - `lease_fencing_counter = submitting_fencing_counter`;
  - `submitting_worker_principal_id` equal to the caller and current lease
    principal.

  A replacement or recovery lease never acknowledges a submission, whatever
  its principal. Lock order: principal, attempt, connection `FOR SHARE`,
  exact version `FOR SHARE`.
- **States.** The route performs only `SUBMITTING -> SUBMITTED`. It also
  replays an identical acknowledgement on an attempt that is already
  `SUBMITTED`. It never performs `LEASED -> SUBMITTED`, and never
  `OUTCOME_UNKNOWN -> SUBMITTED`; the latter belongs to the future
  `acceptance-recovery` route. Any other state is refused with
  `INCOMPATIBLE_ATTEMPT_STATE`.
- **Credential.** Connection eligibility is **not** checked, because
  submission was already authorised (section 24). The exact version must not
  be `DESTROYED`. If it is, the request fails closed as an invariant failure
  (`SUBMITTING_VERSION_DESTROYED`).
- **Provider execution ID.** Validated exactly as the migration 0004
  constraint: 1 to 256 visible ASCII characters (`0x21`-`0x7e`), never
  containing `://`, with no normalisation. Any other request member,
  provider response, URL, path or client timestamp is a 400. Uniqueness is
  the database's `(account_id, provider, provider_execution_id)` unique
  index (section 26). An ID already adopted by another attempt of the same
  Account and provider is refused. Another Account may use the same opaque
  ID.
- **The first transition writes only:**
  - `state = 'SUBMITTED'`;
  - `provider_execution_id`;
  - `submitted_at = now()`;
  - `updated_at = now()`.

  `recovery_expires_at` stays `NULL` until a provider-specific policy exists
  (section 23).

  The lease is **kept**: worker, token verifier, fencing counter,
  `leased_at`, `lease_expires_at` and `heartbeat_at`. So is the immutable
  submission provenance: `credential_granted_at`, `submitting_at`, the
  submitting principal and the submitting fencing counter.

  The same worker continues polling under fencing (section 12), and the job
  stays `RUNNING`. The route audits `execution_attempt.submitted` once. Its
  metadata is `attemptNumber`, `fencingCounter`, `workerPrincipalId`,
  `provider` and `credentialVersion`, never the provider execution ID, a
  token or a secret.

  That kept lease is renewable by heartbeat only while it is still the exact
  live-route epoch (section 12, R44B6N). A kept lease that is not renewed
  runs to its normal expiry. Recovery afterwards follows section 12,
  "Re-lease after expiry".
- Timestamps come from server time. There is no client-supplied acceptance
  timestamp. The journal's `providerAcceptedAt` stays local and
  informational. Recovery horizons, once defined, are measured
  conservatively from `submitting_at` (section 23).
- The response is
  `{executionAttemptId, fencingCounter, state: "SUBMITTED", providerExecutionId, submittedAt}`.
- **Idempotency.** For the same attempt, proof and provider execution ID on
  an already `SUBMITTED` attempt, the route returns the committed result,
  including for concurrent identical requests. It writes no new audit and
  does not change `submitted_at`.
- **Refusals.** All of the following are refused with the uniform
  `409 LEASE_REJECTED` and logged as `WORKER_SUBMITTED_REJECTED` (section
  30):
  - a different provider execution ID on a `SUBMITTED` attempt
    (`PROVIDER_EXECUTION_CONFLICT`), an invariant violation that never
    rewrites the stored ID;
  - an ID already adopted by another attempt of the same Account and
    provider, through the unique index (`PROVIDER_EXECUTION_ID_IN_USE`);
  - a wrong worker, token or fence, or an expired lease, including a replay
    after the live lease has expired;
  - a replacement or recovery lease (`SUBMITTED_LEASE_EPOCH_MISMATCH`).
- **Lost response.** The journal is durable, the control plane commits, the
  response is lost and the worker retries. The retry hits the idempotent
  replay. If the lease has expired meanwhile, the attempt is already
  `SUBMITTED`, because the commit happened. The worker then uses
  `acceptance-recovery`, which replays it. Neither path creates a second
  audit row or changes the provider ID.

```text
SUBMITTED_REPORT_IDEMPOTENT=YES
SUBMITTED_DIFFERENT_PROVIDER_EXECUTION_ID=INVARIANT_VIOLATION
SUBMITTED_TIMESTAMP_AUTHORITY=SERVER
LEASE_KEPT_ON_LIVE_SUBMITTED=YES
LIVE_SUBMITTED_ROUTE_IMPLEMENTED=YES
LIVE_SUBMITTED_ROUTE_REQUIRES_SUBMITTING=YES
LIVE_SUBMITTED_ROUTE_REQUIRES_SUBMISSION_EPOCH_MATCH=YES
LIVE_SUBMITTED_LEASE_PRESERVED=YES
OUTCOME_UNKNOWN_TO_SUBMITTED_BY_LIVE_ROUTE_ALLOWED=NO
ACCEPTANCE_RECOVERY_IMPLEMENTED=YES
ACCEPTANCE_RECOVERY_ROUTE_IMPLEMENTED=YES
WORKER_ACCEPTANCE_RECOVERY_CLIENT_IMPLEMENTED=NO
STARTUP_RECONCILIATION_CALLS_ACCEPTANCE_RECOVERY=NO
SUBMISSION_FAILED_ROUTE_IMPLEMENTED=NO
ACCEPTANCE_JOURNAL_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_USED_BY_LIVE_EXECUTION=NO
STARTUP_JOURNAL_RECONCILIATION_IMPLEMENTED=YES
WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO
```

### `acceptance-recovery` route (journal evidence without a lease token)

**Locked decision (implemented, R44B6R; recorded by R44B6R1).** Acceptance
recovery reconciles a provider execution that was definitively accepted and
durably journaled by the worker, but whose live submission lease was lost
before the control plane durably recorded `/submitted`. It performs
`OUTCOME_UNKNOWN -> SUBMITTED` for that same acceptance without another
provider create. The live `/submitted` route remains unable to perform that
transition.

A restarted worker no longer holds its lease token: the token lives only
in memory, and the
journal never stores it. A swept attempt has no lease at all. Journal
evidence is therefore reported through
`POST /worker-control/v1/attempts/:attemptId/acceptance-recovery` with
exactly `{fencingCounter, providerExecutionId}`.

The route exists only on the explicitly composed worker-control router;
the default commercial-api process answers 404. It uses the existing strict
worker authentication, ACTIVE-principal checks, Origin rejection,
POST-only handling, canonical lowercase UUID route parameter and JSON
content-type validation. Security-sink failure fails the request closed.

**Closed request.** `fencingCounter` is a positive safe integer representing
the immutable original submission epoch. No lease token, arbitrary journal
JSON, journal digest, Account ID, job ID, provider field, provider payload or
credential field is accepted. `recordSha256` is neither accepted nor
persisted. The provider execution ID uses the existing shared contract:
1 to 256 visible ASCII characters, no `://`, and no normalization.

**Exact success response (200).**

```text
{executionAttemptId, fencingCounter, state, providerExecutionId}
```

The first transition returns state `SUBMITTED`; an idempotent replay returns
the stored replayable state listed below. No timestamp, lease authority or
internal recovery metadata is added to this response.

A token-less request **never bypasses a live `SUBMITTING` lease**:

```text
SUBMITTING + valid current lease token
  -> the live submitted route may commit SUBMITTED
SUBMITTING + process restart (token lost)
  -> no provider create
  -> no token-less SUBMITTED transition
  -> wait for the authoritative control-plane expiry
expired SUBMITTING (server clock)
  -> OUTCOME_UNKNOWN (section 12 sweep)
  -> lease fields cleared
  -> submitting_worker_principal_id and fencing counter retained
OUTCOME_UNKNOWN + valid durable acceptance journal
  -> acceptance-recovery may commit SUBMITTED
```

- **Step 1: expiry, in its own READ COMMITTED transaction (TX1).** After
  request authentication, the ACTIVE worker is re-checked `FOR SHARE`.
  The existing section 12 sweep runs, scoped to the named attempt, and
  commits. The named scan waits for its row lock rather than skipping it;
  the acquisition batch keeps its existing `SKIP LOCKED` behavior. If the
  attempt is `SUBMITTING`
  and `lease_expires_at <= now()` by the server clock, it becomes
  `OUTCOME_UNKNOWN` with its normal audit. A live lease is untouched; the
  caller's claim of a restart changes nothing. This committed lifecycle
  expiry remains durable even if the later recovery refuses or rolls back.
- **Step 2: recovery, in a fresh READ COMMITTED transaction (TX2).** The principal
  is re-checked `FOR SHARE` and the attempt locked `FOR UPDATE`. Then:
  - **Authority.** The caller must be an ACTIVE authenticated principal
    equal to the attempt's immutable `submitting_worker_principal_id`
    (section 26). `submitting_at` must be present. `fencingCounter` must
    equal both the immutable `submitting_fencing_counter` and the retained
    `lease_fencing_counter`. Schema version 6 preserves this epoch while
    `SUBMITTING`; `OUTCOME_UNKNOWN` has no lease. Same worker principal
    alone, or a newer same-principal lease fence, is insufficient. These
    checks run before any state is disclosed. Recovery never rewrites the
    submitting timestamp, principal or fencing counter.
  - **`OUTCOME_UNKNOWN`** is the only state this route newly transitions.
    First recovery from `LEASED` or `SUBMITTING` is forbidden. Authoritative
    DB checks bind the attempt, Account, job, claimed generation
    authorization, production, billing mode, provider, ProviderConnection
    and exact credential version. The immutable authorization retains
    request-digest authority; the request supplies no generation digest.
    The connection and exact version are locked `FOR SHARE` in that order.
    An original version destroyed while recovery is required is refused;
    a disconnected connection or retained original version is not replaced
    by another credential.
    The first valid recovery writes exactly these attempt fields:

    ```text
    state = SUBMITTED
    provider_execution_id = requested providerExecutionId
    submitted_at = now()
    failure_code = NULL
    updated_at = now()
    ```

    Clearing the unknown-outcome failure code satisfies schema version 6's
    failure-state contract. Lease fields, credential grant evidence and
    immutable submitting provenance are preserved.
    No lease is created; recovery polling needs a future recovery lease
    (section 36). The job moves from `NEEDS_ATTENTION` to `RUNNING`, with its
    `updated_at` set by server time. The
    route audits `execution_attempt.submitted` with
    `recoveredFromJournal: true`. `OUTCOME_UNKNOWN -> SUBMITTED` is already
    a permitted migration 0004 transition ("provider identity later
    proven").
  - **Still `SUBMITTING` after TX1:** no recovery write, audit or security
    rejection event. The route answers `409 ATTEMPT_STILL_SUBMITTING` only
    after proving the original submitting principal and epoch. This also
    applies when the lease expires between TX1 and TX2: TX2 never
    independently manufactures `OUTCOME_UNKNOWN` or forces
    `SUBMITTING -> SUBMITTED`. A later retry can sweep authoritatively in
    TX1 and then recover. No client clock assertion is used. The worker
    remains blocked; a still-authorized live holder reports through
    `/submitted`.
- **Replay and reconciliation.** If the attempt is already `SUBMITTED`,
  `SUCCEEDED`, `SUBMITTED_FAILED` or `ABANDONED` with the **same** ID, the
  route returns `{executionAttemptId, fencingCounter, state,
  providerExecutionId}` with no write, after the same original-epoch proof.
  Replay does not change `submitted_at`, rewrite provider identity,
  duplicate audit, repeatedly mutate the job or recreate lease authority.
  Terminal same-ID replay remains possible after its credential-retention
  obligation has closed. A different ID is always rejected.
- **Refusals.** These are refused with the uniform `409 LEASE_REJECTED` and
  a security event:
  - a different ID;
  - a terminal state without that ID (`FAILED_BEFORE_SUBMISSION`,
    `CANCELLED`, or `ABANDONED` with no ID);
  - a principal or fencing mismatch;
  - an ID adopted by another attempt;
  - any state before `SUBMITTING`.
- The route never calls a provider. Adopting results still requires recovery
  to verify the ID with the provider, using the exact original credential
  (section 32).

**Uniqueness and concurrency.** The existing database index remains final
authority for `(account_id, provider, provider_execution_id)`. Only SQLSTATE
`23505` naming `execution_attempts_provider_execution_uq` is mapped to
`PROVIDER_EXECUTION_ID_IN_USE`; unrelated unique violations remain database
failures. Attempt row locking serializes concurrent identical recovery into
one first transition and one audit, followed by idempotent replay of the
same stored identity and timestamp. Concurrent conflicting IDs cannot both
succeed. No process-local mutex supplies authority.

**Retention and horizon.** The exact original version remains retained
while `OUTCOME_UNKNOWN`; successful recovery to `SUBMITTED` continues both
existing retention and provider-recovery obligations (sections 22 to 24).
Disconnect cannot destroy that material while obligations remain. Recovery
does not destroy credentials or invent a timeout: `recovery_expires_at`
remains `NULL` until a provider-specific horizon policy exists. Recognizing
live-lease expiry is separate from that undefined provider horizon.

**Audit and security.** First recovery writes `execution_attempt.submitted`
exactly once with `recoveredFromJournal: true`. Section 30's safe metadata
policy applies: no provider execution ID, tokens, credentials or provider
payload. Refusals use `WORKER_ACCEPTANCE_RECOVERY_REJECTED` with the closed
reasons recorded in section 30. Success emits no rejection event;
`ATTEMPT_STILL_SUBMITTING` is an expected lifecycle wait, not a rejection
event. An audit failure rolls back recovery and job restoration together,
while TX1's already-committed expiry remains intact.

**Heartbeat and worker boundary.** Recovery creates no lease, revives no
expired live token and rewrites neither submitting principal nor submitting
fencing counter. It manufactures no live-route `SUBMITTED` heartbeat
authority; replacement/recovery contexts do not inherit that original
live-route epoch (section 12). R44B6R implements only this control-plane
route. The worker acceptance-recovery client and startup wiring remain
unimplemented, so R44B6Q continues to discover and block unresolved durable
acceptance without automatically resolving it.

```text
SUBMITTING_WITH_VALID_JOURNAL_CAN_REPORT_SAME_PROVIDER_EXECUTION=YES
OUTCOME_UNKNOWN_WITH_VALID_JOURNAL_CAN_REPORT_SAME_PROVIDER_EXECUTION=YES
ACCEPTANCE_RECOVERY_AUTHORITY=SUBMITTING_PRINCIPAL_AND_RETAINED_FENCING_COUNTER
ACCEPTANCE_RECOVERY_IMPLEMENTED=YES
ACCEPTANCE_RECOVERY_ROUTE_IMPLEMENTED=YES
ACCEPTANCE_RECOVERY_REQUIRES_OUTCOME_UNKNOWN=YES
ACCEPTANCE_RECOVERY_PROVIDER_RESUBMISSION_ALLOWED=NO
ACCEPTANCE_RECOVERY_USES_EXPIRED_LIVE_TOKEN=NO
ACCEPTANCE_RECOVERY_REQUIRES_ORIGINAL_SUBMISSION_EPOCH=YES
ACCEPTANCE_RECOVERY_DIFFERENT_PROVIDER_EXECUTION_ID_ALLOWED=NO
OUTCOME_UNKNOWN_TO_SUBMITTED_BY_ACCEPTANCE_RECOVERY_ALLOWED=YES
RECOVERY_REWRITES_SUBMITTING_PRINCIPAL=NO
RECOVERY_REWRITES_SUBMITTING_FENCING_COUNTER=NO
RECOVERY_MANUFACTURES_SUBMITTED_HEARTBEAT_AUTHORITY=NO
ACCEPTANCE_RECOVERY_FIRST_TRANSITION_AUDIT_WRITTEN_ONCE=YES
ACCEPTANCE_RECOVERY_REPLAY_DUPLICATES_AUDIT=NO
WORKER_ACCEPTANCE_RECOVERY_CLIENT_IMPLEMENTED=NO
STARTUP_RECONCILIATION_CALLS_ACCEPTANCE_RECOVERY=NO
TOKENLESS_ACCEPTANCE_RECOVERY_FROM_LIVE_SUBMITTING=NO
TOKENLESS_ACCEPTANCE_RECOVERY_FROM_OUTCOME_UNKNOWN=YES
SUBMITTING_RESTART_WITH_JOURNAL_CAN_RESUBMIT_PROVIDER=NO
SUBMITTING_RESTART_WITH_JOURNAL_WAITS_FOR_AUTHORITATIVE_EXPIRY=YES
```

A `SUBMITTING` attempt with a valid journal reports the same provider
execution ID in one of two ways only:

- through the live `submitted` route, while its token-proven lease lasts;
- after the authoritative expiry, through `OUTCOME_UNKNOWN` and
  `acceptance-recovery`.

### Future `submission-failed` route

**Locked decision (design only).**
`POST /worker-control/v1/attempts/:attemptId/submission-failed` with exactly
`{fencingCounter, leaseToken, outcome, failureCode}`.

- `outcome` is `DEFINITIVELY_REJECTED` or `OUTCOME_UNKNOWN`.
- `failureCode` comes from the closed taxonomy of section 27, and each code
  is valid for only one outcome.
- The route requires the live-lease proof and state `SUBMITTING`.
- It writes the target state, `failure_code`, the cleared lease and
  `updated_at`. `DEFINITIVELY_REJECTED` also writes `completed_at`.
- It audits `execution_attempt.failed_before_submission` or
  `execution_attempt.outcome_unknown`.
- A replay with the same outcome and code returns the committed result. Any
  other report on a no-longer-`SUBMITTING` attempt is refused.
- The parent job becomes `NEEDS_ATTENTION` for `OUTCOME_UNKNOWN`. For
  `DEFINITIVELY_REJECTED` it becomes `FAILED`, unless a separately locked
  retry policy creates a new attempt. That policy is deferred and is never
  automatic in v1.

### Upstream reporting after the journal

If the journal holds a provider execution ID but the upstream report fails:

- do not resubmit;
- retry `submitted` while the lease is live, otherwise use
  `acceptance-recovery`;
- do not lease or start another job until the accepted record is reconciled
  with the control plane (section 17).

This is an initial concurrency-1 safety rule.

```text
SUBMITTED_CAN_CALL_PROVIDER_CREATE_AGAIN=NO
```

---

## 19. Credential opener placement

**Locked decision.**

```text
PUBLIC_API_CREDENTIAL_OPENER=NO
PRIVATE_WORKER_CREDENTIAL_OPENER=YES
```

The public control plane provides only:

- the sealed credential envelope;
- the exact associated-data context;
- any key-management reference the approved opener design requires.

The worker opens the envelope locally. Public request handlers never obtain
plaintext during execution. A separate private secret service is not
required by this design; the parent lock already permits plaintext only in
worker or key-service memory.

---

## 20. Credential grant

**Locked decision.** A credential grant requires:

- an authenticated worker principal;
- a live lease;
- the current fencing generation;
- the exact attempt ID.

The server derives, from authoritative persisted relationships:

- Account;
- ProviderConnection;
- ProviderCredentialVersion;
- provider;
- numeric credential version.

The worker cannot supply or substitute these values; any client-supplied
equivalent is rejected. The response returns exactly one sealed credential.

There is no credential enumeration, no "latest credential" lookup and no
arbitrary ProviderConnection lookup.

A grant is refused when:

- the attempt is not leased by the caller under the current fencing
  generation;
- the bound version is `DESTROYED`;
- the connection is no longer eligible for new submissions, unless the
  attempt is already `SUBMITTED` and the grant is for recovery of that
  attempt.

---

## 21. Exact credential-version binding

**Locked decision.**

```text
GENERATION_BINDS_EXACT_CREDENTIAL_VERSION=YES
```

The immutable GenerationAuthorization and attempt provenance record the
exact `provider_credential_version_id`. The sealed credential's associated
data must match Account, ProviderConnection, provider and credential
version; an envelope bound to anything else fails authentication when
opened.

No runtime "use the current key" behaviour is allowed.

**Repository fact.** The engine's current reconcile CLI reads the current
environment key at recovery time. That behaviour is not reused for
commercial recovery.

---

## 22. Recovery credential rule

Carried forward unchanged from the provider-connection lock:

```text
RECOVERY_DEFAULTS_TO_ORIGINAL_VERSION=YES
RECOVERY_CREDENTIAL_SUBSTITUTION_SILENT=NO
RECOVERY_CREDENTIAL_SUBSTITUTION_CURRENTLY_ENABLED=NO
```

A future substitute credential version requires all of:

1. the same ProviderConnection;
2. proven identity of the same provider account or project;
3. provider documentation or testing establishing that substitution works;
4. an explicit capability policy permitting it;
5. an auditable rebind.

---

## 23. Retention and recovery obligations

**Locked decision.** Two distinct obligations protect credential material.

### Credential-retention obligation

The credential must not yet be destroyed because a valid worker execution
may still need or use it.

- Opens at a successful credential grant.
- Remains open while a live leased worker may still submit, while submission
  is in progress, while the provider outcome is unknown, and while a
  submitted provider execution remains recoverable.
- Before `SUBMITTING`, it may close when the worker's authority is
  definitively revoked or expired, or the attempt is safely `CANCELLED` or
  `FAILED_BEFORE_SUBMISSION`, and no provider call occurred.
- After `SUBMITTING`, it closes with the provider-recovery obligation.

### Provider-recovery obligation

A provider-side effect may have occurred and the original credential may be
required to recover it.

- Opens when the durable attempt state becomes `SUBMITTING`, before the
  provider call is issued.
- Remains open for `SUBMITTING`, `OUTCOME_UNKNOWN`, `SUBMITTED`, and output
  recovery and persistence work for that submission.

It does not wait for submission acceptance, because a request may be
accepted before the worker receives or records the provider ID.

It closes only on authoritative proof that no outstanding provider side
effect remains (revision R44B6D1), not merely on proof that no provider call
occurred. A definitive provider rejection is such proof; an ambiguous
provider outcome never is.

```text
CREDENTIAL_RETENTION_OBLIGATION_OPENS_AT_GRANT=YES
PROVIDER_RECOVERY_OBLIGATION_OPENS_AT_SUBMITTING=YES
RECOVERY_OBLIGATION_OPENS_NO_LATER_THAN_SUBMITTING=YES
```

**Repository fact.** Every current recovery path needs the credential again:
Runway task retrieval, Veo operation polling and file download, and Google
interaction replay, Files metadata and download all authenticate with the
key. Runway output download uses a signed URL without the key, but
refreshing that URL requires task retrieval.

### Obligation closure

Retention may end only when the attempt can no longer require the
credential, for example:

- `FAILED_BEFORE_SUBMISSION`, with authoritative evidence that no accepted
  or outstanding provider side effect exists: either no provider call
  occurred, or the provider definitively rejected the submission (section
  14);
- `SUBMITTED_FAILED`, where the provider's terminal failure is
  authoritative;
- `SUCCEEDED`, after output is securely persisted and its integrity
  metadata recorded;
- `ABANDONED`, after explicit policy, horizon or operator resolution;
- `OUTCOME_UNKNOWN`, only after explicit resolution or abandonment.

Destruction is never triggered solely because a lease expired, a worker
crashed, a browser disconnected, the user disconnected the
ProviderConnection, or a provider poll failed temporarily.

**Repository fact.** The only recovery horizons in code are Google GenAI's:
automated recovery ends at `submittedAt` plus 24 hours, an operator-only
historical authority allows 6 days, and output files must have at least one
hour of remaining provider lifetime. No Runway or Veo horizon is encoded.
Commercial horizons per provider are deferred to the gate that enables each
provider (section 33).

**Locked decision (revision R44B6K).** `recovery_expires_at` stays `NULL`
until a provider-specific capability policy locks a horizon. This revision
invents no Runway, Veo or Google value. The state machine is safe without a
horizon:

- `SUBMITTING`, `SUBMITTED` and `OUTCOME_UNKNOWN` keep both obligations open
  indefinitely;
- abandonment is only ever an explicit decision (migration 0004);
- nothing expires automatically.

When horizons are defined, they are measured from `submitting_at`. It is the
earliest server-proven bound on provider acceptance, so the measurement is
conservative. They are never measured from a worker-supplied time.

```text
RECOVERY_EXPIRES_AT_PROVIDER_VALUE_INVENTED=NO
RECOVERY_EXPIRES_AT_UNTIL_PROVIDER_POLICY=NULL
```

---

## 24. Disconnect destruction gate

**Repository fact.** R44B5E's disconnect destroys every credential version
unconditionally. That is safe only while no commercial generation exists.

**Locked decision.** Before commercial generation is enabled, disconnect
becomes:

1. stop new GenerationAuthorization use of the connection;
2. prevent new submissions;
3. inspect every credential version of the connection;
4. versions with no open retention or recovery obligation may become
   `DESTROYED`;
5. versions still required become `RETAINED_FOR_RECOVERY`;
6. when the final obligation closes, the version is destroyed by the defined
   lifecycle service.

```text
DISCONNECT_UNCONDITIONAL_DESTRUCTION_SAFE_AFTER_GENERATION=NO
OPEN_RETENTION_OR_RECOVERY_OBLIGATION_BLOCKS_DESTRUCTION=YES
```

**This is a launch-blocking invariant.** Migration 0002 already provides the
`RETAINED_FOR_RECOVERY` version status and `retained_for_recovery_at`.

**Locked decision (revision R44B6K).** Disconnect after `SUBMITTING` or
`SUBMITTED`:

- **No revocation of committed work.** Disconnect does not revoke recovery
  of a provider call that was authorised before it. The exact version is
  `RETAINED_FOR_RECOVERY` while `SUBMITTING`, `SUBMITTED` or
  `OUTCOME_UNKNOWN` holds the obligation open (implemented in R44B6E).
- **Routes that skip connection eligibility.** These routes act only on
  already-authorised work: heartbeat, `submitted`, `acceptance-recovery`,
  `submission-failed` and the `submitting` replay. They therefore never
  check connection eligibility. Each one fails closed if the exact version
  is `DESTROYED`, which is an invariant failure.
- **No new create.** Disconnect never authorises a new provider create. A
  first `SUBMITTING` after disconnect is refused (R44B6J).
- **Recovery use only.** A retained credential may be used only to recover
  the same provider execution ID: polling, retrieval and output download. Its
  use requires a future recovery-scoped credential grant under a recovery
  lease (section 36). It is never used for create, and never for a different
  attempt.

```text
DISCONNECT_REVOKES_AUTHORISED_SUBMISSION_RECOVERY=NO
RETAINED_CREDENTIAL_USE=RECOVERY_OF_SAME_PROVIDER_EXECUTION_ONLY
```

---

## 25. GenerationAuthorization dependency

**Locked decision.** A commercial execution job cannot exist without an
authoritative GenerationAuthorization. The bridge does not invent
authorization authority.

GenerationAuthorization must eventually bind at minimum:

- Account;
- Production;
- billing mode (`USER_BYO` or `PLATFORM_HOSTED`, with the parent lock's
  nullability matrix and no fallback in either direction);
- requested provider and model;
- exact generation parameters, with an immutable or hashed representation;
- entitlement and usage authority;
- expected-cost cap;
- for `USER_BYO`, the ProviderConnection;
- for `USER_BYO`, the exact ProviderCredentialVersion;
- expiration before claim;
- lifecycle status.

---

## 26. Persistence

### Sequencing

**Locked decision.** This document creates no migration. Implementation
sequencing keeps referential integrity real:

1. this architecture lock;
2. the minimum GenerationAuthorization persistence contract the bridge
   needs;
3. execution jobs and attempts referencing that authorization;
4. worker principals and worker APIs;
5. the credential grant and the retention/recovery gate.

Bridge rows never hold a free-form `generationAuthorizationId` without a
foreign key.

### Conceptual entities

**`worker_principals`**: machine identity and lifecycle.

- ID;
- status;
- authentication public-key reference, key reference or another
  mechanism-neutral identity reference;
- created and disabled timestamps.

No worker plaintext secret is stored in PostgreSQL.

**`execution_jobs`**: one logical commercial generation job. References the
GenerationAuthorization, the Account, and the Production where structurally
appropriate, with composite keys that prevent cross-account combinations.

**`execution_attempts`**: one provider-submission attempt.

- job;
- attempt number;
- state;
- provider;
- exact credential version, for `USER_BYO`;
- lease owner;
- lease verifier (token hash);
- fencing generation;
- lease expiration;
- heartbeat;
- submission timestamps (`SUBMITTING` and accepted);
- provider execution ID;
- recovery horizon;
- closed failure code;
- output object reference;
- output SHA-256;
- output byte size.

Lease fields are attempt columns, not a separate table. Obligations are
derived from attempt state and the bound credential version, not stored as
free-floating rows.

No provider credential plaintext is persisted anywhere.

### Provider execution ID uniqueness

Provider execution IDs are protected from double adoption with uniqueness
scoped to the Account and the provider (revision R44B6D1). Global uniqueness
across independent customer provider accounts or projects is not assumed:
R44B6A did not establish that namespace, and it is adopted only if provider
documentation later proves it. They are not exposed to customers unless a
future product requirement explicitly needs it.

```text
PROVIDER_EXECUTION_ID_GLOBAL_UNIQUENESS_ASSUMED=NO
PROVIDER_EXECUTION_ID_UNIQUENESS_SCOPE=ACCOUNT_PROVIDER
```

**Repository fact.** The engine already enforces a comparable rule for
Google interactions through its global provider-execution-ID claim.

### Migration assessment for the submission lifecycle (revision R44B6K)

**Repository fact.** Migration 0004 already supports, unchanged:

- heartbeat in `SUBMITTING`, which changes only `heartbeat_at` and
  `lease_expires_at`;
- `SUBMITTING -> OUTCOME_UNKNOWN` with every lease field cleared, the
  fencing counter retained and a closed failure code;
- `SUBMITTING -> SUBMITTED` with the lease kept or cleared;
- `SUBMITTING -> FAILED_BEFORE_SUBMISSION` with `submitting_at` kept;
- `OUTCOME_UNKNOWN -> SUBMITTED`;
- the immutability of provider identity and `submitted_at`;
- Account-plus-provider uniqueness of provider execution IDs;
- the lease-expiry index.

**Gap.** `acceptance-recovery` must prove that its caller is the principal
that received provider-call authority. In `OUTCOME_UNKNOWN`, migration 0004
requires `lease_worker_principal_id` to be `NULL`, so the expiry sweep erases
that identity. The only durable copy left is in audit metadata. Audit is
evidence, not authority, so it is not used for authorisation.

**Rejected alternatives:**

- keeping the lease on `OUTCOME_UNKNOWN` (contradicts migration 0004);
- accepting any ACTIVE principal with a matching fencing counter (any worker
  principal could then attach a provider ID to another Account's unknown
  attempt);
- storing the lease token in the journal (forbidden by section 17).

**Locked decision.** Implementation requires a small additive migration
0005, created only in its own authorised slice. Migrations 0001 to 0004 are
never edited.

### Migration 0005 contract (revision R44B6K1)

**Column.** `execution_attempts.submitting_worker_principal_id uuid NULL`,
with
`CONSTRAINT execution_attempts_submitting_worker_fk FOREIGN KEY (submitting_worker_principal_id) REFERENCES worker_principals (id) ON DELETE RESTRICT`.
This is the same restrictive semantics as `execution_attempts_lease_worker_fk`.
Worker principals are disabled, never deleted.

**Meaning.** The column is historical provider-call-authority provenance:

- `NULL` until the attempt first enters `SUBMITTING`;
- non-`NULL` exactly when `submitting_at IS NOT NULL`, enforced by
  `CONSTRAINT execution_attempts_submitting_worker_ck CHECK ((submitting_at IS NULL) = (submitting_worker_principal_id IS NULL))`;
- immutable once set;
- survives the clearing of the live lease, `SUBMITTING -> OUTCOME_UNKNOWN`,
  `SUBMITTING -> FAILED_BEFORE_SUBMISSION`, `SUBMITTED` and every terminal
  descendant.

**Database-derived stamping.** The value comes from the database, never from
application code. Migration 0005 replaces `execution_attempts_guard()`
(`CREATE OR REPLACE FUNCTION`; the trigger binding stays) with the 0004
rules plus:

1. **On INSERT,** `NEW.submitting_worker_principal_id` must be `NULL`.
2. **On the first `LEASED -> SUBMITTING` transition,** the guard requires:
   - `OLD.lease_worker_principal_id IS NOT NULL`;
   - `OLD.lease_expires_at > clock_timestamp()`: the lease is still valid
     by actual wall-clock time at the guarded transition (revision R44B6K5;
     see "Wall-clock provider-call authority barrier" below);
   - `NEW.lease_worker_principal_id IS NOT DISTINCT FROM OLD.lease_worker_principal_id`,
     so the lease cannot change in the same statement;
   - `NEW.submitting_worker_principal_id` either `NULL` or equal to
     `OLD.lease_worker_principal_id`. Any other supplied value is rejected.

   It then **stamps**
   `NEW.submitting_worker_principal_id := OLD.lease_worker_principal_id`.
3. **On every other update,** any
   `NEW.submitting_worker_principal_id IS DISTINCT FROM OLD.submitting_worker_principal_id`
   is rejected. That covers setting it outside the transition, changing it
   and clearing it.

The R44B6J service is unchanged. It never names the column, and the guard
fills it in.

### Wall-clock provider-call authority barrier (revision R44B6K5)

**Erratum.** Revision R44B6K1 required `OLD.lease_expires_at > now()` and
described it as the same transaction clock that the lease service checks.
That was too weak. PostgreSQL `now()` is transaction-stable: it returns the
start time of the enclosing transaction. A transaction that began while the
lease was valid could therefore move `LEASED -> SUBMITTING` after the lease
had already expired in real time. That would grant provider-call authority
to a lease that no longer exists.

**Locked decision.** The database guard is the final, fail-closed authority
for provider-call permission. For the first `LEASED -> SUBMITTING`
transition it evaluates `OLD.lease_expires_at > clock_timestamp()`.
`clock_timestamp()` returns the actual wall-clock time when the guard runs.
A lease that has expired in real time can never cross into `SUBMITTING`,
however early the enclosing transaction began.

**The preliminary service check is separate.** The lease service's
preliminary lease check (for example `lease_expires_at <= now()` in the
R44B6J path) may keep transaction time. It is a fast first refusal, not the
authority. Consider this sequence:

1. the service observes the lease as valid;
2. time passes;
3. the lease expires before the database transition.

The guard rejects the transition. The service then reports a database
failure, and no acknowledgement is returned, so no provider call is
authorised. The database is deliberately stricter than the service.

**Expiry recognition keeps `now()`.** The section 12 sweep (including step 1
of `acceptance-recovery`) and every other expiry *recognition* rule keep
`lease_expires_at <= now()` inside short control-plane transactions. A
transaction-stable clock there can at worst recognise an expiry one
transaction later. That delays the move to `OUTCOME_UNKNOWN` slightly, while
the live lease keeps its authority. It can never grant provider-call
authority after real expiry. The asymmetry is intentional:

- granting authority uses wall-clock time;
- recognising lost authority may use transaction time.

Future implementations must not mechanically replace every `now()` in this
design with `clock_timestamp()`. `submitted_at = now()`,
`updated_at = now()` and similar timestamps also stay transaction time.

```text
SUBMITTING_EXPIRY_USES_TRANSACTION_STABLE_NOW=NO
SUBMITTING_EXPIRY_USES_WALL_CLOCK_TIME=YES
SUBMITTING_EXPIRY_CLOCK_SOURCE=CLOCK_TIMESTAMP
LONG_RUNNING_TRANSACTION_CAN_CROSS_EXPIRED_LEASE_INTO_SUBMITTING=NO
EXPIRY_SWEEP_REQUIRES_CLOCK_TIMESTAMP=NO
```

**Migration order** (one transaction, under the existing migration lock):

1. `ADD COLUMN submitting_worker_principal_id uuid NULL` with the foreign key.
   No default is needed, because every existing value starts `NULL`.
2. **Backfill.** For rows where `state = 'SUBMITTING'` only, set the column
   from `lease_worker_principal_id`. Rows are not otherwise mutated. The
   0004 guard, still installed at this point, does not inspect the new
   column, and the transition and immutability rules are untouched. For a
   `SUBMITTING` row the value is provably the submitting principal, because
   0004 forbids changing the lease principal or token while `SUBMITTING`.
3. **Fail closed.** If any row still has `submitting_at IS NOT NULL` and a
   `NULL` submitting principal, `RAISE EXCEPTION` and abort the whole
   migration. Such a row would be a post-`SUBMITTING` row whose lease has
   already been cleared or replaced. No value is inferred from audit
   metadata or from a later lease. An operator decides. At this revision no
   commercial generation exists and the test schema is reset, so no such
   row is expected.
4. Add `execution_attempts_submitting_worker_ck`, validated.
5. Replace `execution_attempts_guard()` with the extended rules.
6. Record schema version 5.

**Runtime grant.** Migration 0005 is expected to need no runtime grant
change:

- PostgreSQL checks column `UPDATE` privilege only for columns named in the
  statement's `SET` list. A `BEFORE ROW` trigger that assigns
  `NEW.submitting_worker_principal_id` needs no privilege on that column.
- The runtime role therefore gets **no** `UPDATE` on the new column. It
  cannot nominate or change the submitting principal, even by accident.
- The manifest's table-level `SELECT` and `INSERT` already cover new columns.
  The guard and the `CHECK` force `NULL` on insert.
- `runtimeGrants.ts` stays unchanged. Grant-runtime is re-run as normal
  after migrating.
- The 0005 slice adds a privilege test asserting
  `has_column_privilege(runtime, 'execution_attempts', 'submitting_worker_principal_id', 'UPDATE') = false`.

No other schema change is needed for the decisions of this revision.

```text
SUBMITTING_WORKER_PRINCIPAL_DATABASE_DERIVED=YES
SUBMITTING_WORKER_PRINCIPAL_IMMUTABLE=YES
SUBMITTING_WORKER_PRINCIPAL_SURVIVES_LEASE_CLEAR=YES
SUBMITTING_WORKER_PRINCIPAL_SURVIVES_OUTCOME_UNKNOWN=YES
RUNTIME_GRANT_CHANGE_EXPECTED_FOR_0005=NO
```

```text
MIGRATION_0005_REQUIRED_FOR_IMPLEMENTATION=YES
MIGRATION_0005_SCOPE=IMMUTABLE_SUBMITTING_WORKER_PRINCIPAL
MIGRATION_0005_CREATED=NO
```

---

## 27. Failure taxonomy and public progress

### Failure taxonomy

**Locked decision.**

| Code | Meaning | Retry |
|---|---|---|
| `FAILED_BEFORE_SUBMISSION` | Authoritative evidence that no accepted or outstanding provider side effect exists: no provider call occurred, or the provider definitively rejected the submission (section 14). | Policy may permit a new attempt. |
| `OUTCOME_UNKNOWN` | A provider call was attempted and the system cannot prove rejection or acceptance. | Never automatic. |
| `SUBMITTED_FAILED` | The provider identified the execution and later returned a terminal failure. | Policy decision on a new attempt. |
| `ABANDONED` | The recovery horizon or policy ended, or an authorised operator resolved an unknown or recoverable attempt. | No. |

Classification guidance:

- validation failure before the provider call, credential unavailable, and
  an unambiguous, definitive provider rejection of the create proving the
  generation was not accepted: `FAILED_BEFORE_SUBMISSION` (a rejection keeps
  its recorded `submitting_at`);
- timeout, connection reset, ambiguous transport failure, ambiguous provider
  5xx, malformed or uncertain response, a worker crash while the submission
  is in flight, or anything else that cannot rule out acceptance:
  `OUTCOME_UNKNOWN`;
- output recovery or persistence failure within the horizon: the attempt
  stays `SUBMITTED` and recovery continues.

Internal codes are closed enums. Customer-facing errors are coarser.

**Locked decision (revision R44B6K).** The initial closed `failure_code`
values for the submission lifecycle:

| State | `failure_code` | Set by |
|---|---|---|
| `OUTCOME_UNKNOWN` | `WORKER_LEASE_EXPIRED_DURING_SUBMISSION` | the control-plane sweep (section 12) |
| `OUTCOME_UNKNOWN` | `PROVIDER_SUBMISSION_AMBIGUOUS` | `submission-failed`: timeout, reset, ambiguous 5xx or uncertain response |
| `OUTCOME_UNKNOWN` | `ACCEPTANCE_JOURNAL_WRITE_FAILED` | `submission-failed` (section 18) |
| `OUTCOME_UNKNOWN` | `PROVIDER_EXECUTION_ID_INVALID` | `submission-failed`: the provider accepted, but its ID is unusable |
| `FAILED_BEFORE_SUBMISSION` | `PROVIDER_REJECTED_DEFINITIVELY` | `submission-failed`; each provider adapter decides definitiveness by its own closed classification |

Provider adapters may later refine `PROVIDER_REJECTED_DEFINITIVELY` into
narrower closed codes through a reviewed change. No provider-specific
definitiveness rule is inferred here.

### Public progress

**Locked decision.** Public progress vocabulary:

- `QUEUED`
- `RUNNING`
- `SUCCEEDED`
- `FAILED`
- `NEEDS_ATTENTION`

Internal states do not leak. Public responses never expose provider raw
status, provider response payloads, provider execution IDs, worker
hostnames, local paths or the media root.

---

## 28. Media and filesystem

### Output storage

**Locked decision.** Commercial output never depends on exposing the worker
filesystem. A future object-storage capability provides:

- private objects by default;
- server-generated keys prefixed by tenant and job;
- bounded uploads;
- SHA-256 integrity metadata;
- byte count;
- content type;
- time-limited customer download capability.

The worker uploads media directly. The control plane stores object metadata
and references only. The public API does not proxy generated media bytes in
v1.

### Input media

**Locked decision.** Reference or input media reaches the worker as an
object reference or capability-scoped signed retrieval. Arbitrary local
paths, Windows paths and operator media-root paths are never accepted. The
worker materialises inputs inside a server-generated safe namespace.

### Filesystem privacy

**Repository fact.** Engine generation and completion records store absolute
paths (`destinationPath`, `sourceImagePath`, `generationRecordPath`; the
Google record schema requires absolute paths). R44B6A counted 12 of 19
existing media-root JSON records containing drive-letter paths.

**Locked decision.** No commercial API response or wire message contains
drive letters, absolute local paths, operator usernames, repository paths or
media-root locations. Engine evidence reused internally is translated or
redacted at the commercial boundary.

### Engine evidence

**Locked decision.** In v1 the control plane is the commercial lifecycle
authority. The worker uses its local acceptance journal and existing
provider-level engine functions. Current `EP`/`S` lifecycle schemas do not
become the commercial database, and engine evidence schemas are not
modified unless later implementation proves it necessary.

If commercial provenance is added to engine evidence later, it is additive,
versioned, non-secret and path-safe (relative).

**Repository fact.** R44B6A found no credential field in any engine record
schema and no key-like value or secret-named field in the existing media-root
records.

---

## 29. Credential lifetime, errors and logs

### Credential lifetime

**Locked decision.** Plaintext exists only:

- transiently in API memory during create and rotate sealing;
- transiently in private worker or KMS memory during execution and recovery.

It is never persisted to commercial PostgreSQL, the worker journal, engine
evidence, AuditEvent, logs or object storage.

**Repository fact.** The Runway SDK client keeps its key as a public
property for the client's lifetime, and the current production composition
caches one provider executor per process.

**Locked decision.** The worker adapter uses per-attempt credential-scoped
client lifetime. Provider SDK clients are not cached across unrelated
customer jobs.

### Closed error handling

**Repository fact.** The Google operator path discards dependency errors and
emits closed codes. The Runway and Veo paths wrap SDK errors with `cause`.
SDK error contents were not proven secret-free.

**Locked decision.** The worker translates provider and SDK errors into
closed internal codes. Raw SDK errors are never sent upstream and never
placed in AuditEvent, public responses or protocol payloads.

### Worker log safety

Worker logs exclude credential plaintext, sealed credentials, fingerprints,
provider authentication headers, signed object-storage URLs, and full
provider SDK request bodies where secrets may appear. Correlation IDs, job
IDs, attempt IDs and closed codes are permitted, subject to retention policy.

**Locked decision (revision R44B6K).**

- **Permitted.** Worker log lines may carry: attempt ID, job ID, provider,
  fencing counter, lifecycle stage (closed vocabulary) and closed error or
  failure codes.
- **Never logged.** Worker log lines never carry:
  - credential plaintext;
  - the sealed envelope or opening context;
  - the lease token or its hash;
  - the machine bearer credential;
  - provider authorisation headers;
  - the journal state-root path.
- **Provider execution ID.** It is not written to routine worker logs. Its
  durable homes are the journal record and the control-plane attempt row. An
  operator diagnostic that needs it reads the journal or the control plane.
- **Journal mechanics.** Temporary names, link and fsync steps are worker
  debug detail, not domain audit.

```text
PROVIDER_EXECUTION_ID_IN_ROUTINE_WORKER_LOGS=NO
```

---

## 30. Audit and security logs

**Locked decision.** Domain AuditEvent covers business and lifecycle events:

- authorization created;
- job leased;
- lease expired;
- credential granted;
- submitting;
- submission accepted;
- outcome unknown;
- recovery started;
- succeeded;
- failed;
- abandoned;
- retention or recovery obligation opened;
- retention or recovery obligation closed;
- ProviderConnection secret retained for recovery.

Audit metadata is limited to identifiers, provider, credential version number
and closed codes. It never contains secrets, provider payloads, prompts,
paths or URLs.

A separate security log covers:

- worker authentication failures;
- stale-token and fencing rejections;
- KMS decrypt and unwrap operations.

KMS operation logging comes from the eventual key-management system where
possible.

**Locked decision (revision R44B6K).** Event names for the submission
lifecycle.

Domain AuditEvent (`execution_attempt` resource). Metadata is limited to:
`attemptNumber`, `fencingCounter`, `workerPrincipalId`, `provider`,
`credentialVersion` (the number), `failureCode` and `recoveredFromJournal`.

| Event | When |
|---|---|
| `execution_attempt.submitting` | First `LEASED -> SUBMITTING` (implemented, R44B6J). |
| `execution_attempt.submitted` | First commit of the provider execution ID, by `submitted` or `acceptance-recovery` (with `recoveredFromJournal`). Never on replay. |
| `execution_attempt.outcome_unknown` | `SUBMITTING -> OUTCOME_UNKNOWN`, by the sweep or by `submission-failed`. |
| `execution_attempt.failed_before_submission` | `SUBMITTING -> FAILED_BEFORE_SUBMISSION` on a definitive rejection. |

The provider execution ID is not placed in audit metadata, because the
attempt row holds it. Journal filesystem mechanics are never audited.

Control-plane security events (the worker security sink):

| Type | Reasons |
|---|---|
| `WORKER_SUBMITTED_REJECTED` | The existing lease reasons, plus `PROVIDER_EXECUTION_CONFLICT` (a different ID on `SUBMITTED`), `PROVIDER_EXECUTION_ID_IN_USE` (adopted by another attempt) and `INCOMPATIBLE_ATTEMPT_STATE`. |
| `WORKER_ACCEPTANCE_RECOVERY_REJECTED` | `SUBMITTING_PRINCIPAL_MISMATCH`, `FENCING_MISMATCH`, `UNKNOWN_ATTEMPT`, `INCOMPATIBLE_ATTEMPT_STATE`, `PROVIDER_EXECUTION_CONFLICT`, `PROVIDER_EXECUTION_ID_IN_USE`, `SUBMITTING_VERSION_DESTROYED`; the shared transaction-local ACTIVE re-check also uses `WORKER_NOT_ACTIVE`. `ATTEMPT_STILL_SUBMITTING` (still `SUBMITTING` after TX1, for the proven original principal and epoch) is an expected wait signal, not a security event (R44B6R1). |
| `WORKER_SUBMISSION_FAILURE_REJECTED` | The existing lease reasons, plus `INCOMPATIBLE_ATTEMPT_STATE` and `FAILURE_CODE_OUTCOME_MISMATCH`. |
| `WORKER_LEASE_REJECTED` | Existing. A stale worker's heartbeat after its `SUBMITTING` lease was swept (`NOT_LEASED` or `LEASE_EXPIRED`). |

A `SUBMITTING` expiry is a lifecycle fact. It is audited as
`execution_attempt.outcome_unknown`, not logged as a security event.

For acceptance recovery, loss of ACTIVE status at the transaction-local
re-check is the shared 401 refusal with `WORKER_NOT_ACTIVE`. Authentication
and Origin failures retain their existing event types. Successful recovery
and the conservative `ATTEMPT_STILL_SUBMITTING` wait emit no rejection
event; the latter also covers lease expiry between TX1 and TX2 (section 18).

Worker-local security events are written to the worker log in the closed
vocabulary of section 29:

- `ACCEPTANCE_JOURNAL_CORRUPT`;
- `ACCEPTANCE_JOURNAL_CONFLICT`;
- `ACCEPTANCE_JOURNAL_WRITE_FAILED`;
- `ACCEPTANCE_RECONCILIATION_FAILED`;
- `STATE_ROOT_UNSUITABLE`.

No security event, local or central, carries a secret value, a provider
execution ID or a filesystem path.

---

## 31. Crash matrix

**Locked decision.**

| Crash point | Durable state | Rule |
|---|---|---|
| Before lease | job `QUEUED` | No side effect. |
| Leased, before credential grant | `LEASED` | The lease may expire or be released normally. |
| Credential granted, before `SUBMITTING` | `LEASED`, grant audited | A credential-retention obligation exists. If the lease is definitively revoked and no provider call occurred, the obligation can close. |
| `SUBMITTING`, provider call in flight | `SUBMITTING` | A provider-recovery obligation exists. A crash or ambiguous network outcome becomes `OUTCOME_UNKNOWN`. Never auto-resubmit. |
| Provider accepted, local journal durable | journal entry | On restart, report the same provider ID upstream. No resubmission. |
| `SUBMITTED`, polling or recovery | `SUBMITTED` with provider ID | Resume the same provider execution ID with the exact original credential version. |
| Provider success before output persistence | `SUBMITTED` | Remains recoverable until output is securely persisted. |
| Output local, upstream completion missing | local output and hash | Re-upload or report idempotently. |
| Server already terminal, worker missed the acknowledgement | terminal state | A worker replay receives the recorded terminal result. |

### Restart matrix (revision R44B6K)

**Locked decision.** The worker's local evidence is compared with the
control-plane state during startup reconciliation (section 17).

**Implementation boundary (R44B6Q1).** R44B6Q implements the local startup
phase: empty state may be `CLEAR`; valid finals remain unresolved and block
leasing; case G completes exact publication but then remains blocked; case H
quarantines invalid bytes and may become `CLEAR` if no other condition
blocks startup. Case F remains fail-closed. Conflicts and invalid filesystem
state also block. R44B6R now implements the control-plane acceptance-recovery
behavior used by B, B', C and E below. The worker client and startup calls
remain future work: R44B6Q does not invoke the route, resolve this evidence
automatically or create a recovery lease.

| Case | Control plane | Local journal | Rule |
|---|---|---|---|
| A | `SUBMITTING`, or `OUTCOME_UNKNOWN` after the sweep | none | Acceptance cannot be proven. No resubmission. The attempt becomes or stays `OUTCOME_UNKNOWN` (section 12 sweep) for operator resolution. |
| B | Still `SUBMITTING` after TX1, including expiry between TX1 and TX2 | valid record | (Revised R44B6S0.) Block new work. No provider create and no token-less transition: `acceptance-recovery` answers `ATTEMPT_STILL_SUBMITTING` after original-epoch proof. Retry only within section 17's bounded per-record policy; if a later authoritative sweep moves the attempt to `OUTCOME_UNKNOWN`, apply B'. Exhaustion retains the journal and blocks startup. The lease is never shortened and neither TX2 nor the worker retry clock manufactures expiry. |
| B' | `OUTCOME_UNKNOWN` (expired and swept, including by step 1 of `acceptance-recovery`) | valid record | `acceptance-recovery`: `OUTCOME_UNKNOWN -> SUBMITTED` with the same ID, authorised by the immutable submitting principal and the retained fencing counter. No provider create. |
| C | `SUBMITTED`, same ID | valid record | Reconciled. Recovery of that ID resumes under a recovery lease. |
| D | `SUBMITTED` | none | The control-plane ID is authoritative. Recovery uses it. |
| E | Terminal without that ID, or any state with a different ID | valid record | `ACCEPTANCE_RECONCILIATION_FAILED`. Fail closed. No new work until an operator investigates. |
| F | any | corrupt published record | `ACCEPTANCE_JOURNAL_CORRUPT`. Fail closed. Operator quarantine. |
| G | any | valid temporary file only | Complete publication, then apply B, B', C or E. |
| H | any | invalid temporary file only | Quarantine automatically. Then apply A or D. |

In every case: no provider create, no requeue of a post-`SUBMITTING` attempt
and no new submission work while any case is unresolved.

```text
SUBMITTING_WITHOUT_JOURNAL_CAN_AUTO_RESUBMIT_AFTER_RESTART=NO
```

---

## 32. Threat model

| Threat | Mitigation or gate |
|---|---|
| Stolen worker authentication credential | Short-lived authorization, immediate revocation, worker-route-only scope, audit. A stolen worker credential yields sealed envelopes only for leased attempts, not plaintext, without the separately scoped opener authority. |
| Compromised worker machine | **Partially deferred.** Plaintext is reachable only for leased attempts; concurrency 1; opener authority scoped to the worker role; per-attempt client lifetime. Host hardening is a hosting-gate decision. |
| Replayed lease | Single-use lease token stored as a verifier, fencing generation, bounded expiry, idempotent steps. |
| Stale worker | Fencing check on every mutation; `STALE_WORKER_MUTATION=DENIED`; security log. |
| Cross-account job substitution | All identifiers derived from the authorization row; composite foreign keys; worker-supplied identifiers ignored or rejected. |
| Credential-version substitution | Grant returns only the authorization's version; associated data binds the version; no "latest" lookup. |
| Arbitrary credential enumeration | No enumeration route; a grant requires a live leased attempt. |
| Duplicate provider submission | `SKIP LOCKED` lease, attempt state machine, `SUBMITTING` barrier, no automatic resubmission. |
| Ambiguous accepted-but-unrecorded submission | `SUBMITTING` before the call; local journal before the upstream report; `OUTCOME_UNKNOWN` with no automatic retry; recovery obligation retains the credential. |
| Fake provider execution ID | Accepted only from `SUBMITTING` under a live lease; provider-scoped uniqueness; recovery verifies the ID with the provider before adopting results. |
| Poisoned output completion | Lease and fencing check; server-generated object key; SHA-256 and byte count verified against the stored object. |
| Disconnect during recoverable work | Section 24 gate; `RETAINED_FOR_RECOVERY`. Launch-blocking. |
| Filesystem leakage | Object references and relative identifiers only on the wire; redaction at the commercial boundary. |
| Malicious local path injection | No paths accepted from customers or the wire; server-generated namespace; existing reference-inside-root and filename-sanitising guards reused. |
| Provider SDK environment fallback | `COMMERCIAL_WORKER_PROVIDER_ENV_FALLBACK=FORBIDDEN`; startup refusal when provider key variables are present; explicit credential on every client. |
| Raw SDK error leakage | Closed internal codes; raw errors never sent upstream or audited. |

---

## 33. Open provider facts

These remain unresolved. None of them is an implementation assumption.

- Runway provider-side idempotency support.
- Google GenAI and Veo provider-side idempotency support.
- Whether recovery works with a different key of the same provider account
  or project.
- Whether provider account or project identity can be discovered from a key.
- Runway recovery retention horizon (tasks and signed output URLs).
- Veo operation and generated-file retention.
- Recovery behaviour after the provider revokes a key.
- Provider concurrency and rate limits per key.

Each fact is resolved, or explicitly accepted as unknown with a conservative
rule, at the gate that enables the affected provider.

---

## 34. Vendor decisions

Deferred. This document locks interfaces and capabilities only.

```text
HOSTING_VENDOR=UNDECIDED
KMS_VENDOR=UNDECIDED
OBJECT_STORAGE_VENDOR=UNDECIDED
WORKER_AUTH_MECHANISM=UNDECIDED
```

The deployment region is also undecided.

---

## 35. Generation remains disabled

**Locked decision.**

```text
COMMERCIAL_REAL_PROVIDER_GENERATION_DEFAULT=OFF
```

Commercial real-provider generation stays unreachable, even while R44B6 is
being implemented, until all of these exist:

- GenerationAuthorization;
- usage and entitlement authority;
- the retention/recovery destruction gate;
- worker authentication;
- worker lease and fencing;
- the worker credential opener;
- the production KMS and sealing path;
- object storage;
- an explicitly enabled provider capability;
- a controlled live-generation gate.

The parent locks' implementation-timing condition also continues to apply:
the core engine must first demonstrate reliable execution and recovery.

---

## 36. Implementation sequence

**Locked decision.**

1. R44B6B architecture lock (this document).
2. GenerationAuthorization persistence skeleton sufficient for referential
   integrity.
3. Bridge persistence: worker principals, jobs, attempts, lease and fencing.
4. Retention/recovery destruction gate replacing R44B5E unconditional
   destruction.
5. Worker-authentication contract implementation with a test-only identity.
6. Worker lease, heartbeat and fencing API.
7. Credential-grant API, plus a worker-side test opener only.
8. `apps/commercial-worker` skeleton with a fake provider adapter and the
   local journal.
9. Object-storage abstraction with a test implementation.
10. Crash and recovery matrix tests.
11. Real provider adapter wiring behind default-off composition.
12. Full R44B7 entitlement and usage authority.
13. Production KMS, storage and hosting decisions.
14. Controlled live-provider validation.

If implementation evidence requires reordering, this document is updated by
a deliberate architecture revision rather than silently diverged from.

### Status and fake-provider gate (revision R44B6K)

**Repository fact.** Steps 1 to 7 are implemented, together with the worker
skeleton and test opener of step 8 and the fenced `SUBMITTING` barrier
(R44B6J).

**Locked decision.** The submission lifecycle is implemented in this order,
each slice under its own authorised gate:

1. Migration 0005: the immutable submitting principal (section 26). The
   guard stamps it, so there is no R44B6J service change and no runtime
   grant change. Its first `LEASED -> SUBMITTING` check is
   `OLD.lease_expires_at > clock_timestamp()` (revision R44B6K5), never
   transaction-stable `now()`.
2. Heartbeat in `SUBMITTING`; release still refused (section 12).
   `SUBMITTED` heartbeat came later, in step 3a.
3. Expired `SUBMITTING -> OUTCOME_UNKNOWN` sweep (section 12).
3a. Migration 0006: the database-stamped, immutable
    `submitting_fencing_counter`, and `SUBMITTED` heartbeat for the exact
    live-route lease epoch only (section 12, R44B6N).
4. The `submitted`, `acceptance-recovery` and `submission-failed` routes
   (section 18). The live `submitted` route is implemented (R44B6O); no
   worker flow calls it yet. The control-plane `acceptance-recovery` route
   is implemented (R44B6R); its worker client and startup wiring remain
   unimplemented. `submission-failed` remains to be built.
   Neither this step nor any recovery-lease step may
   grant `SUBMITTED` heartbeat authority to any lease other than the exact
   live-route epoch.
5. The worker acceptance journal: state-root validation, write algorithm,
   read validation and corruption handling (section 17). Implemented
   (R44B6P), together with the worker's `submitted` client. R44B6Q uses the
   journal for local startup checks; the provider-acceptance chain and the
   `submitted` client remain unwired to live execution.
6. Worker startup reconciliation and the unresolved-journal new-work block
   (section 17). Implemented (R44B6Q): prepare and reconcile before leasing;
   only `CLEAR` permits fresh work. Valid published acceptance remains
   blocking because the worker acceptance-recovery client and startup
   wiring are not implemented; the control-plane route now exists (R44B6R).
7. Crash-point tests covering every row of the section 31 matrices.
   Faults are injected:
   - before and after each journal step;
   - before and after each control-plane commit;
   - on a lost response;
   - on lease expiry racing each route;
   - on a restart with a valid journal while the `SUBMITTING` lease is still
     live, which must wait for the authoritative expiry (R44B6K1);
   - with an SDK client whose create retry is not disabled, which must be
     refused (R44B6K1).

R44B6Q adds focused local startup crash/restart tests, including exact
temporary publication and interrupted quarantine. R44B6R adds control-plane
recovery, replay, concurrency, expiry-handoff and rollback coverage. These
do not complete the whole-chain crash-point coverage required by slice 7.

**A fake provider adapter may execute only after slices 1 to 7 exist.** As
of R44B6R, the following are still missing:

- the worker acceptance-recovery client and startup wiring (the control-plane
  route is implemented);
- `submission-failed` (slice 4);
- a worker client for the `SUBMITTING` acknowledgement;
- the acceptance-handler adapter that wires provider acceptance to the
  journal, then the handler, then `submitted` (section 18);
- whole-chain crash-point tests (slice 7);
- the production/deployment state-root binding.

The gate is therefore not met.
Every one of them protects the window between `SUBMITTING` and a durable
`SUBMITTED`, which is the first thing a fake provider exercises. None can be
safely deferred.

The following may come after the first fake-provider slice, which stops at
`SUBMITTED`, because they act only after a durable provider identity exists
or before any provider authority exists:

- recovery leases and recovery-scoped credential grants for `SUBMITTED`. A
  recovery lease never inherits live-route `SUBMITTED` heartbeat authority
  (section 12, R44B6M2);
- polling, output persistence and completion (steps 9 and 10);
- resolution of an expired `LEASED` attempt that holds a credential grant.
  This is a liveness gap with no provider side effect.

```text
FAKE_PROVIDER_EXECUTION_GATE=SECTION_36_SLICES_1_TO_7
FAKE_PROVIDER_EXECUTION_IMPLEMENTED=NO
REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO
```

---

## 37. Lock flags

`JOURNAL_RECORD_REMAINS_PRESENT` and `NEW_WORK_ALLOWED` below describe the
period before exact acknowledgement of unresolved acceptance evidence.

```text
RECOVERY_ELIGIBILITY_AUTHORITY=CONTROL_PLANE_DATABASE
WORKER_RETRY_CLOCK_CAN_DECLARE_LEASE_EXPIRED=NO
ACCEPTANCE_RECOVERY_INITIAL_REQUEST_DELAY_MS=0
ACCEPTANCE_RECOVERY_RETRY_MAX_ATTEMPTS=18
ACCEPTANCE_RECOVERY_RETRY_MAX_ELAPSED_MS=150000
ACCEPTANCE_RECOVERY_RETRY_INITIAL_BACKOFF_MS=1000
ACCEPTANCE_RECOVERY_RETRY_MULTIPLIER=2
ACCEPTANCE_RECOVERY_RETRY_MAX_BACKOFF_MS=10000
ACCEPTANCE_RECOVERY_RETRY_JITTER=NONE
ACCEPTANCE_RECOVERY_RETRY_USES_MONOTONIC_ELAPSED_CLOCK=YES
ATTEMPT_STILL_SUBMITTING_RETRYABLE=YES
ATTEMPT_STILL_SUBMITTING_COUNTS_AS_RECOVERY_SUCCESS=NO
ACCEPTANCE_RECOVERY_TRANSPORT_UNAVAILABLE_RETRYABLE=YES
ACCEPTANCE_RECOVERY_HTTP_5XX_RETRYABLE=YES
ACCEPTANCE_RECOVERY_AUTH_REJECTION_RETRYABLE=NO
ACCEPTANCE_RECOVERY_DEFINITIVE_REJECTION_RETRYABLE=NO
ACCEPTANCE_RECOVERY_MALFORMED_RESPONSE_RETRYABLE=NO
ACCEPTANCE_RECOVERY_RETRY_REUSES_EXACT_JOURNAL_IDENTITY=YES
JOURNAL_RECORD_REMAINS_PRESENT=YES
NEW_WORK_ALLOWED=NO
ACCEPTANCE_RECOVERY_RETRY_EXHAUSTION_BLOCKS_NEW_WORK=YES
ACCEPTANCE_RECOVERY_RETRY_EXHAUSTION_DISCARDS_JOURNAL=NO
ACCEPTANCE_RECOVERY_RETRY_BUDGET_SCOPE=PER_RECORD
ALL_UNRESOLVED_RECORDS_MUST_RECOVER_BEFORE_NEW_WORK=YES
ACCEPTANCE_RECOVERY_SENDS_LIVE_LEASE_TOKEN=NO
ACCEPTANCE_RECOVERY_CREATES_RECOVERY_LEASE=NO
ARCHITECTURE_STATUS=LOCKED
BRIDGE_DIRECTION=PRIVATE_WORKER_OUTBOUND_TO_COMMERCIAL_CONTROL_PLANE
WORKER_PROCESS=apps/commercial-worker
WORKER_PROTOCOL_PACKAGE=packages/commercial-worker-protocol
WORKER_DIRECTION=OUTBOUND_ONLY
PUBLIC_INBOUND_ENGINE_PORT_REQUIRED=NO
COMMERCIAL_API_IMPORTS_ENGINE=NO
COMMERCIAL_WORKER_PROVIDER_ENV_FALLBACK=FORBIDDEN
INITIAL_WORKER_CONCURRENCY=1
CONTROL_PLANE_DELIVERY=AT_LEAST_ONCE
STALE_WORKER_MUTATION=DENIED
PROVIDER_SIDE_EFFECT_EXACTLY_ONCE_ASSUMED=NO
PROVIDER_SUBMISSION_PER_ATTEMPT_AUTOMATIC_RETRY=NO
PROVIDER_AUTOMATIC_RESUBMISSION_AFTER_SUBMITTING=NO
SUBMITTING_BARRIER_REQUIRED=YES
WORKER_LOCAL_ACCEPTANCE_JOURNAL_REQUIRED=YES
PUBLIC_API_CREDENTIAL_OPENER=NO
PRIVATE_WORKER_CREDENTIAL_OPENER=YES
GENERATION_BINDS_EXACT_CREDENTIAL_VERSION=YES
RECOVERY_DEFAULTS_TO_ORIGINAL_VERSION=YES
RECOVERY_CREDENTIAL_SUBSTITUTION_SILENT=NO
RECOVERY_CREDENTIAL_SUBSTITUTION_CURRENTLY_ENABLED=NO
CREDENTIAL_RETENTION_OBLIGATION_OPENS_AT_GRANT=YES
PROVIDER_RECOVERY_OBLIGATION_OPENS_AT_SUBMITTING=YES
RECOVERY_OBLIGATION_OPENS_NO_LATER_THAN_SUBMITTING=YES
OPEN_RETENTION_OR_RECOVERY_OBLIGATION_BLOCKS_DESTRUCTION=YES
DISCONNECT_UNCONDITIONAL_DESTRUCTION_SAFE_AFTER_GENERATION=NO
COMMERCIAL_REAL_PROVIDER_GENERATION_DEFAULT=OFF
WORKER_AUTH_MECHANISM_VENDOR_SPECIFIC=DEFERRED
HOSTING_VENDOR=UNDECIDED
KMS_VENDOR=UNDECIDED
OBJECT_STORAGE_VENDOR=UNDECIDED
WORKER_AUTH_MECHANISM=UNDECIDED
DEFINITIVE_PROVIDER_REJECTION_CAN_BE_FAILED_BEFORE_SUBMISSION=YES
FAILED_BEFORE_SUBMISSION_REQUIRES_NO_PROVIDER_CALL=NO
FAILED_BEFORE_SUBMISSION_REQUIRES_NO_OUTSTANDING_PROVIDER_SIDE_EFFECT=YES
AMBIGUOUS_PROVIDER_OUTCOME=OUTCOME_UNKNOWN
SUBMITTING_TO_FAILED_BEFORE_SUBMISSION=ALLOWED
SUBMITTING_AT_PRESERVED_ON_DEFINITIVE_REJECTION=YES
PROVIDER_EXECUTION_ID_GLOBAL_UNIQUENESS_ASSUMED=NO
PROVIDER_EXECUTION_ID_UNIQUENESS_SCOPE=ACCOUNT_PROVIDER
SUBMITTING_HEARTBEAT_ALLOWED=YES
SUBMITTING_HEARTBEAT_CHANGES_FENCING=NO
SUBMITTING_RELEASE_ALLOWED=NO
EXPIRED_SUBMITTING_OUTCOME=OUTCOME_UNKNOWN
EXPIRED_SUBMITTING_AUTO_REQUEUED=NO
EXPIRED_SUBMITTING_CAN_AUTO_RESUBMIT=NO
EXPIRED_SUBMITTING_TRANSITION_OWNER=CONTROL_PLANE
EXPIRED_SUBMITTING_FAILURE_CODE=WORKER_LEASE_EXPIRED_DURING_SUBMISSION
PROVIDER_CALL_REQUIRES_COMMITTED_SUBMITTING=YES
SUBMITTED_REPORT_REQUIRES_DURABLE_JOURNAL=YES
PROVIDER_ACCEPTANCE_REQUIRES_DURABLE_JOURNAL=YES
ACCEPTANCE_HANDLER_RESOLVES_BEFORE_DURABLE_JOURNAL=NO
ACCEPTANCE_JOURNAL_TECHNOLOGY=IMMUTABLE_JSON_RECORD_PER_ATTEMPT
ACCEPTANCE_JOURNAL_PUBLICATION=EXCLUSIVE_HARD_LINK_AFTER_FSYNC
ACCEPTANCE_JOURNAL_NEW_DEPENDENCY=NO
JOURNAL_RECORD_IMMUTABLE=YES
JOURNAL_CONTAINS_PLAINTEXT_CREDENTIAL=NO
JOURNAL_CONTAINS_SEALED_CREDENTIAL=NO
JOURNAL_CONTAINS_LEASE_TOKEN=NO
JOURNAL_CONTAINS_CREDENTIAL_VERSION=NO
CONFLICTING_JOURNAL_RECORD_OVERWRITTEN=NO
VALID_JOURNAL_CAN_AUTHORIZE_SECOND_PROVIDER_CREATE=NO
SUBMITTING_WITHOUT_JOURNAL_CAN_AUTO_RESUBMIT_AFTER_RESTART=NO
SUBMITTING_WITH_VALID_JOURNAL_CAN_REPORT_SAME_PROVIDER_EXECUTION=YES
OUTCOME_UNKNOWN_WITH_VALID_JOURNAL_CAN_REPORT_SAME_PROVIDER_EXECUTION=YES
ACCEPTANCE_RECOVERY_AUTHORITY=SUBMITTING_PRINCIPAL_AND_RETAINED_FENCING_COUNTER
SUBMITTED_REPORT_IDEMPOTENT=YES
SUBMITTED_DIFFERENT_PROVIDER_EXECUTION_ID=INVARIANT_VIOLATION
SUBMITTED_TIMESTAMP_AUTHORITY=SERVER
LEASE_KEPT_ON_LIVE_SUBMITTED=YES
LIVE_SUBMITTED_ROUTE_IMPLEMENTED=YES
LIVE_SUBMITTED_ROUTE_REQUIRES_SUBMITTING=YES
LIVE_SUBMITTED_ROUTE_REQUIRES_SUBMISSION_EPOCH_MATCH=YES
LIVE_SUBMITTED_LEASE_PRESERVED=YES
OUTCOME_UNKNOWN_TO_SUBMITTED_BY_LIVE_ROUTE_ALLOWED=NO
ACCEPTANCE_RECOVERY_IMPLEMENTED=YES
ACCEPTANCE_RECOVERY_ROUTE_IMPLEMENTED=YES
ACCEPTANCE_RECOVERY_REQUIRES_OUTCOME_UNKNOWN=YES
ACCEPTANCE_RECOVERY_PROVIDER_RESUBMISSION_ALLOWED=NO
ACCEPTANCE_RECOVERY_USES_EXPIRED_LIVE_TOKEN=NO
ACCEPTANCE_RECOVERY_REQUIRES_ORIGINAL_SUBMISSION_EPOCH=YES
ACCEPTANCE_RECOVERY_DIFFERENT_PROVIDER_EXECUTION_ID_ALLOWED=NO
OUTCOME_UNKNOWN_TO_SUBMITTED_BY_ACCEPTANCE_RECOVERY_ALLOWED=YES
RECOVERY_REWRITES_SUBMITTING_PRINCIPAL=NO
RECOVERY_REWRITES_SUBMITTING_FENCING_COUNTER=NO
RECOVERY_MANUFACTURES_SUBMITTED_HEARTBEAT_AUTHORITY=NO
ACCEPTANCE_RECOVERY_FIRST_TRANSITION_AUDIT_WRITTEN_ONCE=YES
ACCEPTANCE_RECOVERY_REPLAY_DUPLICATES_AUDIT=NO
WORKER_ACCEPTANCE_RECOVERY_CLIENT_IMPLEMENTED=NO
STARTUP_RECONCILIATION_CALLS_ACCEPTANCE_RECOVERY=NO
SUBMISSION_FAILED_ROUTE_IMPLEMENTED=NO
ACCEPTANCE_JOURNAL_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_USED_BY_LIVE_EXECUTION=NO
ACCEPTANCE_JOURNAL_FORMAT=v1
ACCEPTANCE_JOURNAL_RETRY_REUSES_EXACT_RECORD=YES
STARTUP_JOURNAL_RECONCILIATION_IMPLEMENTED=YES
STARTUP_RECONCILIATION_RUNS_BEFORE_LEASE=YES
UNRESOLVED_ACCEPTANCE_BLOCKS_NEW_WORK=YES
CORRUPT_JOURNAL_BLOCKS_NEW_WORK=YES
CONFLICTING_JOURNAL_BLOCKS_NEW_WORK=YES
VALID_TEMP_REUSES_EXACT_RECORD=YES
VALID_TEMP_REGENERATES_RECORDED_AT=NO
WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO
SUBMITTED_CAN_CALL_PROVIDER_CREATE_AGAIN=NO
UNRESOLVED_ACCEPTANCE_JOURNAL_BLOCKS_NEW_SUBMISSION_WORK=YES
DISCONNECT_REVOKES_AUTHORISED_SUBMISSION_RECOVERY=NO
RETAINED_CREDENTIAL_USE=RECOVERY_OF_SAME_PROVIDER_EXECUTION_ONLY
RECOVERY_EXPIRES_AT_PROVIDER_VALUE_INVENTED=NO
RECOVERY_EXPIRES_AT_UNTIL_PROVIDER_POLICY=NULL
PROVIDER_EXECUTION_ID_IN_ROUTINE_WORKER_LOGS=NO
PROVIDER_EXACTLY_ONCE_CLAIMED=NO
BUSYBOOKIE_AUTOMATIC_PROVIDER_CREATE_AT_MOST_ONCE_PER_ATTEMPT=YES
FAKE_PROVIDER_EXECUTION_GATE=SECTION_36_SLICES_1_TO_7
FAKE_PROVIDER_EXECUTION_IMPLEMENTED=NO
REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO
MIGRATION_0005_REQUIRED_FOR_IMPLEMENTATION=YES
MIGRATION_0005_SCOPE=IMMUTABLE_SUBMITTING_WORKER_PRINCIPAL
MIGRATION_0005_CREATED=NO
TOKENLESS_ACCEPTANCE_RECOVERY_FROM_LIVE_SUBMITTING=NO
TOKENLESS_ACCEPTANCE_RECOVERY_FROM_OUTCOME_UNKNOWN=YES
SUBMITTING_RESTART_WITH_JOURNAL_CAN_RESUBMIT_PROVIDER=NO
SUBMITTING_RESTART_WITH_JOURNAL_WAITS_FOR_AUTHORITATIVE_EXPIRY=YES
SUBMITTING_WORKER_PRINCIPAL_DATABASE_DERIVED=YES
SUBMITTING_WORKER_PRINCIPAL_IMMUTABLE=YES
SUBMITTING_WORKER_PRINCIPAL_SURVIVES_LEASE_CLEAR=YES
SUBMITTING_WORKER_PRINCIPAL_SURVIVES_OUTCOME_UNKNOWN=YES
RUNTIME_GRANT_CHANGE_EXPECTED_FOR_0005=NO
JOURNAL_RECORD_SHA256_PREIMAGE_EXCLUDES_RECORD_SHA256=YES
JOURNAL_RECORD_SHA256_CANONICAL_UTF8=YES
PROVIDER_CREATE_AUTOMATIC_TRANSPORT_RETRY=NO
PROVIDER_CREATE_SDK_RETRY_DISABLED=YES
AMBIGUOUS_PROVIDER_CREATE_RESULT=OUTCOME_UNKNOWN
AMBIGUOUS_PROVIDER_CREATE_AUTO_RESUBMIT=NO
SUBMITTING_EXPIRY_USES_TRANSACTION_STABLE_NOW=NO
SUBMITTING_EXPIRY_USES_WALL_CLOCK_TIME=YES
SUBMITTING_EXPIRY_CLOCK_SOURCE=CLOCK_TIMESTAMP
LONG_RUNNING_TRANSACTION_CAN_CROSS_EXPIRED_LEASE_INTO_SUBMITTING=NO
EXPIRY_SWEEP_REQUIRES_CLOCK_TIMESTAMP=NO
CURRENT_HEARTBEAT_LEASED=YES
CURRENT_HEARTBEAT_SUBMITTING=YES
CURRENT_HEARTBEAT_SUBMITTED=YES
FUTURE_SUBMITTED_HEARTBEAT_REQUIRES_EXACT_LIVE_ROUTE_LEASE_EPOCH=YES
SAME_WORKER_PRINCIPAL_SUFFICIENT_FOR_SUBMITTED_HEARTBEAT=NO
FUTURE_RECOVERY_LEASE_MAY_USE_SAME_WORKER_PRINCIPAL=YES
SUBMITTED_HEARTBEAT_NEEDS_DURABLE_LEASE_EPOCH_PROVENANCE=YES
SUBMITTING_FENCING_COUNTER_PREFERRED_DISCRIMINATOR=YES
SUBMITTING_FENCING_COUNTER_IMPLEMENTED=YES
RECOVERY_LEASE_AUTOMATICALLY_GETS_SUBMITTED_HEARTBEAT_AUTHORITY=NO
SUBMITTED_HEARTBEAT_DISCRIMINATOR_MIGRATION=0006
```

COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE_LOCK_END_2026_11_10
