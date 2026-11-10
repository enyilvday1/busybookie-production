# Commercial Worker Bridge Architecture Lock

COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE_LOCK_2026_11_10

- **Status:** LOCKED for the commercial-to-private-engine worker bridge.
- **Authority revision:** `71ff252e6c92d493fbf5b32907ba50cf6ec27bf6`
- **Parent architecture:**
  `docs/commercial/COMMERCIAL_CONTROL_PLANE_ARCHITECTURE.md`,
  `docs/commercial/COMMERCIAL_DOMAIN_PERSISTENCE_ARCHITECTURE.md` and
  `docs/commercial/COMMERCIAL_PROVIDER_CONNECTION_ARCHITECTURE.md`
- **Source:** R44B6A commercial-to-private-engine bridge discovery.

```text
ARCHITECTURE_STATUS=LOCKED
BRIDGE_DIRECTION=PRIVATE_WORKER_OUTBOUND_TO_COMMERCIAL_CONTROL_PLANE
PUBLIC_INBOUND_ENGINE_PORT_REQUIRED=NO
```

**Implementation authority:** None. This document records architecture
decisions only. It does not authorise migrations, tables, routes, packages,
worker code, key-management integration, object storage, provider calls,
credential validation calls or generation. Each implementation step in
section 31 requires its own explicitly authorised gate.

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

Exact URL spelling is an implementation detail.

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

Stale-worker rejections are recorded in the security log (section 25).

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
and a separate lock (section 28).

---

## 17. Local durable acceptance journal

**Locked decision.**

```text
WORKER_LOCAL_ACCEPTANCE_JOURNAL_REQUIRED=YES
```

The worker keeps a small local durable journal for the ambiguity window
around provider acceptance. It does not rely on volatile memory.

Before the submission-accepted handler resolves, the journal records at
minimum:

- job ID;
- attempt ID;
- provider;
- exact credential version ID;
- provider execution ID;
- accepted timestamp;
- fencing generation;
- correlation identity where needed.

The entry is durably flushed before the worker treats acceptance as
captured.

The journal lives in worker-local durable storage under the worker's own
private root. It is never in a customer media path, never at a
browser-supplied path, and never contains credential plaintext, sealed
credentials or fingerprints.

**Deferred.** Journal technology. Candidates are an append-only file journal
with fsync, or SQLite if separately approved. No dependency is added by this
document.

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

### Upstream reporting after the journal

If the journal holds a provider execution ID but the upstream report fails:

- do not resubmit;
- retry the upstream report;
- do not lease or start another job until the accepted record is reconciled
  with the control plane.

This is an initial concurrency-1 safety rule.

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
provider (section 28).

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

---

## 37. Lock flags

```text
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
```

COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE_LOCK_END_2026_11_10
