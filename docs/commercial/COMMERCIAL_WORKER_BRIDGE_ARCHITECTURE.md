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
  and 37); R44B6S1 (R44B6S worker acceptance-recovery client and startup
  reconciliation wiring implemented under the R44B6S0 policy; provider
  execution, `submission-failed` and recovery leases remain unimplemented:
  introduction, sections 10, 17, 18, 31, 36 and 37); R44B6T0
  (`submission-failed` contract completed for future R44B6T implementation:
  live-lease first transition, token-less original-submission-epoch replay
  authority, exact replay match, exact response, closed request vocabulary,
  conflict ordering and credential-version replay rule; no runtime change:
  introduction, sections 10, 18, 30 and 37); R44B6T0A (`submission-failed`
  request order aligned with the established worker-control wrapper, as
  R44B6T implementation evidence confirmed: Origin and worker authentication
  precede handler body parsing; every body is still parsed before any
  lifecycle transaction, and pair/conflict classification still follows the
  applicable authority proof; no runtime implementation state changed:
  introduction, sections 18 and 37); R44B6T1 (R44B6T `submission-failed`
  control-plane route implemented and published in commit
  f8ec4cc19721a9d5d2801874920ee90a54b65545 under the R44B6T0 replay
  contract and the R44B6T0A request order, which remain authoritative; no
  migration, worker, protocol or provider-adapter change was required;
  provider execution remains disabled and the fake-provider gate remains
  unmet: introduction, sections 10, 17, 18, 30, 36 and 37); R44B6U0
  (worker `SUBMITTING` acknowledgement client contract locked after R44B6U
  discovery found its liveness and error semantics unlocked: R44B6U is
  client-only and single-shot, owning no retry, timeout or lease-expiry
  decision; only an exact successful acknowledgement grants provider-call
  authority; HTTP 409 maps to the new worker code `SUBMITTING_REJECTED`; an
  acknowledgement failure never calls the provider or `submission-failed`;
  orchestration retry and deadline policy is deferred to a later slice; no
  runtime change: introduction, sections 15, 36 and 37); R44B6U1 (R44B6U
  published in commit 382e1bb5eced86a8651577300168cc6045695b58: the worker
  `SUBMITTING` acknowledgement client is implemented, single-shot, owning no
  retry, deadline or lease-expiry policy, and still client-only and unused by
  live execution; no API, protocol, migration or provider-adapter change;
  provider execution remains disabled and the fake-provider gate remains
  unmet because the orchestration and the other listed items are still
  missing: introduction, sections 15, 36 and 37); R44B6V0 (pre-provider
  orchestration contract locked after R44B6V discovery exposed unresolved
  pre-provider liveness semantics: at most 2 `SUBMITTING` acknowledgement
  attempts, retrying only `CONTROL_API_UNAVAILABLE`, each with a 10000 ms
  orchestration-owned deadline; no local minimum lease budget is
  authoritative; a per-attempt `journal.prepare()` is required; a successful
  heartbeat after `SUBMITTING` is mandatory before provider construction or
  call; a heartbeat failure before the call leaves the attempt `SUBMITTING`
  for the authoritative sweep and never calls `submission-failed`; provider
  construction waits for the pre-provider permit; a worker heartbeat client
  and granted-`LEASED` recovery are now explicit prerequisites; provider
  execution remains disabled; no runtime change: introduction, sections 12,
  15, 36 and 37); R44B6W0 (worker heartbeat client contract locked: the
  heartbeat route was already implemented but its worker-side client
  semantics were not; the client is neutral, client-only and single-shot,
  owning no retry, timeout, cadence or lease-expiry authority; its exact
  success is `{fencingCounter, leaseExpiresAt}`; HTTP 409 maps to the new
  worker code `HEARTBEAT_REJECTED`; the mandatory pre-provider heartbeat gets
  at most two attempts, retrying only `CONTROL_API_UNAVAILABLE`, each with a
  10000 ms orchestration-owned deadline; no successful heartbeat means no
  permit and no provider call; in-flight heartbeat scheduling stays
  deferred; no runtime change: introduction, sections 15, 36 and 37);
  R44B6W1 (R44B6W published in commit
  d4f3923d2bf265b0413add63820c797a994276d1: the worker heartbeat client is
  implemented, with `HEARTBEAT_REJECTED`; it is single-shot, owns no retry,
  timeout, cadence or lease-expiry policy, and stays client-only with no
  production caller and unused by live execution; no pre-provider
  orchestration was implemented; no API, protocol, migration or
  provider-adapter change; provider execution remains disabled and the
  fake-provider gate remains unmet: introduction, sections 15, 36 and 37);
  R44B6V1 (R44B6V published in commit
  836cca5c06a92bcc1c729a59dad0cd1fc6badd3b: the pre-provider orchestration
  is implemented as `obtainPreProviderPermit` and unused by live execution;
  `journal.prepare()`, then `SUBMITTING`, then heartbeat, then the permit,
  with both network steps under the locked two-attempt, unavailable-only
  retry policy and a 10-second per-attempt deadline; the permit holds no
  secret and invokes nothing; no provider abstraction or call was added;
  `credentialOpeningRun.ts` is unchanged; no API, protocol, migration or
  provider-adapter change; provider execution remains disabled; the
  fake-provider gate remains unmet, and recovery of granted-but-expired
  `LEASED` attempts is now the next major lifecycle blocker: introduction,
  sections 15, 36 and 37); R44B6X0 (granted-but-expired `LEASED` recovery
  locked after R44B6X discovery found the gap also permanently consumes the
  worker's lease capacity: the locked database row is the recovery
  authority, and an expired row still `LEASED` proves `SUBMITTING` never
  committed; such attempts are requeued automatically (`LEASED -> QUEUED`)
  with `credential_granted_at` and the lease proof cleared, the fence kept
  and incremented by the next lease, and the job moved `RUNNING -> QUEUED`;
  recovery runs in the lease-acquisition transaction before the capacity
  check, and the requesting worker can never be batch-starved by its own
  stale lease; the audit reuses `execution_attempt.lease_expired` with a
  granted marker; no new security event, state, failure code, route,
  protocol change or migration; a stale worker's plaintext API key is outside
  fencing and governed by the trusted-worker invariant; no runtime change:
  introduction, sections 12, 31, 36 and 37); R44B6X1 (R44B6X published in
  commit 8b8044ede555a9a295c045e3e79d61160c8e5ae8: granted-but-expired
  `LEASED` recovery is implemented; `reclaimExpiredLeases` handles granted
  expired rows, and `acquireWorkerLease` runs a pass scoped to the requesting
  worker before the shared batch and the capacity check; the attempt and job
  move atomically, `credential_granted_at` and the lease proof are cleared,
  the fence is kept and the next lease increments it; stale heartbeat, grant
  and `SUBMITTING` proofs are refused, with race coverage; the audit stays
  `execution_attempt.lease_expired`, with `grantedLeaseRecovered: true` on
  the granted branch, now listed in the section 30 metadata vocabulary; no
  new security event, failure code, migration, route, protocol or worker
  change; credential versions are untouched and the section 24
  retained-version lifecycle gap stays separately open; provider execution
  remains disabled: introduction, sections 12, 30, 31, 36 and 37); R44B6Y0
  (acceptance-handler contract locked after R44B6Y discovery found six
  unresolved decisions: the worker uses a worker-local minimal acceptance
  shape `{provider, providerExecutionId}` and imports no engine execution
  handler; acceptance handling is split into an inner durable handler, which
  validates, builds the exact record once, publishes it durably and returns
  it, and an outer reconciliation adapter, which the future provider
  callback awaits, so provider polling cannot begin after journal
  publication but before `SUBMITTED` reconciliation; the pre-provider permit
  now carries `submittingAt` from the exact `SUBMITTING` acknowledgement;
  journal durability precedes every `SUBMITTED` request; live `submitted`
  reporting has at most two attempts of 10 s each, retrying only
  `CONTROL_API_UNAVAILABLE`; a rejection or exhausted unavailability hands
  the durable record to the existing acceptance-recovery policy; a 409 is
  never itself read as lease expiry and no local lease clock is used; the
  record is kept after `SUBMITTED` under v1 retention; a worker
  `submission-failed` client is required, used only for failures before
  durable acceptance, with a journal conflict reported as
  `ACCEPTANCE_JOURNAL_WRITE_FAILED`; a sticky worker-local host-fault latch
  is required; no engine, provider, API, protocol or migration change and no
  implementation; provider execution remains disabled: introduction,
  sections 12, 15, 17, 18, 31, 36 and 37); R44B6Y1 (R44B6Y published in
  commit 2e5446ce9832123a4e40ab2048d03e4d182bda5c: the inner durable
  acceptance handler (`createDurableAcceptanceHandler`) and the outer
  reconciliation adapter (`createAcceptanceAdapter`) are implemented; the
  pre-provider permit now carries `submittingAt`; the worker
  `reportSubmissionFailed` client and the sticky host-fault latch
  (`createHostFaultLatch`) are implemented; live `submitted` reporting uses
  the locked two-attempt, 10-second policy, and a rejection or exhausted
  unavailability hands the exact durable record to acceptance recovery;
  startup and live reconciliation share the extracted
  `recoverAcceptanceRecord` step and the existing recovery policy rather
  than duplicating it; a `SUBMITTED` acknowledgement never deletes the
  record; repeated callbacks fail closed under single use; no engine,
  provider, API, protocol or migration change and no provider-execution
  wiring; the acceptance-handler gate item is satisfied and three
  fake-provider gate items remain; the section 24 lifecycle stays separately
  open; provider flags remain NO: introduction, sections 10, 15, 17, 18, 36
  and 37); R44B6Z0 (in-flight provider heartbeat contract locked after
  R44B6Z discovery found the cadence wording in conflict: "at most every
  third of the lease" read as a minimum gap, while the control-plane lease
  policy intends renewal every 30 to 40 seconds of a lease that stays 120
  seconds; a generic, provider-agnostic in-flight lease keeper wraps the
  provider-submission operation, including the awaited R44B6Y acceptance
  reconciliation and excluding polling; it waits a 30-second quiet interval
  after start and after each settled tick; each tick has at most two
  requests of 10 seconds, retrying only `CONTROL_API_UNAVAILABLE`, with no
  overlap, backoff or jitter; an exhausted tick keeps the cadence; a 409
  stops the keeper without tripping the latch or cancelling the provider;
  authentication, malformed-response, invariant and unexpected keeper faults
  trip the latch; a started provider operation is never cancelled or
  abandoned and its own result stays authoritative; heartbeat abort signals
  never reach the provider; acceptance after lease loss follows R44B6Y; a
  definitive provider failure after lease loss may remain `OUTCOME_UNKNOWN`;
  no new API, protocol or migration; provider-failure outcome composition
  stays separate and polling-phase heartbeat is out of scope; provider
  execution remains disabled: introduction, sections 12, 15, 18, 36 and
  37); R44B6Z1 (R44B6Z published in commit
  2f9683c4ce3d5e9036595eee7cbc6907d3a028db: the generic in-flight lease
  keeper `runWithInFlightHeartbeat` is implemented; the operation starts
  exactly once, its promise is never abandoned and its own result or error
  stays authoritative; the 30-second first delay and quiet interval, two
  10-second attempts per tick and unavailable-only retry are implemented;
  exhausted unavailability keeps the cadence; a 409 stops the keeper without
  a host-fault trip; authentication, malformed-response and invariant
  failures trip the latch; the keeper's own shutdown abort is not a failure;
  no heartbeat signal reaches the operation; no local lease-expiry
  authority, no `submission-failed` or acceptance coupling, and no provider
  knowledge or wiring; component tests cover shutdown, race and
  promise-lifetime semantics; the in-flight heartbeat gate item is
  satisfied and two fake-provider gate items remain; provider execution
  remains disabled: introduction, sections 15, 18, 36 and 37); R44B7A
  (whole-chain crash-point test contract locked after R44B7 discovery was
  blocked by slice 7's overbroad wording: the rows for polling, output,
  completion and recovery-lease resumption, deferred past the first
  fake-provider slice, are removed from slice 7; the negative test for a
  create client whose retry is not disabled moves to the future
  provider-create adapter slice; test-only composition of published
  components is accepted, and no production orchestrator is required; tier
  3 (real worker components, real HTTP client, real commercial-api, real
  guarded test database, real filesystem journal) is mandatory; a simulated
  restart recreates process-local objects and keeps the database and
  journal; the provider operation is a test-only thunk, run at most once in
  the first process and never after a restart; eleven mandatory crash cases
  are locked; pre-durable residuals deliberately end `OUTCOME_UNKNOWN`,
  durable acceptance must end `SUBMITTED`, and `SUBMITTED` retention and
  terminal cleanup through a labelled fixture are included; provider-failure
  composition stays separate, the provider flags stay NO and the state-root
  binding stays independent; no tests implemented: introduction, sections
  16, 31, 36 and 37); R44B7B (R44B7 whole-chain tests published in commit
  d76128011804013c1d40877bbe66f435b4f78c03: one test-only integration file
  and no production change; tier 3 composition over real HTTP, the real
  commercial-api, the real test database and the real journal; 15/15
  whole-chain cases passed on three consecutive runs, with 34/34 worker
  integration, 538/538 worker unit and 558/558 commercial-api DB tests;
  provider dispatch is never repeated across a restart; pre-durable
  uncertainty ends `OUTCOME_UNKNOWN` and durable acceptance ends
  `SUBMITTED`; valid and invalid temporary journal crashes, live and
  expired lease restarts, the live report and recovery lost-response
  replays, heartbeat authority loss with late acceptance, `SUBMITTED`
  retention and replay, and terminal cleanup through a labelled fixture are
  proven; no provider network or SDK; the whole-chain gate item is
  satisfied; a retained live-route `SUBMITTED` lease that keeps holding the
  worker's capacity after a restart was found and deferred to later
  post-`SUBMITTED` lifecycle work; only the production/deployment state-root
  binding remains in the fake-provider gate; provider execution flags
  remain NO: introduction, sections 31, 36 and 37); R44B8A (state-root
  binding contract locked: the first R44B8A attempt was blocked because the
  deployment mount path was unspecified, and R44B8P0 then published the
  durable-data topology, with the persistent mount `/var/lib/busybookie`,
  the media root `/var/lib/busybookie/media` and the worker root
  `/var/lib/busybookie/commercial-worker`; `COMMERCIAL_WORKER_STATE_ROOT`
  and `COMMERCIAL_WORKER_ENV` (`development` or `production`, never
  defaulted) are locked with no fallback; no process entry point is
  required, only a production-library binding; the root is absolute,
  pre-existing and used exactly, with no `realpath` rewriting, and symlinks
  are forbidden for the root and its managed directories; a production
  root is owner-only on Linux with `REQUIRED` directory sync on a local
  ext4/XFS-class persistent filesystem, the whole tree on one filesystem;
  one process, one principal and one environment per root; no identity or
  root-schema marker; persistence across redeploy, and relocation forbidden
  while state is retained; a concrete deployment binding to the published
  runbook; no live host required; rules for a local fake-provider
  development root; provider flags remain NO; the state-root gate item
  stays unmet pending implementation: introduction, sections 17, 36 and 37);
  R44B8B (R44B8 published in commit
  c733b9450f143ab56e5c17f2e67c2c1e4a5d5ab5: `workerConfig.ts` and
  `workerStateRoot.ts` added; configuration is explicit and immutable, the
  production path is enforced exactly, and there is no fallback and no
  `process.env` read; the root must pre-exist; links at the root and in the
  managed directories are refused; production enforces Linux, the
  effective UID and the owner-only mode, with `REQUIRED` directory sync;
  journal preparation and reconciliation both precede any lease; root
  failures fail closed; the worker creates no root, logs no path and adds
  no metadata or locking; no process runner and no provider import or
  network; 608/608 worker unit, 34/34 worker integration and 558/558
  commercial-api DB tests, typecheck clean; the deployment runbook is
  unchanged, and the application and deployment bindings now agree
  exactly; `WORKER_STATE_ROOT_BINDING_IMPLEMENTED=YES`; the final
  pre-fake-provider gate item is satisfied and the gate is complete;
  provider flags remain NO: introduction, sections 17, 36 and 37); R44B9A
  (first fake-provider execution contract locked; a new post-gate phase:
  the first lock attempt was blocked because the proposed lowercase,
  hyphenated identifier broke the existing provider-identifier grammar
  `^[A-Z][A-Z0-9_]{0,31}$`, so the identifier is `BUSYBOOKIE_FAKE`, needing
  no migration, protocol or API change; the fake provider is production
  worker code, never the R44B7 test thunk; development only; a
  `BUSYBOOKIE_FAKE`-only lease barrier, with any other provider refused
  before the credential grant; the fake receives no credential; a
  provider-neutral create-phase contract whose acceptance callback must be
  awaited and is the only authority for the provider execution ID; the
  fake execution ID is `BUSYBOOKIE_FAKE-${executionAttemptId}`; acceptance
  is immediate by default; definitive and ambiguous outcomes; zero create
  retries, and the real-adapter retry assertion stays deferred; a
  one-attempt library composer and no daemon; credential-opening
  continuation without retaining plaintext; the permit precedes provider
  construction; the keeper wraps create plus callback; the endpoint is
  `SUBMITTED`; definitive and ambiguous failure composition is required,
  through one shared submission-failure policy; tier-3 success and failure
  tests; no real network; provider flags remain NO: introduction, sections
  36 and 37); R44B9B (R44B9 published in commit
  e57d2b77af6f61d8548e39c84f4741874806ea8f: `providerExecutionContract.ts`
  extended with the create-phase contract rather than duplicated; the
  production `BUSYBOOKIE_FAKE` provider `fakeProvider.ts` and the
  production composer `runConfiguredFakeProviderAttemptOnce`
  (`attemptExecution.ts`) added; `openLeasedCredentialOnce` added as the
  shared opening primitive; the shared `failureReportPolicy.ts` added (a
  naming-only deviation from the optional `submissionFailurePolicy.ts`),
  and the acceptance adapter uses it; a development-only barrier; the
  non-fake guard runs before the grant; the permit precedes construction;
  exactly one dispatch; the fake receives no credential; the callback is
  awaited and is the only provider-execution-ID authority; the keeper
  wraps create plus acceptance; success reaches `SUBMITTED`; definitive
  and ambiguous failure composition implemented; no provider retry, no
  provider network and no real-provider import or SDK; 656/656 worker
  unit, 40/40 worker integration and 558/558 commercial-api DB tests,
  typecheck clean; all 18 R44B9A criteria satisfied;
  `FAKE_PROVIDER_EXECUTION_IMPLEMENTED=YES` and
  `PROVIDER_FAILURE_COMPOSITION_IMPLEMENTED=YES`;
  `REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO` and
  `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`: introduction, sections 15,
  17, 18, 36 and 37); R44B10P1 (object-storage and reference-image input
  contract locked for an unwired worker library: R44B10 discovery found
  commercial input media, step 9 of section 36, to block real-provider
  wiring; no DB migration, protocol change, API change or package
  dependency is required; `generationRequest` carries a stable key-only
  reference, never a signed URL, arbitrary URL, local path or media-root
  path; the key reuses the migration 0004 storage-neutral grammar; ownership
  stays relational, from the validated opening context; the reference
  image carries key, SHA-256, byte count and content type, limited to PNG,
  JPEG and WebP; an injected read-only single-shot store with no default
  and an in-memory test implementation; bounded reads; at most two
  attempts, retrying only unavailability, each with a 10000 ms deadline;
  byte-count, SHA-256 and magic-byte verification; retrieval completes
  before the permit and `SUBMITTING`; the library stays unwired, and the
  fake composer is unchanged; the interim fail-closed handling of a
  permanent input failure is not sufficient for real-provider wiring, so
  the R44B10P2 honest pre-submission input-failure route is mandatory
  before R44B10A implementation; provider flags unchanged: introduction,
  sections 6, 28, 36 and 37); R44B10P1 docs sync (R44B10P1 published in
  commit 192a97e7eca1c1c17378ccc10821e662eb96f77f: `objectStorageContract.ts`
  and `inputMediaRetrieval.ts` added as an unwired production library;
  seven closed worker errors; the test-only in-memory store; account-isolated
  reads; a strict closed parser; relative-looking keys stay opaque store
  keys; no filesystem, network or vendor; at most two read attempts,
  retrying only unavailability, each with a 10000 ms deadline; SHA-256,
  length and magic-byte checks; 752/752 worker unit, 40/40 worker
  integration and 558/558 commercial-api DB tests, typecheck clean; all 22
  criteria satisfied; the input library and test store are implemented, a
  production storage backend is not, and the vendor stays undecided; step 9
  is complete for its input scope only; R44B10P2 is still required before
  R44B10A: introduction, sections 28, 36 and 37); R44B10P2 (pre-provider
  input-failure route contract locked after a passing discovery: exact
  idempotent replay, so a reporter-provenance migration is required (guard-
  stamped `input_failed_worker_principal_id` and
  `input_failed_fencing_counter`, following 0005 and 0006, with no token
  hash); `POST /worker-control/v1/attempts/:attemptId/input-failed` with
  `{fencingCounter, leaseToken, failureCode}`; source state `LEASED`, with a
  live current lease and the credential granted; five `INPUT_*` codes; no
  provider semantics; the job becomes `FAILED`; the lease is cleared and
  capacity freed; obligations close by state; an `input_failed` audit; exact
  replay with no duplicate audit; the R44B10P1 classification extension
  (permanent input, transient storage, host fault) with a
  classification-aware latch; a single-shot worker report client under the
  two-attempt, unavailable-only report retry; no shared protocol-package
  change; P2 remains unimplemented, and R44B10A stays blocked until P2 is
  implemented: introduction, sections 18, 28, 36 and 37); R44B10P2 docs sync
  (R44B10P2 published in commit 395b4fd8958c9f7bdfd34a215c72cf450cb86de2,
  22 files: migration 0007 adds guard-stamped, immutable
  `input_failed_worker_principal_id` (restrictive worker foreign key) and
  `input_failed_fencing_counter`, with no token hash, pairing, state, code
  and epoch checks (the epoch check a strengthening in the 0006 discipline)
  and a fail-closed refusal of unprovable pre-barrier failures; the
  `input-failed` route and `workerInputFailedService.ts` (granted live
  `LEASED` authority, `FAILED_BEFORE_SUBMISSION`, job `FAILED`, lease
  cleared, capacity freed, one `execution_attempt.input_failed` audit,
  exact replay on reporter and epoch, 409 on conflict) and
  `WORKER_INPUT_FAILURE_REJECTED`; the worker client `reportInputFailed`,
  `INPUT_FAILED_REJECTED` and the two-attempt, unavailable-only report
  policy; the three-class retrieval classification with the latch moved to
  the caller-side `inputMediaFailurePolicy.ts`; a test-only P1/P2
  composition with crash and replay proofs; 628/628 commercial-api DB tests
  (106 suites, including the 31/31 migration suite), 858/858 commercial-api
  non-DB, 833/833 worker unit and 51/51 worker integration tests, both
  typechecks clean; `OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=YES`;
  no production storage backend or vendor; provider flags unchanged;
  R44B10P2 fully closed and R44B10A eligible for its own sequence:
  introduction, sections 18, 28, 36 and 37); R44B10A (first real-provider
  adapter contract locked after a passing read-only discovery: Google GenAI
  Interactions on the Gemini Developer API, `GOOGLE_GENAI` with
  `gemini-omni-1.1-flash`, ending at `SUBMITTED` with no polling, output or
  completion; a thin worker-local adapter owning `@google/genai` exactly
  2.24.0 as a worker dependency, with no engine import (sections 2 and 5
  superseded); the public `interactions.create` with `background`, `store`
  and no stream, `{ maxRetries: 0, timeout: 60000 }` and a mandatory
  transport-level single-request proof; raw `Interaction.id`; a closed
  `{prompt, referenceImage, resolution}` request with a 1000-UTF-16 prompt
  cap and `720p` only; malformed non-image requests refused before the
  grant as issuer violations; R44B10P1/P2 retrieval before the permit; a
  scoped sealed-credential capability re-opened after the permit with no
  second grant; no client before the permit; one client and one dispatch;
  acceptance reuse; a code-based definitive set (429 included, never
  retried) with everything else ambiguous; sanitised errors; default-off
  library composition; 25 flag criteria; no migration, API or protocol
  change; provider flags unchanged; implementation not started:
  introduction, sections 2, 5, 7, 16, 36 and 37).

(R44B10A docs sync: implementation published in commit
aefd2ea95cc0d11652596fd2e099262bc4a945ac. The commercial-worker now owns
the first production-grade real-provider create adapter and composition for
Google GenAI Interactions on the Gemini Developer API, ending at
`SUBMITTED`; `@google/genai` is exact-pinned at 2.24.0; the closed request,
verified input path, scoped sealed-credential re-open, permit-before-client
ordering, one-client/one-create cardinality, zero-SDK-retry transport proof,
raw `Interaction.id`, definitive and ambiguous failure composition,
heartbeat plus durable acceptance, crash/recovery behaviour, no-network
boundary and secret-safety requirements all pass. Validation: 972/972
worker unit tests, 58/58 worker integration tests including seven new
Google tier-3 tests, 858/858 commercial-api non-DB tests, 628/628
commercial-api DB tests, 2052/2052 root Google regression tests, both
typechecks clean, and the worker boundary block 116/116. All 25 R44B10A
criteria pass. `REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES`;
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`. Production object storage,
production issuer/provider credential and KMS readiness, section 24's
destruction lifecycle, the live `SUBMITTED` capacity lifecycle, a process
runner and deployment, controlled live validation, polling, output
persistence and completion remain separate open work.)

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

(R44B10A contract lock, superseding the engine-module allowance above.) The
worker imports no root engine or root source module. A real-provider adapter
owns its provider SDK directly inside the worker package, as an exact-pinned
worker dependency (first: `@google/genai` 2.24.0); section 36, "First
real-provider adapter: Google GenAI (revision R44B10A)".

(R44B10B contract lock.) The same boundary applies to the second real
provider: the Runway adapter owns `@runwayml/sdk` exactly 4.20.0 inside
`apps/commercial-worker`. It imports no root Runway or engine module and
does not modify or rely on the root package dependency. Only Runway's
create phase is reimplemented; polling, output download, recovery and
engine audit paths remain separate. Section 36, "Second real-provider
adapter: Runway Gen-4.5 (revision R44B10B)".

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

**Superseded (R44B10A contract lock).** The worker does not integrate
through engine provider-level functions. The engine Google submitter reads
media-root files and carries EP/S reservation and cost machinery, its
creator hides the provider status and error code needed for classification,
and the worker package boundary forbids root imports. A commercial-worker
real-provider adapter owns its provider SDK directly when that is required
to preserve worker isolation and submission semantics; only the minimal
create-phase contract is reimplemented, and engine polling and output paths
stay separate. The still-valid parts above remain: no `executeSingleShot`,
operator CLI, `.env`-driven execution or EP/S request files. Section 36,
"First real-provider adapter: Google GenAI (revision R44B10A)".

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

(R44B10P1.) The reference-image object reference is now locked in section
28, "Object-storage input contract": a key-only reference with integrity
metadata, resolved through an injected store. It is never a path, so the
engine path guards do not apply to commercial input, and no engine media
reader is used for it.

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

(R44B10A contract lock.) `@google/genai` 2.24.0 reads backend, base-URL and
project variables at client construction even when a key is supplied. The
real Google adapter therefore constructs its client explicitly for the
Gemini Developer API at `generativelanguage.googleapis.com`, and the
forbidden-variable refusal above must cover the actual process environment
the SDK reads, not only an injected copy. There is still no provider-key
environment fallback and no `WorkerConfig` key field.

(R44B10B contract lock.) `@runwayml/sdk` 4.20.0 defaults or consults
`RUNWAYML_API_SECRET`, `RUNWAYML_BASE_URL`, `RUNWAYML_CUSTOM_HEADERS`
and `RUNWAYML_LOG`. The existing commercial-worker process-environment
refusal already names all four and remains mandatory. The adapter supplies
the granted credential, API origin, API version, retry setting, timeout,
transport and `logLevel: "off"` explicitly; it never reads a provider
credential or transport override from the environment.

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
| `attempts/:attemptId/submitted` | `{fencingCounter, leaseToken, providerExecutionId}` | Implemented (R44B6O, section 18). Called only by the worker acceptance adapter (R44B6Y), which live execution does not use. |
| `attempts/:attemptId/acceptance-recovery` | `{fencingCounter, providerExecutionId}` | Implemented (R44B6R, section 18). Called only by worker startup reconciliation (R44B6S, section 17). |
| `attempts/:attemptId/submission-failed` | `{fencingCounter, leaseToken, outcome, failureCode}` | Implemented (R44B6T, section 18; contract R44B6T0/R44B6T0A). Called only by the worker acceptance adapter before durable acceptance (R44B6Y), which live execution does not use. |

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
  released and the job leased again. (R44B6X, recorded by R44B6X1.) This
  includes an expired **granted** `LEASED` attempt: it is requeued
  automatically ("Granted-but-expired `LEASED` recovery" below).
- An expired lease on a `SUBMITTING` attempt that has no durable provider
  execution ID moves the attempt to `OUTCOME_UNKNOWN`.
- An expired lease on a `SUBMITTED` attempt permits only recovery of the
  same provider execution ID with the original credential version. It never
  permits a new submission for that attempt.

### Granted-but-expired `LEASED` recovery (revision R44B6X0)

**Status (R44B6X; recorded by R44B6X1).** Implemented in commit
8b8044ede555a9a295c045e3e79d61160c8e5ae8, in the control plane only.
`reclaimExpiredLeases` now handles every expired `LEASED` attempt, granted
or not, under the existing `FOR UPDATE SKIP LOCKED` scan and server time: it
moves the attempt `LEASED -> QUEUED`, clears `credential_granted_at` and the
live lease ownership and proof with the existing lease-clearing semantics,
keeps the fence, and moves the job `RUNNING -> QUEUED` in the same
transaction. The next lease increments the fence normally. `acquireWorkerLease`
first runs a pass scoped to the requesting worker, then the unchanged shared
bounded pass, and only then evaluates capacity, so the requester's own stale
granted lease is never starved by the global batch; the batch size,
`WORKER_MAX_CURRENT_LEASES` and `SKIP LOCKED` are unchanged and locking is
never bypassed (a row another transaction holds is skipped, and the ordinary
capacity refusal applies). The ordinary ungranted reclaim behaves as before.
Tests establish that recovery serialises on the attempt row with heartbeat,
credential grant and `SUBMITTING`: a heartbeat holding the row wins and its
live lease survives; a `SUBMITTING` holding the row past expiry is refused by
the barrier and the row is recovered afterwards; an already committed
`SUBMITTING` row is never requeued (the existing sweep owns it). After
recovery the old proof is refused for heartbeat, credential grant and
`SUBMITTING`; after a re-lease the new lease has a higher fence and a new
token. Recovery never touches `provider_credential_versions` (a
`RETAINED_FOR_RECOVERY` version stays so), adds no failure code, uses no
`OUTCOME_UNKNOWN` and emits no security event. None of this revokes a
long-lived BYO key already disclosed to worker memory; the trusted-worker
assumption below still governs that. The contract below is unchanged.

**Locked decision (R44B6X0; implemented by R44B6X).** An attempt whose
lease received a credential grant and then expired before `SUBMITTING` is
**automatically requeued** by the control plane. R44B6X discovery found the
gap is worse than a stranded attempt: the expired lease still counts against
`WORKER_MAX_CURRENT_LEASES`, so it can permanently stop its worker from
receiving another lease.

- **Eligibility (authoritative, on the locked row).** All of: `state =
  'LEASED'`; `credential_granted_at IS NOT NULL`; `lease_expires_at <=` the
  database's server time. The row must still be `LEASED` when locked. A row
  that is `SUBMITTING` or any later state is never handled here: the existing
  `SUBMITTING` sweep owns it.
- **Authority principle.** Whether automatic requeue is safe is decided by
  control-plane database state, never by whether the worker may have opened
  the credential. A locked row that is still `LEASED` and expired proves that
  `SUBMITTING` did not commit under that lease and, because the barrier
  refuses an expired lease by server time (section 15), can no longer commit
  under that proof. BusyBookie therefore never granted provider-call
  authority. A worker's uncertainty about whether its `SUBMITTING` request
  committed never overrides the row.
- **Trusted-worker assumption.** Current BYO credentials are long-lived user
  API keys that BusyBookie cannot cryptographically revoke once disclosed; a
  stale worker may still hold plaintext in memory. Fencing protects
  control-plane authority only and never makes a disclosed provider key
  unusable. Automatic requeue therefore relies on the existing invariant that
  a BusyBookie worker never invokes a provider without committed
  `SUBMITTING` authority and the later pre-provider gates (section 15), which
  a worker whose lease expired can neither obtain nor keep. This is an
  accepted assumption of the current worker trust model. A future threat
  model that treats worker hosts as hostile or compromised needs a different
  credential architecture before that stronger claim can be made.
- **Owner and trigger.** The control plane recovers inside the
  lease-acquisition transaction, alongside the existing expired-lease reclaim
  (as an extension of it or a narrowly named sibling). No worker cooperation,
  worker route or admin action is needed for the ordinary case.
- **Capacity ordering.** Recovery runs before the requesting worker's
  current-lease capacity is evaluated. After recovery processing and before
  any capacity refusal, an eligible expired granted lease owned by the
  requesting worker no longer counts against its capacity, and it can never
  be starved behind the global reclaim batch limit: if the shared batch could
  omit it, the requesting principal's own candidate is recovered separately,
  or its inclusion is otherwise guaranteed, before the capacity check. The
  existing `SKIP LOCKED` semantics are kept, and batch sizes are not raised
  to approximate this guarantee. The global capacity rule is not weakened.
- **Attempt mutation.** `LEASED -> QUEUED`; `credential_granted_at` cleared
  to `NULL`; the complete live lease ownership and proof cleared exactly as
  the ordinary expired-lease reclaim clears it (worker principal, token
  verifier, lease and heartbeat times), so no old proof stays usable. The
  fencing counter is **kept**; the next successful lease increments it under
  the existing acquisition rule. Migration 0004's guard already permits
  clearing the grant on exactly this transition.
- **Job mutation.** `RUNNING -> QUEUED` with the existing reclaim semantics,
  atomic with the attempt, lease and grant changes. No `NEEDS_ATTENTION`.
- **Grant marker.** `credential_granted_at` belongs to the abandoned
  pre-submission lease and is cleared, closing the attempt's pre-submission
  grant marker. A later worker needs a new valid live lease before any grant;
  the old grant's replay semantics never carry over to a new lease.
- **Credential version.** Recovery changes no provider credential version:
  it never destroys a version, changes its `ACTIVE`, `SUPERSEDED`,
  `RETAINED_FOR_RECOVERY` or `DESTROYED` status, or replaces a binding.
  Clearing the grant closes this attempt's retention obligation, which is
  derived from attempt state (section 23). A version a disconnect already
  marked `RETAINED_FOR_RECOVERY` stays so: its destruction on obligation
  close belongs to the lifecycle service of section 24, which does not exist
  yet. That is a separate, explicitly tracked lifecycle gap, not something
  R44B6X guesses at. Such a requeued attempt is simply not leased again while
  its version or connection is ineligible for new work.
- **Stale workers.** After recovery commits, the old proof is no longer
  current: heartbeat, credential grant, `SUBMITTING`, `submission-failed` and
  `submitted` are refused by the existing live-lease, state and fencing
  checks. A new lease gets a strictly higher fencing counter and a new token.
  None of this stops a stale process from using plaintext it already holds;
  that is governed only by the trusted-worker invariant above.
- **Races.** Recovery serialises on the attempt row lock with heartbeat,
  credential grant, ordinary reclaim and `SUBMITTING`. A row whose lock is
  held is skipped (`SKIP LOCKED`), as in the existing reclaim. If
  `SUBMITTING` commits first, the row is `SUBMITTING` and not eligible; if
  recovery commits first, the stale `SUBMITTING` fails. The server-time
  barrier stays authoritative, and no worker-side ambiguity check is needed.
  There is no optimistic recovery without the row lock.
- **Audit and security.** Each recovery is audited with the existing
  `execution_attempt.lease_expired` event; its metadata distinguishes a
  granted pre-submission recovery from the ordinary ungranted reclaim with a
  marker (published by R44B6X as `grantedLeaseRecovered: true`, section 30),
  alongside the existing safe fields (attempt number, fencing
  counter, worker principal). Never the token, its verifier, the sealed
  envelope, plaintext or the machine credential. No new security event: an
  expired granted lease is an operational condition, not evidence of
  hostility; stale-worker rejections keep their existing security events.
- **No new vocabulary or path.** No failure code (not `GRANT_ABANDONED`,
  `CREDENTIAL_GRANT_EXPIRED`, `PROVIDER_STATUS_UNKNOWN` or similar), no
  quarantine, no `OUTCOME_UNKNOWN`, `FAILED_BEFORE_SUBMISSION`,
  `NEEDS_ATTENTION` or `CANCELLED` for the ordinary case, and no operator
  workflow: provider-call authority is proven absent, requeue is safe under
  the current trust model, and quarantine would lose liveness for no safety
  gain. Unexpected or inconsistent rows stay fail-closed under existing
  integrity behaviour, outside this transition.
- **Boundary.** No migration, attempt or job state, worker route, protocol
  change, worker-side code or provider-adapter change. The implementation is
  control-plane only: extend `reclaimExpiredLeases` or add a narrowly named
  sibling in the same transaction, reusing the lease-clearing SQL and keeping
  the ordinary ungranted reclaim unchanged, with focused database tests.
- **Required capacity test.** A worker holding a granted, expired `LEASED`
  attempt, which `WORKER_MAX_CURRENT_LEASES` would otherwise block, requests
  another lease; recovery runs before the capacity decision; the old attempt
  becomes `QUEUED` with its grant and lease cleared; the worker may then
  acquire under the normal queue and eligibility rules.

```text
GRANTED_EXPIRED_LEASE_RECOVERY_IMPLEMENTED=YES
GRANTED_EXPIRED_LEASE_RECOVERY_POLICY=REQUEUE
GRANTED_EXPIRED_LEASE_RECOVERY_OWNER=LEASE_ACQUISITION_TRANSACTION
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_STATE=LEASED
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_CREDENTIAL_GRANT=YES
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_SERVER_EXPIRY=YES
GRANTED_EXPIRED_LEASE_RECOVERY_TARGET_ATTEMPT_STATE=QUEUED
GRANTED_EXPIRED_LEASE_RECOVERY_TARGET_JOB_STATE=QUEUED
GRANTED_EXPIRED_LEASE_RECOVERY_CLEARS_CREDENTIAL_GRANTED_AT=YES
GRANTED_EXPIRED_LEASE_RECOVERY_CLEARS_LEASE_PROOF=YES
GRANTED_EXPIRED_LEASE_RECOVERY_INCREMENTS_FENCE=NO
GRANTED_EXPIRED_LEASE_NEXT_LEASE_INCREMENTS_FENCE=YES
GRANTED_EXPIRED_LEASE_RECOVERY_RUNS_BEFORE_CAPACITY_CHECK=YES
GRANTED_EXPIRED_LEASE_RECOVERY_REQUESTING_WORKER_CANNOT_BE_BATCH_STARVED=YES
GRANTED_EXPIRED_LEASE_RECOVERY_CALLS_PROVIDER=NO
GRANTED_EXPIRED_LEASE_RECOVERY_TARGETS_SUBMITTING=NO
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_MIGRATION=NO
GRANTED_EXPIRED_LEASE_RECOVERY_AUDIT_EVENT=execution_attempt.lease_expired
GRANTED_EXPIRED_LEASE_RECOVERY_EMITS_SECURITY_EVENT=NO
```

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
  authority permits (section 18). (R44B6Y0.) The worker never judges that
  authority with a local lease clock: the outer acceptance adapter tries
  the live `submitted` route first and hands the durable record to
  acceptance recovery when that cannot establish success (section 18,
  "Acceptance handler and adapter").
- (R44B6Z0.) While a provider submission is in flight, the worker renews
  the lease under the in-flight keeper of section 15: a 30-second quiet
  interval after start and after each settled tick, so successful renewals
  are normally 30 to 40 seconds apart within the 120-second lease. That
  replaces the earlier "at most every third of the lease" wording, which
  read as a minimum gap. The worker never chooses the duration and never
  derives its schedule from `leaseExpiresAt`.

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
-> heartbeat: one successful heartbeat is mandatory here (R44B6V0), then as needed throughout
-> provider create call (exactly one)
-> definitive provider acceptance
-> outer acceptance adapter receives the minimal acceptance (section 18, R44B6Y0)
-> inner durable handler validates it and durably publishes the exact record (section 17)
-> inner durable handler returns that record
-> outer adapter reports SUBMITTED, or hands the record to acceptance recovery (section 18)
-> outer adapter resolves; only then may provider polling begin
```

- No provider call moves earlier than the committed `SUBMITTING`
  acknowledgement.
- No `SUBMITTED` report moves earlier than durable journal acceptance.
- The journal-root preflight comes before `SUBMITTING`. A worker that cannot
  currently journal must not create provider authority it could not record.
  (R44B6V0.) It is a per-attempt `journal.prepare()` immediately before the
  acknowledgement sequence; the startup preparation alone is not sufficient.
- (R44B6V0.) Between the acknowledgement and the provider create, a
  successful heartbeat is **mandatory**, not "as needed", and no provider
  object is constructed before it: see "Pre-provider orchestration" below.

```text
PROVIDER_CALL_REQUIRES_COMMITTED_SUBMITTING=YES
SUBMITTED_REPORT_REQUIRES_DURABLE_JOURNAL=YES
```

(R44B6U0: a committed `SUBMITTING` grants provider-call authority only
through a successfully parsed exact acknowledgement; see the worker client
contract below. R44B6V0: that authority is usable only once the mandatory
post-`SUBMITTING` heartbeat has also succeeded and the pre-provider permit
exists.)

**Rationale.** Without a durable pre-call mark, a crash during the paid call
is indistinguishable from a crash before it, and a retry could buy the same
generation twice.

### Worker `SUBMITTING` acknowledgement client (revision R44B6U0)

**Status (R44B6U; recorded by R44B6U1).** Implemented in commit
382e1bb5eced86a8651577300168cc6045695b58 as `acknowledgeSubmitting` on
the existing `WorkerControlClient`, with its strict response parser, the
closed worker code `SUBMITTING_REJECTED` and optional pass-through of an
externally supplied `AbortSignal`. It is still client-only: no production
worker path calls it. The contract below is unchanged.

**Locked decision (R44B6U0; implemented by R44B6U).** R44B6U adds only
the worker-side HTTP client for the existing, implemented control-plane
route (R44B6J; section 10)
`POST /worker-control/v1/attempts/:attemptId/submitting`, the
`LEASED -> SUBMITTING` acknowledgement. It is not a second "about to
submit" route, provider execution, acceptance handling, a `submitted` or
`submission-failed` caller, or orchestration wiring. The control-plane
contract stays authoritative: the attempt ID in the path, the body exactly
`{fencingCounter, leaseToken}`, and the success response (200) exactly:

```text
{executionAttemptId, fencingCounter, state: "SUBMITTING", submittingAt}
```

- **Single shot.** One HTTP request per invocation: no internal retry loop,
  counter, backoff, jitter or sleep, no lease-expiry clock, no provider
  call and no lifecycle effect beyond what the route itself commits. The
  client is a transport primitive; it copies neither the acceptance-recovery
  retry policy (section 17) nor the callers' credential-opening retry.
- **Timeout ownership.** The client chooses and starts no timeout. It may
  pass through an externally supplied `AbortSignal` where the shared
  transport already supports one; an abort is a transport failure. Any
  real request deadline belongs to the later orchestration slice, before
  provider execution can become live.
- **No local lease authority.** The client neither receives nor inspects
  `leaseExpiresAt` and never declares a lease expired. A future
  orchestration layer may conservatively decline to continue on its local
  view of the lease, but that is only a decision not to proceed, never
  lifecycle evidence; only the control plane refuses with `LEASE_EXPIRED`,
  and the worker never mutates or reports lifecycle state from local time.
- **Strict success.** Only an exact 200 body is accepted: exactly the four
  members above, `executionAttemptId` equal to the requested attempt,
  `fencingCounter` equal to the presented proof, `state` exactly
  `SUBMITTING`, and `submittingAt` a canonical UTC millisecond instant that
  round-trips (the existing worker-control parser rule). Anything else is
  `MALFORMED_CONTROL_RESPONSE`.
- **Error mapping (closed worker codes).** HTTP 409 maps to a dedicated new
  code `SUBMITTING_REJECTED`, never `LEASE_REJECTED` (which names lease
  acquisition refusal); the control-plane reason is not exposed. 401 and 403
  map to `WORKER_AUTHENTICATION_REJECTED`; 5xx and transport failure to
  `CONTROL_API_UNAVAILABLE`; any other status or a malformed body to
  `MALFORMED_CONTROL_RESPONSE`. This is the existing per-route
  worker-control convention.
- **Transport and secrets.** It reuses `createHttpWorkerControlClient` and
  its Bearer machine credential; there is no second transport or
  authentication mechanism. The lease token appears only in the request body
  and the machine credential only in the `Authorization` header. Neither
  appears in a `WorkerError`, log, metric label or worker event, and no raw
  transport cause is retained.

**Provider-call authority.** `PROVIDER_CALL_REQUIRES_COMMITTED_SUBMITTING`
(above) is satisfied only by a successfully parsed exact 200
acknowledgement. Transport ambiguity, a reset, a timeout or abort, any 409,
5xx or authentication refusal, a malformed response or the local lease clock
never imply that `SUBMITTING` committed. Without an exact acknowledgement the
worker makes no provider call and no `submission-failed` report:
`submission-failed` applies only to an attempt the control plane has
actually committed as `SUBMITTING`.

**Lost response.** The route is replay-idempotent under the same valid live
proof (section 11), so a later caller may resend the exact request if a
future policy allows it. But if the first request committed `SUBMITTING`
and its response was lost, a retry after the lease expired may receive
`409 LEASE_EXPIRED` although `SUBMITTING` committed. A 409 therefore never
proves that the transition did not happen. The worker stays conservative
(no exact acknowledgement, no provider call), and the section 12 sweep
later records `OUTCOME_UNKNOWN`. R44B6U does not repair this ambiguity.

**Client only.** After R44B6U the method exists and is tested, but no
production worker path calls it, including `runCredentialOpeningOnce`.
Provider execution does not exist yet, so calling the route and then
stopping would move a real attempt `LEASED -> SUBMITTING`, then through the
sweep to `OUTCOME_UNKNOWN`, without any provider request: manufactured
unknown-outcome evidence.

**Orchestration policy.** Deferred by R44B6U0 and now locked by R44B6V0
("Pre-provider orchestration" below): retry, request deadline, lease
lifetime, heartbeat ordering and `AbortSignal` ownership. The client itself
stays single-shot. Only an exact successful acknowledgement permits the
provider call.

**Boundary.** R44B6U needs no API, protocol-package, migration or
provider-adapter change; request and response types stay locally defined
by the established convention. Expected worker scope:
`apps/commercial-worker/src/workerControlClient.ts`,
`apps/commercial-worker/src/workerError.ts` (only `SUBMITTING_REJECTED`),
`apps/commercial-worker/tests/boundary.test.ts` and a new
`apps/commercial-worker/tests/submittingClient.test.ts`. No production
caller changes; a compile-only need to touch `credentialOpeningRun.ts`
must be reported before scope widens. Converting the integration test's
direct `fetch` to the client is optional.

```text
WORKER_SUBMITTING_CLIENT_IMPLEMENTED=YES
WORKER_SUBMITTING_CLIENT_USED_BY_LIVE_EXECUTION=NO
SUBMITTING_CLIENT_INTERNAL_RETRY_ENABLED=NO
SUBMITTING_CLIENT_OWNS_REQUEST_TIMEOUT=NO
SUBMITTING_CLIENT_CAN_DECLARE_LEASE_EXPIRED=NO
SUBMITTING_ACK_FAILURE_CALLS_SUBMISSION_FAILED=NO
SUBMITTING_CLIENT_REJECTION_WORKER_CODE=SUBMITTING_REJECTED
```

### Pre-provider orchestration (revision R44B6V0)

**Status (R44B6V; recorded by R44B6V1).** Implemented in commit
836cca5c06a92bcc1c729a59dad0cd1fc6badd3b as `obtainPreProviderPermit`, a
separate unit that no production path calls: `runCredentialOpeningOnce` is
unchanged and does not invoke it, so current execution moves no real attempt
into `SUBMITTING` through it. It runs the per-attempt `journal.prepare()`,
then the `SUBMITTING` acknowledgement and the mandatory heartbeat, each with
the locked two-attempt, unavailable-only retry policy, using one unchanged
proof throughout. Each request attempt gets a fresh orchestration-owned
`AbortController` and a 10000 ms deadline that is cancelled as soon as the
request settles. The deadline acts through the `AbortSignal`, which the
production fetch transport honours, and a retry starts only after the
previous attempt has settled, so attempts never overlap. The timer is an
injectable seam for tests, not runtime configuration. (R44B6Y; recorded by
R44B6Y1.) The returned permit is exactly
`{executionAttemptId, fencingCounter, submittingAt}`, with `submittingAt`
copied unchanged from the exact successful `SUBMITTING` acknowledgement
(below). It excludes the lease token,
machine credential, opened provider credential and `leaseExpiresAt`, and has
no provider callback or object. It records that the locked pre-provider
checks completed; holding it is not itself a security boundary. No provider
abstraction, provider construction or invocation exists. The contract below
is unchanged.

**R44B9 reconciliation (R44B9B).** Since R44B9 (commit
e57d2b77af6f61d8548e39c84f4741874806ea8f), the only production caller of
`obtainPreProviderPermit` is the development-only fake-provider composer
`runConfiguredFakeProviderAttemptOnce` (`attemptExecution.ts`), which
constructs the provider operation only after the permit succeeds. The
"no production path calls" wording above describes the state before R44B9;
`runCredentialOpeningOnce` still does not call it. In this document "live
execution" means real or live provider submission, which stays disabled
(`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`), so the
`*_USED_BY_LIVE_EXECUTION=NO` keys are unchanged. Section 36, "First
fake-provider execution slice", records the implementation.

**Locked decision (R44B6V0; implemented by R44B6V).** The orchestration
boundary immediately before provider invocation. It covers the per-attempt
journal preflight, the `SUBMITTING` acknowledgement sequence, its request
deadline and `AbortSignal` ownership, the mandatory pre-provider heartbeat,
post-`SUBMITTING`/pre-provider failures, and the provider-construction and
permit boundary. It implements no heartbeat client, provider client, fake or
real provider, provider invocation, acceptance handler or `submitted`
orchestration.

**Order.**

```text
credential grant
-> credential validation and open
-> per-attempt journal.prepare()
-> SUBMITTING acknowledgement sequence
-> successful heartbeat
-> pre-provider permit
-> exactly one provider create call (outside R44B6V0)
```

- **Per-attempt journal preflight.** `journal.prepare()` (idempotent) runs
  for each attempt immediately before the acknowledgement sequence; the
  worker proves its state root usable when it is about to create provider
  authority. The startup preparation remains, but is not sufficient. If it
  fails: no `submitting` call, no provider call, no `submission-failed`; the
  attempt stays in its pre-`SUBMITTING` state.
- **Acknowledgement attempts.** At most two in total, the first immediate.
  The second is made only after `CONTROL_API_UNAVAILABLE`, with no delay,
  backoff or jitter. `SUBMITTING_REJECTED`, `WORKER_AUTHENTICATION_REJECTED`
  and `MALFORMED_CONTROL_RESPONSE` are never retried. Both attempts use
  exactly the same `executionAttemptId`, `fencingCounter` and `leaseToken`;
  the proof is never changed. The orchestration owns this retry; the client
  stays single-shot (R44B6U0). The acceptance-recovery policy (section 17)
  does not apply.
- **Request deadline and `AbortSignal`.** Each acknowledgement HTTP attempt
  has a 10000 ms deadline. The orchestration owns a fresh `AbortController`
  per attempt; its signal covers only that request, never the provider call,
  and never becomes the provider-execution cancellation signal. A deadline
  abort is `CONTROL_API_UNAVAILABLE` through the existing client and may use
  the one allowed retry. The values are architecture constants, not
  environment configuration; a repository constant location may be chosen
  at implementation without changing them.
- **Lost response.** As locked by R44B6U0: a 409 never proves that
  `SUBMITTING` did not commit. Without an exact parsed 200 there is no
  provider call and no `submission-failed` report.
- **No local lease minimum.** No fixed worker-side minimum remaining lease
  applies before the acknowledgement, and `leaseExpiresAt` never grants
  provider authority. The control plane stays authoritative for lease
  validity; the fresh lease budget for the provider call comes from the
  mandatory heartbeat below, never from local clock arithmetic.
- **Mandatory pre-provider heartbeat.** After an exact successful
  acknowledgement and before any provider object is constructed, the worker
  must obtain a successful heartbeat acknowledgement for the same attempt,
  fence and lease epoch. The heartbeat renews the authoritative server lease
  under the existing policy (section 12). No successful heartbeat, no
  provider call. Its attempts, retryable errors and 10000 ms per-attempt
  deadline are locked by R44B6W0 ("Worker heartbeat client and pre-provider
  heartbeat" below).
- **Pre-provider heartbeat failure.** If the heartbeat is refused,
  unavailable, ambiguous, malformed or aborted after a committed
  `SUBMITTING`: no provider call, no `submission-failed` report and no
  alternative lifecycle transition. The attempt stays `SUBMITTING`, and the
  authoritative sweep owns the outcome. That may record `OUTCOME_UNKNOWN`
  with `WORKER_LEASE_EXPIRED_DURING_SUBMISSION` although this worker knows it
  never called the provider. This conservatism is intentional: the closed
  `submission-failed` codes describe provider-submission outcomes, and no
  code means "worker deliberately stopped before the provider call". R44B6V0
  adds none (no `PRE_PROVIDER_ABORTED`, `HEARTBEAT_FAILED` or equivalent).
- **`submission-failed` threshold.** Never before a committed `SUBMITTING`.
  After it but before the provider call, orchestration or heartbeat failure
  still never uses `submission-failed`, which stays scoped to the
  provider-submission contract of R44B6T.
- **Provider-construction boundary.** No provider client, adapter or
  provider-create callable is constructed, selected or invoked until the
  credential context is valid and open, the per-attempt `journal.prepare()`
  succeeded, an exact acknowledgement was obtained and the mandatory
  heartbeat succeeded. Every acknowledgement retry and pre-call check
  finishes before any provider object exists, so the exactly-one-create
  boundary fails closed.
- **Pre-provider permit.** The orchestration's conceptual output exists only
  after every gate above succeeds. Holding it calls nothing. No provider
  callback or port is passed into the orchestration to test ordering; it
  stops at the permit, so it stays separable from provider execution. A
  test-local spy that exists only in test code is not fake-provider
  execution, but a production source abstraction that can accept or invoke a
  provider create belongs to provider execution, outside R44B6V.
- **In-flight heartbeat.** Locked by R44B6Z0 ("In-flight provider heartbeat"
  below) and implemented by R44B6Z as `runWithInFlightHeartbeat`, which no
  production path calls yet. The keeper starts only after this permit
  exists, and a heartbeat failure never abandons a create already in flight.

**Prerequisites and sequence.** The expected sequence: a client-only worker
heartbeat client for the existing route (no provider execution); its
publication and docs-sync (both done: R44B6W, R44B6W1); the R44B6V
orchestration that stops at the permit (done: R44B6V, R44B6V1); then keeping
that orchestration unused by live execution until the later
provider-composition prerequisites (section 36) are met. No production path
moves real attempts into `SUBMITTING` only to prove the orchestration.

```text
SUBMITTING_ORCHESTRATION_MAX_ATTEMPTS=2
SUBMITTING_ORCHESTRATION_RETRIES_CONTROL_API_UNAVAILABLE=YES
SUBMITTING_ORCHESTRATION_RETRIES_SUBMITTING_REJECTED=NO
SUBMITTING_ORCHESTRATION_RETRY_BACKOFF=NONE
SUBMITTING_ORCHESTRATION_RETRY_JITTER=NONE
SUBMITTING_ACK_REQUEST_DEADLINE_MS=10000
SUBMITTING_ACK_ABORT_OWNER=PRE_PROVIDER_ORCHESTRATION
SUBMITTING_ACK_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO
SUBMITTING_PRE_PROVIDER_HEARTBEAT_REQUIRED=YES
SUBMITTING_PRE_PROVIDER_HEARTBEAT_FAILURE_CALLS_PROVIDER=NO
SUBMITTING_PRE_PROVIDER_HEARTBEAT_FAILURE_CALLS_SUBMISSION_FAILED=NO
PRE_PROVIDER_PERMIT_REQUIRES_SUBMITTING_AND_HEARTBEAT=YES
PROVIDER_CONSTRUCTION_REQUIRES_PRE_PROVIDER_PERMIT=YES
PER_ATTEMPT_JOURNAL_PREPARE_REQUIRED_BEFORE_SUBMITTING=YES
PRE_PROVIDER_ORCHESTRATION_IMPLEMENTED=YES
WORKER_HEARTBEAT_CLIENT_IMPLEMENTED=YES
```

### Worker heartbeat client and pre-provider heartbeat (revision R44B6W0)

**Status (R44B6W; recorded by R44B6W1).** The client is implemented in
commit d4f3923d2bf265b0413add63820c797a994276d1 as `heartbeat` on the
existing `WorkerControlClient`, returning a `WorkerHeartbeatAcknowledgement`
through its strict response parser, with the closed worker code
`HEARTBEAT_REJECTED` and optional pass-through of an externally supplied
`AbortSignal`. It is a client-only transport with no production caller; its
only caller is the R44B6V orchestration, which itself has no production
caller (R44B6V1). The pre-provider heartbeat policy below is implemented by
that orchestration but not wired into live execution. The contract below is
unchanged. (R44B9B.) Since R44B9 the client is reached only through the
orchestration and the in-flight keeper, and both are called in production
only by the development-only fake-provider composer (section 36); no
real-provider or live path calls it.

**Locked decision (R44B6W0; client implemented by R44B6W).** The
control-plane route is already implemented (section 10; section 12):
`POST /worker-control/v1/attempts/:attemptId/heartbeat`, body exactly
`{fencingCounter, leaseToken}`, success (200) exactly:

```text
{fencingCounter, leaseExpiresAt}
```

There is no `executionAttemptId`, `state`, `heartbeatAt`, worker or token
member. Allowed states stay `LEASED`, `SUBMITTING` and `SUBMITTED` (exact
live-route epoch only). Authority is the full live-lease proof: an `ACTIVE`
worker, current lease ownership of the attempt, the exact fencing counter, a
valid token, an unexpired lease and, in `SUBMITTED`, the live-route epoch. A
success writes only `heartbeat_at`, `lease_expires_at` and `updated_at`; it
never changes state, fence, token or principal and writes no lifecycle
audit.

**Renewal, not replay.** Each success is a fresh renewal:
`lease_expires_at = server now + the authoritative lease duration`
(currently 120 seconds). Repeated identical deliveries are safe and may
renew again. A heartbeat after authoritative expiry is refused; a heartbeat
never revives an expired lease. A lost response leaves the worker unsure
whether the lease renewed, and an exact retry is safe: a second success
renews again and its `leaseExpiresAt` becomes the current data. A later
retry after expiry may return 409, so `HEARTBEAT_REJECTED` never proves that
an earlier heartbeat did not renew. The worker never infers whether an
ambiguous heartbeat committed: without an exactly parsed success there is no
pre-provider permit and no provider call.

**The client (R44B6W).** One neutral worker-side transport method for this
route, usable both for the mandatory pre-provider heartbeat (R44B6V0) and,
later, for periodic heartbeat while a provider call is in flight. It knows
nothing of provider calls or cancellation, permits, cadence, scheduling,
sweep or `submission-failed`; the orchestration interprets its result.

- **Signature and transport.** Conceptually
  `heartbeat(executionAttemptId, proof: LeaseProof, signal?: AbortSignal)`
  returning a heartbeat acknowledgement; naming follows `WorkerControlClient`
  and there is exactly one heartbeat method. The attempt ID is in the path,
  the body is exactly `{fencingCounter, leaseToken}`, and it reuses
  `createHttpWorkerControlClient` and its shared `send`/`post` transport.
- **Single shot.** At most one HTTP request per call: no retry loop or
  counter, backoff, jitter, sleep, interval or scheduling. Callers own retry
  and scheduling; neither the acceptance-recovery policy, nor the
  `SUBMITTING` orchestration policy, nor a future in-flight schedule is
  copied into it.
- **No timeout of its own.** It creates no `AbortController`, timer or
  deadline. It may pass through an externally supplied `AbortSignal`; an
  external abort is `CONTROL_API_UNAVAILABLE`.
- **No local lease authority.** It never reads the clock to judge validity,
  compares `leaseExpiresAt` with local time, declares or synthesises lease
  expiry, or refuses a success because the expiry looks near.
  `leaseExpiresAt` is authoritative server data returned to the caller.
- **Strict success.** Exactly `fencingCounter` and `leaseExpiresAt`: the
  counter a positive safe integer equal to the presented proof, the expiry a
  canonical UTC millisecond instant that round-trips (the existing
  worker-control parser rule), no missing or extra member. The response
  carries no attempt ID or state, so the client neither claims nor checks
  them (the request path binds the attempt), and it never requires the
  expiry to be later than local time or any local threshold.
- **Error mapping (closed worker codes).** HTTP 409 maps to a dedicated new
  code `HEARTBEAT_REJECTED`, never `LEASE_REJECTED` (lease-acquisition
  refusal), `SUBMITTING_REJECTED` (the `submitting` route) or
  `LEASE_EXPIRED` (the worker's conservative local pre-grant check). The
  control-plane reason is not exposed. 401 and 403 map to
  `WORKER_AUTHENTICATION_REJECTED`; 5xx, transport failure and external
  abort to `CONTROL_API_UNAVAILABLE`; any other status (including 400, 404
  and 415) or a malformed 200 to `MALFORMED_CONTROL_RESPONSE`.
- **Secrets.** The machine credential appears only in `Authorization` and
  the token only in the request body; neither appears in a `WorkerError`,
  retained cause, log, metric label, worker event or production-style
  diagnostic, and the request body is never logged. Messages are fixed.
- **Failure semantics.** It only returns a validated acknowledgement or
  throws a closed `WorkerError`. It never calls `submission-failed`,
  `submitted` or `submitting`, changes lifecycle state, triggers a sweep,
  infers `OUTCOME_UNKNOWN`, constructs or invokes a provider, aborts an
  in-flight provider call, or declares the lease expired.
- **Client only.** After R44B6W the client exists and is tested, but no
  production path calls it: not `runCredentialOpeningOnce`,
  `acknowledgeSubmitting`, a pre-provider permit, a heartbeat loop or any
  provider execution.

**Mandatory pre-provider heartbeat policy (owned by the R44B6V
orchestration; implemented by R44B6V, not wired into live execution).**

- **Attempts.** At most two in total, the first immediate. The second only
  after `CONTROL_API_UNAVAILABLE`; `HEARTBEAT_REJECTED`,
  `WORKER_AUTHENTICATION_REJECTED` and `MALFORMED_CONTROL_RESPONSE` are never
  retried. Both use exactly the same `executionAttemptId`, `fencingCounter`
  and `leaseToken`. No delay, backoff or jitter. The client stays
  single-shot.
- **Deadline.** Each heartbeat HTTP attempt has a 10000 ms deadline, set by
  this lock (not inherited from the `SUBMITTING` deadline). The orchestration
  owns a fresh `AbortController` per attempt; its signal covers only that
  heartbeat request and never extends to provider construction or
  invocation, never becomes a provider cancellation signal and never cancels
  a started create. A deadline abort is `CONTROL_API_UNAVAILABLE` and may use
  the one retry. These are architecture constants, not configuration.
- **Permit.** The client knows nothing of the permit. The orchestration
  alone creates it from an exact `SUBMITTING` acknowledgement plus an exact
  heartbeat acknowledgement, subject to the other R44B6V0 gates. The renewed
  `leaseExpiresAt` may be exposed to the orchestration. (R44B6Y0.) The
  permit's representation is now locked as exactly
  `{executionAttemptId, fencingCounter, submittingAt}`. `submittingAt` is
  copied from the exact validated `SUBMITTING` acknowledgement, in the
  client's existing timestamp representation. It is never generated, never
  taken from the heartbeat response and never derived from local time. The
  permit never carries `leaseExpiresAt`, the lease token, a credential or a
  provider callback, and stays non-secret.

**In-flight heartbeat.** Its scheduling, retry and failure policy is locked
by R44B6Z0 ("In-flight provider heartbeat" below), separately from this
pre-provider policy. A heartbeat failure never abandons a create call
already in flight.

**Boundary.** No API, protocol-package, migration or provider-adapter
change. Expected R44B6W scope: `apps/commercial-worker/src/workerControlClient.ts`,
`apps/commercial-worker/src/workerError.ts` (only `HEARTBEAT_REJECTED`),
`apps/commercial-worker/tests/boundary.test.ts` and a new
`apps/commercial-worker/tests/heartbeatClient.test.ts`. No production caller
change, no `credentialOpeningRun.ts` change to exercise it, and no
scheduling or orchestration code.

```text
WORKER_HEARTBEAT_CLIENT_USED_BY_LIVE_EXECUTION=NO
HEARTBEAT_CLIENT_INTERNAL_RETRY_ENABLED=NO
HEARTBEAT_CLIENT_OWNS_REQUEST_TIMEOUT=NO
HEARTBEAT_CLIENT_OWNS_CADENCE=NO
HEARTBEAT_CLIENT_CAN_DECLARE_LEASE_EXPIRED=NO
HEARTBEAT_CLIENT_REJECTION_WORKER_CODE=HEARTBEAT_REJECTED
PRE_PROVIDER_HEARTBEAT_MAX_ATTEMPTS=2
PRE_PROVIDER_HEARTBEAT_RETRIES_CONTROL_API_UNAVAILABLE=YES
PRE_PROVIDER_HEARTBEAT_RETRIES_HEARTBEAT_REJECTED=NO
PRE_PROVIDER_HEARTBEAT_RETRY_BACKOFF=NONE
PRE_PROVIDER_HEARTBEAT_RETRY_JITTER=NONE
PRE_PROVIDER_HEARTBEAT_REQUEST_DEADLINE_MS=10000
PRE_PROVIDER_HEARTBEAT_ABORT_OWNER=PRE_PROVIDER_ORCHESTRATION
PRE_PROVIDER_HEARTBEAT_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO
```

### In-flight provider heartbeat (revision R44B6Z0)

**Status (R44B6Z; recorded by R44B6Z1).** Implemented in commit
2f9683c4ce3d5e9036595eee7cbc6907d3a028db as `runWithInFlightHeartbeat` in
`apps/commercial-worker/src/inFlightHeartbeat.ts`. Only the worker changed:
there is no `workerError.ts`, acceptance-component, commercial-api,
protocol, migration, engine, provider-adapter, manifest or lockfile change,
and no provider is invoked. The contract below is unchanged.

**R44B9 reconciliation (R44B9B).** R44B9 wires the keeper for the first
time, as `runWithInFlightHeartbeat(() => operation.execute(onAccepted))` in
the development-only fake-provider composer, which is its only production
caller. Its lifetime is the provider create plus the awaited acceptance
callback; polling is excluded, and heartbeat authority loss does not cancel
the operation. The boundary statements below that the keeper has no
production caller, and the "provider-failure composition gap" below,
describe the state before R44B9. The keeper itself still contains no
failure reporting; generic provider-failure composition now lives in the
composer and the shared `failureReportPolicy.ts` (section 36). No
real-provider or live path calls the keeper.

- **API.** `runWithInFlightHeartbeat<T>(context, operation)`. The context
  holds only:
  - `executionAttemptId`;
  - an immutable `LeaseProof`, frozen into a copy;
  - a client exposing only `heartbeat`;
  - the injected host-fault latch;
  - an optional `DeadlineTimer` (default `realDeadlineTimer`);
  - an optional abortable `RecoverySleep`-compatible sleep (default
    `defaultRecoverySleep`).

  The operation is a no-argument async thunk. The keeper receives no
  provider SDK, provider identity, provider execution ID, credential,
  acceptance record, journal or polling metadata. It knows nothing of
  acceptance itself: `IN_FLIGHT_HEARTBEAT_ACCEPTANCE_RECONCILIATION_INCLUDED`
  and `IN_FLIGHT_HEARTBEAT_POLLING_PHASE_INCLUDED` describe the future
  composition of the operation it will wrap, and no provider runner is
  wired.
- **Operation ownership.** `operation()` is invoked exactly once, first.
  Settlement handlers are attached before any heartbeat wait. There is no
  `Promise.race`. The keeper joins its heartbeat task, then returns the
  operation's exact value or rethrows its exact error; tests check identity.
  A synchronous throw propagates with no keeper started. Heartbeat status
  never replaces the outcome.
- **Cadence.** 30000 ms first delay and 30000 ms quiet interval, run
  sequentially: sleep, tick, wait for the tick to settle, then the next
  sleep. There is no immediate heartbeat, no `setInterval`, no overlap and
  no local lease-expiry calculation (no `leaseExpiresAt`, `Date` or
  `performance.now` logic).
- **Attempts.** At most two per tick. Each gets a fresh `AbortController`
  and a fresh 10000 ms deadline, with the same attempt ID and frozen proof.
  Only `CONTROL_API_UNAVAILABLE` earns the second; no backoff or jitter.
- **Results.**

  | Heartbeat result | Keeper | Latch |
  |---|---|---|
  | `CONTROL_API_UNAVAILABLE` on both attempts | ends only that tick; no throw, cancellation or expiry inference; the 30000 ms cadence resumes | not tripped |
  | `HEARTBEAT_REJECTED` | stops scheduling for the wrapped operation, with no retry; never aborts the operation or replaces its result, and is never read as a provider outcome | not tripped |
  | `WORKER_AUTHENTICATION_REJECTED`, `MALFORMED_CONTROL_RESPONSE`, or any unexpected client, keeper or invariant failure | stops scheduling; keeps awaiting the operation | tripped |

  Tests cover several exhausted ticks followed by a later success. The
  latch is implemented but not wired into any production provider or
  work-acquisition loop, so no live enforcement exists.
- **Shutdown.** When the operation settles, the keeper:
  - aborts a pending quiet sleep or heartbeat request;
  - suppresses any further retry or tick;
  - joins the heartbeat task, leaving no timer or request behind.

  That keeper-owned abort is not a failure. An unavailability result seen
  while the keeper is stopping means shutdown: no retry, no latch trip and
  no later heartbeat. A deadline abort while the operation is still pending
  is `CONTROL_API_UNAVAILABLE` and follows the retry policy. Tests cover
  both explicitly.
- **Signals.** Heartbeat signals stay heartbeat-local. The operation is
  invoked with no arguments, so no heartbeat deadline or shutdown can
  cancel it.
- **Boundaries.** Boundary tests prove:
  - no production caller: no provider adapter, credential opening,
    pre-provider orchestration, acceptance component or startup
    reconciliation calls it;
  - no `reportSubmissionFailed` or route reference, so the separately
    tracked provider-failure composition gap is unchanged;
  - no acceptance adapter or handler, journal, `recoverAcceptance`,
    `runAcceptanceRecoveryWithRetry` or `prepare()`;
  - no Runway, Veo or Google, SDK, port, factory, selector, provider
    execution ID, polling or credential.
- **Tests.** Deterministic component tests cover:
  - immediate resolution and rejection, and a synchronous throw;
  - a successful tick;
  - unavailable then retry success;
  - several exhausted ticks then success;
  - a 409 followed by the operation resolving or rejecting;
  - authentication, malformed and unexpected faults followed by
    settlement;
  - the operation settling during a request, between attempts, or during
    the quiet sleep;
  - no overlap;
  - a deadline abort versus the keeper's own shutdown abort;
  - exact preservation of the operation's result and error.

  These are keeper component tests only. They are **not** the whole-chain
  crash-point tests of section 36, which must exercise the composed chain
  across components.

**Locked decision (R44B6Z0; implemented by R44B6Z).** R44B6Z discovery found the
earlier cadence wording, "at most every third of the lease", in conflict
with the control-plane lease policy. Read literally, that wording sets a
minimum gap; the policy intends renewal every 30 to 40 seconds of a
120-second lease. This lock replaces it and fixes the full in-flight policy.
It changes no route, protocol, migration, engine module or provider adapter,
and implements nothing.

**Control-plane authority (unchanged).**

- `POST /worker-control/v1/attempts/:id/heartbeat` with exactly
  `{fencingCounter, leaseToken}`.
- It is allowed only under the exact live lease epoch, in `LEASED`,
  `SUBMITTING` or `SUBMITTED`; in `SUBMITTED` only for the live-route epoch
  (section 12).
- The database clock is authoritative. A success sets
  `lease_expires_at = now() + 120 s` and updates `heartbeat_at`.
- It cannot revive an already-expired lease; the route never runs the
  expiry sweep.
- It never changes state, fence or token, grants no provider-call
  authority, creates no acceptance and cancels no provider work.
- The worker heartbeat client is unchanged (R44B6W0): single-shot, no retry
  or timer of its own, an optional external `AbortSignal`, no expiry
  authority and no provider knowledge.

**Keeper model.** A generic, provider-agnostic, worker-local in-flight lease
keeper, conceptually:

```text
runWithInFlightHeartbeat({executionAttemptId, proof, client: heartbeat, latch, deadlineTimer, sleep}, operation)
```

The implementation may follow repository naming. The keeper never receives
a provider SDK, opened credential, API key, acceptance record, provider
execution ID or polling metadata. All it knows of provider work is the
lifetime of the supplied async operation.

**Operation lifetime.**

- The keeper starts the operation exactly once and attaches to its promise
  before any other await. It keeps ownership of that promise for its whole
  life.
- The promise is never abandoned because a heartbeat failed. No
  `Promise.race` or equivalent may:
  - return before the operation settles;
  - drop a later acceptance or rejection;
  - leave a provider rejection unhandled.
- The keeper returns exactly the operation's resolved result, or rethrows
  exactly its error, after heartbeat cleanup.
- Heartbeat status never replaces or wraps that outcome; no compound result
  exists without a later amendment.

**Composition boundary.**

- The supplied operation is the provider-submission phase. For an accepted
  submission that phase includes the create, the provider acceptance
  callback and the awaited R44B6Y outer acceptance adapter through
  authoritative reconciliation. It is not complete merely because the
  provider returned an ID.
- Provider polling begins only after that callback resolves, and is out of
  scope.
- R44B6Z does not wire this composition.

**Start and stop.**

```text
pre-provider permit (mandatory pre-provider heartbeat succeeded)
-> keeper starts
-> provider-submission operation invoked exactly once
-> keeper heartbeats concurrently
-> operation settles (resolves or rejects)
-> keeper stops, cleans up, then returns or rethrows the operation outcome
```

- No keeper exists before the permit.
- The keeper stops only when the operation settles. Because an accepted
  submission's operation includes the awaited R44B6Y adapter, heartbeats
  naturally continue through acceptance reconciliation.
- That may briefly include heartbeats while the attempt is `SUBMITTED`
  under the exact live epoch.
- The keeper never continues into polling. No polling-phase heartbeat
  policy exists in R44B6Z.

**Timing.**

- **First tick.** No immediate heartbeat: the pre-provider heartbeat has
  just renewed the lease. The first tick starts after a 30000 ms quiet
  interval from keeper start.
- **Cadence.** Strictly sequential: sleep 30000 ms, run one tick, and only
  after the tick fully settles sleep another 30000 ms.
- **Spacing.** With each request bounded by its 10-second deadline,
  successful renewals are normally 30 to 40 seconds apart. Example: from a
  renewal at t0, the first tick starts at t0+30 and, even if both its
  attempts fail by t0+50, the next tick starts at t0+80 and can renew by
  t0+90, inside the 120-second lease. One fully failed tick is tolerated.
- This is not a fixed 40-second gap, and no `setInterval`-style scheduling
  is used.
- The schedule is proactive only. It is never derived from
  `leaseExpiresAt`, and the worker never declares expiry from a local
  clock.
- **Deadline.** Each heartbeat HTTP attempt has a 10000 ms deadline, owned
  by the keeper, under a fresh `AbortController` per attempt. The signal
  covers only that request.
- **Attempts per tick.** At most two, both immediate. Only
  `CONTROL_API_UNAVAILABLE` earns the second. `HEARTBEAT_REJECTED`,
  `WORKER_AUTHENTICATION_REJECTED`, `MALFORMED_CONTROL_RESPONSE` and every
  other closed result are never retried. No backoff and no jitter.
- **No overlap.** At most one tick and at most one heartbeat request are
  active at any time; the sequential loop guarantees it by construction.

**Outcome policy.** In every case the keeper keeps awaiting the operation.
It never cancels it, never resubmits and never calls `submission-failed`
because of a heartbeat result.

| Heartbeat result | Keeper | Host-fault latch |
|---|---|---|
| Success | continue the cadence | unchanged |
| `CONTROL_API_UNAVAILABLE` twice in one tick (transport, 5xx or request deadline) | tick exhausted; continue the normal cadence; no consecutive-failure threshold | not tripped |
| `HEARTBEAT_REJECTED` (409) | stop scheduling | not tripped for the rejection alone |
| `WORKER_AUTHENTICATION_REJECTED` | stop scheduling | **tripped** |
| `MALFORMED_CONTROL_RESPONSE` | stop scheduling | **tripped** |
| Scheduler invariant violation (for example an impossible overlap) | stop scheduling | **tripped** |
| Unexpected heartbeat-loop error | stop scheduling | **tripped** |
| Keeper-owned stop abort | shut down | not tripped |

- Temporary unavailability does not make the host unsafe. If the lease
  lapses meanwhile, a later request receives 409 and the rejection row
  applies.
- A 409 establishes only that the route refused the current proof or state.
  It is never translated into a provider outcome, and never proves that the
  provider did or did not accept.
- A tripped latch means new work is unsafe until restart and clean startup
  reconciliation. The already-started provider operation continues.
- An unexpected keeper error never orphans the operation or creates an
  unhandled provider rejection.

**Keeper-owned stop.** When the operation settles, the keeper promptly
aborts its own pending sleep or heartbeat request, then joins and cleans up
its heartbeat task before returning or rethrowing. No timer is left behind.
That stop abort:

- is not a control-plane failure and never counts as
  `CONTROL_API_UNAVAILABLE`;
- trips nothing;
- schedules nothing;
- cannot affect the already-settled operation.

**Signal separation and cancellation.**

- Heartbeat signals are strictly heartbeat-local and never reach the
  provider operation. Neither a heartbeat timeout nor a keeper shutdown
  aborts the provider; the pre-provider rule
  (`PRE_PROVIDER_HEARTBEAT_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO`)
  extends here.
- No heartbeat or control-plane condition may abort, cancel, detach from,
  race away or replace a provider create or submit that has started. A
  control-plane failure does not prove the provider refused the request.
- Provider timeouts and cancellation stay with the existing provider-owned
  mechanisms; the SDK-owned create timeouts are unchanged.

**Acceptance after heartbeat failure.** After unavailability, rejection,
authentication failure, a malformed response, database expiry or the
`SUBMITTING` sweep, an acceptance still follows R44B6Y:

```text
durable journal -> live reportSubmitted if possible -> acceptance recovery when required
```

- `SUBMITTED_REPORT_REJECTED` after lost authority hands the record to
  database-authoritative recovery.
- `submission-failed` stays forbidden once the record is durable, and the
  provider is never resubmitted.
- The keeper never inspects records, calls `recoverAcceptance`, decides
  expiry or creates a lease.

**Provider failure after lease loss.** The keeper never reports provider
outcomes. A future provider-outcome handler may try the existing
`submission-failed` route under its own policy, but:

- if the live lease has expired, the first transition is refused;
- if the sweep already recorded `OUTCOME_UNKNOWN`, a later definitive
  report never overwrites it (section 18).

The attempt then stays `OUTCOME_UNKNOWN` with the job `NEEDS_ATTENTION`, and
operator resolution is authoritative. That loses precision but never makes
a false definitive transition. No new route or API change is made.

**Provider-failure composition gap.** Worker-side composition for a
provider result that is definitively rejected, or ambiguously failed,
before acceptance is **not** part of the keeper and is not implemented.
R44B6Z never becomes that component. It is a known provider-execution
composition item for later whole-chain or provider-execution work, outside
the current fake-provider gate.

**Races.** All transitions serialise on the attempt row. No API change is
required.

| Race | Result |
|---|---|
| Heartbeat commits before the sweep | the lease is renewed; a later sweep finds it unexpired |
| Sweep commits before the heartbeat | the attempt is `OUTCOME_UNKNOWN` with no lease proof; the heartbeat gets 409 and the keeper stops |
| Live `SUBMITTED` commits first | an exact live-epoch heartbeat may still renew until keeper shutdown |
| Acceptance recovery clears or replaces authority | a later heartbeat is refused and the keeper stops; reconciliation is never reversed |

**Residuals and boundaries.**

- **Process crash.** A crash after the create is dispatched but before
  durable acceptance stays a known residual. Startup cannot prove whether
  the provider accepted, and the attempt becomes `OUTCOME_UNKNOWN` through
  the existing sweep and recovery path. Heartbeat cannot close this window.
- **Idempotency.** Provider idempotency keys are still not used, even where
  an SDK offers one (section 16). This needs a separate lock.
- **Timing seams.** Reuse `DeadlineTimer` and `realDeadlineTimer` for
  request deadlines, and an abortable `RecoverySleep`-compatible sleep for
  the cadence. No second timing framework is introduced. `MonotonicClock`,
  if used at all, is a test aid and never lease authority.
- **Section 24.** Independent: the keeper changes no credential-version
  status and creates, releases or destroys no retention obligation.

**Expected scope.** Worker-only:

- a new keeper source;
- focused keeper tests;
- `boundary.test.ts`;
- `workerError.ts` only if a genuinely necessary local invariant code is
  missing.

There is no change to the acceptance handler, adapter or journal,
commercial-api, the protocol package, migrations, or engine and provider
adapters. No production caller is required, and Runway, Veo, Google and fake
or real providers stay unwired. Implementing it removes only the in-flight
heartbeat item from the section 36 gate; the whole-chain crash-point tests
and the state-root binding remained at that time (both since satisfied, by
R44B7 and R44B8; the gate is complete as of R44B8B). Provider execution
stays disabled.

```text
IN_FLIGHT_HEARTBEAT_KEEPER_IMPLEMENTED=YES
IN_FLIGHT_HEARTBEAT_USED_BY_LIVE_EXECUTION=NO
IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS=30000
IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS=30000
IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS=10000
IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK=2
IN_FLIGHT_HEARTBEAT_RETRIES_CONTROL_API_UNAVAILABLE=YES
IN_FLIGHT_HEARTBEAT_RETRY_BACKOFF=NONE
IN_FLIGHT_HEARTBEAT_RETRY_JITTER=NONE
IN_FLIGHT_HEARTBEAT_OVERLAP_ALLOWED=NO
IN_FLIGHT_HEARTBEAT_LOCAL_LEASE_EXPIRY_AUTHORITY=NO
IN_FLIGHT_HEARTBEAT_UNAVAILABLE_STOPS_KEEPER=NO
IN_FLIGHT_HEARTBEAT_UNAVAILABLE_TRIPS_HOST_FAULT=NO
IN_FLIGHT_HEARTBEAT_REJECTION_STOPS_KEEPER=YES
IN_FLIGHT_HEARTBEAT_REJECTION_TRIPS_HOST_FAULT=NO
IN_FLIGHT_HEARTBEAT_AUTH_FAILURE_TRIPS_HOST_FAULT=YES
IN_FLIGHT_HEARTBEAT_MALFORMED_RESPONSE_TRIPS_HOST_FAULT=YES
IN_FLIGHT_HEARTBEAT_CANCELS_PROVIDER_OPERATION=NO
IN_FLIGHT_HEARTBEAT_ABANDONS_PROVIDER_PROMISE=NO
IN_FLIGHT_HEARTBEAT_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO
IN_FLIGHT_HEARTBEAT_KEEPER_STOP_ABORT_IS_FAILURE=NO
IN_FLIGHT_HEARTBEAT_FAILURE_OVERRIDES_OPERATION_OUTCOME=NO
IN_FLIGHT_HEARTBEAT_ACCEPTANCE_RECONCILIATION_INCLUDED=YES
IN_FLIGHT_HEARTBEAT_POLLING_PHASE_INCLUDED=NO
```

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
  because changing it would void this invariant. (R44B7A.) No commercial
  provider-create adapter exists yet. The invariant is unchanged: commercial
  provider create never silently retries. Its assertion, and the negative
  test that a create client whose retry is not disabled is refused, fail
  closed, are obligations of the future provider-create adapter slice, not
  of slice 7 (section 36).
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

(R44B10A contract lock.) For the first real adapter the obligation is
concrete: `@google/genai` 2.24.0, the public
`GoogleGenAI.interactions.create` with exactly `{ maxRetries: 0, timeout:
60000 }`, which 2.24.0 translates into zero internal retries (its default
for Interactions create is four retries), proven by a transport-level test
with an injected counting fetch, and pinned by a boundary test. Provider
retry advice (for example on 429) never justifies an SDK or application
retry. Section 36, "First real-provider adapter: Google GenAI (revision
R44B10A)".

(R44B10B contract lock.) The Runway obligation is equally concrete:
`@runwayml/sdk` 4.20.0, public `client.imageToVideo.create`, with
client-level and per-create `maxRetries: 0` and a 60000 ms timeout.
Runway 4.20.0 otherwise retries connection failures, 408, 409, 429 and
5xx responses. A real-SDK counting-fetch test must prove exactly one HTTP
request for at least 408, 409, 429, 503, a connection failure and a
timeout. No Runway retry recommendation permits automatic resubmission.

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

**What was not implemented before R44B9.** No provider submission flow
writes a new acceptance record or calls the `submitted` client. (R44B6Y; recorded by
R44B6Y1.) The worker components that implement the chain exist (the inner
durable handler and the outer acceptance adapter, section 18), but no
provider path calls them. The required chain is still unwired to live
execution:

```text
provider definitively accepts
-> acceptance record becomes durable (this section; inner durable handler)
-> outer acceptance adapter reports submitted or hands over to recovery (section 18)
-> outer adapter resolves; only then may provider polling begin
```

(R44B9B.) R44B9 wires this chain for the development-only fake provider
only: the production composer `runConfiguredFakeProviderAttemptOnce` passes
the acceptance adapter as the awaited callback of the `BUSYBOOKIE_FAKE`
operation, which then writes the acceptance record and reports `submitted`
(or hands over to recovery). The "no provider path" wording above describes
the state before R44B9. No real-provider or live submission flow exists, and
polling is still not wired (section 36, "First fake-provider execution
slice").

The control-plane `acceptance-recovery` route is implemented (R44B6R,
section 18), and worker startup reconciliation now calls it through the
worker acceptance-recovery client (R44B6S, "Startup reconciliation" below).
The control-plane `submission-failed` route is implemented (R44B6T,
section 18). Its worker client was first called only by the acceptance
adapter (R44B6Y); since R44B9 its only caller is the shared
`failureReportPolicy.ts`, used by the acceptance adapter and the
development-only fake composer. Development-only fake-provider execution is
implemented (R44B9); real-provider execution remains unimplemented. Startup
makes no provider call; it resolves valid published acceptance evidence only
through an exact control-plane acknowledgement.

**State root.** R44B6P takes the state root as explicit worker composition
input. (R44B8A.) The configuration key `COMMERCIAL_WORKER_STATE_ROOT`, its
validation and the deployment binding to
`/var/lib/busybookie/commercial-worker` are now locked ("State-root binding"
below). R44B8 implements them (recorded by R44B8B) as library code with no
production caller: `loadWorkerConfig` reads the key from an injected
object, and `bindWorkerStateRoot` binds the journal to it. (R44B9B.) Since
R44B9 the development-only fake-provider composer calls
`bindWorkerStateRoot` (with an already parsed `WorkerConfig`); nothing calls
`loadWorkerConfig` or `runConfiguredCredentialOpeningOnce` in production,
and no alternate state-root mechanism exists.

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
acceptance handler is considered complete (section 18; R44B6Y0: before the
inner durable handler returns, and so before any `SUBMITTED` request). A
journal record
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
explicit configuration value. (Historical, R44B6K to R44B7B: no machine
path or environment-variable name was locked, and R44B6Q accepted the root
only through explicit worker composition.) (R44B8A.) The key
`COMMERCIAL_WORKER_STATE_ROOT`, the private/staging path
`/var/lib/busybookie/commercial-worker` and the full binding contract are
now locked in "State-root binding" below.

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

### State-root binding (revision R44B8A)

**Status (R44B8; recorded by R44B8B).** Implemented in commit
c733b9450f143ab56e5c17f2e67c2c1e4a5d5ab5. It adds
`apps/commercial-worker/src/workerConfig.ts` and
`apps/commercial-worker/src/workerStateRoot.ts`, plus tests. There is no
commercial-api, protocol, migration, runbook, provider, manifest or lockfile
change. The contract below is unchanged.

The implementation is **library-only**. There is still no worker daemon,
process entry point or start script, and no worker production module reads
`process.env`; no exemption was added.

**Configuration.** `loadWorkerConfig(environment)` parses an injected
object.

- It requires `COMMERCIAL_WORKER_ENV`, exactly `development` or
  `production` with no default, and `COMMERCIAL_WORKER_STATE_ROOT`.
- It returns a frozen `WorkerConfig` (`{ mode, stateRoot }`).
- `WORKER_CONFIG_KEYS` and `PRODUCTION_WORKER_STATE_ROOT` are exported.
- Errors are a `WorkerConfigError` with closed codes and fixed messages
  that never echo a supplied value or path: `WORKER_ENV_MISSING`,
  `WORKER_ENV_INVALID`, `WORKER_STATE_ROOT_MISSING`,
  `WORKER_STATE_ROOT_EMPTY` and `WORKER_STATE_ROOT_NOT_PRODUCTION_ROOT`.
  No `WorkerError` code was added.
- Development still requires an explicit root, with no `cwd`, tmp, home,
  repository or media-root derivation and no root creation.
- Production accepts **exactly** `/var/lib/busybookie/commercial-worker`
  and refuses any other root. That is the application half of the
  published binding: worker root `/var/lib/busybookie/commercial-worker`
  on the persistent `/var/lib/busybookie` mount.

**Root policy.** `assertWorkerStateRoot(config, host?)` enforces:

- **Shape:** non-empty, no NUL, absolute, no `..` segment.
- **Existence:** an existing directory, used as the exact configured
  string with no `realpath` rewriting. The root is never created.
- **Links:** lstat refuses a linked root and an existing linked
  `acceptance-journal`, `v1` or `quarantine`. The managed directories are
  checked again after `prepare()`, which catches a link introduced during
  preparation. This is trusted-host configuration validation, not
  hostile-filesystem race-proofing.
- **Production:** the OS must be `linux`, the effective UID must be
  available and equal the root's owner, and `(mode & 0o077) == 0`. The
  root is never chmod-repaired; managed descendants keep `0700`/`0600`.
  Even a hand-built production configuration binds only the published
  root.
- **Directory sync:** `selectDirectorySync` returns `REQUIRED` in
  production, `DEVELOPMENT_BEST_EFFORT` for Windows development and
  `REQUIRED` for other development. That last choice deliberately fails
  closed rather than silently downgrading.
- **Responsibility split:** the application checks the path shape,
  existence, links and the production owner/mode. Through the journal's
  `prepare()` it also probes hard links and directory fsync. The runbook
  smoke gate checks the filesystem class: persistent, block-backed,
  ext4/XFS, not NFS/SMB/FAT/exFAT/FUSE/network, no nested mount. Worker
  code does not detect filesystem type.

**Binding and composition.**

- `bindWorkerStateRoot(config, { host?, journalFileSystem? })` checks the
  policy, constructs
  `createAcceptanceJournal({ stateRoot: exact root, directorySync: selected })`,
  runs `prepare()` and verifies the managed directories.
- `runConfiguredCredentialOpeningOnce(config, deps)` binds the root, then
  delegates to the existing `runCredentialOpeningOnce`. It adds no provider
  work, no loop, no signal handling and no daemon.
- Every root or filesystem failure converges to the existing
  `STATE_ROOT_UNSUITABLE`. Configuration parse errors stay
  `WorkerConfigError`. The only log is the closed
  `{ stage: "STARTUP", outcome: "FAILED", code: "STATE_ROOT_UNSUITABLE" }`,
  never the path, and errors are tested for path leakage.

**Proven invariants.**

- **Before any lease:** every root failure causes **zero** lease requests.
  That covers an invalid path, a missing root, a non-directory, a link,
  the production OS, owner or mode, a hard-link failure and a required
  directory-fsync failure.
- **Reconciliation first:** with a retained record the calls are
  recovery then lease; a failed reconciliation gives recovery only, with
  no lease.
- **Same-root restart:** instance 1 writes a record; instance 2 binds the
  same root, sees it as FINAL and VALID, and reconciles it before leasing.
  R44B7 remains the full whole-chain crash and restart proof.
- **Nothing added:** no lock file; no principal, environment or deployment
  marker; no root schema file; no migration, old-root discovery or
  relocation. A missing root is refused and stays absent. One process,
  one principal and one environment per root, and the relocation
  prohibition, stay deployment contracts (`deployment/README.md`).
- **No fallback:** no `process.cwd()`, `os.tmpdir()`, `mkdtemp()`, home or
  `BUSYBOOKIE_MEDIA_ROOT` in worker production source, checked by the
  boundary test. Tests use temporary directories only as explicit
  fixtures.
- **No provider:** no provider import, Runway, Veo or Google client, SDK,
  network or credential, and no production caller. This is persistence and
  configuration work only.

**Test seams.** The optional `host` facts (platform, effective UID, lstat)
and `journalFileSystem` default to the real host and filesystem. They make
platform and filesystem policy deterministic in tests and do not weaken
production behaviour.

**Tests.**

| Suite | Result |
|---|---|
| `workerConfig.test.ts` | 27 tests |
| `workerStateRoot.test.ts` | 34 tests |
| `boundary.test.ts` | 74 tests (previously 65) |
| Worker unit | 608/608 across 15 files (previously 538/538 across 13) |
| Worker integration | 34/34 across 2 files (whole-chain 15/15, credential opening 19/19) |
| commercial-api DB | 558/558 across 19 files |
| Typecheck, `git diff --check` | clean |

No provider call.

Focused coverage includes:

- missing and invalid keys;
- the canonical production path and non-canonical production paths;
- relative, `./`, `..`, NUL and missing paths, and a regular file;
- a linked root, linked managed directories, and a link introduced during
  `prepare()`;
- ordinary managed directories;
- the exact configured root, with no rewriting;
- the production OS, a missing UID, the wrong owner, and each
  group/other permission bit;
- production owner-only success;
- the development sync policy;
- hard-link and directory-fsync failures;
- reconciliation ordering and the same-root restart.

**Deployment side and gate.**

- `deployment/README.md` needed no R44B8 change. It remains at sha
  `93d2b1fbe84de57195137c92adbc2bad71efeb6e9f122538a23ecc14efb7fdd2` (388
  lines), with `/var/lib/busybookie` containing `media/` and
  `commercial-worker/`.
- Both sides now exist:
  - **application:** production configuration requires
    `/var/lib/busybookie/commercial-worker` and binds the journal to that
    exact root;
  - **deployment:** the runbook reserves that path on the persistent,
    block-backed ext4/XFS-class `/var/lib/busybookie`.

  The application and deployment paths are concretely bound.
- **Gate criteria:** every R44B8A gate criterion is met:
  - explicit keys and no defaults;
  - an absolute, pre-existing root;
  - the production owner/mode check and the link checks;
  - production `REQUIRED` sync and exact journal construction;
  - reconciliation and root suitability before any lease;
  - the deployment binding and the same-filesystem runbook semantics;
  - passing tests and regressions;
  - provider flags NO and no provider call.

  Unrelated future obligations are not marked complete.

**Locked decision (R44B8A; implemented by R44B8).** The first R44B8A attempt was
blocked because `deployment/README.md` gave the persistent volume no mount
path. R44B8P0 published one, and this lock binds the worker to it. This lock
creates no configuration module, composition, process entry point, test or
runbook change. Nothing was implemented at lock time; R44B8 has since
implemented it (Status above).

**Definition.** The commercial-worker state root is the explicit persistent
filesystem directory beneath which commercial-worker-owned durable local
state is stored.

- It currently contains **only** `acceptance-journal/` (layout above), plus
  transient `acceptance-journal/.link-probe-*` artifacts that `prepare()`
  removes. No other production worker artifact exists there.
- Future worker persistent state defaults to subdirectories of this root
  unless a later slice assigns it elsewhere.
- Provider media and output storage stays separate and deferred
  (section 28).

**Retained contents.**

- Published records, temporaries and quarantined artifacts hold
  operational identifiers only. They never hold the worker credential, a
  lease token, a provider credential or any plaintext secret.
- `SUBMITTED` records stay until terminal recovery cleanup.
- Quarantined artifacts stay until an operator acts.

**Configuration.**

- `COMMERCIAL_WORKER_STATE_ROOT` is the only state-root key. It is
  mandatory, explicit and string-valued, supplied through an injected
  configuration or environment object, and never derived.
- There is no fallback to `process.cwd()`, `os.tmpdir()`, `mkdtemp()`, the
  repository, the home directory or `BUSYBOOKIE_MEDIA_ROOT`.
- Its private/staging production value is
  `/var/lib/busybookie/commercial-worker`.
- `COMMERCIAL_WORKER_ENV` takes exactly `development` or `production` and
  is required explicitly on the production-capable startup composition.
  It is **never** defaulted, because durability must never weaken over a
  forgotten key. That is deliberately stricter than the commercial-api
  default.
- The root is required in **both** modes on that composition. Tests may
  still inject temporary roots at lower-level seams. There is no default
  and no temp or `cwd` fallback.
- Configuration follows the commercial-api convention: handwritten
  validation, an injected environment object and closed, deterministic
  errors. No Zod, no parallel framework, and no `process.env` reads in
  ordinary worker source. With no process entry point, **zero** worker
  production modules read `process.env`.

**Application binding.** R44B8 creates **no** daemon or process entry point;
the package stays "never started by default", and a later execution slice
owns the runner. R44B8 provides a production-capable library composition
that runs:

```text
configuration -> state-root validation -> createAcceptanceJournal(exact root)
-> directory-sync policy selection -> startup journal reconciliation
-> runCredentialOpeningOnce
```

It contains no provider execution. The composition resolves the root once
and the journal keeps it for the life of the process: no reload and no
mutation.

**Path rules.**

- **Absolute.** Empty, NUL, relative and `..`-segment roots are rejected,
  under the existing journal validation.
- **Pre-existing directory.** The worker never creates the root; the
  operator provisions it. The journal creates only `acceptance-journal/`,
  `v1/` and `quarantine/` beneath it.
- **Used exactly.** No `realpath` rewriting of the operator's mount path
  and no `cwd`-relative resolution.
- **Symlinks.** For production-shaped startup, neither the root nor
  `acceptance-journal`, `v1` or `quarantine` may be a symbolic link, checked
  with lstat-equivalent validation. On Windows development, obvious
  reparse-point redirection is rejected where Node exposes it consistently.
  This is configuration safety on a trusted, single-writer host, not a
  race-proof defence against a hostile filesystem.

**Production policy** (`COMMERCIAL_WORKER_ENV=production`, Linux):

- the root is owned by the effective worker UID with no group or other
  access, that is `uid == euid` and `(mode & 0o077) == 0`; Unix ownership is
  not required in Windows development;
- managed directories stay `0700` and files `0600`;
- `directorySync` is `REQUIRED` and never silently downgraded;
- Windows development may use `DEVELOPMENT_BEST_EFFORT`, and Linux or Unix
  development should use `REQUIRED` where supported.

**Filesystem.**

- **Required:** a local, block-backed ext4/XFS-class persistent filesystem
  with exclusive create, hard links, file fsync, directory fsync,
  chmod/owner-only semantics and durable metadata.
- **Prohibited:** NFS, SMB and other network filesystems; FAT and exFAT;
  object-store or unverified FUSE; ephemeral container or image
  filesystems.
- **Who checks what:** the application's `prepare()` probes remain
  authoritative for link and fsync capability. The deployment smoke gate
  validates the filesystem class.
- **One filesystem:** the whole tree under
  `/var/lib/busybookie/commercial-worker` (`acceptance-journal`, `v1`,
  `quarantine`) stays on the same filesystem as `/var/lib/busybookie`. No
  submount may split the temporary, final or quarantine paths, because
  publication and quarantine use hard links.

**Cardinality and identity.**

- **One process per root.** No filesystem locking is added.
- **One principal per root.** The control plane's fail-closed principal
  check is a secondary safety net, not the deployment mechanism.
- **One environment per root.** Development, staging and production never
  share a root, and test roots stay isolated temporary fixtures.
- No root identity marker (principal, environment or deployment) and no
  root-level schema file. The journal already has `acceptance-journal/v1/`
  and versioned records, and control-plane reconciliation already fails
  closed on misbound records. A marker remains optional future hardening.

**Persistence and relocation.**

- The same logical worker (same principal and environment) receives the
  same root across service restart, host reboot, binary replacement and
  redeploy. On the private/staging host,
  `/var/lib/busybookie/commercial-worker` persists independently of the
  deployed release.
- Changing `COMMERCIAL_WORKER_STATE_ROOT` while retained state exists
  (final records, temporaries, quarantine) is forbidden unless an explicit
  operator-managed migration has been completed. There is no automatic
  migration, no old-root discovery, and never a fresh empty root on an
  ordinary redeploy.

**Startup order.**

1. Parse the configuration.
2. Validate `COMMERCIAL_WORKER_ENV`.
3. Validate `COMMERCIAL_WORKER_STATE_ROOT`.
4. Validate the production root policy.
5. Construct the acceptance journal.
6. `prepare()` and probe the root.
7. Scan and reconcile the startup journal.
8. Require reconciliation to be CLEAR.
9. Only then acquire a lease.
10. Credential grant and opening.
11. Later, provider execution.

**Fail-closed startup.** Each of these fails **before** any lease, through
the existing taxonomy where possible:

- a missing state-root key;
- a missing or invalid environment;
- a relative or nonexistent root, or a root that is not a directory;
- a symlinked root or managed directory;
- a production owner mismatch or group/other access;
- permission denied, a read-only root or an I/O error;
- a failed hard-link probe or required directory fsync.

**Runtime and operations.**

- **Runtime root loss:** no background monitor. The per-attempt
  `prepare()` before `SUBMITTING`, publication before durable acceptance,
  and host-fault on publication failure remain sufficient.
- **Disk space:** minimum free space is operational hardening, not this
  gate; a full disk is an I/O failure and fails closed.
- **Backup:** not a gate requirement. Restart and redeploy persistence is;
  disaster recovery is separate.
- **Encryption at rest:** application-level journal encryption is not
  required, because no secret is persisted. Platform disk encryption is
  operational hardening. Owner-only production access is required.
- **Logging:** the state-root path is never logged (section 29). A closed
  status such as "commercial worker persistent state root ready" is
  acceptable; no absolute path appears in application logs.

**Deployment binding.** Both halves are required; neither alone satisfies
the gate.

- **Application:** `COMMERCIAL_WORKER_STATE_ROOT=/var/lib/busybookie/commercial-worker`
  constructs the acceptance journal.
- **Deployment:** that directory is pre-provisioned on the persistent,
  block-backed `/var/lib/busybookie` mount.

The published private/staging runbook (`deployment/README.md`, R44B8P0) is
authoritative, and no other deployment target is invented:

```text
/var/lib/busybookie/            persistent-volume mount
|-- media/                      BUSYBOOKIE_MEDIA_ROOT
`-- commercial-worker/          COMMERCIAL_WORKER_STATE_ROOT
    `-- acceptance-journal/
        |-- v1/
        `-- quarantine/
```

The worker root is a dedicated sibling of `media/`, outside the media root
and outside every Git or release tree, on the same persistent filesystem.
The runbook already records:

- persistent block-backed local ext4/XFS storage that is not
  NFS/SMB/FAT/exFAT/FUSE;
- data and release separation, and sibling media and worker roots;
- the same-filesystem rule;
- one worker process and environment separation;
- pre-provisioning and an owner-only worker root;
- redeploy persistence and the relocation warning;
- no claim of implementation.

**Smoke-gate evidence.** Implementation and deployment evidence must verify:

1. `/var/lib/busybookie` is the persistent mount;
2. its filesystem is ext4/XFS class;
3. `/var/lib/busybookie/commercial-worker` exists;
4. the worker root is owner-only;
5. the worker root is not a nested mount;
6. the journal tree is on the same filesystem;
7. the root is writable by the worker service user;
8. hard links work;
9. exactly one worker process owns the root;
10. the application configuration uses exactly that root.

`prepare()` stays the authoritative startup probe for link and fsync.

**No live host or entry point required.** Gate evidence may be the
production-capable library binding, tests, the published runbook and the
smoke-gate contract. Provider or process execution comes later.

**Local fake-provider root.** A later local fake-provider run must use a
development root that is:

- explicitly configured and absolute;
- stable across worker restarts;
- not tmp/temp, and not ephemeral container or image storage;
- not FAT/exFAT and not NFS/SMB/network storage;
- able to pass the hard-link probe.

Windows development may use `DEVELOPMENT_BEST_EFFORT`. A local development
root never replaces the production deployment binding.

**Independent items.** The live-route `SUBMITTED` capacity condition,
provider-failure composition, the create-retry adapter obligation and
section 24 are unchanged. The provider flags stay NO; closing this gate
does not enable provider execution.

**Expected implementation scope.**

- `apps/commercial-worker/src/workerConfig.ts`, plus the smallest
  production-library composition module for validated configuration →
  `createAcceptanceJournal` → `runCredentialOpeningOnce`, named per
  repository conventions;
- configuration tests, state-root startup and binding tests, and a
  boundary-test update;
- `deployment/README.md` only if configuration names or final smoke
  commands need reconciling.

No API, protocol, migration, provider adapter or provider network.

**Test contract.** Tests must show:

- A. a missing `COMMERCIAL_WORKER_STATE_ROOT` refuses;
- B. a missing `COMMERCIAL_WORKER_ENV` refuses;
- C. an invalid `COMMERCIAL_WORKER_ENV` refuses;
- D. an empty root refuses;
- E. a relative root refuses;
- F. a nonexistent root refuses;
- G. a non-directory root refuses;
- H. the exact configured path constructs the journal;
- I. no `cwd` fallback;
- J. no tmp fallback;
- K. production selects `REQUIRED`;
- L. Windows development may select `DEVELOPMENT_BEST_EFFORT`;
- M. a production owner mismatch refuses;
- N. production group or other permissions refuse;
- O. a symlinked root refuses;
- P. a symlinked managed directory refuses;
- Q. an unsuitable filesystem or failed link probe refuses before any
  lease;
- R. reconciliation precedes lease acquisition;
- S. a recreated process on the same root sees retained journal state;
- T. no worker production module reads `process.env`.

**Gate pass criteria.** Section 36 may remove the state-root item only when
all of these hold (a live host is not required):

1. `COMMERCIAL_WORKER_STATE_ROOT` and `COMMERCIAL_WORKER_ENV` are
   implemented and explicitly validated;
2. no root default or fallback;
3. the root is absolute and pre-existing;
4. the production owner check and owner-only mode check are implemented;
5. root and managed-directory symlinks are rejected;
6. production uses `REQUIRED` directory sync;
7. the exact configured root constructs the journal;
8. reconciliation runs before any lease, and an unsuitable root fails
   before any lease;
9. the one-process, one-principal and one-environment contracts and the
   relocation prohibition are documented;
10. the exact Linux path is locked, and the runbook binds it to the
    `/var/lib/busybookie` persistent volume;
11. the same-filesystem and ext4/XFS local-filesystem requirements and the
    smoke-gate evidence are documented;
12. the application and startup/root-binding tests pass, and existing
    worker and API regressions pass;
13. the provider flags stay NO and no provider call occurs.

```text
WORKER_STATE_ROOT_BINDING_IMPLEMENTED=YES
WORKER_STATE_ROOT_CONFIG_KEY=COMMERCIAL_WORKER_STATE_ROOT
WORKER_ENV_CONFIG_KEY=COMMERCIAL_WORKER_ENV
WORKER_STATE_ROOT_DEPLOYMENT_PATH=/var/lib/busybookie/commercial-worker
WORKER_PERSISTENT_VOLUME_MOUNT=/var/lib/busybookie
WORKER_STATE_ROOT_ALWAYS_REQUIRED=YES
WORKER_STATE_ROOT_DEFAULT_ALLOWED=NO
WORKER_STATE_ROOT_MUST_BE_ABSOLUTE=YES
WORKER_STATE_ROOT_MUST_PREEXIST=YES
WORKER_STATE_ROOT_REALPATH_CANONICALIZATION=NO
WORKER_STATE_ROOT_SYMLINK_ALLOWED=NO
WORKER_STATE_ROOT_PRODUCTION_OWNER_CHECK=YES
WORKER_STATE_ROOT_PRODUCTION_OWNER_ONLY=YES
WORKER_STATE_ROOT_PRODUCTION_DIRECTORY_SYNC=REQUIRED
WORKER_STATE_ROOT_NETWORK_FILESYSTEM_ALLOWED=NO
WORKER_STATE_ROOT_EPHEMERAL_FILESYSTEM_ALLOWED=NO
WORKER_STATE_ROOT_SINGLE_FILESYSTEM_REQUIRED=YES
WORKER_STATE_ROOT_SHARED_BY_MULTIPLE_PROCESSES=NO
WORKER_STATE_ROOT_ONE_PRINCIPAL_PER_ROOT=YES
WORKER_STATE_ROOT_CROSS_ENVIRONMENT_REUSE_ALLOWED=NO
WORKER_STATE_ROOT_RELOCATION_WITH_RETAINED_STATE_ALLOWED=NO
WORKER_STATE_ROOT_IDENTITY_MARKER_REQUIRED=NO
WORKER_STATE_ROOT_PROCESS_ENTRYPOINT_REQUIRED_FOR_GATE=NO
WORKER_STATE_ROOT_DEPLOYMENT_BINDING_REQUIRED=YES
WORKER_STATE_ROOT_LIVE_HOST_REQUIRED_FOR_GATE=NO
WORKER_STATE_ROOT_LOCAL_FAKE_PROVIDER_STABLE_ROOT_REQUIRED=YES
WORKER_STATE_ROOT_PATH_LOGGED=NO
WORKER_STATE_ROOT_ACCEPTANCE_JOURNAL_INCLUDED=YES
WORKER_STATE_ROOT_PROVIDER_OUTPUT_INCLUDED=NO
```

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
| Valid published final | Durable provider-acceptance evidence; the local scan reports it as `UNRESOLVED_ACCEPTANCE` unchanged. Do not overwrite or regenerate it. (Revised R44B6S1.) Startup then calls `acceptance-recovery` with its exact persisted identity (see "Startup reconciliation with acceptance recovery" below). An exact `SUBMITTED` acknowledgement reconciles it for this startup and retains it; an exact `SUCCEEDED`, `SUBMITTED_FAILED` or `ABANDONED` acknowledgement removes it under "Retention". A blocking failure or retry exhaustion retains it unchanged and prevents `CLEAR`. No lease is requested before `CLEAR`. |
| Valid complete temporary | Not yet published acceptance evidence. Complete publication through `publish(record)` using the exact existing record, preserving its original `recordedAt`, `recordSha256` and canonical bytes. Never regenerate it through `write(input)`. Remove the source temporary only after verifying the same exact final is published. The resulting final is then a valid published final (row above): unresolved, blocking fresh work until exactly acknowledged by acceptance recovery. |
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
final stays unresolved in the local scan and is offered to acceptance
recovery again (a retained `SUBMITTED` record is replayed idempotently); a
valid temporary may become the same exact final;
an invalid temporary is quarantined once without repeated evidence
mutation; a corrupt final stays fail-closed. Startup manufactures no
duplicate acceptance records and introduces no garbage collection: the only
removal of a valid final is the exact terminal acknowledgement described
under "Retention" (R44B6S).

**CLEAR gate.** Only `CLEAR` permits lease acquisition. The other local
results are `UNRESOLVED_ACCEPTANCE`, `CORRUPT` and `CONFLICT`.
`UNRESOLVED_ACCEPTANCE` proceeds to acceptance recovery and becomes `CLEAR`
only when every unresolved valid record of the pass has an exact
acknowledgement (R44B6S). Until then, and for `CORRUPT` or `CONFLICT`:

```text
NEW_WORK_ALLOWED=NO
LEASE_REQUESTS=0
CREDENTIAL_GRANT_REQUESTS=0
CREDENTIAL_OPENS=0
PROVIDER_CALLS=0
```

Startup refusal uses closed worker codes: `STATE_ROOT_UNSUITABLE`,
`ACCEPTANCE_RECONCILIATION_FAILED` for unresolved acceptance (definitive
recovery refusal or retry exhaustion), `ACCEPTANCE_JOURNAL_CORRUPT` and
`ACCEPTANCE_JOURNAL_CONFLICT` (also for a terminal removal whose final
drifted or failed). A recovery authentication rejection or malformed control
response keeps its existing `WORKER_AUTHENTICATION_REJECTED` or
`MALFORMED_CONTROL_RESPONSE` code; no new code exists. Logs use safe
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

### Startup reconciliation with acceptance recovery

**Boundary (revised R44B6S1).** The local phase above (R44B6Q) still runs
first and alone decides `CORRUPT` and `CONFLICT`; it never calls the
control plane. R44B6S implements the worker acceptance-recovery client and
the startup call to the control-plane route (R44B6R, section 18) for the
valid published records the local phase leaves unresolved. Recovery never
creates a lease or a recovery lease, never sends a live lease token, and
never calls a provider. The worker transitions nothing itself: only the
control plane may move `OUTCOME_UNKNOWN -> SUBMITTED`.

**Locked decision (revision R44B6K; implemented R44B6S).** Startup extends
the local checks as follows, still before requesting any lease:

1. validates the state root (absolute, local, link-capable, owner-only, and
   directory-fsync-capable in production). R44B8A locks the configuration,
   existence, symlink, production owner/mode and `REQUIRED` sync checks
   that precede this ("State-root binding" above), implemented by R44B8 in
   `bindWorkerStateRoot`, which runs before `runCredentialOpeningOnce`;
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

**Implementation (R44B6S; recorded by R44B6S1).** After a clean local scan,
the unresolved valid records are processed one at a time in lexical
attempt-ID order. Each receives its own fresh bounded budget under the
retry policy below, and every request reuses exactly that record's persisted
`executionAttemptId`, `fencingCounter` and `providerExecutionId`; the
request body is exactly `{fencingCounter, providerExecutionId}`.
`recordedAt` and `recordSha256` are never regenerated and `write()` is never
used. Outcomes:

- exact `SUBMITTED` acknowledgement: reconciled for this startup pass and
  retained unchanged, so a later startup offers it again and the route
  replays it idempotently;
- exact `SUCCEEDED`, `SUBMITTED_FAILED` or `ABANDONED` acknowledgement:
  reconciled, then removed under "Retention" — the final is re-read and must
  still be byte-identical to the reconciled record, then it is unlinked and
  the directory is synced under the journal's directory-sync policy. Drift
  is `ACCEPTANCE_JOURNAL_CONFLICT`; a missing, corrupt or unremovable final
  is `ACCEPTANCE_JOURNAL_CORRUPT`;
- `ATTEMPT_STILL_SUBMITTING`, transport failure or HTTP 5xx: retried within
  that record's budget; never an acknowledgement;
- definitive refusal (`409 LEASE_REJECTED`), authentication rejection,
  malformed or unexpected response, or budget exhaustion: fail closed at
  that record, which is retained intact (no delete, no quarantine); later
  records are not processed and startup does not become `CLEAR`.

`leaseNextAttempt` is called only after every unresolved record of the pass
has an exact acknowledgement and startup is `CLEAR`.

### Startup acceptance-recovery retry policy (revision R44B6S0)

**Locked decision (R44B6S0; implemented R44B6S).** This is the policy the
worker acceptance-recovery client and startup calls implement. Section 37
records the authoritative numeric and classification flags.

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
fail-closed exhaustion with evidence retained. R44B6S implements these tests
on injected time, including request durations and a request that hangs
through the remaining budget.

**In-flight bound (R44B6S).** Each request is bounded by the remaining
per-record budget, measured on the same injected monotonic clock and waited
through the same injected sleep. If that bound is reached first, the request
is aborted (a transport failure, `CONTROL_API_UNAVAILABLE`) and the record
is exhausted at once: no budget remains, so no second request can overlap
it. This bound limits only how long startup asks; it never declares a
control-plane lease expired.

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

(R44B6Y0.) Steps 2 to 5 belong to the inner durable handler, which resolves
by returning the exact durable record. Step 6 belongs to the outer
acceptance adapter. The provider callback is the outer adapter, so the
callback itself resolves only after step 6 has reached an allowed result or
failed closed ("Acceptance handler and adapter" below).

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
  reaches the same state. (R44B6Y0.) A journal publication conflict is
  reported as `ACCEPTANCE_JOURNAL_WRITE_FAILED`; the report is best effort
  under the policy in "Acceptance handler and adapter" below;
- the worker does **not** report `SUBMITTED`, because `SUBMITTED` requires
  durable local evidence. The in-memory ID is not sent upstream in v1;
- the worker treats a journal-write failure as a host fault. It halts new
  submission work until its state root passes the startup checks again.
  (R44B6Y0.) The halt is the sticky process-lifetime host-fault latch below:
  a new process with clean startup reconciliation is the only way back to
  new work;
- the attempt is never retried automatically.

### Acceptance handler and adapter (revision R44B6Y0)

**Status (R44B6Y; recorded by R44B6Y1).** Implemented in commit
2e5446ce9832123a4e40ab2048d03e4d182bda5c, in `apps/commercial-worker`
only. There is no engine, provider, commercial-api, protocol, migration,
manifest or lockfile change, and no provider is invoked. The contract below
is unchanged.

**R44B9 reconciliation (R44B9B).** Since R44B9 (commit
e57d2b77af6f61d8548e39c84f4741874806ea8f):

- the development-only fake-provider composer is the only production
  caller of `createAcceptanceAdapter`, and holds the host-fault latch;
- the adapter's best-effort failure report goes through the shared
  `failureReportPolicy.ts` (`reportSubmissionFailureWithPolicy`), the only
  caller of `client.reportSubmissionFailed`. The exported
  `ACCEPTANCE_FAILURE_REPORT_*` names keep identical values, and the
  adapter's behaviour is unchanged;
- the composer tracks the callback locally (`NONE`, `INVOKED`, `COMPLETED`,
  `REJECTED`) only to check the provider operation's contract; the adapter
  and journal stay the durable authority, and a callback rejection rethrows
  the adapter's own error with no second report.

Statements below that the adapter is unused, or that no provider path calls
it, describe the state before R44B9. No real-provider or live path calls it,
so `WORKER_ACCEPTANCE_HANDLER_USED_BY_LIVE_EXECUTION=NO` is unchanged. The
one-attempt composer starts no further attempt; a future multi-attempt
runner must still consult the latch before starting another provider
attempt.

- **Inner durable handler.** `createDurableAcceptanceHandler` accepts the
  worker-local `{provider, providerExecutionId}` shape.
  - Provider equality is exact.
  - The ID is checked by the existing commercial `isProviderExecutionId`
    validator, with no trim, case change or other normalisation.
  - Ownership is claimed by a synchronous flag before the first await. A
    repeated or concurrent invocation fails closed, trips the latch, creates
    no second record and sends no lifecycle report of any kind, including no
    `submission-failed`; the first invocation stays authoritative.
    Concurrency is covered by tests.
  - The record is built once with `buildAcceptanceRecord`, and
    `journal.publish(record)` is called once. `journal.prepare()` is not
    repeated. The exact durable record is returned.
  - It makes no control-plane request.
- **Outer adapter.** `createAcceptanceAdapter` runs:

  ```text
  inner durable handler
  -> durable record
  -> bounded live reportSubmitted
  -> acceptance-recovery fallback when allowed
  -> resolve only after authoritative reconciliation; otherwise reject closed
  ```

  It is **unused** by live execution. No provider path,
  `credentialOpeningRun`, the pre-provider orchestration or startup
  reconciliation calls it, and no provider polling is wired to it. Tests
  prove it stays pending while journal publication, the live `submitted`
  report or acceptance recovery is pending. That meets the polling-barrier
  contract at component level; it is not connected to a provider runner.
- **Failure before durable acceptance.** Every such case trips the latch,
  sends no `SUBMITTED` report and makes no provider call. The upstream
  classification is:

  | Cause | Failure code |
  |---|---|
  | provider or ID validation failure | `PROVIDER_EXECUTION_ID_INVALID` |
  | journal write failure | `ACCEPTANCE_JOURNAL_WRITE_FAILED` |
  | journal conflict | `ACCEPTANCE_JOURNAL_WRITE_FAILED` |

  For a conflict, the local error stays `ACCEPTANCE_JOURNAL_CONFLICT`. The
  adapter-owned report policy is implemented: at most two attempts, retrying
  only `CONTROL_API_UNAVAILABLE`, a 10000 ms deadline and a fresh
  `AbortController` per attempt, no backoff or jitter, and the same frozen
  proof and report. Once the record is durable, `submission-failed` is
  never used for that acceptance.
- **Live `submitted`.** The locked policy is implemented: at most two
  attempts, retrying only `CONTROL_API_UNAVAILABLE`, a 10000 ms deadline and
  a fresh controller per attempt, the same proof and provider execution ID,
  no backoff, no jitter and no local lease clock.
  - `SUBMITTED_REPORT_REJECTED`: no second live attempt; the exact durable
    record goes to acceptance recovery. A 409 is never read as lease expiry.
  - Two `CONTROL_API_UNAVAILABLE` results: the record goes to acceptance
    recovery.
  - `WORKER_AUTHENTICATION_REJECTED`, `MALFORMED_CONTROL_RESPONSE`,
    `SUBMITTED_REPORT_INVALID` and any unexpected error fail closed without
    handover: the record is kept, the latch is tripped and the adapter
    rejects. There is no `submission-failed`, no resubmission and no
    recovery fallback to mask the fault. Startup reconciliation may process
    the record later.
- **Shared recovery step.** `startupJournalReconciliation.ts` now exports
  `recoverAcceptanceRecord`, the existing per-record startup step
  (`runAcceptanceRecoveryWithRetry` plus the terminal-retention rule),
  extracted unchanged. The live fallback and startup both call it. It is
  not a new algorithm or a second acceptance path, and startup behaviour is
  otherwise unchanged. The section 17 policy values are unchanged, and
  `ATTEMPT_STILL_SUBMITTING` stays owned by it; no local lease arithmetic
  was added.
- **Retention.** Tests, including tests on the real on-disk journal,
  confirm:
  - neither a live nor a recovered `SUBMITTED` deletes the record;
  - a terminal recovery removes it only under the existing rule.
- **`submission-failed` client.** `reportSubmissionFailed` uses the
  existing route, body and four-field response exactly. It sends one
  request per call and accepts an optional external `AbortSignal`, with no
  timer, retry or lease-expiry authority.

  | Response | Worker code |
  |---|---|
  | 409 | `SUBMISSION_FAILED_REJECTED` |
  | 401 or 403 | `WORKER_AUTHENTICATION_REJECTED` |
  | transport failure, abort or 5xx | `CONTROL_API_UNAVAILABLE` |
  | malformed or any other response | `MALFORMED_CONTROL_RESPONSE` |

  `reportSubmitted` gained an optional external `AbortSignal` and still owns
  no retry and no timer.
- **Host-fault latch.** `createHostFaultLatch()` is dependency-injected,
  with no module-global state.
  - It starts clear; a trip is one-way and sticky for the process lifetime.
  - It has no reset or clear method and stores no reason.
  - Live new-work enforcement is **not wired**, because provider execution
    is disabled: no production worker loop consults it yet.
- **Worker error vocabulary.** New worker-local codes:
  - `SUBMISSION_FAILED_REJECTED`;
  - `PROVIDER_ACCEPTANCE_INVALID`;
  - `ACCEPTANCE_JOURNAL_WRITE_FAILED` (worker-local; the same name is also
    an existing control-plane failure code).

  The existing `ACCEPTANCE_JOURNAL_CONFLICT` keeps local diagnosis. No API
  or protocol vocabulary changed.
- **Secrets and boundary.** The secret rules are unchanged:
  - the lease token stays in memory and never enters a record, error or the
    latch;
  - error messages are fixed and expose neither the token nor the provider
    ID;
  - no credential is persisted, and the provider ID is not moved into audit
    metadata.

  The boundary tests prove:
  - no `src/execution`, `SingleShotSubmissionAcceptedHandler`,
    `GoogleGenAiSubmissionAcceptedHandler`, SDK or provider dependency;
  - no provider port, factory or selector;
  - no fake or real provider.

**Locked decision (R44B6Y0; implemented by R44B6Y).** R44B6Y discovery found six
decisions unresolved: the adapter shape, where `SUBMITTED` is reported, the
source of `submittingAt`, the live `submitted` retry policy, the missing
`submission-failed` client and host-fault halt, and the lease-liveness
signal. This lock resolves them. It changes no route, protocol, migration,
engine module or provider adapter, and implements nothing.

**Two worker-local layers.**

- **Inner durable acceptance handler.** It accepts the minimal acceptance,
  enforces single use, validates the provider and the provider execution
  ID, builds the record exactly once, publishes that exact record durably
  and returns it to its caller. It never calls a provider, owns no provider
  SDK, never reports `SUBMITTED`, never polls, never deletes the record and
  imports no engine execution code.
- **Outer acceptance adapter.** It is the future callback supplied to
  provider execution. It calls the inner handler, waits until the record is
  durable, performs the live `submitted` report, hands the exact durable
  record to acceptance recovery when needed, and resolves only after
  post-acceptance reconciliation reaches an allowed result. Otherwise it
  fails closed. It does **not** resolve merely because the inner handler
  returned.

**Worker-local acceptance shape.** The worker defines its own minimal
acceptance value, conceptually `{provider, providerExecutionId}`. It imports
nothing from `src/execution`: not `SingleShotSubmissionAcceptedHandler`,
not `GoogleGenAiSubmissionAcceptedHandler` and no provider-specific engine
acceptance type. The worker boundary test continues to forbid those
imports. The shape carries no `recoveryMetadata`,
`providerEstimatedCredits`, polling data, provider response or SDK object.
It is acceptance data, not a provider abstraction or port. Future provider
composition may adapt its provider callback to it structurally; R44B6Y does
not do that wiring.

**Validation before publication.**

- The provider equals the attempt and lease provider.
- The ID passes the existing commercial `isProviderExecutionId` rule.
- The ID is used exactly as received: no trim, no case change, no
  normalisation.
- The engine orchestrator's handler trims IDs and is not reusable by the
  commercial worker.

**Single use.**

- One handler instance accepts at most one invocation. The first invocation
  owns the acceptance lifecycle, and is marked as owner synchronously on
  entry, so two concurrent invocations can never produce two records or two
  `SUBMITTED` reports.
- A second invocation fails closed and trips the host-fault latch. It never
  causes a provider call, creates no record, issues no control-plane request
  and never competes with the first invocation's lifecycle transition.
- The first invocation's outcome stays authoritative. The
  `PROVIDER_EXECUTION_ID_INVALID` classification applies only to the
  owning invocation's own validation failure. A repeated callback never
  causes `submission-failed`, in particular after an exact durable record
  exists.

**Record construction.**

- The record is built once from the acceptance with `buildAcceptanceRecord`
  (or its exact existing equivalent) and published durably as that exact
  record. The 13-member schema and the R44B6P1 exact-record, canonical-byte
  and idempotency rules are unchanged.
- `recordedAt` never changes because of a retry. Any republication of the
  same acceptance uses `publish(theSameExactRecord)`, never a new build or
  `write`.
- R44B6P1 authorises no automatic in-handler publication retry, so the
  handler performs one publication. Its failure is a journal persistence
  failure (above).

Field sources:

| Member | Source |
|---|---|
| `executionJobId`, `attemptNumber`, `provider`, `generationRequestSha256` | the immutable lease and job execution context |
| `accountId` | the credential grant's opening context |
| `fencingCounter` | the pre-provider permit (the `SUBMITTING` epoch) |
| `submittingAt` | the pre-provider permit, copied from the exact validated `SUBMITTING` acknowledgement |
| `providerExecutionId` | the validated acceptance |
| `providerAcceptedAt`, `recordedAt` | worker timestamps, under the existing journal semantics |

The lease token, machine credential, provider API key and opened credential
are never persisted. `providerAcceptedAt` and `recordedAt` are never
lease-liveness or fencing authority, never proof of a control-plane commit,
and never decide whether to call `submitted` or acceptance recovery. Tests
may inject a clock under existing worker conventions.

**Journal-first barrier.** No `SUBMITTED` request is ever sent before the
exact record is durably published:

```text
provider returns definitive acceptance
-> outer adapter receives the minimal acceptance
-> inner handler validates it
-> inner handler builds the exact record once
-> inner handler durably publishes the exact record
-> inner handler returns the durable record
-> outer adapter attempts SUBMITTED reconciliation
-> outer adapter resolves only after an allowed authoritative result
```

Reporting `SUBMITTED` first and journaling afterwards is never allowed. The
durable journal is the crash boundary.

**Failure before durable acceptance.**

- If the first invocation cannot establish a valid durable record, the
  worker fails closed and trips the host-fault latch. Causes: provider
  mismatch, invalid ID, journal persistence failure, or a journal integrity
  or publication conflict.
- The worker then makes a best-effort report through the existing
  `submission-failed` contract, always with outcome `OUTCOME_UNKNOWN`:

  | Cause | Failure code |
  |---|---|
  | Provider or ID validation failure | `PROVIDER_EXECUTION_ID_INVALID` |
  | Journal persistence failure | `ACCEPTANCE_JOURNAL_WRITE_FAILED` |
  | Journal publication conflict | `ACCEPTANCE_JOURNAL_WRITE_FAILED` |

- For a conflict, the local `WorkerError` may keep `ACCEPTANCE_JOURNAL_CONFLICT`
  for diagnosis. No new API or protocol failure code is added.
- Policy for the report:
  - at most two attempts, both immediate;
  - only `CONTROL_API_UNAVAILABLE` earns the second;
  - each attempt has a 10000 ms deadline and a fresh adapter-owned
    `AbortController`;
  - no backoff and no jitter;
  - the same immutable report and lease proof on both attempts.
- `SUBMISSION_FAILED_REJECTED`, `WORKER_AUTHENTICATION_REJECTED`,
  `MALFORMED_CONTROL_RESPONSE` and every other non-unavailable error are
  never retried.
- If the report cannot be established, the latch stays tripped and the
  adapter throws. No new provider work starts and no durable record is
  fabricated. The authoritative `SUBMITTING` expiry sweep (section 12)
  provides eventual lifecycle recovery.

**`submission-failed` boundary.** `submission-failed` applies only before
an exact durable acceptance record has been committed. Once that record
exists, `submission-failed` is **never** called for that acceptance.
Ambiguity after that point is reconciled only through `submitted` or
acceptance recovery. Definitive provider rejection before any acceptance
stays with the existing `submission-failed` contract, outside this path.

**Worker `submission-failed` client.** A primitive that was missing at
R44B6Y0 and is now implemented by R44B6Y (Status above), conceptually
`reportSubmissionFailed(executionAttemptId, proof, outcome, failureCode,
signal?)` on the existing `WorkerControlClient`:

- It uses the existing route, body and four-field response exactly.
- It is provider-agnostic and single-shot.
- It owns no retry and no request timer. It accepts an optional
  externally owned `AbortSignal`.
- It makes no lease-expiry decision and no provider call.

Status mapping:

| Response | Worker code |
|---|---|
| 409 | the new code `SUBMISSION_FAILED_REJECTED` |
| 401 or 403 | `WORKER_AUTHENTICATION_REJECTED` |
| transport failure, abort or 5xx | `CONTROL_API_UNAVAILABLE` |
| any other status, or a malformed response | `MALFORMED_CONTROL_RESPONSE` |

No commercial-api or protocol change is required.

**Host-fault latch.** A sticky worker-local primitive.

- It starts clear. It can be tripped, and once tripped it stays tripped for
  the life of the process. There is no ordinary runtime clear or reset.
- Future new-work orchestration must check it before beginning any
  provider work.
- The next clear state is a new process after successful startup
  reconciliation.
- It stores no secret.
- It is tripped by:
  - an invalid or duplicate provider acceptance;
  - a journal write failure or conflict;
  - unresolved `SUBMITTED` reconciliation;
  - an impossible or malformed control-plane response on the
    post-acceptance path.
- It is **not** tripped by an ambiguity that the acceptance-recovery policy
  resolves successfully.

R44B6Y may implement and test the latch without a production leasing loop.
Live new-work enforcement is not active, because live provider execution
itself is disabled. Nothing claims that production execution is halted by
a component with no production caller. Future live composition must
consult the shared latch before starting another provider attempt.

**Live `submitted` report.** Once the durable record exists, the outer
adapter uses the existing `reportSubmitted` client:

- at most two attempts, both immediate;
- only `CONTROL_API_UNAVAILABLE` earns the second;
- each attempt has a 10000 ms deadline and a fresh adapter-owned
  `AbortController`;
- no backoff, no jitter and no local lease clock;
- both attempts use the same `executionAttemptId`, the same submitting
  epoch and lease proof, and the same `providerExecutionId`.

`reportSubmitted` may gain an optional externally owned `AbortSignal` for
this, with no other behaviour change. An exact validated success ends the
live phase, and the record is **kept**.

**Handover to acceptance recovery.**

- If `reportSubmitted` returns `SUBMITTED_REPORT_REJECTED`, the live route
  has failed to establish success. A 409 is **not** taken as proof that the
  lease expired.
- If both live attempts end in `CONTROL_API_UNAVAILABLE`, the first report
  may still have committed with its response lost.
- In both cases the adapter hands the already-durable exact record to the
  existing `runAcceptanceRecoveryWithRetry` policy. That control-plane
  recovery, not the worker clock, determines the authoritative state. The
  provider is never submitted again.

The live fallback reuses that policy unchanged, as locked in section 17:

- 18 attempts and 150000 ms elapsed at most, the first attempt immediate;
- backoff starting at 1000 ms, doubling, capped at 10000 ms, with no
  jitter;
- request duration counted in the elapsed budget;
- every existing response classification.

No second recovery algorithm exists. `ATTEMPT_STILL_SUBMITTING` is waited
on only by that policy. There is no additional live wait budget, no local
expiry arithmetic, no new lease and no resubmission.

**Errors that do not enter recovery.** `WORKER_AUTHENTICATION_REJECTED`,
`MALFORMED_CONTROL_RESPONSE` and `SUBMITTED_REPORT_INVALID` from the live
report are never read as lease expiry. They are never converted into a
recovery loop that would hide the fault. Instead:

- the durable record is kept;
- the host-fault latch is tripped;
- the adapter fails closed;
- the provider is never resubmitted;
- startup reconciliation may process the record once the host issue is
  corrected.

**Lease-liveness authority.** The adapter never decides "lease live" or
"lease expired" from `Date.now()`, `performance.now()`, a `leaseExpiresAt`
comparison or a deadline derived from lease expiry. It always tries
`reportSubmitted` under the existing proof first. No heartbeat or
lease-status probe is used to choose between `reportSubmitted` and
`recoverAcceptance`.

**Recovery results.** Existing acceptance-recovery semantics are preserved:

- Exact `SUBMITTED`: reconciliation succeeds and the record is kept.
- A terminal state under the existing policy: the existing terminal
  record-removal semantics apply, with no resubmission.
- Exhausted or unresolved: the record is kept, the latch is tripped and the
  adapter fails closed. That process starts no new provider work.

No second terminal-state policy exists.

**Retention.** A successful `SUBMITTED` acknowledgement never deletes the
record. Section 17's v1 retention is unchanged: deletion happens only under
the existing terminal-state rules (`SUCCEEDED`, `SUBMITTED_FAILED` or
`ABANDONED` with the same ID). "Authoritative acknowledgement" never means
permission to delete a merely `SUBMITTED` record.

**Live and startup paths.** Live acceptance and startup recovery do **not**
share an entry point:

```text
live:    provider acceptance -> inner durable handler -> live reportSubmitted
         -> acceptance-recovery fallback if needed
startup: existing durable record -> acceptance recovery
```

They share:

- the exact record format;
- the attempt, fence and provider-ID identity;
- the `runAcceptanceRecoveryWithRetry` policy.

Startup recovery never re-validates a provider response, never calls the
inner handler and never creates a second record. The bridge between live
and recovery execution is the canonical durable record, not a shared
provider callback.

**Provider-polling barrier.** Future provider execution must await the
outer adapter. Its callback resolves only on one of:

- an exact live `SUBMITTED` acknowledgement;
- an allowed successful acceptance-recovery reconciliation;
- a closed failure, by throwing.

So provider polling can never begin between journal durability and
control-plane reconciliation. R44B6Y does not wire this into any provider.

**In-flight heartbeat boundary.** This lock does not define the in-flight
heartbeat policy. R44B6Z0 locks it separately (section 15, "In-flight
provider heartbeat"), and R44B6Z implements its keeper, unused by live
execution. That keeper wraps the provider-submission operation,
including this adapter's awaited reconciliation.

- A heartbeat failure never abandons a create already in flight.
- An acceptance that arrives after lease authority has lapsed is still
  journaled, then follows the same `submitted` and recovery policy.
- The adapter never cancels a known-accepted provider operation, never
  calls `submission-failed` after durable acceptance and never resubmits.

**`prepare()`.** R44B6V's orchestration already runs `journal.prepare()`
before `SUBMITTING`. Acceptance handling never runs it again for the same
attempt. It operates only once a valid permit exists, which is evidence
that the `prepare()`, `SUBMITTING` and heartbeat gates completed. Startup
reconciliation keeps its own preparation unchanged.

**Secrets.** Neither the record nor the latch contains:

- the lease token or its hash;
- the provider API key or opened credential;
- the machine credential.

The lease token stays in memory only for the live `reportSubmitted` and
`submission-failed` requests. It is never logged or persisted. The provider
execution ID stays out of audit metadata as section 30 requires.

**No provider abstraction.** R44B6Y adds no `ProviderPort`, provider factory
or selector, SDK wrapper, Runway, Veo or Google dependency, or fake or real
provider. The worker-local acceptance shape and the async adapter callback
are not a provider abstraction.

**Boundary and expected scope.** No change to:

- commercial-api;
- the protocol package;
- migrations;
- provider adapters.

The existing `submitted`, `acceptance-recovery` and `submission-failed`
routes are authoritative and sufficient. If implementation discovery proves
otherwise, it stops.

Expected R44B6Y scope, all in `apps/commercial-worker`:

- **New:**
  - the acceptance handler and adapter source;
  - the host-fault latch source, if kept separate;
  - focused handler and adapter tests.
- **Modified:**
  - `preProviderOrchestration.ts`, to propagate `submittingAt`;
  - `workerControlClient.ts`, for the `submission-failed` client and the
    optional `reportSubmitted` signal;
  - `workerError.ts`, for `SUBMISSION_FAILED_REJECTED` and only genuinely
    required worker-local codes;
  - `boundary.test.ts`, the pre-provider orchestration tests and existing
    client tests as necessary.

The architecture is not edited during implementation. No production caller
is required, and the component may stay unused by live execution.

```text
WORKER_ACCEPTANCE_HANDLER_IMPLEMENTED=YES
WORKER_ACCEPTANCE_HANDLER_USED_BY_LIVE_EXECUTION=NO
ACCEPTANCE_HANDLER_ENGINE_IMPORTS_ALLOWED=NO
ACCEPTANCE_HANDLER_NORMALIZES_PROVIDER_EXECUTION_ID=NO
ACCEPTANCE_HANDLER_JOURNAL_BEFORE_SUBMITTED=YES
ACCEPTANCE_HANDLER_SINGLE_USE=YES
ACCEPTANCE_HANDLER_DELETES_RECORD_ON_SUBMITTED_ACK=NO
PRE_PROVIDER_PERMIT_INCLUDES_SUBMITTING_AT=YES
LIVE_SUBMITTED_MAX_ATTEMPTS=2
LIVE_SUBMITTED_RETRIES_CONTROL_API_UNAVAILABLE=YES
LIVE_SUBMITTED_RETRIES_SUBMITTED_REPORT_REJECTED=NO
LIVE_SUBMITTED_RETRY_BACKOFF=NONE
LIVE_SUBMITTED_RETRY_JITTER=NONE
LIVE_SUBMITTED_REQUEST_DEADLINE_MS=10000
LIVE_SUBMITTED_LOCAL_LEASE_EXPIRY_AUTHORITY=NO
LIVE_SUBMITTED_REJECTION_HANDS_TO_ACCEPTANCE_RECOVERY=YES
LIVE_SUBMITTED_UNAVAILABLE_EXHAUSTION_HANDS_TO_ACCEPTANCE_RECOVERY=YES
SUBMISSION_FAILED_CLIENT_IMPLEMENTED=YES
SUBMISSION_FAILED_CLIENT_INTERNAL_RETRY_ENABLED=NO
SUBMISSION_FAILED_CLIENT_OWNS_REQUEST_TIMEOUT=NO
SUBMISSION_FAILED_CLIENT_CAN_DECLARE_LEASE_EXPIRED=NO
SUBMISSION_FAILED_CLIENT_REJECTION_WORKER_CODE=SUBMISSION_FAILED_REJECTED
ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS=2
ACCEPTANCE_FAILURE_REPORT_RETRIES_CONTROL_API_UNAVAILABLE=YES
ACCEPTANCE_FAILURE_REPORT_RETRY_BACKOFF=NONE
ACCEPTANCE_FAILURE_REPORT_RETRY_JITTER=NONE
ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS=10000
ACCEPTANCE_RECORD_RETAINED_AFTER_SUBMITTED_ACK=YES
ACCEPTANCE_HOST_FAULT_LATCH_IMPLEMENTED=YES
ACCEPTANCE_HOST_FAULT_LATCH_RUNTIME_CLEAR_ALLOWED=NO
```

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

**Status.** The route exists. A real-provider worker submission flow does
not; since R44B9 only the development-only fake-provider flow uses it.
- **Implemented (R44B6P):** the acceptance journal (section 17) and a strict
  worker client for this route.
- **Implemented (R44B6Q):** local startup journal reconciliation and the
  fail-closed new-work gate before lease acquisition (section 17).
- **Implemented (R44B6R):** the separate control-plane acceptance-recovery
  route below.
- **Implemented (R44B6S):** its worker client and the startup reconciliation
  call to it (section 17), under the bounded per-record retry policy.
- **Implemented (R44B6T):** the control-plane `submission-failed` route
  below.
- **Implemented (R44B6Y; recorded by R44B6Y1):** the inner durable
  acceptance handler, the outer acceptance adapter, the worker
  `submission-failed` client and the host-fault latch ("Acceptance handler
  and adapter" above). The adapter is the only caller of the `submitted`
  client; since R44B9 the `submission-failed` client is called only by the
  shared `failureReportPolicy.ts`, which the adapter and the fake composer
  use.
- **Implemented (R44B9; recorded by R44B9B):** development-only
  fake-provider execution. The production composer
  `runConfiguredFakeProviderAttemptOnce` with the production
  `BUSYBOOKIE_FAKE` provider reaches this route through the acceptance
  adapter and ends at `SUBMITTED` (section 36, "First fake-provider
  execution slice").
- **Not wired:** no real-provider or live submission flow calls the
  adapter, so no live execution writes new acceptance records or reports
  `submitted` or `submission-failed`.
- **Not implemented:** real-provider worker execution.
  Valid published acceptance is resolved at startup only through an exact
  `acceptance-recovery` acknowledgement; otherwise it keeps blocking new work.

The required worker ordering still stands (R44B6Y0 wording):

```text
provider accepts
-> inner durable handler publishes the exact record (section 17) and returns it
-> outer acceptance adapter reports submitted (or hands over to acceptance recovery)
-> outer adapter resolves; only then may provider polling begin
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
  audit row or changes the provider ID. (R44B6Y0.) The worker does not
  itself determine that the lease expired: a refused live report
  (`SUBMITTED_REPORT_REJECTED`) or two unavailable live attempts hand the
  exact record to acceptance recovery, which establishes the authoritative
  state.

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
WORKER_ACCEPTANCE_RECOVERY_CLIENT_IMPLEMENTED=YES
STARTUP_RECONCILIATION_CALLS_ACCEPTANCE_RECOVERY=YES
SUBMISSION_FAILED_ROUTE_IMPLEMENTED=YES
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
live-route epoch (section 12). R44B6R implements this control-plane route.
R44B6S implements the worker acceptance-recovery client and the startup
reconciliation call (section 17): it sends exactly
`{fencingCounter, providerExecutionId}` from the durable record, never a
lease token, obtains no lease, and resolves unresolved durable acceptance
only on an exact acknowledgement; anything else keeps blocking new work.

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
WORKER_ACCEPTANCE_RECOVERY_CLIENT_IMPLEMENTED=YES
STARTUP_RECONCILIATION_CALLS_ACCEPTANCE_RECOVERY=YES
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

### `submission-failed` route

**Locked decision (implemented, R44B6T; contract locked by R44B6T0 and
R44B6T0A; recorded by R44B6T1).**
`POST /worker-control/v1/attempts/:attemptId/submission-failed` with exactly
`{fencingCounter, leaseToken, outcome, failureCode}`. It exists only on the
explicitly composed worker-control router; the default process answers 404.
No live worker flow calls it. (R44B6Y0 locks its worker client and restricts
its acceptance-path use to failures before an exact durable acceptance
record exists; R44B6Y implements that client, `reportSubmissionFailed`,
called only by the unused acceptance adapter; section 18, "Acceptance
handler and adapter". Since R44B9 its only caller is the shared
`failureReportPolicy.ts`, used by the acceptance adapter and the
development-only fake-provider composer, which reports typed fake
definitive and ambiguous failures through it; no real-provider or live
flow calls it.) The implementation follows the contract below
exactly: the first transition requires the live submission epoch; replay is
authorised by the immutable original-submission provenance, with
`leaseToken` syntactically required but never replay authority; an exact
replay is read-only; sweep-recorded failure evidence is never replaced; the
response is the locked four-field shape. No migration was required and the
route never calls a provider. It uses the existing worker-control router conventions: Origin
rejection, strict worker authentication, POST only, canonical lowercase UUID
route parameter, JSON content type and an exact member set.

**Request order (R44B6T0A).** The route uses the established worker-control
route wrapper unchanged; there is no special pre-authentication parser:

1. route-level Origin policy (`403 ORIGIN_NOT_ALLOWED`);
2. route-level worker machine authentication (`401`, or `503` when the
   verifier is unavailable);
3. the authenticated handler parses and validates the exact request body;
4. the service transaction re-checks the worker `ACTIVE`;
5. the service proves the applicable lifecycle authority: the full live
   lease for a `SUBMITTING` first transition, or the immutable
   original-submission epoch for a non-`SUBMITTING` replay candidate;
6. only then is a recognised outcome/failure-code pairing classified;
7. the first transition or the exact replay comparison follows.

An unauthenticated or Origin-bearing request is therefore refused by the
established layers before its body vocabulary is interpreted, so a malformed
unauthenticated request is not necessarily a `400`. Every body is parsed and
validated before any lifecycle transaction or mutation. The established
`401`, `403`, `413`, `415` and `503` conventions are unchanged.

**Closed request vocabulary (R44B6T0).** Worker-reportable values are:

| `outcome` | Valid `failureCode` | Target state |
|---|---|---|
| `DEFINITIVELY_REJECTED` | `PROVIDER_REJECTED_DEFINITIVELY` only | `FAILED_BEFORE_SUBMISSION` |
| `OUTCOME_UNKNOWN` | `PROVIDER_SUBMISSION_AMBIGUOUS`, `ACCEPTANCE_JOURNAL_WRITE_FAILED` or `PROVIDER_EXECUTION_ID_INVALID` | `OUTCOME_UNKNOWN` |

`WORKER_LEASE_EXPIRED_DURING_SUBMISSION` is set only by the control-plane
expiry sweep (section 12) and is never worker-reportable. Once a request
reaches the authenticated handler (step 3 above), malformed JSON, an unknown
`outcome`, an unknown `failureCode`, the sweep-only code, a malformed
`fencingCounter` or `leaseToken`, or a missing or extra member is
`400 INVALID_REQUEST`. These request-shape failures reach no lifecycle
transaction, mutate nothing and record no
`WORKER_SUBMISSION_FAILURE_REJECTED` event.

A recognised `outcome` with a recognised but incompatible `failureCode` (for
example `DEFINITIVELY_REJECTED` with `PROVIDER_SUBMISSION_AMBIGUOUS`) is
`409 LEASE_REJECTED` with security reason `FAILURE_CODE_OUTCOME_MISMATCH`.
That classification is made only after the applicable authority proof below
succeeds, so a caller without that authority learns nothing about route
semantics.

**First transition (live-lease authority).** On an attempt that is
`SUBMITTING`, the request is a first-transition candidate. In one
transaction, with the established lock order (worker principal `FOR SHARE`,
attempt `FOR UPDATE`, ProviderConnection `FOR SHARE`, exact credential
version `FOR SHARE`), it requires:

- an authenticated principal, re-checked `ACTIVE`;
- the current lease held by that principal;
- `fencingCounter` equal to `lease_fencing_counter`;
- `leaseToken` matching the current stored verifier (constant-time);
- an unexpired lease;
- `submitting_worker_principal_id` equal to the authenticated principal;
- `submitting_fencing_counter` equal to `fencingCounter`, and so to
  `lease_fencing_counter`.

A replacement or recovery lease never reports the original provider-call
failure. Connection eligibility is not checked (section 23); the exact
credential version must not be `DESTROYED` (`SUBMITTING_VERSION_DESTROYED`).
After that proof, a mismatched pair is refused as above. The first
transition then writes:

- `DEFINITIVELY_REJECTED`: `SUBMITTING -> FAILED_BEFORE_SUBMISSION`,
  `failure_code`, `completed_at = now()`, `updated_at = now()` and every
  current-lease field cleared. The parent job moves `RUNNING -> FAILED` with
  server `completed_at` and `updated_at`. One
  `execution_attempt.failed_before_submission` audit.
- `OUTCOME_UNKNOWN`: `SUBMITTING -> OUTCOME_UNKNOWN`, `failure_code`,
  `updated_at = now()` and every current-lease field cleared;
  `completed_at` stays `NULL`. The parent job moves
  `RUNNING -> NEEDS_ATTENTION`. One `execution_attempt.outcome_unknown`
  audit.

Both keep `submitting_at`, `submitting_worker_principal_id`,
`submitting_fencing_counter`, the retained `lease_fencing_counter` and the
credential-grant evidence (migrations 0004 to 0006). Audit metadata is the
section 30 safe set with `failureCode`. The attempt write, job write and audit
commit or roll back together; security events follow the established
fail-closed sink convention. There is no automatic retry, new attempt or
resubmission. A separately locked retry policy could later create a new
attempt after `DEFINITIVELY_REJECTED`; it is deferred and never automatic in
v1.

**Replay (original-submission-epoch authority).** Both target states clear
the lease, so no lease-token verifier survives the first commit. A request
for an attempt that is no longer `SUBMITTING` is a replay candidate. It is
authorised exactly like the acceptance-recovery epoch proof (section 18,
`acceptance-recovery`), before any state is disclosed:

- an authenticated principal, re-checked `ACTIVE`;
- that principal equal to the immutable `submitting_worker_principal_id`;
- `submitting_at` present;
- `fencingCounter` equal to `submitting_fencing_counter` and to the retained
  `lease_fencing_counter`.

`leaseToken` stays in the fixed wire schema and must still be well formed,
but on replay it is not authority: nothing can verify it, and the route
never claims to have validated it. No replay token, verifier column,
migration or recovery lease is introduced.

After the epoch proof, a mismatched pair is `FAILURE_CODE_OUTCOME_MISMATCH`.
Otherwise the replay succeeds only on an exact match with the committed row:
`DEFINITIVELY_REJECTED` + `PROVIDER_REJECTED_DEFINITIVELY` matches only
`FAILED_BEFORE_SUBMISSION` with that `failure_code`; each `OUTCOME_UNKNOWN`
code matches only `OUTCOME_UNKNOWN` with that same `failure_code`. A
successful replay writes nothing: no attempt or job write, no audit, no
security event, and no change to `completed_at`, `updated_at` or
`failure_code`. It recreates no lease, opens no credential and calls no
provider. It neither locks nor requires the credential version: a committed
`FAILED_BEFORE_SUBMISSION` closes its obligations (section 23) and may later
permit destruction, and replay must not depend on that timing.
`OUTCOME_UNKNOWN` keeps its recovery obligation independently.

Anything else, after the epoch proof, is `409 LEASE_REJECTED` with
`INCOMPATIBLE_ATTEMPT_STATE`. That covers a different outcome, a different
valid failure code, an attempt the expiry sweep moved to `OUTCOME_UNKNOWN`
with `WORKER_LEASE_EXPIRED_DURING_SUBMISSION` (never replaced by a later
worker report), and any other state. Existing reasons keep their meaning:
`UNKNOWN_ATTEMPT`; `OTHER_WORKER`, `FENCING_MISMATCH`, `TOKEN_MISMATCH` and
`LEASE_EXPIRED` on the live-lease path; `SUBMITTING_PRINCIPAL_MISMATCH` and
`FENCING_MISMATCH` on the epoch path. No new rejection reason is introduced
beyond `FAILURE_CODE_OUTCOME_MISMATCH` (section 30).

**Exact response (200), first transition and replay alike.**

```text
{executionAttemptId, fencingCounter, state, failureCode}
```

`state` is `FAILED_BEFORE_SUBMISSION` or `OUTCOME_UNKNOWN`; `failureCode` is
the committed code. There is no `outcome`, timestamp, provider execution ID,
lease field, worker principal or credential information. Server timestamps
remain database authority but are not part of this response.

### Upstream reporting after the journal

If the journal holds a provider execution ID but the upstream report fails:

- do not resubmit;
- (R44B6Y0) retry `submitted` under the locked live policy (at most two
  attempts, unavailable-only), then hand the exact record to
  `acceptance-recovery` on a refusal or exhausted unavailability. The
  worker never decides lease liveness from a local clock, and never reads a
  409 as proof of expiry;
- never call `submission-failed` once the exact record is durable;
- do not lease or start another job until the accepted record is reconciled
  with the control plane (section 17).

This is an initial concurrency-1 safety rule.

```text
SUBMITTED_CAN_CALL_PROVIDER_CREATE_AGAIN=NO
```

### `input-failed` route (revision R44B10P2)

**Status (R44B10P2; recorded by the R44B10P2 docs sync).** Implemented in
commit 395b4fd8958c9f7bdfd34a215c72cf450cb86de2 ("feat(commercial): add
pre-provider input failure handling"; 22 files, 3142 insertions, 123
deletions), committed only after every validation below passed.

- added: `apps/commercial-api/migrations/0007_input_failure_provenance.sql`,
  `apps/commercial-api/src/workerControl/workerInputFailedService.ts`,
  `apps/commercial-worker/src/inputMediaFailurePolicy.ts`, and the tests
  `apps/commercial-api/tests/db/workerInputFailed.test.ts`,
  `apps/commercial-worker/tests/inputFailedClient.test.ts`,
  `apps/commercial-worker/tests/inputMediaFailurePolicy.test.ts` and
  `apps/commercial-worker/tests/integration/inputFailureComposition.test.ts`;
- modified production files: `workerControlApplication.ts`,
  `workerSecurityEvents.ts` (commercial-api), and `inputMediaRetrieval.ts`,
  `workerControlClient.ts`, `workerError.ts` (commercial-worker); the
  remaining changes are existing tests (boundary, migration, catalog,
  privilege, runtime-version and fixture expectations).

There is no change to this architecture (during implementation), the
deployment runbook, the shared protocol package, package manifests,
lockfiles, `runtimeGrants.ts`, `attemptExecution.ts`, `fakeProvider.ts`,
the acceptance journal, the state root, real-provider code or provider SDK
code. `OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=YES`; the contract
below is implemented as locked, with one strengthening (the epoch check).

- **Migration 0007.** Adds `input_failed_worker_principal_id uuid NULL`
  (foreign key `execution_attempts_input_failed_worker_fk` to
  `worker_principals (id) ON DELETE RESTRICT`) and
  `input_failed_fencing_counter bigint NULL`. No lease-token verifier is
  persisted. The `execution_attempts_guard` function is replaced in place
  (its 0006 body is carried over unchanged, which a test pins line by
  line). On `LEASED -> FAILED_BEFORE_SUBMISSION` the guard requires a lease
  and an earlier grant (`OLD.credential_granted_at`), rejects a supplied
  value that differs from the stamp, and stamps both values from
  `OLD.lease_worker_principal_id` and `OLD.lease_fencing_counter`. It
  rejects provenance on INSERT and any later change or clearing. The runtime
  role has no UPDATE privilege on either column (`runtimeGrants.ts`
  unchanged), and application SQL never names them.
- **Checks.** `execution_attempts_input_failed_pair_ck` (both NULL or both
  set), `execution_attempts_input_failed_state_ck` (set exactly when
  `state = 'FAILED_BEFORE_SUBMISSION' AND submitting_at IS NULL`),
  `execution_attempts_input_failed_code_ck` (one of the five `INPUT_*`
  codes exactly when set) and
  `execution_attempts_input_failed_epoch_ck`
  (`input_failed_fencing_counter IS NULL OR input_failed_fencing_counter =
  lease_fencing_counter`). The epoch check is an implementation
  strengthening in the epoch discipline of migration 0006: the reporting
  epoch always stays the retained fencing counter that replay compares.
  A provider-caused `FAILED_BEFORE_SUBMISSION` structurally carries no
  input-failure provenance or `INPUT_*` code, and a pre-barrier failure
  cannot shed its provenance to pass as provider-caused.
- **Fail closed.** No backfill. The migration aborts if any
  `FAILED_BEFORE_SUBMISSION` row with a NULL `submitting_at` exists,
  inferring nothing from the failure code, timestamps, the retained counter
  or audit data; it applies cleanly to every provable row, including
  provider-caused failures.
- **Route.** `POST /worker-control/v1/attempts/:attemptId/input-failed` on
  the existing worker-control wrapper (Origin refusal, worker
  authentication, closed body). Exactly `{fencingCounter, leaseToken,
  failureCode}`; any other member, a malformed proof and any code outside
  the five (unknown `INPUT_*`, provider, storage or free-form) are 400 with
  no state change. No provider or storage code crosses the route.
- **First transition** (`workerInputFailedService.ts`).
  `requireActiveWorker` (principal `FOR SHARE`), the attempt row `FOR
  UPDATE`, then `lockCurrentLease(..., ["LEASED"])`: the same principal, the
  exact fencing counter, the constant-time token match and an unexpired
  lease. Then `credential_granted_at IS NOT NULL` (else
  `CREDENTIAL_NOT_GRANTED`) and `submitting_at IS NULL`. The exact
  credential version is read, never locked, only for the audit. One
  transaction: `FAILED_BEFORE_SUBMISSION`, the `INPUT_*` code,
  `completed_at = now()`, `submitting_at` left NULL, the lease cleared field
  by field with the fencing counter and `credential_granted_at` kept, the
  job `RUNNING -> FAILED`, and one audit row. Capacity is freed at once;
  there is no replacement attempt, `NEEDS_ATTENTION` or `OUTCOME_UNKNOWN`,
  and obligations close by state.
- **Exact replay.** An attempt that is no longer `LEASED` is a replay
  candidate. The caller must be `input_failed_worker_principal_id`
  (`INPUT_FAILURE_PRINCIPAL_MISMATCH`), then `fencingCounter` must equal
  `input_failed_fencing_counter` and the retained `lease_fencing_counter`
  (`FENCING_MISMATCH`), and only then is the code compared with the
  committed pre-barrier failure (`INCOMPATIBLE_ATTEMPT_STATE`). An exact
  match returns the same 200 acknowledgement with no write and no audit. The
  lease token stays syntactically required but is never replay authority.
  A different code, principal or epoch, a provider-caused
  `FAILED_BEFORE_SUBMISSION`, every other state, and a stale, expired,
  foreign, ungranted or unknown first-time request get the uniform 409
  `LEASE_REJECTED`; the first committed reason wins.
- **Acknowledgement and audit.** `{executionAttemptId, fencingCounter,
  state: "FAILED_BEFORE_SUBMISSION", failureCode}` for both. The
  `execution_attempt.input_failed` audit carries `attemptNumber`,
  `fencingCounter`, `workerPrincipalId`, `provider`, `credentialVersion` and
  `failureCode`; never an object key, SHA-256, URL, bytes, a storage error,
  a lease token or a credential.
- **Security event.** `WORKER_INPUT_FAILURE_REJECTED` (plus the rejection
  reason `INPUT_FAILURE_PRINCIPAL_MISMATCH`), TypeScript union members only;
  no migration.
- **Worker client.** `reportInputFailed(executionAttemptId, proof,
  failureCode, signal?)` on the worker-control client, with the closed
  `INPUT_FAILURE_CODES`. It sends nothing outside the contract, parses the
  acknowledgement exactly (`parseInputFailedResponse`; anything else is the
  existing `MALFORMED_CONTROL_RESPONSE`), maps 409 to the new closed
  `INPUT_FAILED_REJECTED`, and never exposes a response body. One request
  per call.
- **Report policy** (`inputMediaFailurePolicy.ts`).
  `reportInputFailureWithPolicy` wraps the client in the existing
  `atMostTwoAttempts` (`failureReportPolicy.ts`):
  `INPUT_FAILURE_REPORT_MAX_ATTEMPTS = 2`,
  `INPUT_FAILURE_REPORT_REQUEST_DEADLINE_MS = 10000`, a fresh controller per
  attempt, retrying only `CONTROL_API_UNAVAILABLE`; the result is
  `REPORTED` (first transition or exact replay) or `UNREPORTED`. This is a
  control-report retry, never a provider retry.
- **Classification.** Retrieval throws `InputMediaRetrievalError` (a
  `WorkerError`, codes unchanged) carrying `failure: InputMediaFailure`,
  one of `{kind: "PERMANENT_INPUT", reason}` (exactly one `INPUT_*` code),
  `{kind: "TRANSIENT_STORAGE"}` or `{kind: "HOST_FAULT"}`, decided once by
  closed result and never from message text (mapping below).
- **Latch ownership.** The R44B10P1 interim helper-side latch is replaced:
  retrieval no longer takes a latch. `handleInputMediaFailure` (dependencies
  `client`, `deadlineTimer`, `latch`) owns the decision and never throws:
  `PERMANENT_INPUT` reports and never trips the latch; `TRANSIENT_STORAGE`
  does nothing; `HOST_FAULT`, and any error that is not a classified
  retrieval failure, trips the existing host-fault latch with no report.
  Its closed outcomes are `PERMANENT_INPUT_REPORTED`,
  `PERMANENT_INPUT_UNREPORTED`, `TRANSIENT_STORAGE` and `HOST_FAULT`; a 409
  refusal is not retried and yields `PERMANENT_INPUT_UNREPORTED`. Every
  outcome stops the attempt: no permit, `SUBMITTING`, provider
  construction, dispatch, local `FAILED` or `OUTCOME_UNKNOWN`, and no latch
  for control-plane unavailability alone. R44B10P1 is not reopened; only its
  interim latch expectations changed.
- **Unwired.** No production composer calls the policy yet; the fake
  composer and `BUSYBOOKIE_FAKE` gained no input retrieval.

| Retrieval condition | Worker error (unchanged) | Class and reason |
|---|---|---|
| malformed authorized reference, including an unsupported declared type | `OBJECT_REFERENCE_INVALID` | `PERMANENT_INPUT` / `INPUT_REFERENCE_INVALID` |
| `NOT_FOUND` | `OBJECT_NOT_FOUND` | `PERMANENT_INPUT` / `INPUT_OBJECT_NOT_FOUND` |
| declared `byteCount` above `maxBytes` (no store call) | `OBJECT_TOO_LARGE` | `PERMANENT_INPUT` / `INPUT_OBJECT_TOO_LARGE` |
| store `TOO_LARGE` with the declared size within `maxBytes` | `OBJECT_TOO_LARGE` | `PERMANENT_INPUT` / `INPUT_OBJECT_INTEGRITY_MISMATCH` |
| length or SHA-256 mismatch on valid `FOUND` bytes | `OBJECT_INTEGRITY_MISMATCH` | `PERMANENT_INPUT` / `INPUT_OBJECT_INTEGRITY_MISMATCH` |
| allowed declared type contradicted by the bytes | `OBJECT_MEDIA_TYPE_INVALID` | `PERMANENT_INPUT` / `INPUT_MEDIA_TYPE_INVALID` |
| `UNAVAILABLE` twice, or two read-deadline expiries | `OBJECT_STORAGE_UNAVAILABLE` | `TRANSIENT_STORAGE` |
| `ACCESS_DENIED` | `OBJECT_STORAGE_ACCESS_DENIED` | `HOST_FAULT` |
| `INVALID_OBJECT`, store throw or malformed result | `OBJECT_INTEGRITY_MISMATCH` | `HOST_FAULT` |
| store returns more bytes than `maxBytes` | `OBJECT_TOO_LARGE` | `HOST_FAULT` |
| missing or invalid store, invalid `accountId` or `maxBytes` | `WORKER_CONFIGURATION_INVALID` | `HOST_FAULT` |

**Composition and crash evidence.** The test-only P1/P2 composition
(`inputFailureComposition.test.ts`) drives a granted `LEASED` attempt
through retrieval with the in-memory store, the classification, the policy
and the real worker-control client over HTTP to the real router on
PostgreSQL 16. For not found, SHA-256 mismatch, media mismatch and declared
oversize it reaches `FAILED_BEFORE_SUBMISSION` with the job `FAILED`, the
lease cleared and no latch, and the only outbound requests are the lease,
the grant and the input-failed report: no permit, `SUBMITTING`, provider
construction or dispatch. Access denied and store contract violations trip
the latch and send no report; unavailable storage sends no report, trips no
latch and leaves the lease to expiry. The API and composition tests also
prove: a lost response after commit is recovered by the exact replay (one
transition, one audit, never requeued); two unavailable reports leave the
attempt `LEASED`, and after expiry granted-expired recovery requeues it and
the next lease rediscovers and reports the same fault; a stale epoch is
refused after recovery without touching the newer authority's attempt; a
committed input failure is never requeued; `input-failed` and `SUBMITTING`
race with exactly one winner. `OUTCOME_UNKNOWN` is never used on this path.

**Validation.** Commercial-api PostgreSQL DB suite 628/628 tests in 106/106
suites (exit 0), of which the migration suite 31/31 in 1/1 file (exit 0:
empty database through 0007, upgrades from earlier versions, second-run
no-op, checksum drift for 0001 to 0007, the migration lock, malformed
migrations, 0007 on provable rows and its fail-closed refusal); commercial-api
non-DB 858/858 in 21/21 files; commercial-worker unit 833/833 in 19/19
files; commercial-worker integration 51/51 tests in 16/16 suites; both
typechecks clean; `git diff --check` and the protected-scope screen passed.
The first DB run exposed three stale schema-test expectations (the new 0007
foreign key missing from a catalog expectation, the foreign-key count 25 to
26, and the schema version 6 to 7); those test expectations were corrected
and the whole suite then passed. They were not production defects.

**Locked decision (R44B10P2; implemented by R44B10P2, recorded by the
R44B10P2 docs sync).** An authoritative
control-plane transition for a **permanent pre-provider input failure**:
discovered after the credential grant and open, but before `SUBMITTING`,
provider construction and provider dispatch. It never represents a provider
rejection, provider ambiguity or a provider submission failure. It is the
R44B10P2 hard gate of section 28 ("Object-storage input contract").

**Evidence (R44B10P2 discovery, revalidated).**

- The attempt guard allows `LEASED -> FAILED_BEFORE_SUBMISSION`. That state
  requires `failure_code` and `completed_at`, permits a NULL `submitting_at`
  and a set `credential_granted_at`, has no outgoing transition, and
  (`execution_attempts_lease_state_ck`) requires the lease to be cleared.
- Credential obligations are derived from state
  (`credentialObligations.ts`), so `FAILED_BEFORE_SUBMISSION` closes the
  attempt's retention and recovery obligations.
- `release` is not replayable (a retry is 409). `submission-failed` replays
  through the immutable submitting provenance of migrations 0005 and 0006,
  which is stamped only on `LEASED -> SUBMITTING` and tied to
  `submitting_at`, so it cannot carry a P2 reporter.
- After a P2 commit clears the lease, no reporter provenance survives, so
  exact replay needs new provenance.
- The worker-control route contracts of `submitted` and `submission-failed`
  are implemented by the API router and the worker client, not by the
  shared protocol package.
- The R44B10P1 library conflates some permanent-input, host and transient
  failures (`OBJECT_INTEGRITY_MISMATCH`, `OBJECT_TOO_LARGE`) and trips the
  latch itself.

**Replay decision: exact idempotent replay.** R44B10P2 rejects
release-style non-replayable semantics. A migration **is** required, only
for reporter provenance. The transition itself, the failure-code grammar,
the audit-event grammar, the job's `FAILED` status and the lease clear need
no migration.

**Provenance (migration 0007, `0007_input_failure_provenance.sql` or the
next number in repository convention).** Following 0005 and 0006 exactly:

- `input_failed_worker_principal_id uuid NULL`, with a foreign key to
  `worker_principals (id) ON DELETE RESTRICT`;
- `input_failed_fencing_counter bigint NULL`, the same type as
  `lease_fencing_counter`.

No lease-token hash is persisted. In the precedent, the token is never
replay authority once the lease is cleared (`submission-failed` replay
consults the principal and epoch only).

**Provenance invariants (database-enforced).**

- The guard stamps both values, on the first `LEASED ->
  FAILED_BEFORE_SUBMISSION` only, from `OLD.lease_worker_principal_id` and
  `OLD.lease_fencing_counter`. It requires a lease and a set
  `credential_granted_at`. Any supplied value must equal the stamp, and
  application code never names the columns.
- They are NULL on INSERT and immutable on every other UPDATE. The runtime
  role gets no UPDATE privilege on them (`runtimeGrants.ts` stays
  unchanged), as for `submitting_*`.
- CHECK constraints: the two columns are both NULL or both set; they are
  set exactly when `state = 'FAILED_BEFORE_SUBMISSION' AND submitting_at IS
  NULL`; and `failure_code` is one of the five `INPUT_*` codes exactly when
  they are set. A `LEASED -> FAILED_BEFORE_SUBMISSION` row therefore always
  carries an `INPUT_*` code and its provenance. A provider-caused
  `FAILED_BEFORE_SUBMISSION` (from `submission-failed`, with `submitting_at`
  set) never carries either, so the two producers are structurally distinct
  and submitting provenance is never overloaded.
- **Backward compatibility:** the columns are nullable, there is no
  backfill, and existing provider-caused rows stay valid. Like 0005, the
  migration fails closed if any existing `FAILED_BEFORE_SUBMISSION` row has
  a NULL `submitting_at` (unrecoverable provenance; none is expected,
  because no route has produced one). It changes no provider,
  object-storage, journal, job or credential schema.

**Route.** `POST /worker-control/v1/attempts/:attemptId/input-failed`, on
the explicitly composed worker-control router only: no public, customer or
provider route. The name parallels the existing kebab-case actions and
avoids "submission", because no submission occurred.

**Request.** Exactly `{fencingCounter, leaseToken, failureCode}`. The
attempt ID is in the path, and the principal comes only from worker
authentication. Unknown members, and any account, provider, object key,
SHA-256, URL, message, raw worker error, credential identifier or provider
execution ID, are rejected with 400.

**First transition, source authority.** `requireActiveWorker`, then
`lockCurrentLease(..., ["LEASED"])` with no second authority model: the
caller's live, unexpired current lease, exact fencing counter and exact
token proof. Then `credential_granted_at IS NOT NULL` and (implied by
`LEASED`) `submitting_at IS NULL`.

- An expired lease is refused; granted-expired recovery stays
  authoritative and may requeue.
- `QUEUED`, `SUBMITTING`, `SUBMITTED`, `OUTCOME_UNKNOWN`,
  `SUBMITTED_FAILED`, `ABANDONED`, a provider-caused
  `FAILED_BEFORE_SUBMISSION` and every other state are never transitioned.
  Only a matching P2 terminal row is a replay candidate.
- `input-failed` and `SUBMITTING` both lock the attempt row, so exactly one
  wins and the other is refused.
- **Dispatch proof:** `state = 'LEASED'` with `submitting_at IS NULL`
  proves the provider-call barrier was never crossed. No
  `providerDispatched` field exists.

**Failure codes.** Exactly five closed, provider-neutral wire codes:
`INPUT_REFERENCE_INVALID`, `INPUT_OBJECT_NOT_FOUND`,
`INPUT_OBJECT_TOO_LARGE`, `INPUT_OBJECT_INTEGRITY_MISMATCH` and
`INPUT_MEDIA_TYPE_INVALID`. Unknown `INPUT_*` values, provider codes and
storage implementation codes are rejected with 400. Storage codes never
cross the route.

**Transition.** One transaction, in this order:

1. authority validation and locking;
2. `state = 'FAILED_BEFORE_SUBMISSION'`, `failure_code` (one of the five),
   `completed_at = now()` and `submitting_at` left NULL, with no provider
   field fabricated;
3. the lease cleared field by field, as `submission-failed` does
   (`lease_worker_principal_id`, `lease_token_sha256`, `leased_at`,
   `lease_expires_at`, `heartbeat_at` to NULL), with the fencing counter
   retained;
4. the guard stamps the provenance;
5. the job `RUNNING -> FAILED`, with no retry, no replacement attempt and no
   `NEEDS_ATTENTION`;
6. one audit row.

There is no partial terminalization.

- Capacity is freed at once (capacity counts current leases), so P2 input
  faults leave no poison attempt holding the lease. The separate live
  `SUBMITTED` capacity condition is not fixed.
- `credential_granted_at` stays as history; it is not cleared to make the
  row look ungranted.
- Obligations close by state, with no separate grant write. This does not
  solve the section 24 destruction lifecycle; over-retention stays
  fail-safe.

**Audit.** A dedicated `execution_attempt.input_failed` event (valid under
the existing event-type grammar, so no migration), never
`failed_before_submission`, so it is never mistaken for a provider
rejection. Its payload follows the existing convention: `attemptNumber`,
`fencingCounter`, `workerPrincipalId`, `provider`, `credentialVersion`
where precedent allows, and `failureCode`. It never holds an object key,
SHA-256, signed URL, bytes, a raw storage error, a credential or a lease
token. A first transition writes exactly one row; an exact or conflicting
replay writes none.

**Replay.** If the attempt is no longer `LEASED`, it is a replay
candidate. Authority is proven before any state is disclosed:

- the authenticated active caller equals `input_failed_worker_principal_id`;
- `fencingCounter` equals `input_failed_fencing_counter` (and the retained
  `lease_fencing_counter`);
- only then is `failureCode` compared, and an exact match with the committed
  P2 row returns 200 with the same acknowledgement, no mutation and no
  audit.

The lease token must be syntactically valid but is not authority on
replay. A different code, principal or epoch, a provider-caused
`FAILED_BEFORE_SUBMISSION` (no P2 provenance) and every other state get
409; the first reason wins. The failure code is immutable: the state is
terminal, and the guard forbids changing the code without a state change.

**Acknowledgement.** `{executionAttemptId, fencingCounter, state:
"FAILED_BEFORE_SUBMISSION", failureCode}`, for both the first transition
and a replay. Lease clearing is implied by the state, and nothing else is
returned.

**HTTP.** The existing conventions, unchanged:

| Status | When |
|---|---|
| 200 | first success or exact replay |
| 400 | invalid closed body or code |
| 401 | authentication failure or inactive worker |
| 403 | Origin present |
| 409 `LEASE_REJECTED` | stale, expired, wrong-state, conflicting replay, other worker, unknown attempt or not granted |
| 503 | unexpected failure |

Rejections record a new security-event type, `WORKER_INPUT_FAILURE_REJECTED`
(a TypeScript union member only, no migration).

**Protocol package.** No shared protocol-package change. Route contracts
live in the API router and the worker client, as for `submitted` and
`submission-failed`. This corrects the R44B10P1 expectation of a "protocol"
change; the wire contract is additive.

**API scope (implemented by R44B10P2).** Additive only:
`workerControlApplication.ts` (the action pattern, a member set and a
handler), a new
`workerInputFailedService.ts`, `workerSecurityEvents.ts`, the migration and
its tests, and worker-control DB tests. `runtimeGrants.ts` is unchanged.

**Worker client and report policy (implemented by R44B10P2).**

- A single-shot `reportInputFailed(executionAttemptId, proof, failureCode,
  signal?)` on the worker-control client: worker authentication, the exact
  closed body, an exact acknowledgement parser, no internal retry.
- A semantic 409 is a new closed `INPUT_FAILED_REJECTED`. A malformed
  acknowledgement is the existing `MALFORMED_CONTROL_RESPONSE`, and
  authentication and unavailability use the existing codes. No raw body is
  exposed.
- The client is wrapped by the existing `atMostTwoAttempts`: two attempts,
  retrying only `CONTROL_API_UNAVAILABLE`, a 10000 ms deadline each, a fresh
  `AbortController` per attempt. This is a control-report retry, never a
  provider retry.
- **Lost response:** the commit happened, the response was lost, the policy
  retries and the API returns the exact 200 replay; the worker stops
  cleanly.
- **Unreported:** after two unavailable attempts, or a refusal, the
  outcome is `UNREPORTED` (as in the existing failure-report policy). The
  worker still stops: no `SUBMITTING`, no dispatch, no local `FAILED` state,
  no `OUTCOME_UNKNOWN` and no latch for control-plane unavailability. The
  database is either the terminal P2 state or still `LEASED`, which
  granted-expired recovery will requeue.

**Crash semantics.** Never `OUTCOME_UNKNOWN`, and never a provider state.

| Crash point | Result |
|---|---|
| before the report | still `LEASED`; the lease expires, recovery requeues, and the next lease rediscovers and reports the fault |
| during the report | atomic: either the terminal P2 state or still `LEASED` |
| after commit, before the response | the exact replay returns 200, with no duplicate audit and no requeue |

Granted-expired recovery selects only expired `LEASED` attempts, so a
committed P2 row is never requeued.

**Failure classification.** Composing R44B10P1 retrieval with P2 needs
three closed, typed, non-secret classes; WorkerErrorCode alone is
insufficient, and nothing is inferred from message text:

| Class | P2 report | Latch |
|---|---|---|
| `PERMANENT_INPUT` (carrying exactly one `INPUT_*` reason) | yes | no |
| `TRANSIENT_STORAGE` | no | no (not solely for an outage) |
| `HOST_FAULT` | no | yes |

| Condition | Class and reason |
|---|---|
| malformed authorized reference, including an unsupported declared type | `PERMANENT_INPUT` / `INPUT_REFERENCE_INVALID` |
| `NOT_FOUND` after bounded retrieval (for the current architecture; not a claim about every future vendor or consistency model) | `PERMANENT_INPUT` / `INPUT_OBJECT_NOT_FOUND` |
| declared `byteCount` above the caller's ceiling (no store call) | `PERMANENT_INPUT` / `INPUT_OBJECT_TOO_LARGE` |
| store `TOO_LARGE` when the declared size is within `maxBytes` (by the store contract the object exceeds `maxBytes`, so it disagrees with its reference) | `PERMANENT_INPUT` / `INPUT_OBJECT_INTEGRITY_MISMATCH` |
| length or SHA-256 mismatch on valid `FOUND` bytes | `PERMANENT_INPUT` / `INPUT_OBJECT_INTEGRITY_MISMATCH` |
| declared allowed type contradicted by the bytes | `PERMANENT_INPUT` / `INPUT_MEDIA_TYPE_INVALID` |
| `UNAVAILABLE` twice, or read-deadline expiry | `TRANSIENT_STORAGE` |
| `ACCESS_DENIED` | `HOST_FAULT` |
| missing or invalid store, invalid `accountId` or `maxBytes` | `HOST_FAULT` |
| store throw, malformed result, or `INVALID_OBJECT` | `HOST_FAULT` |
| store returns more bytes than `maxBytes` (bounded-contract violation) | `HOST_FAULT` |

The interim helper-side latching of R44B10P1 is replaced. The final latch
and report decision moves to the caller, or the helper becomes
classification-aware: a permanent input fault never trips the latch. The
affected R44B10P1 tests are the interim latch expectations for not found,
declared oversize, authorized integrity mismatch, media mismatch and a
malformed authorized reference. Parser, hash, media, retry, deadline,
account-isolation and resolver-confinement tests stay valid. This does not
reopen R44B10P1.

**Observability.** Worker logs may carry only approved identifiers: the
attempt ID, the closed `INPUT_*` code and the route outcome or stage. A new
closed `WorkerLogEvent` stage is added only if the logging architecture
needs one. They never carry the object key, SHA-256, URL, raw storage error,
credential or lease token.

**Isolation.** P2 uses no provider SDK, adapter, network,
`providerExecutionId`, acceptance journal, acceptance callback or polling
and output logic. No provider is contacted. It needs no production object
store: tests use the R44B10P1 in-memory store.
`OBJECT_STORAGE_PRODUCTION_IMPLEMENTED=NO` and `OBJECT_STORAGE_VENDOR`
stays `UNDECIDED`.

**Mandatory tests (implemented by R44B10P2).**

- **API DB:**
  1. a valid granted live `LEASED` attempt with `INPUT_REFERENCE_INVALID`
     succeeds;
  2. the attempt becomes `FAILED_BEFORE_SUBMISSION`;
  3. the job becomes `FAILED`;
  4. `completed_at` is set;
  5. `submitting_at` stays NULL;
  6. the lease is fully cleared;
  7. capacity is immediately available;
  8. the obligation closes by state;
  9. exactly one `input_failed` audit;
  10. provenance is stamped;
  11. exact replay is 200;
  12. replay adds no audit;
  13. a conflicting code is 409;
  14. another worker is 409;
  15. a stale fencing counter is 409;
  16. a wrong token is 409;
  17. an expired lease is 409;
  18. no grant is 409;
  19. `SUBMITTING` is 409;
  20. `SUBMITTED` is 409;
  21. `OUTCOME_UNKNOWN` is 409;
  22. `ABANDONED` and other terminal states are 409;
  23. a provider-caused `FAILED_BEFORE_SUBMISSION` is 409;
  24. an invalid code is 400;
  25. an unknown member is 400;
  26. Origin is 403;
  27. invalid or inactive worker authentication gets the established
      response;
  28. a race with `SUBMITTING` has exactly one winner;
  29. a committed P2 row is never requeued by granted-expired recovery.

  Also migration tests for every provenance invariant: guard stamping,
  immutability, NULL on insert, the pairing and `INPUT_*` checks, the
  fail-closed backfill check, and no runtime UPDATE grant.
- **Codes:** each of the five individually; unknown `INPUT_*`, provider
  and storage codes are 400.
- **Replay:** first 200; same 200; a different code 409; a different
  principal 409; a different epoch 409; a provider-caused terminal row 409;
  exactly one audit throughout. A lease-token mismatch is not a replay
  check, because the token is not replay authority.
- **Worker client:** the exact path, body and authentication; the exact
  acknowledgement; 200 and 200 replay; a malformed acknowledgement fails
  closed; no retry on 409, 401 or 403; unavailable then success is two
  requests; two unavailable is two requests; a fresh controller and a 10000
  ms deadline each; no raw body leakage.
- **Classification:** the `PERMANENT_INPUT` cases (malformed reference,
  not found, declared oversize, reference-versus-object size mismatch,
  SHA-256 mismatch, media mismatch); the `TRANSIENT_STORAGE` cases
  (unavailable, deadline); the `HOST_FAULT` cases (access denied, missing
  or invalid store, bad account or `maxBytes`, store throw, malformed
  result, oversized return). None inferred from message text.
- **Latch:** `PERMANENT_INPUT` and `TRANSIENT_STORAGE` never trip it;
  `HOST_FAULT` does. Only the interim R44B10P1 latch expectations change.
- **P1/P2 composition (test-only, before R44B10A):** for at least not
  found, digest mismatch, media mismatch and declared oversize, a leased
  and granted attempt goes through retrieval to a permanent classification,
  the P2 report and the API commit. Assert the lease is cleared, the job is
  `FAILED`, and there is no permit, `SUBMITTING`, provider construction,
  dispatch or latch. Also: access denied or a store contract failure trips
  the latch, with no P2, permit or provider; and unavailability after the
  retries makes no P2 report, no provider call and no ambiguity, leaving
  the lease to expiry.
- **Crash and replay (API and control level):** a crash before the report,
  a lost response after commit, the exact retry replay, and a stale report
  after recovery. Full real-provider composition is deferred to R44B10A.

**Flags.** Unchanged by this lock:
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=NO`,
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRED_BEFORE_REAL_PROVIDER=YES`,
`REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO` and
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`. After P2 implementation and
docs sync, `OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED` becomes eligible
to flip. (R44B10P2 docs sync: flipped to
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=YES`; the contract-lock and
required-before-real-provider flags stay YES, and both provider flags stay
NO.)

**Real-provider unblock.** R44B10P2 implementation is the final known
prerequisite before R44B10A. R44B10A still owns its own contract: the Google
request schema, credential re-open and lifetime, the engine-worker boundary
revision, the SDK dependency, the retry assertion, real-adapter
classification and the `REAL_PROVIDER_EXECUTION_IMPLEMENTED` criteria. None
is solved here, and R44B10A stays blocked until R44B10P2 is implemented.
(R44B10P2 docs sync: that prerequisite is now satisfied and R44B10P2 is
fully closed. R44B10A is eligible to begin its own contract and
implementation sequence; it is not implemented, and every R44B10A item
above stays its own responsibility.)

```text
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_CONTRACT_LOCKED=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PATH=/worker-control/v1/attempts/:attemptId/input-failed
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_CODES=INPUT_REFERENCE_INVALID,INPUT_OBJECT_NOT_FOUND,INPUT_OBJECT_TOO_LARGE,INPUT_OBJECT_INTEGRITY_MISMATCH,INPUT_MEDIA_TYPE_INVALID
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REPLAY=EXACT_IDEMPOTENT
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PROVENANCE_MIGRATION_REQUIRED=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_SOURCE_STATE=LEASED
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRES_CREDENTIAL_GRANT=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_CLEARS_LEASE=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_JOB_STATE=FAILED
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PROVIDER_SEMANTICS=NO
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PROTOCOL_PACKAGE_CHANGE_REQUIRED=NO
OBJECT_STORAGE_INPUT_FAILURE_CLASSIFICATION_EXTENSION_REQUIRED=YES
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
  is `DESTROYED`, which is an invariant failure. (R44B6T0.) The exception is
  a read-only `submission-failed` replay: its first transition already
  committed and may have closed the obligation, so it neither locks nor
  requires the version (section 18).
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

### Object-storage input contract (revision R44B10P1)

**Status (R44B10P1; recorded by the R44B10P1 docs sync).** Implemented in
commit 192a97e7eca1c1c17378ccc10821e662eb96f77f, in `apps/commercial-worker`
only (6 files, 859 insertions, 4 deletions):

- added: `src/objectStorageContract.ts`, `src/inputMediaRetrieval.ts`,
  `tests/inputMediaRetrieval.test.ts`,
  `tests/support/inMemoryObjectStore.ts`;
- modified: `src/workerError.ts`, `tests/boundary.test.ts`.

There is no change to this architecture (during implementation), the
deployment runbook, commercial-api, the protocol package, migrations, the
database schema, package manifests, lockfiles, the fake composer, the
acceptance journal, the state root, real-provider code or provider SDK code.

Three things are distinct:

- **A. The production input library:** implemented
  (`OBJECT_STORAGE_INPUT_LIBRARY_IMPLEMENTED=YES`).
- **B. The in-memory test store:** implemented
  (`OBJECT_STORAGE_TEST_IMPLEMENTATION_IMPLEMENTED=YES`).
- **C. A production storage backend:** not implemented
  (`OBJECT_STORAGE_PRODUCTION_IMPLEMENTED=NO`, which means a real
  vendor-backed `ObjectStore`), with `OBJECT_STORAGE_VENDOR` still
  `UNDECIDED`.

The library stays **unwired**: no production module calls it.

**Store contract.** `objectStorageContract.ts` defines `ObjectStore`, with
one operation, `getObject({ accountId, key, maxBytes, signal })`. It is
injected, read-only, single-shot (no retry inside the primitive),
account-authoritative and bounded, with no default, vendor, URL or
filesystem fallback. Its result is `FOUND` (with bytes) or one of
`NOT_FOUND`, `UNAVAILABLE`, `ACCESS_DENIED`, `TOO_LARGE` and
`INVALID_OBJECT`; raw vendor errors are never exposed. The contract file
contains no code.

**Parser.** `parseReferenceImage` validates the closed
`{ key, sha256, byteCount, contentType }` member and returns it frozen.
`parseGenerationRequestReferenceImage` reads only the optional
`generationRequest.referenceImage` member (null when absent).

- **Key:** the exact migration 0004 grammar, with no trimming,
  normalisation or path resolution: no dot segments, no `//`, no trailing
  `/`. A key such as `images/reference.webp` may look like a relative path,
  but it is only an opaque store key. Safety comes from the grammar plus
  store-only resolver confinement, not the grammar alone. A test uses
  `package.json`, a syntactically valid key naming a real file in the test
  working directory: the library receives `NOT_FOUND` from the store and
  never touches the filesystem.
- **SHA-256:** exact lowercase 64-hex. **Byte count:** a positive safe
  integer. **Type:** exactly `image/png`, `image/jpeg` or `image/webp`, with
  no aliases, parameters or video.
- **Alternate members** (`url`, `signedUrl`, `localPath`, `path`,
  `sourceImagePath`, `mediaRoot`, `file`, `uri` and others) are rejected
  inside `referenceImage`.

**Retrieval.** `retrieveVerifiedReferenceImage` runs, in order:
configuration validation, then the reference, then declared size within
`maxBytes` (no store call otherwise), then the store read, then the actual
size within `maxBytes`, the exact byte count, the SHA-256 and the
worker-local signature check (PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG
`FF D8 FF`; WebP `RIFF` at bytes 0 to 3 and `WEBP` at 8 to 11; no engine
media reader and no decoder). It returns a frozen verified result, with no
provider transformation, base64 or temporary file.

- **TOCTOU:** verification runs on a private copy of the returned bytes,
  and that copy is returned, so later changes to the store's buffer cannot
  alter the verified result. No secure-memory or deep-immutability claim is
  made.
- **Retry and deadlines:** at most two read attempts, retrying only
  `UNAVAILABLE`, each with a 10000 ms deadline under a fresh
  `AbortController` (through the existing `DeadlineTimer` seam). A deadline
  expiry counts as `UNAVAILABLE` and may take the one retry; two expiries
  end in `OBJECT_STORAGE_UNAVAILABLE` with no latch.
- **Store contract violations:** an unexpected throw or a malformed result
  is an invalid-object invariant failure: `OBJECT_INTEGRITY_MISMATCH`, latch
  tripped, with no thrown or vendor detail leaked.
- **Invalid composition:** a missing or invalid store, an invalid
  `accountId` or an invalid `maxBytes` fails closed with the existing
  `WORKER_CONFIGURATION_INVALID` and trips the latch. That is a caller
  failure, not a provider failure.

| Outcome | Worker error | Latch |
|---|---|---|
| malformed reference (no store call) | `OBJECT_REFERENCE_INVALID` | trip (interim) |
| declared size above `maxBytes` (no store call), `TOO_LARGE`, or more bytes returned | `OBJECT_TOO_LARGE` | trip (interim) |
| `NOT_FOUND` (including another account's key) | `OBJECT_NOT_FOUND` | trip (interim) |
| byte-count or SHA-256 mismatch, `INVALID_OBJECT`, store contract violation | `OBJECT_INTEGRITY_MISMATCH` | trip (interim) |
| signature disagrees with type | `OBJECT_MEDIA_TYPE_INVALID` | trip (interim) |
| `ACCESS_DENIED` | `OBJECT_STORAGE_ACCESS_DENIED` | trip |
| `UNAVAILABLE` twice, or two deadline expiries | `OBJECT_STORAGE_UNAVAILABLE` | no trip |

There is no provider classification and no control-plane transition. All
failures go through one `latch.trip()` site, and a static test pins
`OBJECT_STORAGE_UNAVAILABLE` as the only mapped error that does not trip.
Account isolation is proven: account A retrieves its object, and account B
gets `NOT_FOUND` for the same key, with no key-prefix parsing, so no
existence is disclosed.

(R44B10P2 docs sync.) The latch column and the single `latch.trip()` site
above record R44B10P1 as published. R44B10P2 (commit
395b4fd8958c9f7bdfd34a215c72cf450cb86de2) replaced that interim latch
ownership: retrieval keeps these worker errors but no longer takes a latch,
and classifies every failure as `PERMANENT_INPUT`, `TRANSIENT_STORAGE` or
`HOST_FAULT`; the caller-side `inputMediaFailurePolicy.ts` reports permanent
input failures and trips the latch only for host faults. The current
mapping is in section 18, "`input-failed` route". The parser, key grammar,
account isolation, `maxBytes`, SHA-256, byte-count and magic-byte checks,
fresh read deadlines and the unavailable-only read retry are unchanged.

**Errors.** Seven new closed codes in `workerError.ts`:
`OBJECT_REFERENCE_INVALID`, `OBJECT_NOT_FOUND`,
`OBJECT_STORAGE_UNAVAILABLE`, `OBJECT_STORAGE_ACCESS_DENIED`,
`OBJECT_TOO_LARGE`, `OBJECT_INTEGRITY_MISMATCH` and
`OBJECT_MEDIA_TYPE_INVALID`. Messages are fixed text with no key,
`accountId`, digest, URL, bytes, storage cause or credential. A test throws
vendor text containing a URL and proves it does not leak.

**Test store.** `tests/support/inMemoryObjectStore.ts` is test-only:
account-aware, deterministic, explicitly seeded and write-once, with a
mutation seam, a forced-result seam, a read-until-abort seam and a call
log. It uses no filesystem or network, and no `src` module imports it.
There is no production default: no filesystem, media-root, working
directory, temporary directory, fixture or in-memory fallback, and a
missing store fails closed.

**What did not change.**

- `OpenedAttemptContext` is unchanged: the library is unwired, and no
  runtime caller needs `generationRequest` after opening yet. The extension
  stays deferred to R44B10P2 or R44B10A.
- `providerExecutionContract.ts` is unchanged; storage contracts stay
  separate from the provider create-phase contract.
- The production modules have no dependency on `reportSubmissionFailed`,
  `createAcceptanceAdapter`, `obtainPreProviderPermit`,
  `runWithInFlightHeartbeat` or provider create. The library stops at
  verified bytes, with no attempt transition and no provider state.
- No API, protocol, migration or schema change; no new dependency or
  lockfile change; no storage SDK or vendor. No `fetch`, HTTP, `axios`,
  `undici`, S3, GCS, R2, Supabase or MinIO. No input filesystem resolver:
  no `fs.readFile`, `fs.createReadStream`, path resolution to an input,
  working-directory, temporary-directory or `BUSYBOOKIE_MEDIA_ROOT`
  fallback, and no `file://` resolver.
- `attemptExecution.ts` and `fakeProvider.ts` are byte-identical to R44B9.
  `BUSYBOOKIE_FAKE` is not wired to retrieval, and
  `FAKE_PROVIDER_EXECUTION_IMPLEMENTED` stays YES. Real-provider code is
  unchanged, `REAL_PROVIDER_EXECUTION_IMPLEMENTED` and
  `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED` stay NO, and no provider adapter
  exists.

**Boundary tests.** A new "object-storage input boundary" block proves:

- the library is unwired;
- imports are local and permitted;
- there is no filesystem resolver, network implementation or provider
  semantics;
- the contract is read-only;
- the store is used single-shot: one `.getObject(` call site, reached at
  most twice by the caller-level retry;
- the constants and key grammar match the migration source;
- the store is test-only, and there is no production default;
- the latch scope is pinned.

**Validation.**

- worker unit: 752/752 across 17 files (baseline 656/656 across 16): 84 new
  library tests, and the boundary suite grows from 85 to 97;
- worker integration: 40/40 across 3 files;
- R44B9 regression: fake provider 6/6, whole chain 15/15,
  `attemptExecution` 37/37;
- credential opening: integration 19/19, unit 56/56;
- commercial-api DB: 558/558 across 19 files;
- typecheck clean and `git diff --check` clean.

The tests cover the parser, valid PNG, JPEG and WebP, the key grammar, the
relative-looking opaque key, alternate-member rejection, SHA-256, byte
count, signatures, the zero-call declared-oversize case, actual oversize,
mutation, unavailable retries, distinct deadline signals, deadline as
unavailable, `NOT_FOUND`, `ACCESS_DENIED`, `TOO_LARGE`, store contract
violations, account isolation, a missing store, no fallback, the latch
mapping and the absence of provider semantics.

**Criterion reconciliation.** All 22 R44B10P1 implementation criteria are
satisfied:

1. a stable key-only reference;
2. the parser;
3. the account-authoritative store;
4. the in-memory test store;
5. no production default;
6. a bounded buffer read;
7. the two-attempt, unavailable-only retry;
8. a fresh 10000 ms deadline per attempt;
9. byte-count verification;
10. SHA-256 verification;
11. PNG, JPEG and WebP signature verification;
12. no URL;
13. no filesystem or media-root resolution;
14. cross-account isolation;
15. closed worker errors;
16. safe messages;
17. no new package;
18. no API, protocol or DB change;
19. the fake composer unchanged;
20. no real-provider code or network;
21. the mandatory tests;
22. boundary enforcement.

**Milestone.** R44B10P1 is fully closed: a storage-neutral,
account-authoritative, verified input-media abstraction and its test
implementation exist. That does **not** mean a production storage backend,
customer ingest, object lifecycle or retention, R44B10P2, a real-provider
adapter or live provider submission exists.

**R44B10P2 stays a hard gate.**
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=NO` and
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRED_BEFORE_REAL_PROVIDER=YES`. The
interim permanent-failure handling is acceptable only while the library is
unwired, and R44B10A stays blocked until R44B10P2 is implemented.

**Gate satisfied (R44B10P2 docs sync).** R44B10P2 is implemented (commit
395b4fd8958c9f7bdfd34a215c72cf450cb86de2) and fully closed:
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=YES`, while
`OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRED_BEFORE_REAL_PROVIDER=YES`
stays as the record that it was a prerequisite. The interim latch handling
is superseded by the classification and caller-side policy (section 18,
"`input-failed` route"). R44B10A may now begin its own sequence; no
production storage backend, vendor, real provider or live submission
exists.

**Locked decision (R44B10P1; implemented by R44B10P1, recorded by the
R44B10P1 docs sync).** This locks the input side
of section 36 step 9 as an **unwired** production library in
`apps/commercial-worker`, with an in-memory test implementation. It changes
no commercial-api route, protocol, migration or database schema, selects no
storage vendor (`OBJECT_STORAGE_VENDOR` stays `UNDECIDED`), adds no package
and no upload product, and wires nothing into execution. Real-provider
adapters, provider network, polling, output writes, object retention and
signed-URL issuing are outside it.

**Evidence (R44B10P0 discovery, revalidated; the state before R44B10P1,
now historical where the status above supersedes it).**

- `generation_authorizations.generation_request` is immutable jsonb: a
  non-empty object of at most 16384 bytes (migration 0003). The lease
  already delivers it opaquely as `WorkerLease.generationRequest`. No
  media-reference member is defined.
- Migration 0004 defines the only object identity in the repository, the
  storage-neutral output identity: `output_object_key`, `output_sha256`,
  `output_byte_count` and `output_content_type`.
- No object-storage abstraction, storage SDK, upload route or authorization
  issuer exists. The worker's only runtime dependency is the protocol
  package.
- The Google GenAI, Runway Gen-4.5 and Veo production paths all send image
  bytes inline. PNG, JPEG and WebP are accepted by all three.
- No control-plane route ends a granted `LEASED` attempt for a permanent
  pre-provider input fault. `release` refuses a granted lease, and
  `submission-failed` acts only from `SUBMITTING` with provider codes.

**Durable reference.** The durable commercial input is a **stable object
reference**, vendor-neutral. A signed or presigned URL, any HTTP URL, a
local filesystem path, a media-root path and a provider upload URI are
never the durable identity and are never persisted in `generationRequest`.
A future production store may use a transient signed retrieval capability
internally; it is never request identity.

**Reference-image member.** `generationRequest` may carry one optional
member, conceptually:

```text
referenceImage: { key, sha256, byteCount, contentType }
```

It is a closed object with exactly these four members. It has no bucket,
vendor, hostname, signed URL, local path, media root, account ID or
provider upload URL. Exact TypeScript names follow worker conventions.

- **`key`:** the migration 0004 grammar, unchanged: 1 to 512 characters,
  `^[A-Za-z0-9][A-Za-z0-9._/-]*$`, no `//`, no `.` or `..` segment
  (`(^|/)\.\.?(/|$)`) and no trailing `/`. The character set excludes `:`,
  `\`, whitespace and `?`, so no URL, scheme, Windows path, drive letter,
  UNC path or query can be represented, and a leading `/` is impossible.
  A valid key can still look like a relative filesystem path (for example
  `images/reference.webp`). The grammar alone does not distinguish a key
  from every relative path; safety also depends on resolver confinement
  ("Key interpretation" below).
- **`sha256`:** 64 lowercase hexadecimal characters (`^[0-9a-f]{64}$`), the
  repository convention. It proves the media bytes.
  `generationRequestSha256` proves request identity and never substitutes
  for it.
- **`byteCount`:** a positive safe integer.
- **`contentType`:** exactly `image/png`, `image/jpeg` or `image/webp`. No
  video. It is a claim, not proof.

**Ownership is relational.** Account ownership never comes from
`generationRequest`. The worker takes the authoritative `accountId` from the
validated credential-opening context and passes it to the store separately
from the reference. No account-prefix key grammar is invented: section 28's
"prefixed by tenant and job" defines no canonical string format, so binding
is enforced through the store's account context, not by parsing the key.
Production ingest may later lock physical key namespaces. A lookup under
the wrong account is indistinguishable from not found, so no existence
oracle crosses accounts.

**Store contract.** An injected, **read-only**, single-shot primitive,
conceptually `getObject({ accountId, key, maxBytes, signal })`, returning a
complete bounded byte buffer or a closed failure. It never retries, never
produces provider URLs, never writes, deletes, copies or signs uploads,
never exposes buckets or storage credentials, and never falls back to a
filesystem, the media root or any default. It must refuse, or abort, rather
than return more than `maxBytes`.

- **Buffer, not stream:** inputs are at most about 10 MiB, every candidate
  provider needs the bytes inline, and hashing and signature checks are
  simple on a buffer. A later revision may add streaming without changing
  durable identity.
- **Maximum size:** the caller supplies `maxBytes`, and the retrieval layer
  enforces it. Provider ceilings (for example Runway's data-URI limit and
  Google's 10 MiB) belong to the provider request schema or adapter, never
  to generic storage.
- **Closed store failures:** `NOT_FOUND`, `UNAVAILABLE`, `ACCESS_DENIED`,
  `TOO_LARGE` and an invalid-object invariant failure. Raw vendor errors,
  URLs, credentials and storage exception text are never exposed, stored or
  logged.

**Retrieval helper.** A production helper, conceptually
`retrieveVerifiedReferenceImage`:

1. validates the reference member (no store call if it is malformed);
2. refuses a declared `byteCount` above `maxBytes`;
3. reads through the injected store with the authoritative `accountId`;
4. requires the exact final length to equal `byteCount`;
5. requires the SHA-256 to equal `sha256`;
6. requires the PNG, JPEG or WebP signature to agree with `contentType`;
7. returns the verified bytes and safe metadata.

It does no provider-specific transformation. Signature checks are a small
worker-local validator (PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`;
WebP `RIFF`, four length bytes, `WEBP`), not an engine media-reader import
and not deep image decoding. Bytes are never accepted on storage metadata
alone, and an expected digest or size is never updated.

**Read retry.** Object reads are idempotent and are not provider create
(section 16). The caller retries: at most **two** attempts, retrying only
`UNAVAILABLE`, both immediate, each under its own **10000 ms** deadline (the
worker's established per-request deadline). `NOT_FOUND`, `ACCESS_DENIED`,
malformed references, oversize, byte-count, digest and signature mismatches
and unsupported types are never retried. No backoff, jitter or retry
dependency.

**Sequencing (for future real-provider composition).**

```text
lease -> provider admission -> credential grant/open -> authoritative accountId
-> retrieve and verify reference image (size, SHA-256, type, account authority)
-> only on success: pre-provider permit (journal prepare, SUBMITTING, heartbeat)
-> provider construction -> provider create
```

Retrieval completes before `SUBMITTING` and before any dispatch, so a
missing or corrupt input can never create an `OUTCOME_UNKNOWN` provider
state. It follows the grant and open because only the validated opening
context supplies the authoritative `accountId`; storage is never accessed
before account authority exists. Plaintext is not kept merely because
retrieval follows opening; credential re-open and lifetime belong to the
real-provider slice. There is no storage heartbeat: bounded retrieval, the
existing expiry checks, the authoritative `SUBMITTING` expiry refusal and
the mandatory heartbeat after `SUBMITTING` suffice. The library itself
stays unwired.

**Failure handling.** Provider dispatch is 0 in every case below, and no
provider-failure classification is used. The helper takes the injected
host-fault latch and trips it as stated.

| Case | Closed worker error | Latch | Report | Lease |
|---|---|---|---|---|
| malformed reference | `OBJECT_REFERENCE_INVALID` | trip (interim) | none | left to authoritative expiry and recovery |
| declared size above `maxBytes`, or store returns more | `OBJECT_TOO_LARGE` | trip (interim) | none | expiry and recovery |
| not found (including another account's key) | `OBJECT_NOT_FOUND` | trip (interim) | none | expiry and recovery |
| byte-count or SHA-256 mismatch | `OBJECT_INTEGRITY_MISMATCH` | trip (interim) | none | expiry and recovery |
| signature disagrees with type, or unsupported media | `OBJECT_MEDIA_TYPE_INVALID` | trip (interim) | none | expiry and recovery |
| access denied | `OBJECT_STORAGE_ACCESS_DENIED` | trip (host, deployment or authorization fault) | none | expiry and recovery |
| unavailable after two attempts | `OBJECT_STORAGE_UNAVAILABLE` | no trip | none | expiry and recovery |
| no store injected | `WORKER_CONFIGURATION_INVALID` (existing) | trip (configuration fault) | none | fails before any read |

Routine messages never contain the key, a signed URL, the account ID or a
raw storage cause.

**Interim permanent-failure semantics.** The "interim" rows are chosen
**only** because this library is unwired. A permanent input failure makes no
`submission-failed` report and is never classified
`PROVIDER_REJECTED_DEFINITIVELY`, because no provider was called. Failing
closed and leaving the lease to expire avoids any dishonest transition, but
granted-expired recovery requeues the attempt, so the same input fault
would recur. This is **not** approved behaviour for a real-provider worker.
(R44B10P2 docs sync: superseded. A permanent input failure is now reported
through the `input-failed` route without a latch, a transient outage trips
nothing, and only a host fault trips the latch; section 18, "`input-failed`
route".)

**Hard gate: R44B10P2.** Real-provider implementation (R44B10A) must not be
wired or enabled until an honest pre-provider input-failure control-plane
path exists. R44B10P2 must define an authoritative transition of a granted
`LEASED` attempt to a permanent pre-submission failure, without pretending
a provider was called and never using `PROVIDER_REJECTED_DEFINITIVELY`. It
needs its own architecture, API and protocol slice. No migration is
expected: the attempt guard already allows `LEASED ->
FAILED_BEFORE_SUBMISSION`, and the failure-code grammar
(`^[A-Z][A-Z0-9_]{0,63}$`) admits a suitable closed code. R44B10P1 does not
design its route, request body or status codes. (R44B10P2.) Two of these
expectations are superseded by R44B10P2 discovery: exact replay needs a
reporter-provenance migration (the transition itself still needs none), and
the shared protocol package does not change (route contracts live in the API
router and worker client). The locked contract is section 18, "`input-failed`
route (revision R44B10P2)". (R44B10P2 docs sync: the gate is satisfied; the
route, migration 0007, the worker client and policy are implemented in
commit 395b4fd8958c9f7bdfd34a215c72cf450cb86de2.)

**Signed URLs and SSRF.** A signed URL is never durable identity, never in
`generationRequest`, never journalled and never logged. If a production
store uses one, it is produced fresh per retrieval, and its host is never
chosen by request data. Production signed-retrieval ownership stays
undecided. Request data never chooses a host, scheme, port, redirect or DNS
target.

**Key interpretation.** A validated input-media key is interpreted **only**
as an opaque object-store key. Commercial-worker input-media code never
interprets it as a filesystem path: not relative to the working directory,
a temporary directory or the media root, and not as a host path. Security
rests on **both** of these:

- **A. Key grammar.** It rejects `http://`, `https://`, `file://` and every
  other scheme (`:` is forbidden), Windows drive paths (`:` and `\`), UNC
  paths (`\`), absolute Unix paths (the key starts with an alphanumeric),
  query-style syntax (`?`) and `.` and `..` segments (explicit segment
  rules).
- **B. Resolver confinement.** Only the injected store resolves the key.
  Production input-media code has no `fs.readFile`, no
  `fs.createReadStream`, no path resolution to an input, no working
  directory, temporary directory, `BUSYBOOKIE_MEDIA_ROOT` or local fixture
  fallback, and no `file://` resolver.

The grammar alone is not the local-path defence: a relative-looking key is
harmless because nothing in the worker resolves it against a filesystem.
Local-file traversal is excluded because dot segments and absolute,
Windows and UNC forms are rejected, and because keys reach only the store.

**Test store.** A test-only in-memory store,
`apps/commercial-worker/tests/support/inMemoryObjectStore.ts` (or an
equivalent name). It is deterministic and dependency-free, with no network,
filesystem or temporary files. Objects are seeded explicitly with an owning
account, and lookups go through the same production contract. It is
write-once by default, with an explicit test-only mutation seam for
integrity tests. It can simulate found, not found, unavailable, access
denied, mutated bytes and an oversized response. `src` never imports it.

**No production default.** The store is a required injection with no
default and no fallback to the working directory, a temporary directory,
the media root, `/var/lib/busybookie/media`, a fixture directory or the
in-memory store. Production code called without one fails closed.

**Parser scope.** The parser validates only the optional `referenceImage`
member. It rejects a non-object, missing or extra members, a bad key, a bad
hash, an invalid byte count and an unsupported type. The `key` field is
semantically an object key only; syntax cannot tell
`images/reference.webp` the key from the same text as a relative path, and
the parser does not try to. No alternate member (`localPath`, `path`,
`sourceImagePath`, `mediaRoot`, a URL or similar) is accepted inside
`referenceImage`, and no other `generationRequest` member is ever treated as
an input-media source. The validated key is passed only to the store, and no
production filesystem resolver consumes it. It does not validate
other `generationRequest` members; R44B10A locks the Google provider
request schema separately. The schema is worker-validated, so there is no
protocol response expansion and no migration.

**Request hash.** The worker cannot recompute `generationRequestSha256`
today: it is defined as the issuance service's canonical serialisation, no
issuer or recipe exists, and jsonb re-serialises the document. R44B10P1
therefore relies on database immutability for `generationRequest` and on
the media digest for the bytes. The canonical request-hash recipe stays a
later defence-in-depth and live-readiness gap.

**Mutation, deletion, ingest and output.**

- Digest verification is authoritative against mutation: changed bytes
  under a key fail retrieval. Production storage should later be write-once,
  but P1 does not depend on it.
- No retention duration and no lifecycle table are locked. A deletion
  before retrieval appears as not found. Retention or pinning until create
  stays a future live ingest and lifecycle requirement, unresolved.
- No upload route exists, and none is added; tests seed the in-memory
  store. Commercial ingest stays a live-readiness concern.
- The identity shape deliberately matches the migration 0004 output
  identity. P1 implements reads only; future output storage may extend the
  abstraction.
- In v1 inputs are held only as bounded in-memory bytes; nothing is written
  to the worker filesystem. `/var/lib/busybookie/media` is not the worker
  input contract, the worker state root stays
  `/var/lib/busybookie/commercial-worker`, and object storage is a separate
  logical boundary. No P1 code derives input from `BUSYBOOKIE_MEDIA_ROOT`.

**Expected implementation scope.** Worker only, with repository-equivalent
names:

- `src/objectStorageContract.ts` (store contract and closed failures);
- `src/inputMediaRetrieval.ts` (parser, verification and retrieval
  helper);
- `src/workerError.ts` (the seven new closed codes above; the missing-store
  case reuses `WORKER_CONFIGURATION_INVALID`);
- `src/credentialOpeningRun.ts`, only to add the immutable
  `generationRequest` (and only other non-secret leased request metadata
  genuinely required) to `OpenedAttemptContext`, never a credential;
- `src/providerExecutionContract.ts` only if a minimal generic extension is
  genuinely needed; no duplicate generic contract;
- `tests/support/inMemoryObjectStore.ts`, unit tests and boundary updates.

The R44B9 fake composer and `BUSYBOOKIE_FAKE` semantics are unchanged: no
credential, no media, endpoint `SUBMITTED`. The library is not wired into
it. No dependency is added, and Node built-ins suffice.

**Boundary rules.** Boundary tests prove the production storage and input
modules contain no `process.env`, `BUSYBOOKIE_MEDIA_ROOT`, filesystem read
or stream (`fs.readFile`, `fs.createReadStream`), path resolution of an
input, working-directory, temporary-directory or local-fixture fallback,
`file://`, `http://` or `https://`, provider SDK, Runway, Veo or Google
name, engine media-path import, or test-store import. Exact-token
allowances are added only where justified, and broad rules are not
weakened.

**Mandatory tests.**

- **Parser:** valid PNG, JPEG and WebP references; an invalid key; `//`; a
  `.` segment; a `..` segment; a trailing slash; a URL; a Windows path; an
  absolute Unix path; a UNC path; an alternate path- or URL-bearing member
  (rejected as an extra member); a malformed SHA-256; an invalid byte count;
  an unsupported type. A relative-looking valid key is accepted by the
  parser and reaches only the store, never the filesystem.
- **Retrieval:** success with exact byte count and SHA-256; PNG, JPEG and
  WebP signatures; a type and signature mismatch; byte-count and SHA-256
  mismatches; an object above `maxBytes`; a declared byte count above
  `maxBytes`; a missing object; unavailable then success; unavailable twice;
  access denied; a cross-account lookup denied.
- **Retry:** one success is one store call; unavailable then success is two;
  a second unavailability stops at two; `NOT_FOUND`, `ACCESS_DENIED` and
  integrity failures are not retried; a malformed reference makes zero
  store calls; deadlines use injected time.
- **Account authority:** with object `X` seeded for account A, A can
  retrieve `X` and account B cannot, even knowing the key.
- **No fallback:** no injected store fails closed; no local-path, working
  directory, temporary directory or media-root fallback; `src` cannot import
  the in-memory store.

**Completion criteria.** R44B10P1 is complete only when a published
implementation proves:

1. a stable key-only reference shape;
2. the `referenceImage` parser;
3. the account-authoritative store contract;
4. the in-memory test store;
5. no production default store;
6. bounded reads;
7. the two-attempt, unavailable-only caller retry;
8. byte-count verification;
9. SHA-256 verification;
10. PNG, JPEG and WebP signature verification;
11. no URL;
12. no local or media-root path;
13. cross-account isolation;
14. closed errors;
15. secret- and URL-safe logging;
16. unit and boundary tests;
17. the fake composer unchanged.

Even then, R44B10A real-provider implementation stays **blocked** until
R44B10P2 provides the honest pre-submission input-failure route.
(R44B10P2 docs sync: provided; R44B10A is now eligible for its own sequence.)

**Status and flags.** For R44B10P1 itself there is no new API endpoint, no
lease response expansion, no protocol change, no migration and no new
dependency. R44B10P2 will need an API and protocol change, and current
evidence indicates no migration. (R44B10P2, superseding that expectation:
P2 needs an additive API and wire-contract change in the API router and
worker client, no shared protocol-package change, and one migration for
exact-replay reporter provenance; section 18, "`input-failed` route".)
(R44B10P1 docs sync.)
`OBJECT_STORAGE_PRODUCTION_IMPLEMENTED` means a real vendor-backed
production `ObjectStore`, and stays NO;
`OBJECT_STORAGE_INPUT_LIBRARY_IMPLEMENTED` and
`OBJECT_STORAGE_TEST_IMPLEMENTATION_IMPLEMENTED` record the input library
and the in-memory test store, both YES. Completing this abstraction is not
real-provider implementation: `FAKE_PROVIDER_EXECUTION_IMPLEMENTED=YES`,
`PROVIDER_FAILURE_COMPOSITION_IMPLEMENTED=YES`,
`REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO` and
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` are unchanged.

**Still open for live enablement** (none blocks the P1 abstraction or its
test implementation): the production object-storage vendor; production
storage credential injection (distinct from the worker-control credential,
provider credentials and the opener key); ingest and upload; issuer
validation of reference ownership and existence; object retention; the
deletion lifecycle; the canonical request-hash recipe; and production
signed-retrieval ownership, if one is used.

```text
OBJECT_STORAGE_INPUT_CONTRACT_LOCKED=YES
OBJECT_STORAGE_PRODUCTION_IMPLEMENTED=NO
OBJECT_STORAGE_TEST_IMPLEMENTATION_IMPLEMENTED=YES
OBJECT_STORAGE_INPUT_LIBRARY_IMPLEMENTED=YES
OBJECT_STORAGE_INPUT_REFERENCE_TYPE=KEY_PLUS_INTEGRITY
OBJECT_STORAGE_INPUT_SIGNED_URL_DURABLE=NO
OBJECT_STORAGE_INPUT_ARBITRARY_URL_ALLOWED=NO
OBJECT_STORAGE_INPUT_LOCAL_PATH_ALLOWED=NO
OBJECT_STORAGE_INPUT_MEDIA_ROOT_ALLOWED=NO
OBJECT_STORAGE_INPUT_MAX_READ_ATTEMPTS=2
OBJECT_STORAGE_INPUT_READ_RETRY=UNAVAILABLE_ONLY
OBJECT_STORAGE_INPUT_READ_DEADLINE_MS=10000
OBJECT_STORAGE_INPUT_SHA256_REQUIRED=YES
OBJECT_STORAGE_INPUT_BYTE_COUNT_REQUIRED=YES
OBJECT_STORAGE_INPUT_MAGIC_BYTES_REQUIRED=YES
OBJECT_STORAGE_INPUT_ALLOWED_CONTENT_TYPES=image/png,image/jpeg,image/webp
OBJECT_STORAGE_INPUT_ACCOUNT_AUTHORITY=RELATIONAL_CONTEXT
OBJECT_STORAGE_INPUT_TEST_STORE=IN_MEMORY_INJECTED_NO_DEFAULT
OBJECT_STORAGE_INPUT_PROVIDER_DISPATCH_BEFORE_VERIFICATION=NO
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRED_BEFORE_REAL_PROVIDER=YES
```

(R44B10P2 docs sync: `OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED` is YES
since commit 395b4fd8958c9f7bdfd34a215c72cf450cb86de2; every other flag
above is unchanged.)

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
`credentialVersion` (the number), `failureCode`, `recoveredFromJournal` and
`grantedLeaseRecovered`. (R44B6X.) `grantedLeaseRecovered` is the boolean
`true`, present only on `execution_attempt.lease_expired` for a
granted-but-expired `LEASED` recovery (section 12); the ordinary ungranted
reclaim's `lease_expired` omits it. It carries no secret material.

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
| `WORKER_SUBMISSION_FAILURE_REJECTED` | Implemented (R44B6T), together with the new reason `FAILURE_CODE_OUTCOME_MISMATCH`. The existing lease reasons, plus `INCOMPATIBLE_ATTEMPT_STATE` and `FAILURE_CODE_OUTCOME_MISMATCH`. (R44B6T0.) The replay path uses the existing `SUBMITTING_PRINCIPAL_MISMATCH` and `FENCING_MISMATCH` for a failed original-epoch proof; `FAILURE_CODE_OUTCOME_MISMATCH` is classified only after authority is proven; a successful first transition or exact replay emits no rejection event, and a `400 INVALID_REQUEST` is not a security event. |
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

(R44B7A.) Slice 7 tests only the rows from `SUBMITTING` through durable
`SUBMITTED`, plus terminal journal cleanup through a labelled fixture
(section 36, "Whole-chain crash-point test contract"). The rows for
`SUBMITTED` polling or recovery, provider success before output
persistence, missing upstream completion and an already-terminal server
stay locked here. Their tests belong to the slices that implement those
phases.

| Crash point | Durable state | Rule |
|---|---|---|
| Before lease | job `QUEUED` | No side effect. |
| Leased, before credential grant | `LEASED` | The lease may expire or be released normally. |
| Credential granted, before `SUBMITTING` | `LEASED`, grant audited | A credential-retention obligation exists. If the lease is definitively revoked and no provider call occurred, the obligation can close. (R44B6X0.) Once the lease expires by server time while the row is still `LEASED`, provider-call authority provably never committed: the control plane requeues it (`LEASED -> QUEUED`, grant and lease cleared, job `QUEUED`; section 12). Not `OUTCOME_UNKNOWN`. Implemented (R44B6X). A row that already committed `SUBMITTING` is instead owned by the existing `SUBMITTING` sweep. |
| `SUBMITTING`, provider call in flight | `SUBMITTING` | A provider-recovery obligation exists. A crash or ambiguous network outcome becomes `OUTCOME_UNKNOWN`. Never auto-resubmit. |
| Provider accepted, local journal durable | journal entry | On restart, report the same provider ID upstream. No resubmission. (R44B6Y0.) Without a restart, the outer acceptance adapter reports `submitted`, or hands the record to acceptance recovery; `submission-failed` is never used. |
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
state also block. R44B6R implements the control-plane acceptance-recovery
behavior used by B, B', C and E below. (Revised R44B6S1.) R44B6S implements
the worker client and startup calls: after the local phase, each valid
final (including one completed from case G) is recovered in lexical order
under its own bounded budget, so B', C and terminal same-ID replays can
reach `CLEAR`, while B (until a later authoritative sweep) and E fail
closed. No recovery lease is created.

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

**Step 9 status (R44B10P1 docs sync).** Step 9 is **complete for its input
scope**: the object-storage input abstraction and its in-memory test
implementation exist (R44B10P1, commit
192a97e7eca1c1c17378ccc10821e662eb96f77f; section 28, "Object-storage input
contract"). It is not recorded as wholly complete, because the R44B10P1 lock
covers only the input side; the output-write side of the abstraction is not
implemented. The following are separate and none is implied:

- step 9 input scope complete;
- a production storage backend (none; the vendor is undecided);
- real-provider readiness (R44B10A create-to-`SUBMITTED` implementation
  complete; separate live-readiness blockers remain);
- live provider submission (disabled).

**Step 11 status (R44B10P2 docs sync).** The R44B10P2 prerequisite is
satisfied (commit 395b4fd8958c9f7bdfd34a215c72cf450cb86de2; section 18,
"`input-failed` route"), so step 11 is no longer blocked on it. Step 11 is
**not started**: R44B10A must first lock and implement its own contract.
Real-provider execution and live provider submission stay disabled, and
step 9 still has no production storage backend.

**Step 11 status (R44B10A contract lock).** The step 11 contract is now
locked: the first real provider is Google GenAI Interactions
(`GOOGLE_GENAI`, `gemini-omni-1.1-flash`), ending at `SUBMITTED` (section 36,
"First real-provider adapter: Google GenAI (revision R44B10A)"). Its
implementation is **not started**; the provider flags stay NO.

**Step 11 status (R44B10A docs sync).** The contract-lock paragraph above is
the historical lock-time state. R44B10A implementation is now validated and
published in commit `aefd2ea95cc0d11652596fd2e099262bc4a945ac`. The
create-to-`SUBMITTED` real-provider slice therefore satisfies
`REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES`. This does not enable provider
submission from normal production startup:
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`. Production object storage,
production issuer/provider credentials and KMS readiness, section 24's
destruction lifecycle, the live `SUBMITTED` capacity lifecycle, a process
runner and deployment, controlled live validation, polling, output
persistence and completion remain open.

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
   (section 18). The live `submitted` route is implemented (R44B6O). The
   control-plane `acceptance-recovery` route is implemented (R44B6R), and
   its worker client and startup wiring are implemented (R44B6S). The
   control-plane `submission-failed` route is implemented (R44B6T). Its
   worker client and the acceptance adapter that alone calls `submitted`
   and `submission-failed` are implemented (R44B6Y); no live worker flow
   calls them. (R44B9.) The development-only fake-provider composer is
   their only production caller.
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
   only `CLEAR` permits fresh work. Valid published acceptance is recovered
   through the control-plane route (R44B6R) by the worker
   acceptance-recovery client and startup wiring (R44B6S), and keeps
   blocking unless exactly acknowledged.
7. Whole-chain crash-point tests, narrowed by R44B7A ("Whole-chain
   crash-point test contract" below). They cover the section 31 rows from
   `SUBMITTING` through durable `SUBMITTED` and restart cases A to H, plus
   terminal journal cleanup through a labelled fixture. Faults are injected:
   - at the journal steps;
   - before and after control-plane commits;
   - on lost responses;
   - on authoritative lease expiry;
   - on a restart with a valid journal while the `SUBMITTING` lease is still
     live, which must wait for the authoritative expiry (R44B6K1).

   The polling, output, completion and recovery-lease rows are deferred to
   their own slices. The negative test for a create client whose retry is
   not disabled (R44B6K1) moves to the future provider-create adapter slice
   (section 16). Implemented by R44B7 (commit
   d76128011804013c1d40877bbe66f435b4f78c03; recorded by R44B7B) in
   `apps/commercial-worker/tests/integration/wholeChainCrashRecovery.test.ts`.

R44B6Q adds focused local startup crash/restart tests, including exact
temporary publication and interrupted quarantine. R44B6R adds control-plane
recovery, replay, concurrency, expiry-handoff and rollback coverage. R44B6S
adds worker recovery-client, retry-policy, retention and startup-wiring
coverage, including end-to-end recovery against the real router. R44B6T
adds control-plane `submission-failed` coverage: both outcomes, every
failure-code pair, exact replay, replay conflicts, sweep evidence, audit
rollback and concurrency. These
do not complete the whole-chain crash-point coverage required by slice 7.
R44B7 completes it ("Whole-chain crash-point test contract" below).

The worker client for the `SUBMITTING` acknowledgement is implemented
(R44B6U, section 15: single-shot and client-only). (R44B9.) It is called
only through the pre-provider orchestration, whose only production caller
is the development-only fake-provider composer.

**A fake provider adapter may execute only after slices 1 to 7 exist.** As
of R44B8B, **no item is missing: the pre-fake-provider gate is complete.**
(R44B8.) The final item, the production/deployment state-root binding, is
satisfied by R44B8P0 (the runbook path), R44B8A (the contract) and commit
c733b9450f143ab56e5c17f2e67c2c1e4a5d5ab5 (the implementation): section 17,
"State-root binding". (R44B7.) The
whole-chain crash-point prerequisite (slice 7) is satisfied by the tier-3
tests of "Whole-chain crash-point test contract" below. They use test-only
composition; no production provider orchestrator exists. (R44B6Z.) The in-flight
heartbeat prerequisite is satisfied at component level: the generic
keeper `runWithInFlightHeartbeat` is implemented (section 15), unused by
live execution. Its component tests do not satisfy the whole-chain
crash-point item. (R44B6Y.) The
acceptance-handler adapter prerequisite is satisfied: the inner durable
handler, the outer reconciliation adapter, the `submission-failed` client
and the host-fault latch are implemented (section 18), unused by live
execution. The worker heartbeat client
(R44B6W) and the pre-provider orchestration (R44B6V: `journal.prepare()`,
then the `SUBMITTING` acknowledgement, then the mandatory heartbeat, then the
permit) are implemented (section 15); neither is used by live execution, and
neither touches a provider. Granted-but-expired `LEASED` recovery is
implemented (R44B6X, section 12), meeting every removal condition R44B6X0
set: attempt and job recovery work, stale control-plane proofs are refused,
the requesting worker's capacity is released, the races are covered and the
audit is recorded. The credential-version retention gap it identified stays
separately tracked: destroying a `RETAINED_FOR_RECOVERY` version when its
final obligation closes needs the lifecycle service of section 24, which
R44B6X did not implement. Its classification is unchanged: section 24's
"launch-blocking invariant" before commercial generation, not an item of
this fake-provider gate.

There are **zero** remaining unmet items. Historically (R44B6K to R44B8A)
the gate listed, in turn:

- the acceptance-handler adapter (R44B6Y);
- the in-flight heartbeat (R44B6Z);
- the whole-chain crash-point tests (R44B7);
- the production/deployment state-root binding (R44B8).

Each protected the window between `SUBMITTING` and a durable `SUBMITTED`,
which is the first thing a fake provider exercises.

**PRE-FAKE-PROVIDER GATE = COMPLETE.** The architecture prerequisites for
starting a separate fake-provider execution slice are satisfied. That does
**not** mean:

- fake-provider execution exists or is enabled;
- a worker process runner exists (the package stays "never started by
  default");
- a provider adapter exists;
- real provider execution exists;
- production provider submission is enabled.

The R44B7 controlled thunk was test-only composition, not a fake-provider
implementation.

(R44B9B.) Those bullets state what completing the gate meant on its own.
Development-only fake-provider execution has since been implemented by
R44B9 as a separate post-gate milestone ("First fake-provider execution
slice" below). The remaining bullets still hold: there is no worker process
runner, no real-provider adapter, no real-provider execution and no live
provider submission. The R44B7 thunk remains test-only and does not count.

**Next-slice boundary.** The next phase **may** begin a separate
fake-provider execution slice. That slice must lock and address its own
contract, including where applicable:

- the production runner and composer;
- the provider-create adapter boundary, with SDK create retry disabled or
  refused when not guaranteed (section 16);
- the pre-provider permit, the in-flight heartbeat keeper and the
  acceptance adapter;
- failure and outcome composition;
- no real provider network in fake-provider mode.

R44B8B designs and implements none of it. (R44B9A.) That contract is now
locked in "First fake-provider execution slice" below, as a new post-gate
phase. The gate stays complete. (R44B9.) That slice is implemented, in
commit e57d2b77af6f61d8548e39c84f4741874806ea8f, recorded by R44B9B.

**Separate items, still open.** These are separate readiness domains that
neither block nor reopen this gate:

- the live-route `SUBMITTED` lease and capacity lifecycle (below);
- real-provider-specific failure classification in the future real
  adapters. (R44B9.) The generic production provider-failure composition is
  implemented;
- the SDK create-retry obligation of the future provider-create adapter;
- section 24's credential-version retention and destruction lifecycle,
  which stays launch-blocking.

`REAL_PROVIDER_EXECUTION_IMPLEMENTED` and
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED` stay NO. (R44B9B.)
`FAKE_PROVIDER_EXECUTION_IMPLEMENTED` and
`PROVIDER_FAILURE_COMPOSITION_IMPLEMENTED` are YES.

The following may come after the first fake-provider slice, which stops at
`SUBMITTED`, because they act only after a durable provider identity exists
or before any provider authority exists:

- recovery leases and recovery-scoped credential grants for `SUBMITTED`. A
  recovery lease never inherits live-route `SUBMITTED` heartbeat authority
  (section 12, R44B6M2);
- polling, output persistence and completion (steps 9 and 10);
- (R44B7B) release of a retained live-route `SUBMITTED` lease. The live
  `submitted` route keeps its lease (section 18), and that lease keeps
  counting against the worker's capacity. Automatic reclaim today covers
  only expired `SUBMITTING` attempts (the sweep) and expired granted
  `LEASED` attempts (section 12); it does not reclaim an expired live-route
  `SUBMITTED` lease. So after a restart, a single-slot worker can stay
  unable to lease further work until the post-`SUBMITTED` lifecycle
  (polling, completion or recovery leases) handles that attempt. R44B7 case
  5 shows this as current behaviour. It is not an R44B7 failure: the slice
  7 endpoint is `SUBMITTED`, and acceptance recovery succeeded. This item
  belongs with that later lifecycle work, outside the current gate;
- resolution of an expired `LEASED` attempt that holds a credential grant.
  This is a liveness gap with no provider side effect.

```text
FAKE_PROVIDER_EXECUTION_GATE=SECTION_36_SLICES_1_TO_7
FAKE_PROVIDER_EXECUTION_IMPLEMENTED=YES
REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO
```

### Whole-chain crash-point test contract (revision R44B7A)

**R44B9 reconciliation (R44B9B).** This subsection records R44B7 and is
unchanged. Its statements that no production provider orchestrator exists
and that production provider-failure composition is missing describe the
state at R44B7. R44B9 has since implemented both, for development-only
fake-provider execution only ("First fake-provider execution slice"
below), keeping the order tested here. The R44B7 `controlledProvider()`
thunk remains test-only and is not the implementation.

**Status (R44B7; recorded by R44B7B).** Implemented in commit
d76128011804013c1d40877bbe66f435b4f78c03 as one new test-only integration
file, `apps/commercial-worker/tests/integration/wholeChainCrashRecovery.test.ts`.

- There is no shared-helper extraction, no production source change and
  no change to `workerCredentialOpening.test.ts`.
- The contract below is unchanged, and this is not merely more component
  testing. It proves the previously missing cross-component property: a
  real database commit, a lost response, a durable journal, discarded
  process-local state, a restart, authoritative convergence and no provider
  resubmission.

**Harness.** Tier 3, composed in test code:

- the worker's production components;
- the real `WorkerControlClient` over HTTP;
- the real commercial-api router and services;
- the real guarded PostgreSQL test database;
- the real temporary-directory acceptance journal.

The only stand-ins are:

- the test-only controlled provider-event thunk, which is not fake-provider
  execution;
- injected deterministic timing;
- lost-response injection in the transport;
- journal `JournalFileSystem` fault injection.

No production provider orchestrator exists. Production still does not
compose runner → permit → create → keeper → adapter, and the later composer
must keep the order tested here. No live-use or provider flag changes.

**Results.**

| Suite | Result |
|---|---|
| Whole-chain file | 15/15, on three consecutive runs |
| Existing worker integration file | 19/19 |
| Full worker integration | 34/34 across 2 files |
| Worker unit | 538/538 across 13 files |
| commercial-api DB | 558/558 across 19 files |
| Typecheck, `git diff --check` | clean |

There were no unhandled errors and no provider call.

**Restart and dispatch safety.**

- Where dispatch occurs, the thunk is dispatched exactly once, and
  restarted processes add zero dispatches. Startup recovery never
  resubmits.
- A restart keeps PostgreSQL and the journal state root. It recreates the
  client, transport, journal object, latch, timing and other process-local
  objects. The old process's I/O is frozen, so abandoned work cannot touch
  the restarted scenario. There is no real OS kill.

**Cases.**

| Case | Result |
|---|---|
| 1 | One dispatch with no durable record, then crash and expiry; restart runs the real sweep. Attempt `OUTCOME_UNKNOWN` (`WORKER_LEASE_EXPIRED_DURING_SUBMISSION`), job `NEEDS_ATTENTION`, journal absent, dispatch count 1; one `outcome_unknown` audit and no `submitted` audit. This is an accepted residual, not a defect. |
| 2 | The complete temporary bytes survived and no `submitted` report was sent. Restart published exactly those bytes, removed the temporary, and reached `SUBMITTED` through real TX1/TX2. Job `RUNNING`, lease cleared under the recovery path, record retained; one recovered `submitted` audit and one `outcome_unknown` audit. |
| 3 | The torn temporary was quarantined unchanged, with the startup quarantine event. No acceptance was fabricated and nothing was reported. Attempt `OUTCOME_UNKNOWN`, `provider_execution_id` null, job `NEEDS_ATTENTION`. |
| 4A | With the lease live, the attempt stays `SUBMITTING`. Startup recovery sees `ATTEMPT_STILL_SUBMITTING` over 18 requests, with backoffs 1000, 2000, 4000, 8000 and 13 × 10000 (145000 ms of fake time), then fails closed with `ACCEPTANCE_RECONCILIATION_FAILED`. Record bytes unchanged, no `submitted` audit. This is correct fail-closed behaviour. |
| 7 (folded into 4A) | Restart 1 saw `ATTEMPT_STILL_SUBMITTING` and crashed during its first backoff; restart 2 ran a completely fresh 18-request budget. No local recovery counter survives a restart. |
| 4B | With the lease expired, restart made exactly two requests, recovery then leases. Attempt `SUBMITTED`, failure code null, job `RUNNING`, record bytes unchanged; one recovered `submitted` audit and one `outcome_unknown` audit. |
| 5 | The live `/submitted` commit is proven from the database: `SUBMITTED`, with the live lease kept by the worker, and the response was lost. On restart, acceptance recovery replays `SUBMITTED` (200). The following lease request is refused with `LEASE_REJECTED`, because the kept live-route lease still holds the worker's only slot; this is current behaviour, deferred in section 36. One live-route `submitted` audit (not recovered), no expiry audit, record retained. |
| 6 | Two variants: (A) two unavailable live reports, crash before recovery, expiry, restart; (B) a real live-report 409 after database expiry, crash before recovery, restart. Each reaches `SUBMITTED` with one recovered `submitted` audit, and no `submission-failed` request occurs. |
| 8 | The live report gets a real 409; acceptance recovery commits `SUBMITTED` and its response is lost. The database shows `SUBMITTED` before the restart. Restart replay returns 200 with no duplicate transition; one `submitted` audit and one `outcome_unknown` audit. |
| 9 | Two variants, no crash: (A) one renewal succeeds, the database expires the lease, the next heartbeat gets 409, the keeper stops and the operation stays pending; (B) both attempts of a tick are unavailable, the cadence continues, and the database expires the lease. In both, the late acceptance is journaled, the live report gets 409, recovery TX1/TX2 reach `SUBMITTED`, the operation resolves, the latch stays clear, the keeper joins and the dispatch count stays 1. Loss of heartbeat authority never abandons a later acceptance. |
| 10 | Two consecutive restarts replay the retained `SUBMITTED` record (recovery-path `SUBMITTED`, lease cleared); each new process starts with a clear latch; record bytes and audit trail are identical; no resubmission. This is distinct from case 5's live-route capacity condition. |
| 11 | **TEST TERMINAL FIXTURE — NOT PROVIDER POLLING**: a guarded fixture moves `SUBMITTED` to `ABANDONED` (`RECOVERY_ABANDONED`). On restart, recovery replays `ABANDONED`, the exact record is removed and the attempt stays `ABANDONED`. This proves journal cleanup only, not polling or terminal provider execution. |
| Optional | **HARNESS-LEVEL CONTROL-PLANE ASSERTION — NOT PRODUCTION PROVIDER-FAILURE COMPOSITION**: after lease loss and `OUTCOME_UNKNOWN`, `reportSubmissionFailed` returns `SUBMISSION_FAILED_REJECTED` and the unknown state is unchanged. Production provider-failure composition stays missing. |

**Replay of a live-route `SUBMITTED`.** Both source and runtime prove that
the same principal, the same epoch fence and the same provider execution ID
replay an already live-route `SUBMITTED` attempt with 200, writing no
duplicate transition or audit. This confirms the lock.

**Assertions.**

- **Audit:** `submitted` and `outcome_unknown` cardinalities, and
  `recoveredFromJournal` identity where applicable. No heartbeat audit is
  invented, and no duplicate transition audit appears after a lost-response
  replay.
- **Journal:** retained bytes compared before and after each replay, exact
  record-directory contents, quarantine file names, and exact terminal
  removal. Journal identity is preserved across simulated restarts.
- **Secrets:** journal files and audit text are scanned for the lease
  token, worker credential and plaintext, and failure messages and stacks
  are scanned too. Fixture credentials only, with no authentication bypass.
- **No provider network:** every recorded request starts with the test
  server's `/worker-control/v1/` family. The file has no provider SDK or
  execution-layer import, no provider environment read and no Runway, Veo
  or Google construction. Startup runs with `environment: {}`.
- **Determinism:** heartbeat sleeps, request deadlines and recovery time
  are injected, and expiry uses SQL. The only real waits are short polls
  for real HTTP and filesystem completion. Abandoned continuations are
  frozen and observed, so nothing is left unhandled.

**Unchanged obligations.**

- The future provider-create adapter must still prove that create retry is
  disabled, failing closed otherwise (section 16). R44B7 does not satisfy
  that.
- Production composition from definitive or ambiguous create outcomes to
  the right reporting or recovery path stays missing.
- Polling, output and completion were not tested.
- The provider flags stay NO and section 24 is unchanged. At R44B7B the
  production/deployment state-root binding was the sole remaining gate
  item; R44B8 has since satisfied it, and the gate is complete (R44B8B).

**Locked decision (R44B7A; implemented by R44B7).** R44B7 discovery was blocked
by slice 7's wording, which conflicted with the architecture in two places:

- "every row of the section 31 matrices" included the polling, output,
  completion and recovery-lease rows, which this section defers past the
  first fake-provider slice;
- it required refusing a create client whose retry is not disabled, but no
  commercial provider-create adapter exists to enforce that.

This lock narrows slice 7. It changes no source, route, protocol or
migration, adds no fake or real provider, adapter or production
orchestrator, and implements no test.

**Whole chain.** The chain under test is:

```text
real worker production components
-> real WorkerControlClient HTTP requests
-> real commercial-api router and services
-> real guarded PostgreSQL test database
-> real filesystem acceptance journal
```

A **test-only** controlled provider-operation thunk stands in for provider
execution. The participating components, where relevant, are:

- worker: `WorkerControlClient`, `obtainPreProviderPermit`,
  `runWithInFlightHeartbeat`, `createDurableAcceptanceHandler`,
  `createAcceptanceAdapter`, the acceptance journal, `reportSubmitted`,
  acceptance recovery, and startup reconciliation through the real startup
  entry point;
- control plane: the worker-control routes, the lease and state services,
  the `SUBMITTING` expiry sweep, and database transactions and locks.

The chain needs no provider SDK, adapter, port, factory, selector, provider
credential or provider network request.

**Test-only composition.** Test code may compose the published components,
conceptually:

```text
obtainPreProviderPermit
-> runWithInFlightHeartbeat(operation = controlled thunk -> createAcceptanceAdapter when acceptance is injected)
```

- That is not a production execution orchestrator, and it sets neither
  `FAKE_PROVIDER_EXECUTION_IMPLEMENTED` nor
  `REAL_PROVIDER_EXECUTION_IMPLEMENTED` to YES.
- The absence of a production orchestrator does **not** block slice 7.
  Slice 7 comes before fake-provider execution precisely to prove that the
  built durability and control-plane components compose safely before any
  provider is connected; none is manufactured for the gate.
- The later production composer must keep the order proven here.

**Tier 3 is mandatory.** Every mandatory case uses:

- the worker's production components;
- the real `WorkerControlClient` over HTTP;
- the real in-process commercial-api application;
- the real guarded test PostgreSQL database;
- a real temporary-directory journal.

Pure worker mocks would mock away the authoritative state, lease expiry,
the sweep, recovery TX1/TX2, replay idempotence, real commit-then-lost
responses and row-lock serialisation. Component tests with fake clients
stay useful but never satisfy slice 7.

**Controlled operation.** The thunk is test-only. It may expose test events
such as dispatched, pending, accepted, definitively rejected and ambiguously
failed. It is not a fake provider adapter or subsystem, a real provider or
an SDK client. No provider URL is contacted, no provider environment
variable is needed and no paid call occurs.

**Scope.** Slice 7 tests only the crash and restart boundaries from:

```text
pre-provider and SUBMITTING
-> provider-submission uncertainty
-> durable acceptance
-> live submitted reporting
-> acceptance recovery
-> authoritative SUBMITTED
```

It also tests terminal journal cleanup through a labelled fixture. Rows
whose substance needs any of the following stay deferred to the slices that
implement them; the section 31 matrices themselves are unchanged:

- polling;
- output retrieval or persistence;
- completion processing or publication;
- resumption under a recovery lease;
- any later provider-result lifecycle.

**Retry-guard obligation.** The negative test for a create client whose
retry is not disabled is removed from slice 7 and **kept** as an obligation
of the future provider-create adapter or provider-wiring slice. That slice
must test that create retry is disabled and must fail closed when the
no-retry configuration cannot be guaranteed. The invariant itself is not
weakened (section 16), and no adapter is invented to test it now.

**Boundaries.**

- **Start.** After a real lease acquisition and credential grant, which
  fixture setup may create, at `obtainPreProviderPermit` with the real
  client. The queue scheduler and work-acquisition loop are outside the
  chain.
- **End.** Either:
  - success: attempt `SUBMITTED` with the durable record retained (v1
    rule);
  - conservative residual: attempt `OUTCOME_UNKNOWN` with the job
    `NEEDS_ATTENTION`, where the provider outcome cannot be reconstructed.

  Polling and provider terminal success are not endpoints.

**Restart model.** A crash discards the process-local object graph.

| On restart | Items |
|---|---|
| Recreated | the `WorkerControlClient`, orchestration and acceptance components, any keeper, the timing objects, and a new clear host-fault latch |
| Preserved | PostgreSQL state, the journal state root and its durable files |

- No timer, retry counter, keeper or latch state survives, and no real OS
  kill is needed. The durability boundary under test is persistent database
  and filesystem state, not heap continuity.
- Restart cases go through the real startup entry point,
  `runCredentialOpeningOnce` (startup journal inspection, reconciliation,
  then the existing recovery policy), never an internal helper merely for
  convenience.
- The latch is never written to the journal, database or audit metadata;
  tests may assert the journal holds none. Keeper heartbeats, requests and
  stop state never resume, and none is restored.

**Mechanisms.**

- **Journal.** The real temporary-directory journal. Crashes are simulated
  through the existing `JournalFileSystem` seam: before durable publication,
  after temporary persistence, before and after final publication, and at
  corruption and quarantine boundaries. Never an in-memory journal.
- **Expiry.** The established guarded test-database mechanism (migrator SQL
  setting `lease_expires_at` before database `now()`). No real 120-second
  waits, and worker time is never lease authority.
- **Lost response.** The real request reaches the real API and its
  transaction commits; only then is the client-visible response suppressed.
  An artificial client error before the server receives the request is
  never a substitute.
- **Provider operation count.** The thunk runs at most once in the first
  simulated process, and exactly once where dispatch occurs. Restarted
  processes invoke it **zero** times for that attempt. Startup recovery
  never resubmits.

**Mandatory crash set.** Each case asserts its own outcome; parameterised
variants are allowed where assertions and failure location stay distinct.
The count is not inflated to mirror component tests.

| Case | Scenario | Expected result |
|---|---|---|
| 1 | Pre-durable dispatch residual: thunk invoked once, no durable record, crash, then deterministic expiry and sweep | `OUTCOME_UNKNOWN` / `NEEDS_ATTENTION`; restart invokes the thunk zero times. A crash after `SUBMITTING` but before dispatch, and an acceptance held only in memory, converge the same way and may be combined here. |
| 2 | Valid temporary journal file only (final publication not done), crash, restart | startup completes the publication of the exact record; ordinary reconciliation; no resubmission; exact journal state asserted |
| 3 | Invalid temporary artifact, crash, restart | handled or quarantined exactly per the existing journal policy; never turned into acceptance; no resubmission; the attempt stays under conservative recovery and the sweep |
| 4A | Durable journal, live `SUBMITTING` lease, crash before the report, restart | `ATTEMPT_STILL_SUBMITTING` under a fresh budget; fails closed while the lease stays live; record kept; no resubmission. It also covers case 7: a crash during the wait restarts with a fresh budget, the same record drives recovery, and no counter persists. |
| 4B | Durable journal, crash, deterministic expiry, restart | recovery TX1 (named sweep) then TX2 to `SUBMITTED`; record kept; no resubmission |
| 5 | Live `reportSubmitted` commits, response lost, crash, restart | recovery and replay against the real live-epoch `SUBMITTED` state converge idempotently to `SUBMITTED`; record kept; no second operation |
| 6 | Live report unavailable (twice) or refused (409), durable record kept, crash before recovery completes, restart | startup recovery reaches `SUBMITTED`; a 409 is never read as provider failure |
| 8 | Acceptance recovery commits `SUBMITTED`, response lost, crash, restart | idempotent replay to `SUBMITTED`; record kept |
| 9 | Real keeper, real heartbeat authority loss (a 409 after database expiry, or a partition followed by expiry), pending thunk, late acceptance | the keeper never cancels or abandons the operation; durable journal; live report then recovery handover; real TX1/TX2 to `SUBMITTED`; record kept; operation count 1 |
| 10 | `SUBMITTED` with the record kept, restart | harmless replay; same record kept; no operation |
| 11 | Legal terminal state set by a **TEST TERMINAL FIXTURE — NOT PROVIDER POLLING** (preferably `ABANDONED`), restart | the exact record is removed under the existing rule. This proves journal cleanup only. |

A crash before the `SUBMITTING` acknowledgement is not mandatory. The
attempt is still granted `LEASED`, recovered by the DB-tested
granted-expired policy, with dispatch count 0.

**Optional cases.** These never replace a mandatory case:

- separate 409 and partition variants for case 9;
- late definitive failure after lease loss, where the harness calls the
  existing `reportSubmissionFailed` directly and gets the route's 409, with
  `OUTCOME_UNKNOWN` unchanged. It must be labelled **HARNESS-LEVEL
  CONTROL-PLANE ASSERTION — NOT PRODUCTION PROVIDER-FAILURE COMPOSITION**;
- duplicate acceptance across a restart.

**Failure composition.** Production composition for definitive or
ambiguous provider failure stays missing and separately tracked, outside
this gate. The conservative result (no durable acceptance, then expiry,
then `OUTCOME_UNKNOWN` and `NEEDS_ATTENTION`) does not block slice 7. No
outcome route and no provider idempotency are added, and no test claims
production failure composition exists.

**Existing races.** The DB suites already cover heartbeat vs sweep, recovery
vs expiry, `submission-failed` concurrency, `submitted` replay and expiry,
and granted-expired recovery. Whole-chain tests add cross-component
durability and restart properties rather than repeating those permutations,
though a mandatory case may exercise a handoff naturally.

**Audit and secrets.**

- Where a real transition audits, tests assert the audit's cardinality and
  identity, in particular no duplicate transition or audit after a lost
  response and replay. No audit is required where the route intentionally
  emits none.
- Tests use the existing test authentication with fixture credentials and
  tokens only, with no bypass. They keep checking that secrets do not
  appear in the journal, failure messages, audit metadata or diagnostics.

**No provider calls.** Tests assert:

- the operation is test-local;
- no provider SDK import and no provider environment variable;
- outbound URLs only in the worker-control family;
- no Runway, Veo or Google client construction.

**Accepted residual windows.** These are documented outcomes, not failed
invariants:

- (A) death after dispatch before any durable acceptance;
- (B) acceptance held only in memory when the process dies;
- (C) an ambiguous create response before durable acceptance.

None is resubmitted. Each ends `OUTCOME_UNKNOWN` / `NEEDS_ATTENTION` under
operator resolution. Provider idempotency, still locked off, could later
narrow them. Slice 7 demonstrates these windows; it does not eliminate them.

**Placement and scope.**

- The tests go in
  `apps/commercial-worker/tests/integration/wholeChainCrashRecovery.test.ts`,
  with optional test-only support under
  `apps/commercial-worker/tests/integration/support/`.
- Extracting helpers from existing integration tests must keep their
  semantics exactly.
- Only tests and test support change, with no production `src/` file, API,
  protocol, migration or provider-adapter change. If a production contract
  must change, implementation stops.

**Gate pass criteria.** Section 36 may remove the whole-chain item only when
every mandatory case passes in the tier-3 harness, with evidence of:

1. real worker components composed in test code;
2. real `WorkerControlClient` HTTP;
3. real commercial-api router and services;
4. the real guarded test database;
5. the real filesystem journal;
6. exercised restart durability boundaries;
7. lost-response cases committing server state before the client loses
   the response;
8. deterministic database expiry with no real lease waits;
9. the first-process thunk never invoked more than once;
10. restarted processes invoking it zero times;
11. residual uncertainty converging to `OUTCOME_UNKNOWN` /
    `NEEDS_ATTENTION`;
12. durable acceptance converging to `SUBMITTED`;
13. proven `SUBMITTED` record retention;
14. terminal cleanup proven with a labelled non-polling fixture;
15. no fake or real provider execution enabled;
16. no provider SDK or URL;
17. correct audit cardinality;
18. no secret leakage;
19. deterministic tests with no unhandled promises;
20. all existing worker and API integration regressions passing.

Component tests alone never satisfy the gate.

**Independent items.**

- The provider flags stay NO; whole-chain tests enable nothing.
- The production/deployment state-root binding was the last gate item
  after slice 7; slice 7 neither satisfied it nor changed deployment
  configuration. R44B8 satisfied it later (R44B8B).
- Section 24 is unchanged and separately launch-blocking.

```text
WHOLE_CHAIN_CRASH_TESTS_IMPLEMENTED=YES
WHOLE_CHAIN_CRASH_TESTS_TEST_ONLY_COMPOSITION=YES
WHOLE_CHAIN_CRASH_TESTS_PRODUCTION_ORCHESTRATOR_REQUIRED=NO
WHOLE_CHAIN_CRASH_TESTS_REAL_CONTROL_API_REQUIRED=YES
WHOLE_CHAIN_CRASH_TESTS_REAL_TEST_DATABASE_REQUIRED=YES
WHOLE_CHAIN_CRASH_TESTS_REAL_FILESYSTEM_JOURNAL_REQUIRED=YES
WHOLE_CHAIN_CRASH_TESTS_REAL_PROVIDER_REQUIRED=NO
WHOLE_CHAIN_CRASH_TESTS_FAKE_PROVIDER_REQUIRED=NO
WHOLE_CHAIN_CRASH_TESTS_PROVIDER_OPERATION_THUNK_TEST_ONLY=YES
WHOLE_CHAIN_CRASH_TESTS_POLLING_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_OUTPUT_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_COMPLETION_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_PROVIDER_RETRY_GUARD_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_PROVIDER_RESUBMISSION_ALLOWED=NO
WHOLE_CHAIN_CRASH_TESTS_RESTART_PRESERVES_DATABASE=YES
WHOLE_CHAIN_CRASH_TESTS_RESTART_PRESERVES_JOURNAL=YES
WHOLE_CHAIN_CRASH_TESTS_RESTART_PRESERVES_PROCESS_STATE=NO
WHOLE_CHAIN_CRASH_TESTS_TERMINAL_FIXTURE_ALLOWED=YES
WHOLE_CHAIN_CRASH_TESTS_STATE_ROOT_BINDING_INCLUDED=NO
```

### First fake-provider execution slice (revision R44B9A)

**Status (R44B9; recorded by R44B9B).** Implemented in commit
e57d2b77af6f61d8548e39c84f4741874806ea8f, in `apps/commercial-worker` only
(10 files, 1678 insertions, 74 deletions):

- modified: `src/acceptanceAdapter.ts`, `src/credentialOpeningRun.ts`,
  `src/providerExecutionContract.ts`, `src/workerError.ts`,
  `tests/boundary.test.ts`;
- added: `src/attemptExecution.ts`, `src/failureReportPolicy.ts`,
  `src/fakeProvider.ts`, `tests/attemptExecution.test.ts`,
  `tests/integration/fakeProviderExecution.test.ts`.

There is no change to commercial-api, the protocol package, migrations,
database constraints, this architecture (during implementation), the
runbook, the engine provider executors, provider SDK or client code, the
state-root implementation, the acceptance-journal format, manifests or
lockfiles, and no dependency was added. The locked contract below is
unchanged, and the implementation satisfies it.

**Create-phase contract.** The existing `providerExecutionContract.ts` is
extended, not duplicated. It keeps the shared `isProviderExecutionId`
re-export and adds:

- `ProviderSubmissionOutcome`: exactly `ACCEPTED`, `DEFINITIVE_FAILURE` and
  `AMBIGUOUS_FAILURE`. No outcome carries a `providerExecutionId`.
- `ProviderAcceptanceCallback`: the awaited acceptance callback, the sole
  authority for the provider execution ID. An operation may settle
  `ACCEPTED` only after awaiting it.
- `ProviderSubmissionOperation` (one `execute(onAccepted)`) and
  `ProviderSubmissionOperationFactory`: the production create-phase
  abstractions.
- `ProviderSubmissionRequest`: exactly `executionAttemptId` and `provider`,
  with no credential, lease token or proof.

**Production fake provider.** `src/fakeProvider.ts` is a production worker
module for provider identifier `BUSYBOOKIE_FAKE`, create phase only:

- execution ID `BUSYBOOKIE_FAKE-${executionAttemptId}`, validated with the
  shared `isProviderExecutionId` rule;
- default behaviour: accept, awaiting the callback before settling
  `ACCEPTED`;
- deterministic typed `DEFINITIVE_FAILURE` and `AMBIGUOUS_FAILURE`
  behaviours, selectable only through an explicit dependency option, never
  an environment variable;
- construction refused for any other provider
  (`LEASED_PROVIDER_INCOMPATIBLE`);
- one `execute` only: a second raises `PROVIDER_CONTRACT_VIOLATION`, and no
  retry path exists;
- zero provider network, zero provider SDK, zero credential input and zero
  create retry.

The R44B7 `controlledProvider()` thunk remains test-only and does not count.

**Credential opening.** `credentialOpeningRun.ts` adds
`openLeasedCredentialOnce(deps, admitLease?)`, the shared opening primitive:

- It runs the one production path: forbidden-environment check, startup
  journal reconciliation, lease, admission, expiry check, grant, open and
  verify, then discard.
- The optional admission runs on the authoritative lease after the `LEASE`
  `OK` log and before the credential grant.
- `runCredentialOpeningOnce` delegates to it and keeps its existing public
  result contract unchanged.
- It returns a frozen `OpenedAttemptContext`. That holds only the lease
  identity (`executionJobId`, `executionAttemptId`, `attemptNumber`,
  `provider`, `generationRequestSha256`), `accountId` from the validated
  opening context, and the `LeaseProof`. It holds no plaintext credential,
  no envelope and no opening context. Plaintext stays confined to the
  `openAndDiscard` verifier.

**Composer.** `runConfiguredFakeProviderAttemptOnce(config, deps)` in
`src/attemptExecution.ts`: library-only and one attempt. There is no daemon,
loop, scheduler, process entry point or package start script.

- A non-`development` `WorkerConfig` is refused with
  `WORKER_CONFIGURATION_INVALID` before any control-plane request,
  state-root access or log.
- It calls the existing `bindWorkerStateRoot` (an unsuitable root logs only
  the closed `STATE_ROOT_UNSUITABLE` startup event) and reuses the real
  startup journal reconciliation and credential-opening path. No alternate
  state-root mechanism exists; R44B8 stays authoritative.
- Implemented order:

  ```text
  development guard -> bindWorkerStateRoot -> startup reconciliation -> lease
  -> BUSYBOOKIE_FAKE admission -> grant -> open/verify/discard
  -> obtainPreProviderPermit (per-attempt journal prepare, SUBMITTING, mandatory heartbeat)
  -> only now construct the provider operation -> acceptance adapter
  -> runWithInFlightHeartbeat(() => operation.execute(onAccepted))
  -> submitted report or acceptance recovery -> SUBMITTED
  ```

- The permit keeps owning per-attempt journal preparation, the `SUBMITTING`
  acknowledgement and the mandatory heartbeat. Tests prove that a
  `SUBMITTING`, heartbeat or permit failure leaves construction 0 and
  dispatch 0.
- The keeper's lifetime is the provider create plus the awaited acceptance
  callback. Polling is excluded, and heartbeat authority loss does not
  cancel the operation.
- The real production acceptance adapter is used. The composer tracks the
  callback locally (`NONE`, `INVOKED`, `COMPLETED`, `REJECTED`) only to
  check the operation's contract; the adapter and journal stay the durable
  authority.
- There is one provider-operation invocation site and no automatic
  resubmission. Zero worker production modules read `process.env`. No
  `COMMERCIAL_WORKER_PROVIDER_MODE` or other provider-mode key exists.
- Fake execution contains no Runway, Veo or Google import, no provider SDK,
  no engine execution import, no provider HTTP client and no provider
  credential.

**Non-fake lease.** A lease for any provider other than `BUSYBOOKIE_FAKE`
gets:

- a host-fault latch trip and `LEASED_PROVIDER_INCOMPATIBLE`;
- no credential grant, opening, `SUBMITTING`, provider construction or
  dispatch, and no `submission-failed` report;
- the authoritative lease left to expiry and reclaim.

It is not a provider rejection.

**Outcome composition.**

| Case | Composer behaviour | Host fault |
|---|---|---|
| `ACCEPTED` after the callback completed | `SUBMITTED`; the journal record is retained for recovery semantics; no polling, output, completion or recovery lease | no |
| `DEFINITIVE_FAILURE` before acceptance | report `DEFINITIVELY_REJECTED` / `PROVIDER_REJECTED_DEFINITIVELY`; when the report is accepted, attempt `FAILED_BEFORE_SUBMISSION` and job `FAILED`; no journal record; no resubmission | no |
| `AMBIGUOUS_FAILURE` before acceptance | report `OUTCOME_UNKNOWN` / `PROVIDER_SUBMISSION_AMBIGUOUS`; when the report is accepted, attempt `OUTCOME_UNKNOWN` and job `NEEDS_ATTENTION`; no fabricated acceptance; no resubmission | no |
| typed failure, report not established | `PROVIDER_FAILURE_UNREPORTED`; the existing expiry and sweep own the eventual authoritative transition, and no unknown outcome is claimed before it happens | no |
| `ACCEPTED` without a completed callback | provider contract violation; ambiguous report when authority permits; no fabricated acceptance; no retry | yes |
| callback rejection | rethrows the acceptance adapter's own failure; no duplicate `submission-failed` report; the adapter's latch and report behaviour stay authoritative | adapter's existing |
| non-`ACCEPTED` outcome after durable acceptance, or an un-awaited callback | provider contract violation; no `submission-failed` report; accepted authority and journal preserved; no retry | yes |
| untyped throw (before or after acceptance) or unknown outcome | provider contract violation; no fabricated acceptance; no `submission-failed` report from the composer; no resubmission; after durable acceptance the accepted authority stays preserved. Programming faults are never reinterpreted as provider ambiguity | yes |

The composer's host-fault classes are only:

- an incompatible leased provider;
- a provider contract violation;
- the existing acceptance-adapter and keeper durability faults.

Ordinary `DEFINITIVE_FAILURE` and `AMBIGUOUS_FAILURE` do not trip it, and
there is no second latch policy.

**Shared failure-report policy.** `src/failureReportPolicy.ts` is the sole
production caller of `client.reportSubmissionFailed`. Its policy is
unchanged from the adapter's:

- at most two report attempts;
- a fresh `AbortController` and request for each attempt;
- a 10000 ms deadline per request;
- only `CONTROL_API_UNAVAILABLE` earns the second attempt;
- no provider retry.

`reportSubmissionFailureWithPolicy` never throws and returns `REPORTED`
(with the acknowledgement) or `UNREPORTED`. `acceptanceAdapter.ts` now
consumes it, and the exported `ACCEPTANCE_FAILURE_REPORT_*` names keep
identical values. No acceptance behaviour change was intended, and the
existing acceptance tests and regressions pass.

**Naming deviation.** The module is `failureReportPolicy.ts`, not the
optional `submissionFailurePolicy.ts` named under "Expected scope" below.
An import path containing `/submission` collides with the boundary test's
`SUBMITTING`-route rule. This is naming only and changes no R44B9A
semantics. Likewise, the contract extends `providerExecutionContract.ts`
instead of adding `providerExecution.ts`.

**Boundary tests.** `tests/boundary.test.ts` is expanded for R44B9:

- The permit, keeper, acceptance-adapter and state-root caller lists now
  admit the fake-provider composer as the only production caller.
- Failure-report calls are centralised through `failureReportPolicy.ts`.
- A new "fake-provider execution boundary" block checks the locked order,
  the fake's locality, the secret-free contract, the absence of callers and
  the single-attempt shape.
- One narrow exact-token allowance, `export const FAKE_PROVIDER_ID =
  "BUSYBOOKIE_FAKE";`, is admitted in `fakeProvider.ts` only. Without it,
  the existing `BUSYBOOKIE_` engine-environment-loader screen catches the
  constant. This is **not** a broad `BUSYBOOKIE_` exemption: guard tests
  prove that any other `BUSYBOOKIE_` source text, including a
  `BUSYBOOKIE_FAKE_*` key or the literal elsewhere, is still rejected.

The suite has 85 tests: 74 before R44B9, plus 6 parametric cases for the
three new source files and 5 in the new block.

**Unit evidence.** `tests/attemptExecution.test.ts` has 37 tests:

- the fake: its ID, callback awaiting, typed failures, construction
  refusal and second-dispatch refusal;
- the shared failure-report policy;
- credential admission and the opened context;
- the development and production barriers and state-root failure;
- the non-fake lease and the permit barriers;
- the composer contract cases: `ACCEPTED` without the callback, callback
  failure, recovery handover, failure after acceptance, unexpected throws
  and an unknown outcome;
- keeper heartbeat while the dispatch is pending.

Duplicate acceptance stays governed by the existing single-use claim and its
handler tests; no second mechanism was added.

**Tier-3 evidence.** `tests/integration/fakeProviderExecution.test.ts` has
6 tests, each running the real production composer and the real production
fake provider over the real `WorkerControlClient` HTTP, the real
commercial-api router and services, PostgreSQL and the real filesystem
journal:

- **Success:** `SUBMITTED` with provider execution ID
  `BUSYBOOKIE_FAKE-${executionAttemptId}`; job `RUNNING`; one `submitting`
  and one `submitted` audit; journal record retained; construction 1 and
  dispatch 1.
- **Definitive:** `FAILED_BEFORE_SUBMISSION`, job `FAILED`, the
  `failed_before_submission` audit, no journal record, no host fault.
- **Ambiguous:** `OUTCOME_UNKNOWN`, job `NEEDS_ATTENTION`, the
  `outcome_unknown` audit, no journal record, no host fault.
- **Keeper:** a pending operation receives a real second heartbeat (200)
  while `SUBMITTING`, then completes to `SUBMITTED`.
- **Non-fake lease:** only the lease request is made, the attempt stays
  `LEASED`, there is no opening and the latch trips.
- **Production refusal:** zero requests, and the attempt stays `QUEUED`.

**No real network.** Tier-3 tests origin-check every outbound request:
zero off-origin requests were observed, and only local worker-control
traffic occurred. The fake contacts no provider.

**Secret safety.** `ProviderSubmissionRequest` carries only
`executionAttemptId` and `provider`. Tests prove the fake operation receives
no plaintext credential, machine or worker credential, lease token or
provider API key. Logs, errors, audit text and journal files were scanned
for those values, and no leakage was found.

**Validation.**

- worker unit: 656/656 across 16 files (previous baseline 608/608 across
  15);
- worker integration: 40/40 across 3 files (whole-chain 15/15, credential
  opening 19/19, fake provider 6/6);
- commercial-api DB: 558/558 across 19 files;
- typecheck clean and `git diff --check` clean;
- no provider call.

**Criterion reconciliation.** All 18 "Fake flag criteria" below are
satisfied:

1. Production fake provider: `fakeProvider.ts`.
2. Production fake-only composer: `runConfiguredFakeProviderAttemptOnce`.
3. Development-only barrier: refusal before any request.
4. `BUSYBOOKIE_FAKE` barrier: refusal before the grant.
5. Create-phase contract: `providerExecutionContract.ts`.
6. Permit before construction: construction and dispatch stay 0 on permit
   failure.
7. Keeper wiring: `runWithInFlightHeartbeat` around create plus the awaited
   callback.
8. Durable acceptance: the production acceptance adapter and journal.
9. Definitive composition.
10. Ambiguous composition.
11. Shared failure policy: `failureReportPolicy.ts`.
12. Tier-3 success test.
13. Tier-3 definitive-failure test.
14. Tier-3 ambiguous-failure test.
15. Keeper wiring test (unit and tier-3).
16. No-real-network proof: boundary tests and the tier-3 origin check.
17. Secret-safety proof: unit and tier-3 scans.
18. No test-thunk substitution: the production fake is imported from `src/`.

Accordingly `FAKE_PROVIDER_EXECUTION_IMPLEMENTED=YES`. Because both typed
definitive and ambiguous outcomes are production-composed through the
shared policy, `PROVIDER_FAILURE_COMPOSITION_IMPLEMENTED=YES`. That flag
means the generic worker failure composition exists; it does not mean
real-provider-specific classification or adapters exist.

**What stays unchanged and open.**

- `REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO`: no production real-provider
  adapter or composition exists. The engine executors are not
  commercial-worker real-provider adapters.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`: fake execution authorises
  no provider credential use, provider network or live submission.
- The real-SDK create-retry obligation stays unresolved: a real adapter
  must verify, or refuse, unless create retry is deterministically
  disabled. The fake has zero retries by construction, which does not
  satisfy it. (R44B10A contract lock: the obligation is now specified for
  the Google adapter, `maxRetries: 0` with a transport-level proof; it is
  satisfied only when that adapter is implemented and tested.)
- The live-route `SUBMITTED` capacity condition stays deferred. Successful
  fake execution ends at `SUBMITTED`, and a later lease may receive
  `WORKER_AT_CAPACITY` while that lease and its capacity slot are retained.
  R44B9 does not change the post-`SUBMITTED` lifecycle and is not reopened
  for it.
- Section 24 stays separately launch-blocking. The fake receives no
  credential, and opening and discarding a fake attempt's credential
  material does not solve the real-provider credential-lifetime obligation.
- R44B8 stays closed and authoritative; there was no state-root redesign.
- `PRE_FAKE_PROVIDER_GATE` stays **COMPLETE** and is not reopened; R44B9 is
  a post-gate execution milestone.

**Milestone.** R44B9 fake-provider execution is complete: a real production
worker fake-provider composition exists and is proven end to end through
the control plane and the database. It does **not** mean that:

- a real provider adapter or real provider network exists;
- live provider submission is enabled;
- a process daemon exists;
- polling, output or completion exists.

**Next-phase boundary.** Later work must separately address real and live
provider readiness, including:

- the real provider adapter boundary;
- the real provider create-retry assertion;
- real-provider credential lifetime;
- the engine's create-versus-polling boundary incompatibility;
- the live `SUBMITTED` lifecycle and capacity issue, where applicable;
- section 24.

None of these is complete, and this record designs none of them.

**Locked decision (R44B9A; implemented by R44B9, recorded by R44B9B).**
This is a new post-gate execution phase; `PRE_FAKE_PROVIDER_GATE` stays
**COMPLETE** and is not reopened. The first lock attempt was blocked because the proposed identifier
`busybookie-fake` broke the authoritative provider-identifier grammar
`^[A-Z][A-Z0-9_]{0,31}$`. That grammar is enforced by:

- database constraints (`provider_connections`,
  `generation_authorizations` and `execution_attempts`);
- the commercial-api connection service;
- the protocol credential context;
- the worker-control client lease parser;
- the acceptance-journal record schema.

The corrected identifier, `BUSYBOOKIE_FAKE`, passes all of them, so no
migration, protocol change or API validation change is needed, and
provider-identifier validation is not widened. This lock changes no source,
test, runbook, API, protocol, migration or engine code.

**Evidence (R44B9 discovery, revalidated; the state before R44B9, now
historical).**

- `runCredentialOpeningOnce` stops after opening. Its summary discards the
  lease token and proof and the plaintext credential, so execution cannot
  continue from it.
- `obtainPreProviderPermit`, `runWithInFlightHeartbeat` and
  `createAcceptanceAdapter` have no production caller.
- There is no provider-neutral worker execution interface, no production
  fake provider and no production failure composer.
- The real engine executors fuse create, acceptance, polling and output,
  and are unsuitable for this slice.
- R44B7's `controlledProvider()` remains test-only.

**Definition.** A fake provider counts as implemented only when production
`apps/commercial-worker` source contains a deterministic local fake
create-phase provider that is wired through the production worker execution
composition. That composition exercises:

- the real state-root binding and startup reconciliation;
- the real lease, grant and open;
- the real pre-provider permit and in-flight keeper;
- the real durable acceptance adapter;
- real submission-failure reporting;
- real worker-control HTTP, commercial-api and database in tier-3 tests.

A test-only thunk never qualifies. The fake uses no provider SDK, provider
HTTP endpoint, Runway, Veo or Google execution, or engine polling and
output code.

**Endpoint.** Success ends at **`SUBMITTED`**: the acceptance is durably
recorded and the control plane is `SUBMITTED`. Polling, output, download,
media persistence, completion, terminal status, recovery leases and the
post-`SUBMITTED` lifecycle are excluded. The live-route `SUBMITTED`
capacity condition stays separately deferred.

**Identity and barrier.**

- The dedicated fake **provider identifier** is `BUSYBOOKIE_FAKE`. It is
  not a provider execution ID.
- Fake execution runs only when `COMMERCIAL_WORKER_ENV=development`.
  Production mode is refused before any lease.
- The barrier is the fake-only composer, plus development mode, plus
  `lease.provider === "BUSYBOOKIE_FAKE"`. There is no
  `COMMERCIAL_WORKER_PROVIDER_MODE` or other provider-mode variable and no
  generic real/fake selector; a later real-provider slice owns selection.
- **No real network, structurally:** no Runway, Veo or Google import, no
  engine `src/execution` import, no provider SDK dependency, no provider
  credential passed to the fake, and no HTTP client in the fake. Boundary
  tests enforce this.
- **Lease-provider guard:** checked immediately after the lease and before
  any credential grant, opening, pre-provider orchestration or fake
  construction. A provider other than `BUSYBOOKIE_FAKE` gets:
  - no grant, opening, `SUBMITTING`, construction or dispatch;
  - no `submission-failed` report;
  - a host-fault trip, because a fake-only worker acquired an incompatible
    attempt;
  - the lease left for normal authoritative expiry and reclaim.

  This is never reported as a provider rejection.

**Credential continuation.**

- `runCredentialOpeningOnce` keeps its public summary and behaviour.
  Implementation may refactor `credentialOpeningRun.ts` only enough to
  share one internal lease → expiry checks → grant → open primitive. The
  existing function returns its summary from that primitive; the fake
  composer receives the non-secret continuation context. No API or protocol
  change.
- **Execution context:** immutable, read-only, in memory only, never
  logged and never persisted as a whole. It holds the existing source
  values of `executionJobId`, `executionAttemptId`, `attemptNumber`,
  `provider` and `generationRequestSha256` (lease); `accountId` (grant
  opening context); `fencingCounter`; and the `LeaseProof` (fencing counter
  and lease token) that worker-control calls need. All are already exposed
  by `WorkerLease`, the grant and `LeaseProof`, so no API or protocol change
  is needed. It never contains a plaintext credential or provider API key.
- **Fake mode still runs grant, then open**, so the production ordering is
  exercised. The plaintext is verified under the existing opening contract
  and discarded at once. The fake receives no plaintext, API key or
  credential object. This resolves nothing for real-provider credential
  lifetime (section 24).

**Create-phase contract.** A worker-local, provider-neutral contract
covering only provider create/submit plus the awaited acceptance callback;
never polling, download, output or completion. Typed outcomes are
**ACCEPTED**, **DEFINITIVE_FAILURE** and **AMBIGUOUS_FAILURE**, with
TypeScript names per worker convention.

- **Callback.** The operation receives
  `(acceptance: WorkerProviderAcceptance) => Promise<void>` (the outer
  acceptance adapter) and **must await it**. The callback is the sole
  authority for `providerExecutionId`; the return value carries no
  competing ID.
- **ACCEPTED** is valid only when the create was dispatched, an accepted ID
  was produced, and the callback was invoked and awaited successfully, in
  that order.
  - ACCEPTED without a completed callback is treated as ambiguous plus a
    contract violation: host-fault trip, the ambiguous report if authority
    permits, otherwise the sweep owns it. No fabricated ID, no retry.
- **Callback rejection:** the composer never reports `submission-failed`
  again on that account. The adapter already owns pre-durable reporting,
  durability failure and the latch. The composer fails closed: no duplicate
  report, no resubmission.
- **A failure after completed acceptance:** if a DEFINITIVE_FAILURE or
  AMBIGUOUS_FAILURE follows a completed callback, that is an adapter
  contract violation. Host-fault trip, no `submission-failed`, no
  overwrite of the accepted authority, journal and recovery preserved, no
  resubmission.
- **Untyped throw:** an adapter or host contract fault. Host-fault trip, no
  fabricated acceptance, no definitive claim, no new route, no
  resubmission; the existing expiry and sweep own the unresolved state.

**Construction and dispatch.**

- **Permit before construction:** a factory boundary. The fake operation
  is constructed only after `obtainPreProviderPermit` succeeds, so no
  submission-capable object exists earlier. Tests count construction and
  dispatch: if `SUBMITTING`, the mandatory heartbeat or the permit fails,
  both are 0.
- **Fake module:** production `apps/commercial-worker/src/fakeProvider.ts`
  (or an equivalent name). It is create-phase only, `BUSYBOOKIE_FAKE` only,
  with no network, no SDK and no credential. Its default is deterministic
  ACCEPTED, with typed definitive and ambiguous behaviour selectable only
  through an explicit dependency or test seam, never an environment mode.
  No engine imports.
- **Fake execution ID:** `BUSYBOOKIE_FAKE-${executionAttemptId}`. It is a
  different grammar from the provider identifier. At 52 characters it
  satisfies `isProviderExecutionId`: 1 to 256 visible ASCII characters and
  no `://`. It is deterministic, bound to the attempt, collision-free
  across attempts, obviously fake and contains no secret. No randomness.
- **Timing:** production fake acceptance is immediate. There is no delay
  setting; tests may inject a pending operation through the production
  seam.
- **Cardinality:** at most one create dispatch per leased attempt, with one
  construction after the permit and one invocation. No create or dispatch
  retry, no second construction, and no resubmission after a restart.
- **Retry:** the fake has zero create retries and no transport, and no
  generic retry wrapper surrounds it.
- **Real-adapter obligation:** a real adapter must refuse construction or
  use unless create retry is deterministically disabled. The fake is exempt
  because it has no SDK. Discovery evidence shows this is feasible later
  (Runway `maxRetries: 0`, Google per-request `maxRetries: 0`, Veo
  `attempts: 1`), but the obligation is **not** satisfied, and no
  Runway/Veo/Google assertion is added to the fake.

**Composer.** One library-only composer, conceptually
`runConfiguredFakeProviderAttemptOnce`: one startup, at most one leased
attempt and at most one dispatch. No loop, daemon, CLI, signals, scheduler
or start script. It reuses R44B8: `WorkerConfig` → require development →
bind the state root → startup reconciliation → lease. No temporary root in
production; tests may inject explicit fixtures. Order on success:

```text
configuration/state-root validation -> journal prepare -> startup reconciliation
-> lease -> verify provider == BUSYBOOKIE_FAKE -> credential grant
-> credential open/verify -> discard plaintext -> per-attempt journal prepare
-> SUBMITTING acknowledgement -> mandatory heartbeat -> pre-provider permit
-> construct fake operation -> construct/use acceptance adapter
-> runWithInFlightHeartbeat(fake create -> await durable acceptance)
-> durable journal -> submitted report or acceptance recovery -> SUBMITTED
```

It stops there.

- `obtainPreProviderPermit` is reused and not weakened.
- `runWithInFlightHeartbeat` wraps the create plus the awaited acceptance,
  never polling. Heartbeat authority never cancels the operation: a 409
  stops scheduling only, and a late acceptance stays recoverable. R44B7
  already proved lease-loss semantics, so only a composer wiring proof is
  needed.
- `createDurableAcceptanceHandler` and `createAcceptanceAdapter` are
  reused. The fake awaits the adapter callback. The existing single-use
  claim governs duplicates; no second mechanism is added.

**Failure composition (required).** `FAKE_PROVIDER_EXECUTION_IMPLEMENTED`
never becomes YES with success-only composition. Before durable acceptance:

| Outcome | Report | Expected result | Host fault |
|---|---|---|---|
| DEFINITIVE_FAILURE | `DEFINITIVELY_REJECTED` / `PROVIDER_REJECTED_DEFINITIVELY` | attempt `FAILED_BEFORE_SUBMISSION`, job `FAILED`, no acceptance record, dispatch 1 | not for an ordinary rejection |
| AMBIGUOUS_FAILURE | `OUTCOME_UNKNOWN` / `PROVIDER_SUBMISSION_AMBIGUOUS` | attempt `OUTCOME_UNKNOWN`, job `NEEDS_ATTENTION`, no fabricated acceptance, dispatch 1, no resubmission | not for typed ambiguity alone |

- **After lease loss:** if the report is refused because authority is
  gone, no new transition is invented, no create is retried and no
  acceptance is fabricated. The existing expiry, sweep and unknown-outcome
  authority owns the state, and `OUTCOME_UNKNOWN` is never claimed before
  the sweep has actually run.
- **Shared policy:** the R44B6Y failure-report policy, currently private in
  the acceptance adapter, is extracted into **one** production helper with
  identical semantics: at most two attempts, retrying only
  `CONTROL_API_UNAVAILABLE`, 10 s per attempt, no provider retry, and the
  existing 409, authentication, malformed and invariant handling and latch
  behaviour. The acceptance adapter and the fake composer both use it. The
  adapter's behaviour does not change. No second latch policy exists.
- **Host fault:** not tripped for a successfully reported definitive or
  typed ambiguous outcome. Acceptance durability or integrity failures keep
  the existing latch behaviour. A provider contract violation trips it.
  A failure-report control-plane failure follows the shared policy.

**Secrets and process.**

- The fake receives no plaintext credential, API key, lease token or
  worker credential. The lease proof stays composer and control-plane data.
- No CLI, daemon, executable, loop or start script, and no provider-mode
  variable. `COMMERCIAL_WORKER_ENV=development` is the only environmental
  gate. Library composition is enough for the flag once every tier-3
  criterion passes.

**Tests (mandatory for the flag).**

- **Tier-3 success:** the production composer with the production
  `BUSYBOOKIE_FAKE` provider, imported from `src/` and not the R44B7 thunk,
  over real HTTP, commercial-api, database and journal. It asserts:
  - startup reconciliation, one lease, and the guard passing;
  - one grant and open, and the permit before construction;
  - construction 1, dispatch 1 and durable acceptance 1;
  - provider ID `BUSYBOOKIE_FAKE-${executionAttemptId}`, persisted exactly;
  - `SUBMITTED`, the journal retained, the `submitted` audit;
  - no resubmission and no provider network.
- **Tier-3 definitive failure:** construction 1, dispatch 1, no journal,
  the definitive classification, `FAILED_BEFORE_SUBMISSION` (when
  authority permits), job `FAILED`, the `failed_before_submission` audit,
  no resubmission and no host fault.
- **Tier-3 ambiguous failure:** construction 1, dispatch 1, no fabricated
  acceptance, the ambiguous report, `OUTCOME_UNKNOWN` (when the report
  succeeds), job `NEEDS_ATTENTION`, the `outcome_unknown` audit, no
  resubmission and no host fault.
- **Keeper wiring:** an injected pending operation through the production
  seam under fake time, with at least one real heartbeat renewal while
  pending, then normal completion. No 30-second waits.
- **Barrier tests:**
  - A. production mode refuses before any lease;
  - B. a non-`BUSYBOOKIE_FAKE` lease refuses before the grant;
  - C. an incompatible provider leaves construction at 0;
  - D and E. a permit failure leaves construction and dispatch at 0;
  - F. no real-provider imports in the composer;
  - G. the fake receives no credential.
- **Acceptance tests:**
  - A. the callback is awaited;
  - B. ACCEPTED without a completed callback is ambiguous plus a host
    fault;
  - C. a callback rejection produces no duplicate report;
  - D. a failure after acceptance overwrites nothing and trips the latch;
  - E. duplicates stay with the durable single-use claim.
- **Failure-policy tests:** the shared helper keeps the adapter's
  behaviour; the definitive and ambiguous mappings; unavailable-only retry;
  at most two attempts; a 409 never authorises a provider retry;
  authentication, malformed and invariant failures fail closed; no dispatch
  retry.
- **No real network:** no engine or provider-brand imports and no SDK
  dependency, no HTTP client in the fake, no provider credential
  environment, and runtime outbound URLs only in the worker-control family.
- **Secrets:** fake input, journal, audit text, errors and latch messages
  never contain the plaintext credential, worker credential, lease token or
  an API key. The fake ID contains only the attempt ID.
- **Audits:** the expected transition families are `submitted`,
  `failed_before_submission` and `outcome_unknown`, alongside the existing
  `submitting`. No heartbeat or fake-provider-specific audit is invented.

**Unchanged.**

- The engine executors (`executeRunwaySingleShot`, `executeVeoSingleShot`,
  `submitGoogleGenAiSingleShot`) and the SDK constructors are not
  modified. The create/polling fusion and the ID-normalisation conflict
  belong to the real-adapter slice.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED` and
  `REAL_PROVIDER_EXECUTION_IMPLEMENTED` stay NO.
- Section 24 stays launch-blocking; the fake uses no credential.
- The live-route `SUBMITTED` capacity condition stays deferred.
- R44B8 stays authoritative for the state root.

**Fake flag criteria.** `FAKE_PROVIDER_EXECUTION_IMPLEMENTED` stays **NO**
until a published implementation proves all of:

1. the production fake provider;
2. the fake-only composer;
3. the development-only barrier;
4. the `BUSYBOOKIE_FAKE` barrier;
5. the create-phase contract;
6. permit before construction;
7. keeper wiring;
8. durable acceptance;
9. definitive composition;
10. ambiguous composition;
11. the shared failure policy;
12. the tier-3 success test;
13. the tier-3 definitive-failure test;
14. the tier-3 ambiguous-failure test;
15. the keeper wiring test;
16. the no-real-network proof;
17. the secret-safety proof;
18. no test-thunk substitution.

A module merely existing never qualifies. (R44B9B.) All 18 are satisfied
by the published implementation ("Criterion reconciliation" in the status
above), so the flag is YES.

**Expected scope.** Worker only:

- `src/providerExecution.ts`;
- `src/fakeProvider.ts`;
- `src/attemptExecution.ts`;
- `src/credentialOpeningRun.ts`, only for the continuation refactor;
- `src/acceptanceAdapter.ts`, only for extracting the policy;
- optionally `src/submissionFailurePolicy.ts`;
- tests for the contract, the fake, the composer, the continuation, the
  policy, the boundary, and tier-3 fake execution.

Repository naming may differ. There is no change to commercial-api, the
protocol, migrations, database constraints, the journal format, the
state-root contract, the runbook, the engine executors, SDKs or lockfiles,
and no new dependency.

**Stop conditions.** Implementation stops if it would require:

- widening the provider-identifier pattern, a migration, or a protocol or
  API change;
- a provider SDK, a real-provider import or real-provider network;
- a daemon or entry point, or a `process.env` read;
- a credential passed to the fake;
- a create retry or automatic resubmission;
- weakening permit-before-construction;
- polling, output or completion;
- a state-root or deployment change;
- treating `controlledProvider` as the implementation.

```text
FAKE_PROVIDER_ID=BUSYBOOKIE_FAKE
FAKE_PROVIDER_ALLOWED_WORKER_ENV=development
FAKE_PROVIDER_REAL_NETWORK_ALLOWED=NO
FAKE_PROVIDER_REAL_PROVIDER_IMPORTS_ALLOWED=NO
FAKE_PROVIDER_PROVIDER_CREDENTIAL_REQUIRED=NO
FAKE_PROVIDER_PROCESS_ENTRYPOINT_REQUIRED=NO
FAKE_PROVIDER_ENDPOINT=SUBMITTED
FAKE_PROVIDER_CREATE_RETRY_ALLOWED=NO
FAKE_PROVIDER_TEST_THUNK_COUNTS_AS_IMPLEMENTATION=NO
FAKE_PROVIDER_FAILURE_COMPOSITION_REQUIRED=YES
FAKE_PROVIDER_TIER3_SUCCESS_REQUIRED=YES
FAKE_PROVIDER_TIER3_DEFINITIVE_FAILURE_REQUIRED=YES
FAKE_PROVIDER_TIER3_AMBIGUOUS_FAILURE_REQUIRED=YES
FAKE_PROVIDER_KEEPER_WIRING_REQUIRED=YES
PROVIDER_CREATE_PHASE_CONTRACT_LOCKED=YES
PROVIDER_CREATE_PHASE_ACCEPTANCE_CALLBACK_MUST_BE_AWAITED=YES
PROVIDER_CREATE_PHASE_PROVIDER_ID_RETURN_AUTHORITY=CALLBACK_ONLY
PROVIDER_FAILURE_COMPOSITION_IMPLEMENTED=YES
PROVIDER_REAL_ADAPTER_CREATE_RETRY_ASSERTION_REQUIRED=YES
FAKE_PROVIDER_EXECUTION_IMPLEMENTED=YES
```

### Real-provider prerequisite sequence (revision R44B10P1)

**Locked decision (R44B10P1).** R44B10 discovery found that real-provider
wiring (step 11) cannot precede step 9: every validated provider path needs
input image bytes, and section 28 forbids local and media-root paths. The
post-R44B9 sequence is:

1. **R44B10P1:** the object-storage and reference-image input contract
   (section 28, "Object-storage input contract"), then its unwired library
   implementation with the in-memory test store. This satisfies only the
   input side of step 9. Production storage, ingest, output writes and the
   vendor stay open.
2. **R44B10P2:** an honest pre-submission input-failure route. It defines an
   authoritative control-plane transition of a granted `LEASED` attempt to
   a permanent pre-submission failure, after the credential grant and
   before `SUBMITTING`, without pretending a provider was called and never
   using `PROVIDER_REJECTED_DEFINITIVELY`. It is its own architecture, API
   and protocol slice; no migration is expected. (R44B10P2: superseded.
   Exact replay needs a provenance migration, and the shared protocol
   package does not change; contract locked in section 18, "`input-failed`
   route".)
3. **R44B10A:** the first real-provider adapter lock. Google GenAI
   Interactions remains the leading candidate (R44B10 discovery). Nothing
   about its adapter is locked here. (R44B10A contract lock: selected and
   locked; see "First real-provider adapter: Google GenAI (revision
   R44B10A)" below.)

Locking R44B10P1 does not make step 11 ready, and R44B10A implementation
stays blocked until R44B10P2 is implemented. The other R44B10 findings
(credential re-open and lifetime, the request schema, the engine boundary
placement, the SDK dependency, the retry assertion, definitive
classification and the real-provider flag criteria) stay with R44B10A or
later slices.

**Status (R44B10P1 docs sync).**

- **R44B10P1:** lock and implementation complete (commit
  192a97e7eca1c1c17378ccc10821e662eb96f77f); fully closed.
- **Next:** R44B10P2, the honest pre-submission input-failure route. It is
  not designed here.
- **Then:** the R44B10A Google adapter lock.

**Status (R44B10P2 contract lock).** R44B10P1 is fully closed. R44B10P2 is
now **contract-locked** (section 18, "`input-failed` route") but not
implemented. Its remaining sequence: migration and API, then the worker
client, then P1 classification and latch integration, then tests, then
publication and docs sync, after which it is fully closed. Only then does
the R44B10A Google real-provider adapter lock follow; R44B10A is not moved
ahead of P2.

**Status (R44B10P2 docs sync).**

- **R44B10P1:** fully closed.
- **R44B10P2 discovery:** PASS.
- **R44B10P2 contract lock:** PASS (commit
  d60fc0b25070a469ca21e8ceacd4e69d8f76fedb).
- **R44B10P2 implementation:** PASS.
- **R44B10P2 implementation publication:** PASS (commit
  395b4fd8958c9f7bdfd34a215c72cf450cb86de2).
- **R44B10P2 docs sync:** this revision. With its publication R44B10P2 is
  **fully closed** and the real-provider prerequisite it represented is
  satisfied.
- **Next:** R44B10A, the Google real-provider adapter lock, now eligible
  for its own contract and implementation sequence. It is not implemented,
  and nothing about its adapter is locked here. (R44B10A contract lock: its
  discovery passed and its contract is now locked in the next subsection;
  implementation not started.)

Still open and separate: the production object-store backend, the storage
vendor, storage credentials, ingest and upload, the retention and deletion
lifecycle, the section 24 destruction service, the live `SUBMITTED`
capacity condition, the real-provider adapter, real-provider credential
lifetime and re-open, the provider SDK dependency, provider polling and
output, the process runner, and live provider enablement.

Still open for live readiness, none of them complete: the production
storage backend and vendor; production storage credentials; ingest and
upload; issuer validation; retention and pinning; the deletion lifecycle;
the canonical request-hash recipe; and signed-retrieval ownership, if one
is ever used.

### First real-provider adapter: Google GenAI (revision R44B10A)

**Locked decision (R44B10A; contract locked, not implemented).** The R44B10A
discovery passed (read-only, at commit
7af042fb88997f9bd442635c52c916cad3106bad). This revision converts it into
the contract for the first real-provider execution slice. Nothing is
implemented, no package is installed and no provider is contacted.
`REAL_PROVIDER_EXECUTION_IMPLEMENTED=NO` and
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` are unchanged.

**Implementation status (R44B10A docs sync).** The lock-time paragraph above
is preserved as historical contract evidence. The implementation was
validated and published in commit
`aefd2ea95cc0d11652596fd2e099262bc4a945ac`. The worker now contains
`googleProviderContract.ts`, `googleProviderAdapter.ts` and
`googleAttemptExecution.ts`, together with their unit, boundary and tier-3
integration coverage; the existing fake-provider path remains isolated.
All 25 criteria below pass, so the current canonical state is
`REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES`. Live provider submission remains
disabled: `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

**Basis.** The lock rests on: the repository-installed `@google/genai`
2.24.0 source; the existing BusyBookie Google production creator
(`createGoogleGenAiSingleShotProductionInteractionCreator`) and its
activation and pricing policy; the published Gemini API error reference
(<https://ai.google.dev/gemini-api/docs/api-errors>), which lists
request-level codes such as `invalid_request` and `failed_precondition`
(HTTP 400), `payment_required` (402), and `rate_limit_exceeded` and
`quota_exceeded` (429); and the current Gemini model and pricing
documentation. No provider documentation is read as guaranteeing delivery
semantics beyond what it states: wherever acceptance cannot be disproved,
the outcome is ambiguous.

**Provider and model.** The first and only real provider of this slice is
the Gemini Developer API (Google GenAI Interactions), provider identifier
`GOOGLE_GENAI`, model exactly `gemini-omni-1.1-flash`. Runway and Veo are
not locked into this slice: their engine paths fuse create and polling
(`executeRunwayGen45` waits for task output; the Veo runner polls in the
same helper) and would need extraction first. Google already has a
create-only boundary that returns a stable `Interaction.id` before
completion.

**Endpoint.** The slice ends when the provider-assigned `Interaction.id` is
durably accepted and the control plane reaches `SUBMITTED`. Polling,
provider completion, download, output storage and final completion remain
later slices.

**Placement and engine boundary.** The adapter is a thin
commercial-worker-local adapter in `apps/commercial-worker/src` that owns
the provider SDK directly. The worker imports no root engine or root
source module. The engine Google submission code is not reusable: it reads
media-root files (`sourceImagePath`, `assertReferenceImageInsideRoot`),
carries EP/S reservation and cost machinery, and its creator reduces every
SDK error to one generic `Error`, hiding the status and code that
classification needs. Rule: a commercial-worker real-provider adapter owns
its provider SDK within the worker package when that is required to
preserve worker isolation and submission semantics. This is not a licence
to duplicate engine logic: only the minimal create-phase contract is
reimplemented, and engine polling and output paths stay separate. This
supersedes the section 2 and section 5 wording that the worker integrates
through engine provider-level functions.

**SDK dependency.** `@google/genai` exactly `2.24.0`, added as an exact
runtime dependency of commercial-worker (`apps/commercial-worker/package.json`
and `apps/commercial-worker/package-lock.json`; no caret or range). The root
manifest and lockfile stay unchanged, and the worker never relies on the
root `node_modules` installation. Any SDK upgrade reopens the retry, error
and API-surface verification below.

**Backend.** Gemini Developer API only, at
`generativelanguage.googleapis.com`; no Vertex or Enterprise backend. The
client receives the plaintext credential only through BusyBookie's
credential-opening path (below); there is no `WorkerConfig` key field and no
`GOOGLE_API_KEY` or `GEMINI_API_KEY` fallback. The installed SDK reads
environment variables at construction even when a key is supplied
(`GOOGLE_GENAI_USE_ENTERPRISE`, `GOOGLE_GENAI_USE_VERTEXAI`,
`GOOGLE_GEMINI_BASE_URL`, `GOOGLE_VERTEX_BASE_URL`, and the project and
location variables), which can switch the backend, base URL or API version.
The implementation must prevent that: it constructs the client explicitly
for the Gemini Developer backend with the intended endpoint, and the
section 7 forbidden-environment refusal must be applied to the actual
process environment the SDK reads, not only to an injected copy.

**Create call.** The provider create authority is
`GoogleGenAI.interactions.create` (the public wrapper) with
`background: true`, `store: true`, `stream: false`. It returns before
generation completes; the returned `Interaction.id` is the provider
execution identity. The adapter never polls.

**Zero create retries.** For the locked 2.24.0 public wrapper, every create
uses exactly the request options `{ maxRetries: 0, timeout: 60000 }`. In
2.24.0 the wrapper (`toGoogleGenAIRequestOptions`) translates them into the
SDK's internal `retries` (attempt-count strategy, zero retries) and
`timeout_ms`. Without them, Interactions create defaults to an
attempt-count backoff of four retries on 408, 409, 429, 5xx and connection
or timeout errors, which is not acceptable. The adapter must use the public
`GoogleGenAI.interactions` path whose translation was inspected, never the
inner generated client. This is a 2.24.0 fact, not a version-independent
claim.

**Transport-level proof.** Source inspection does not satisfy the flag
criterion. A mandatory implementation test drives the real 2.24.0 SDK with
an injected counting fetch and no network, and proves exactly one HTTP
request for at least HTTP 429, HTTP 503, a connection failure or reset, and
a timeout: no SDK resend, no application retry, no resubmission. A boundary
or source test also pins the `maxRetries: 0` option.

**Timeout.** The create deadline is 60000 ms, the existing Google
activation-policy create timeout. A timeout does not prove non-dispatch:
`AMBIGUOUS_FAILURE`, never retried, redirected or resubmitted.

**Provider execution ID.** Exactly the raw `Interaction.id`: no trimming,
prefixing, encoding or fabrication. It must satisfy the existing
`isProviderExecutionId` grammar, and the acceptance callback stays the only
authority that brings it into the durable lifecycle. A missing, empty or
non-conforming ID on a nominal success is handled below (malformed
success).

**Model authority.** The model comes from the authoritative lease and
generation authorization; the worker checks that it exactly equals
`gemini-omni-1.1-flash` and never substitutes another. A different model is
a control-plane or issuer contract violation, refused before the credential
grant and before any provider construction.

**Closed generation request.** The first-slice `generationRequest` is
exactly `{ prompt, referenceImage, resolution }`; any other member is
rejected. There is no free-form options object, duration, aspect ratio,
negative prompt, seed, audio, tool option or response-format object.

- `prompt`: a non-empty string with no leading or trailing whitespace, at
  most 1000 UTF-16 code units, never trimmed or rewritten by the worker;
  the issuer owns the canonical prompt. BusyBookie's existing Google
  single-shot prompt builder
  (`src/execution/providers/buildGoogleGenAiSingleShotPrompt.ts`) already
  enforces `GOOGLE_GENAI_PROMPT_MAX_CODE_UNITS = 1000`, refusing a prompt
  whose `.length` exceeds it. That is a local BusyBookie Google operational
  limit, not an official Google API or provider maximum. R44B10A preserves
  that existing 1000-UTF-16-code-unit limit, and the commercial worker
  validates the same limit itself, without importing the engine or root
  implementation.
- `referenceImage`: exactly the R44B10P1 reference object; content types
  `image/png`, `image/jpeg` and `image/webp` only (no HEIC, GIF, TIFF, BMP
  or local-path compatibility); at most 10,485,760 verified bytes; obtained
  only through `retrieveVerifiedReferenceImage`, with failures handled by
  `handleInputMediaFailure`. No filesystem, media-root or `sourceImagePath`
  route, and no signed URL as durable identity.
- `resolution`: exactly `"720p"`. Other resolutions are not exposed,
  because the repository's expected-cost authority has an authoritative
  local video-output price only for 720p (`googleGenAiExpectedCost.ts`);
  the others fail pricing closed, and the provider-adapter slice does not
  widen cost authority.

**Provider request.** After verification and after the pre-provider permit,
the adapter builds: `model: "gemini-omni-1.1-flash"`; `input`: first
`{type: "text", text: prompt}`, then `{type: "image", data: <verified
bytes, base64>, mime_type: <verified type>}`; `response_format: {type:
"video", delivery: "uri", resolution: "720p"}`; `background: true`,
`store: true`, `stream: false`. The response-format type, delivery,
resolution and the three flags are adapter-owned constants that the
`generationRequest` cannot override. Base64 conversion happens inside the
adapter, only after the permit.

**Request hash.** The worker does not invent or recompute a request-hash
recipe; `generation_request_sha256` stays issuer and control-plane
authority, and the canonical request-hash readiness item stays open. A
future live issuer must guarantee that the closed request stored in
`generationRequest` is the request whose hash it authorized.

**Non-image request errors.** The five R44B10P2 `INPUT_*` codes stay
image and input-object specific. A malformed `prompt`, `resolution` or
model, or an unknown `generationRequest` member, is an issuer or
control-plane contract violation: refused before the credential grant and
any provider construction, through the host-fault and invariant path, never
reported through `input-failed` and never reported as a provider rejection.
This is acceptable only because live enablement stays blocked until a
production issuer validates the same closed schema before authorizing work.
Without that issuer the refused attempt is a poison authorization (each
lease expiry requeues it and the next worker refuses it again); that is a
recorded live-readiness issue.

**Migration, API and protocol.** None: no database migration, no
commercial-api change and no shared protocol change. This depends on
keeping malformed non-image request data an issuer invariant violation. If
implementation shows that to be dishonest, implementation stops and the
architecture is reopened; R44B10P2 is never silently widened.

**Ordering.**

```text
lease
-> provider, model and closed-request admission (before any grant)
-> credential grant
-> first credential open and validation (plaintext discarded)
-> verified reference-image retrieval (R44B10P1)
-> R44B10P2 policy if retrieval fails (stop)
-> pre-provider orchestration: journal preparation, SUBMITTING, mandatory renewal (the permit)
-> credential re-open from the sealed capability
-> provider-client construction (one)
-> runWithInFlightHeartbeat( provider create (one) -> awaited durable acceptance )
-> SUBMITTED, or a typed provider failure reported once
```

Retrieval stays after the grant and open (the authoritative account comes
from the validated opening context) and before `SUBMITTING`, the permit and
any construction. A permanent image fault, a transient storage failure and
a host fault never create a Google client.

**Production object store.** Not required for implementation: the injected
`ObjectStore` and the existing in-memory store suffice for automated tests.
Required for live enablement. `OBJECT_STORAGE_PRODUCTION_IMPLEMENTED=NO`
and `OBJECT_STORAGE_VENDOR=UNDECIDED` stay; no live claim follows.

**Credential authority.** No second credential grant exists (the grant
route accepts only `LEASED`, so none is possible after `SUBMITTING`); the
first grant stays the sole authority. R44B10A adds a scoped
sealed-credential capability that keeps only the sealed envelope and the
validated opening context, never plaintext across control-plane calls,
never exposes the secret to logs, audit or the journal, and allows
re-opening only for that same already-granted attempt. Before the permit
the existing grant, open and validation run and the plaintext is discarded
at once. After the permit the adapter re-opens from the capability,
constructs one client, dispatches at most one create, and drops the
plaintext and the client when the create settles (the SDK holds the key
inside the client, which section 29's per-attempt client rule covers).

**Permit before construction.** No `GoogleGenAI` instance exists before
`obtainPreProviderPermit` succeeds. Construction performs no network in
2.24.0, but a client holding the credential is submission-capable. Before
the permit only non-secret configuration, the sealed capability, verified
input bytes, the closed parsed request and provider-neutral context may
exist. Tests count client construction and provider dispatch and prove
both are 0 on every pre-permit refusal path.

**One client, one dispatch.** Per leased attempt: at most one Google
client construction and at most one `interactions.create` dispatch. No
create retry, no second construction after a create attempt, no fallback
provider, no resubmission after a process restart, and no control-plane
retry ever invokes create again.

**Acceptance.** `createAcceptanceAdapter` and
`createDurableAcceptanceHandler` are reused unchanged; the create receives
and awaits the existing acceptance callback. `ACCEPTED` is valid only when
exactly one create was dispatched, a valid `Interaction.id` was returned,
and the callback was invoked and completed successfully. Once a valid ID
exists, acceptance may already exist: any failure to record it durably
follows the existing acceptance-adapter and recovery contract, with no
second `submission-failed` report, no create retry and no overwrite of
accepted authority.

**Failure classification.** Classification uses only the SDK's typed error
class and HTTP status, the machine-readable Interactions error code, and
dispatch and response facts; never message text. In 2.24.0 the error `code`
is an open string (documented by the SDK as a URI identifying the error
type), so the implementation pins its exact wire representation in tests;
any code that does not exactly match the locked set is ambiguous. Raw
response bodies and messages never cross the adapter boundary.

- **Definitive** (`DEFINITIVE_FAILURE`), only for an explicit request-level
  rejection returned synchronously with no `Interaction.id` and no
  callback, with one of these codes: `invalid_request`,
  `failed_precondition`, `parameter_unknown`, `authentication`,
  `payment_required`, `permission_denied`, `not_found`, `model_not_found`,
  `out_of_range`, `rate_limit_exceeded`, `quota_exceeded`,
  `too_many_requests`, `unimplemented`. A synchronous request-level policy
  or safety block before any ID is also definitive when the SDK exposes it
  as such a request-level error code.
- **429 decision.** `rate_limit_exceeded`, `quota_exceeded` and
  `too_many_requests` are definitive for that single dispatched create when
  the provider returned the explicit request-level error and no ID exists.
  Google may recommend retrying such requests with backoff; BusyBookie
  deliberately does not, because provider create cardinality is one and
  automatic resubmission is prohibited. Provider retry advice is never a
  reason to reintroduce SDK or application retry. A later fresh business
  attempt is a matter for future control-plane policy, outside R44B10A.
- **Ambiguous** (`AMBIGUOUS_FAILURE`): `aborted`, or a conflict where
  acceptance cannot be disproved; HTTP 408 if observed; HTTP 409; HTTP 499
  or cancelled; HTTP 500; HTTP 503; HTTP 504 or a deadline; a timeout; a
  connection reset; a lost response; any network failure after dispatch
  could have occurred; an abort or cancellation the provider contract does
  not prove pre-dispatch; an unknown SDK transport exception; an unknown
  HTTP status or error code. Never retried; no ID fabricated; reported
  through the existing ambiguous composition when authority permits.
- **Malformed success**: a nominal success with no ID, an empty ID, a
  malformed result or an ID outside the provider-ID grammar is not a
  definitive rejection. It is `AMBIGUOUS_FAILURE` plus a host fault, because
  dispatch may have succeeded but accepted identity cannot be established.
  No resubmission.
- **Safety and content.** A synchronous request-level policy error before
  any ID is a definitive provider rejection. A provider-generated terminal
  state after an `Interaction.id` was assigned means the interaction was
  already accepted; that later failure belongs to polling and completion,
  not R44B10A. Provider safety rejection never maps to the R44B10P2
  `INPUT_*` codes.

**Sanitisation.** The SDK may expose `body`, `rawResponse`, provider
messages, headers and causes. None of them reaches a `WorkerError`, audit
event, journal record, security event, worker log or control-API request.
The adapter edge reduces provider results to `ACCEPTED`,
`DEFINITIVE_FAILURE` or `AMBIGUOUS_FAILURE`, plus an approved closed
host-fault reason or stage. Safe log fields: `executionAttemptId`,
`provider`, a closed stage, a closed classification, and
`providerExecutionId` only once approved as durable identity.

**Network boundary.** The Google SDK client and its create call are the
only provider-network component. No provider network exists before the
permit; automated tests inject the fetch transport explicitly and never
call Google; no generic HTTP fallback exists outside the SDK.

**Default-off composition.** No generic provider-mode environment variable
and no default production factory. A separate library-only real-provider
composer receives its dependencies (including the provider client factory
and transport) by explicit injection; automated tests inject the real
adapter with a non-network transport. R44B10A has no production process or
runner caller, so provider network is structurally unreachable from normal
production startup, without a permanent source boolean that would have to
be edited for a controlled validation. `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED`
stays NO.

**Single real provider.** Exactly one real provider, `GOOGLE_GENAI`, with no
generic multi-provider selector. A lease for any other provider is refused
before the credential grant and any construction, as a host or
configuration mismatch (as the fake composer's guard does). The fake
provider and fake composer stay separate and unchanged.

**In-flight heartbeat.** The provider create plus the awaited acceptance
callback run inside `runWithInFlightHeartbeat`; polling never does.
Heartbeat authority loss never causes resubmission, and no external
cancellation signal is wired into create because heartbeat authority
changed. A late accepted interaction stays recoverable through the existing
journal and control-plane semantics.

**Journal order.** The acceptance-journal contract is unchanged: startup
reconciliation and per-attempt journal preparation run inside the
pre-provider orchestration before any dispatch, in the reviewed order, and
once an ID is returned durable acceptance handling is authoritative. There
is no new unjournalled acceptance window and no competing journal format.

**Host faults** (distinct from ordinary definitive rejection): provider
mismatch; model mismatch; a malformed closed `generationRequest`; invalid
local request conversion; credential re-open failure after the permit;
SDK or client construction failure before dispatch; SDK retry
configuration drift; malformed provider success; a missing or invalid
provider ID; an untyped or unknown adapter contract exception; `ACCEPTED`
without a completed callback; a typed failure after completed acceptance.

**Post-permit, pre-dispatch faults.** If the credential re-open, request
conversion or client construction fails after the attempt entered
`SUBMITTING` but before any dispatch: trip the host-fault latch, fabricate
no provider failure, call no provider, resubmit nothing, and leave the
authoritative `SUBMITTING` expiry sweep to converge to `OUTCOME_UNKNOWN`.

**Cost authority.** The worker creates no second billing authority.
Provider `GOOGLE_GENAI`, model `gemini-omni-1.1-flash` and resolution
`720p` are fixed; the expected cost stays issuer and control-plane
authority. The adapter only checks that the execution is compatible with
the existing expected-cost cap and unit, and never recomputes an
entitlement decision. Cost policy is not widened.

**Process runner.** None: R44B10A is library plus automated-test
composition only. No daemon, CLI, worker loop, scheduler, start script or
deployment change.

**Separate blockers.**

| Item | Adapter implementation | Automated tests | Controlled real-provider validation | Continuous or commercial live operation |
|---|---|---|---|---|
| Section 24 destruction lifecycle | no | no | **yes** (under the current architecture, section 35) | **yes** |
| Live `SUBMITTED` capacity condition | no | no | no (a single test or mock-controlled execution) | **yes** |
| Production object store | no | no | **yes** | **yes** |

None of them is repaired or marked solved by R44B10A.

**Live enablement.** `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED` stays NO
after R44B10A implementation. Future enablement still needs at least: the
production object store, its backend and credentials; production issuer
validation of the closed request; production provider credential and KMS
readiness; the section 24 destruction lifecycle; the live `SUBMITTED`
capacity lifecycle; process, runner and deployment design; and controlled
live validation. `REAL_PROVIDER_EXECUTION_IMPLEMENTED` means
production-grade real adapter code and composition exist and pass the
required tests; it never means provider keys, production storage,
continuous operation or live submission.

**Boundary rules (implementation tests).** `@google/genai` is imported only
by the real Google adapter and factory files the implementation names in
its boundary test; no root engine or root source import; no `process.env`
credential fallback in the adapter; no arbitrary filesystem or media path;
`fakeProvider.ts` and the fake composer neither import nor reach Google;
the Google client is constructed only after the permit; the
`maxRetries: 0` option and the 60000 ms timeout are pinned; exactly one
real provider; the exact SDK dependency version is pinned. No existing
boundary rule is weakened; any new allowance is a narrow, named exemption.

**Mandatory tests.**

- **Adapter unit**, with the actual `@google/genai` 2.24.0 and an injected
  counting transport: a valid accepted create; the exact `Interaction.id`
  handed to the callback; the exact Google request shape, model, `720p`
  resolution and `background`/`store`/`stream` constants; exactly one HTTP
  request; exactly one request on 429, 503, a connection failure and a
  timeout; definitive and ambiguous mappings; malformed success; a missing
  ID; an unknown error; no raw response or body leaked; no plaintext
  credential leaked; the client dropped after create.
- **Zero construction and zero dispatch** for: a wrong provider; a wrong
  model; a malformed request; an unknown request member; a wrong
  resolution; each R44B10P2 image fault (malformed reference, not found,
  declared oversize, integrity mismatch, media mismatch); a transient
  storage failure; an object-store host fault; a permit refusal; a
  `SUBMITTING` acknowledgement failure; a mandatory heartbeat failure.
- **Tier 3 accepted**, with real worker components, the real commercial-api
  router, the real PostgreSQL test database, the real journal, the actual
  SDK and an injected non-network counting fetch: lease, admission, grant
  and open, input verification, journal and permit, re-open, one
  construction, one dispatch, `Interaction.id`, awaited durable acceptance,
  `SUBMITTED`; no real Google network and no polling.
- **Tier 3 definitive**: one construction and one dispatch; an explicit
  pre-ID provider rejection; no acceptance journal record; the definitive
  `submission-failed` composition; `FAILED_BEFORE_SUBMISSION` when
  authority permits and the job `FAILED`; no host fault for an ordinary
  definitive rejection; no retry, second client or resubmission.
- **Tier 3 ambiguous**: one construction and one dispatch; an ambiguous
  transport or provider outcome; no fabricated ID and no acceptance record;
  the ambiguous composition; `OUTCOME_UNKNOWN` when the report succeeds and
  the job `NEEDS_ATTENTION`; no retry or resubmission.
- **Lost response and crash**: a timed-out or lost create response;
  heartbeat authority loss while the create is pending; a callback commit
  with a lost response; a provider ID returned and then a callback failure;
  a host fault after `SUBMITTING` and before dispatch; a restart proving no
  automatic create resubmission. Existing journal and recovery semantics
  only; no second recovery mechanism.

**Criteria for `REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES`.** The flag stays
NO until all 25 pass; a file merely existing is insufficient.

1. The Google real adapter exists in commercial-worker.
2. `@google/genai` 2.24.0 is exact-pinned as a worker dependency.
3. No engine or root runtime import.
4. Zero provider-create retries are configured.
5. Zero retries are proven at the actual SDK HTTP transport level.
6. The create timeout is 60000 ms and a timeout maps to ambiguous.
7. The closed request parser exists.
8. The prompt is capped at 1000 UTF-16 code units.
9. The model is exactly `gemini-omni-1.1-flash`.
10. The resolution is exactly `720p`.
11. Verified R44B10P1/P2 input composition happens before the permit.
12. The scoped sealed-credential capability preserves authority.
13. Plaintext does not survive across control-plane calls.
14. Client construction happens only after the permit.
15. At most one client construction and one create dispatch.
16. `runWithInFlightHeartbeat` wraps create plus acceptance.
17. The durable acceptance callback is awaited and is the sole ID authority.
18. The provider execution ID is the raw, validated `Interaction.id`.
19. The definitive provider-failure composition passes.
20. The ambiguous provider-failure composition passes.
21. No duplicate report and no automatic resubmission exist.
22. The adapter unit and transport-level test matrix passes.
23. The tier 3 accepted, definitive and ambiguous paths pass.
24. The boundary, no-network and secret-safety proofs pass.
25. The real adapter stays default-off and
    `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

**Implementation result (R44B10A docs sync).** All 25 criteria pass against
the implementation published in
`aefd2ea95cc0d11652596fd2e099262bc4a945ac`. Evidence: 972/972 worker unit
tests across 22 files; worker typecheck clean; 58/58 worker integration
tests across 21 files, of which seven are the new Google tier-3 tests
covering accepted, definitive, ambiguous, P2/pre-dispatch, lost-response
and restart paths; 858/858 commercial-api non-DB tests and clean typecheck;
628/628 commercial-api DB tests across 106 suites; 2052/2052 root Google
regression tests across 33 files; and 116/116 worker boundary tests. The
actual SDK counting-transport tests prove exactly one HTTP request for 429,
503, connection failure, timeout and lost-response cases with
`maxRetries: 0`; the staged dependency is exactly `@google/genai` 2.24.0
in both worker manifest and lockfile. No protected commercial-api,
migration, shared-protocol, deployment, engine, root-manifest,
fake-provider, journal, acceptance or P1/P2 source was changed by the
implementation.

**Historical expected implementation scope (contract-lock time).** NEW in commercial-worker: the
Google create adapter, the real Google composer, the closed Google
`generationRequest` parser, and their unit, composer and tier 3 tests.
MODIFIED: `credentialOpeningRun.ts` (the sealed capability and the opened
context's model and request), possibly `credentialContracts.ts`,
`workerError.ts` only if genuinely needed, `tests/boundary.test.ts`,
`apps/commercial-worker/package.json` and
`apps/commercial-worker/package-lock.json`. UNCHANGED unless implementation
discovery proves otherwise: commercial-api, migrations, the shared
protocol, the deployment runbook, engine `src/**`, the root `package.json`
and `package-lock.json`, `fakeProvider.ts`, the fake composer's semantics,
the acceptance-journal format, the acceptance handler and adapter, and the
R44B10P1/P2 semantics. Exact filenames follow repository convention at
implementation.

**Still open** (none solved here): the production object store, storage
vendor and storage credentials; a production issuer; canonical
request-hash readiness; the section 24 destruction lifecycle; the live
`SUBMITTED` capacity condition; the process runner; production deployment;
controlled live-provider validation; provider polling, output storage and
provider completion; later provider adapters; and live provider
enablement.

**Status (R44B10A docs sync).**

- **R44B10P1:** fully closed.
- **R44B10P2:** fully closed.
- **R44B10A discovery:** PASS.
- **R44B10A contract lock:** published in
  `5bf740f530b3fc41044fe405c308251db65c6a6c`.
- **R44B10A implementation:** PASS; validated and published in
  `aefd2ea95cc0d11652596fd2e099262bc4a945ac`.
- **R44B10A implementation criteria:** 25/25 PASS.
- `REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES`;
  `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

### Second real-provider adapter: Runway Gen-4.5 (revision R44B10B)

**Locked decision (R44B10B; discovery and conflict screen passed, contract
locked, not implemented).** Discovery ran read-only against
`4580959f36a1433d26da883fd173ed8cb72c8234`. R44B10A, R44B10P1 and
R44B10P2 are fully closed, and no prerequisite slice is required before
this adapter. R44B10B adds a second worker-local create-only real-provider
adapter. It ends at durable `SUBMITTED`; it adds no polling, task retrieval,
output download, output persistence or completion. Live provider submission
stays disabled.

**Provider, model and SDK.** Provider identifier exactly `RUNWAY`; model
exactly `gen4.5`. The worker owns `@runwayml/sdk` exactly 4.20.0 as an
exact runtime dependency. The root manifest currently declares
`^4.20.0` but the root lock resolves 4.20.0; neither root file changes.
The adapter imports no engine or root source module.

**API authority.** API origin exactly `https://api.dev.runwayml.com`;
Runway API version exactly `2024-11-06`. The client is constructed only
after the provider permit with the re-opened granted credential, explicit
origin and version, `maxRetries: 0`, timeout 60000, injected fetch, and
`logLevel: "off"`. No custom headers, environment fallback, default
credential or default transport override is authoritative.

**Closed generation request.** The request is exactly
`{ prompt, referenceImage, durationSeconds }`; unknown members are
rejected before credential grant as issuer/control-plane invariant faults.

- `prompt`: non-empty string, no leading or trailing whitespace, at most
  1000 UTF-16 code units, never trimmed or rewritten.
- `referenceImage`: the exact R44B10P1 reference object. PNG, JPEG and
  WebP only.
- `durationSeconds`: integer 2 through 5 inclusive. Runway Gen-4.5
  supports a wider 2-to-10-second range, but this slice preserves
  BusyBookie's existing five-second operational ceiling. Widening it needs
  a later explicit policy lock.

The adapter owns `ratio: "1280:720"` and `outputFormat: "mp4"`. The
request cannot supply a seed, alternate ratio, professional/HDR format,
content-moderation override, provider URL or provider-specific option.

**Reference image transport.** The verified image bytes are converted
directly to
`data:<verified-content-type>;base64,<verified-bytes>` after the permit.
There is no HTTPS input URL, `runway://` durable identity or Runway
ephemeral-upload operation in R44B10B. The final data-URI string may not
exceed 5,242,880 characters. A conservative uniform retrieval ceiling of
3,932,142 raw bytes guarantees the limit for the allowed MIME prefixes;
the final URI length is checked again before construction/dispatch. An
oversized declared or retrieved object is handled through the existing
R44B10P2 `INPUT_OBJECT_TOO_LARGE` path before the permit.

**Cost authority.** The lease must use
`expectedCostCap.unit=PROVIDER_CREDITS`. Pricing and entitlement remain
issuer/control-plane authority; the worker neither invents nor refreshes a
price. Current Runway Gen-4.5 pricing and the existing BusyBookie policy
are 12 credits per second, but that fact is not a second worker billing
authority. The create response's `estimatedCost` is not acceptance
identity and is not used to override the authorised cap.

**Ordering.**

```text
lease
-> RUNWAY / gen4.5 / closed-request admission
-> credential grant
-> first credential open and validation; plaintext discarded
-> verified R44B10P1 image retrieval
-> R44B10P2 policy on input failure; stop
-> pre-provider permit: journal preparation, SUBMITTING, renewal
-> same-grant sealed credential re-open
-> inline data-URI construction and Runway client construction
-> runWithInFlightHeartbeat(
     one imageToVideo.create
     -> raw task.id
     -> awaited durable acceptance
   )
-> SUBMITTED
```

No provider client exists before the permit. No second credential grant
exists. Post-permit/pre-dispatch local failure is a host fault, makes no
provider report and leaves authoritative expiry recovery unchanged.

**Provider create.** Exactly one call:

```text
client.imageToVideo.create(
  {
    model: "gen4.5",
    promptImage: <verified-data-uri>,
    promptText: <authorised-prompt>,
    ratio: "1280:720",
    duration: <authorised-2-to-5>,
    outputFormat: "mp4"
  },
  { maxRetries: 0, timeout: 60000 }
)
```

Awaiting the create response is allowed. Calling `waitForTaskOutput`,
`tasks.retrieve`, any resume helper, output downloader, generation-record
writer or engine transaction is forbidden in this slice.

**Provider execution ID.** Exactly the raw `task.id`; no trimming,
prefixing, case change, encoding or fabrication. It must already satisfy
the shared provider-execution-ID grammar. A valid ID is passed to the
existing awaited durable acceptance callback, which remains the sole
authority for entering `SUBMITTED`. `estimatedCost` is not part of the
acceptance record.

**Create failure classification.** Classification uses typed SDK fields
only, never error message text, raw bodies, headers or causes.

- **Definitive for this attempt:** typed Runway API response status 400,
  401, 403, 404, 422 or 429, with no accepted task ID. A 429 is never
  retried automatically.
- **Ambiguous:** 408, 409, every 5xx, timeout, connection failure/reset,
  unknown transport failure, an unknown or unlocked HTTP status, or any
  condition where acceptance cannot safely be disproved.
- **Malformed success:** missing, empty, transformed or invalid `task.id`
  is ambiguous and a host fault. No ID is fabricated.
- A later task failure after a valid task ID was accepted belongs to future
  polling/completion work and cannot be reclassified as create rejection.

**Provider retry and idempotency.** Client and request both use
`maxRetries: 0`. Runway's SDK default retry machinery is never relied
on. No application retry exists. No Runway idempotency key/header is
relied on, and BusyBookie makes no provider exactly-once claim.

**Secret and logging safety.** The Runway client uses
`logLevel: "off"`. Raw SDK response bodies, messages, headers, causes,
credential material, data URIs and image bytes never enter WorkerError,
journal, audit, security events, routine logs or control-plane requests.

**Default-off composition.** R44B10B is a worker library plus automated
tests only. It adds no generic provider selector, registry, daemon, CLI,
worker loop, deployment entrypoint or startup caller. Google remains
unchanged. Normal production startup still cannot invoke either real
provider.

**Migration, API and protocol.** None. Existing
`expectedCostCap` already supports `PROVIDER_CREDITS`; P1/P2,
credential sealing, permit, heartbeat, acceptance, failure reporting and
provider-ID grammar are reused unchanged.

**Mandatory tests.**

- request parser: exact members, prompt rules, duration 2..5, provider/model,
  cost unit and all rejected variants;
- data-URI construction for PNG/JPEG/WebP, the 3,932,142-byte ceiling and
  exact final 5,242,880-character guard;
- actual Runway 4.20.0 SDK with injected counting fetch: accepted create
  and exactly one HTTP request on 408, 409, 429, 503, connection failure
  and timeout;
- a guard test proving the counting harness observes more than one request
  when retries are intentionally enabled;
- zero construction/dispatch for wrong provider/model/request/cost unit,
  every P2 input failure, storage failure and permit refusal;
- post-permit credential re-open/client-construction faults: latch, zero
  dispatch and zero provider-failure report;
- raw task-ID acceptance and malformed-ID ambiguity;
- definitive and ambiguous failure composition;
- tier-3 accepted, definitive and ambiguous paths using the real control
  router, test PostgreSQL, journal and real SDK with no network;
- lost response, acceptance failure, heartbeat authority loss and restart:
  no automatic Runway create resubmission;
- boundary, no-engine-import, no-polling, no-upload, no-environment,
  secret-safety and default-off proofs.

**Criteria for `R44B10B_RUNWAY_PROVIDER_IMPLEMENTED=YES`.**

1. The Runway adapter exists in commercial-worker.
2. `@runwayml/sdk` 4.20.0 is exact-pinned in the worker.
3. API origin and version are explicit.
4. No root engine/source runtime import exists.
5. The closed request parser exists.
6. Prompt and duration rules are enforced without normalization.
7. Model is exactly `gen4.5`.
8. Ratio is exactly `1280:720` and output format exactly `mp4`.
9. Runway input uses verified inline data URI only.
10. Provider-specific data-URI size is rejected before the permit through
    the existing P2 path.
11. The expected-cost unit is exactly `PROVIDER_CREDITS`.
12. The single granted sealed credential preserves authority.
13. Plaintext does not survive across control-plane calls.
14. Client construction occurs only after the permit.
15. At most one Runway client and one create dispatch exist.
16. Create uses `maxRetries: 0` and timeout 60000.
17. Real-SDK transport tests prove one request on all locked retryable
    cases.
18. `runWithInFlightHeartbeat` wraps create plus acceptance.
19. The durable acceptance callback is awaited and is the sole ID authority.
20. The provider execution ID is raw validated `task.id`.
21. Definitive and ambiguous failure composition passes.
22. No duplicate report or automatic resubmission exists.
23. Tier-3 accepted, definitive and ambiguous paths pass.
24. Boundary, no-network, no-polling, no-upload and secret-safety proofs
    pass.
25. The adapter remains default-off and
    `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

**Expected implementation scope.** NEW in commercial-worker: Runway request
contract, create adapter, Runway attempt composer and their unit/tier-3
tests. MODIFIED: worker package manifest/lockfile and boundary tests;
`workerError.ts` only if a genuinely missing local invariant requires it.
Expected unchanged: commercial-api, migrations, shared protocol,
deployment, root `src/**`, root manifest/lockfile, Google adapter/composer,
fake provider/composer, acceptance journal/handler/adapter and P1/P2
semantics.

**Historical status (R44B10B contract lock).**

- **R44B10B discovery:** PASS.
- **R44B10B conflict screen:** PASS.
- **R44B10B prerequisite required:** NO.
- **R44B10B contract lock:** this revision.
- **R44B10B implementation:** not started.
- `R44B10B_RUNWAY_PROVIDER_IMPLEMENTED=NO`.
- `REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES` remains true because R44B10A
  is already implemented.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

**Implementation result (R44B10B docs sync).** All 25 implementation
criteria pass against the implementation published in
`c15a1186ab072dc32602c707b05f93807a0e25ef`. Evidence: 1159/1159
commercial-worker unit tests across 25 files and clean worker typecheck;
67/67 worker PostgreSQL integration tests across 26 files after the
ordering repair; 858/858 commercial-api non-DB tests across 21 files and
clean commercial-api typecheck; 628/628 commercial-api PostgreSQL tests
across 106 suites after the repair; 2289/2289 root Runway-and-Google
regression tests across 77 files; and 131/131 worker boundary tests.

The actual `@runwayml/sdk` 4.20.0 counting transport proves one provider
request on the locked accepted and failure paths with provider retries
disabled, while the deliberate retry-enabled guard proves the harness
would detect multiple requests. The ordering regression tests prove the
post-permit sequence is sealed-credential re-open, inline data-URI
construction, then client construction; the prior reversed ordering fails
the regression guards. The final implementation changed exactly the
expected ten commercial-worker files. Commercial-api production source,
migrations, shared protocol, deployment, root engine/source,
root manifest/lockfile, Google semantics, fake-provider semantics,
acceptance semantics and R44B10P1/P2 semantics were not changed by
R44B10B. No real provider network call was made during automated
validation.

**Current status (R44B10B docs sync).**

- **R44B10B discovery:** PASS.
- **R44B10B conflict screen:** PASS.
- **R44B10B prerequisite required:** NO.
- **R44B10B contract lock:** published in
  `26649355a9d8af8fda34e83ee8a6362e4c1882e8`.
- **R44B10B implementation:** PASS; validated and published in
  `c15a1186ab072dc32602c707b05f93807a0e25ef`.
- **R44B10B implementation criteria:** 25/25 PASS.
- `R44B10B_RUNWAY_PROVIDER_IMPLEMENTED=YES`.
- `REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES`.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

### BYO generation authority and usage-ledger prerequisite (revision R44B11P1)

**Locked decision (R44B11P1; architecture and policy only, not
implemented).** R44B10A and R44B10B complete the default-off real-provider
create-to-`SUBMITTED` worker adapters. The next control-plane dependency is
the historical implementation-sequence step 12: generation entitlement and
usage authority. That step's old label, "Full R44B7 entitlement and usage
authority", is stale because R44B7 was subsequently used for the whole-chain
crash/restart proof. The continuation is R44B11. R44B11P1 locks the
prerequisite contract before any issuance service, usage-ledger migration or
customer generation route is implemented.

**Discovery and conflict screen.** Discovery ran against
`71df65f6ac2e379786fcb738c4fe21316dde2126`. The R44B11 discovery report
SHA-256 is
`44d4ec822e8b8edaddfdf2a7bb1f19bddbc0fb25d33ed5e0b271f156dc7575ab`.
The R44B11P1 conflict-screen report SHA-256 is
`60e85ceabb0a3df2ecb9838fb0873fedff68771d18789c88b8ba91a3727ee26a`.
The existing `generation_authorizations` table is a persistence skeleton:
there is no application issuance service and no usage reservation authority.
The worker queue already requires `generation_authorizations.status =
'CLAIMED'`. `free-byo-v1` currently defines Production cardinality only,
and the persistence architecture explicitly deferred generation reservation,
consumption and UsageLedger policy.

**Scope.** R44B11P1 is `USER_BYO` only. `PLATFORM_HOSTED`,
`HOSTED_TRIAL` and `CREATOR` remain outside this contract. No platform
credential authority, hosted-trial reservation, checkout, billing, provider
polling, output persistence, completion, production runner or live-provider
enablement is introduced.

**FREE_BYO semantics.** For USER_BYO generation the qualifying FREE_BYO grant
is access and provenance authority, not a per-generation consumable token.
Issuing, claiming, executing, retrying or recovering one USER_BYO generation
does not change the grant from `AVAILABLE` to `RESERVED` or `CONSUMED`
and does not write `reserved_at` or `consumed_at`. No numeric generation,
runtime, shot or cost quota is invented by this slice. A future numeric usage
limit requires an explicit policy-version and architecture revision rather
than silently changing `free-byo-v1`.

**Eligibility at issuance.** A new USER_BYO GenerationAuthorization requires
all of the following server-side authority at the same account boundary:

- active authenticated User and active Account;
- an owned Production whose `archived_at` is NULL;
- its qualifying FREE_BYO grant in `AVAILABLE` state under a supported
  policy version;
- a ProviderConnection of that Account whose status is `ACTIVE` and whose
  verification status is `VERIFIED`;
- the exact current credential version in `ACTIVE` state;
- a provider and model explicitly enabled by the server's generation
  capability policy;
- an exact generation request accepted by the shared provider/model request
  contract;
- a server-authoritative expected-cost cap.

The browser supplies no trusted Account, grant, billing mode, credential
version, entitlement decision or expected-cost cap. There is no fallback from
USER_BYO to a platform credential.

**Production archival policy.** R44B11P1 deliberately resolves new-generation
behaviour for the schema-v1 archival marker. A Production whose
`archived_at` is non-NULL is ineligible for a new GenerationAuthorization.
Archiving does not restore FREE_BYO Production capacity, does not roll back or
cancel already-claimed work, and does not prevent recovery of an already
authorised provider execution.

**Provider-verification prerequisite.** The provider-connection architecture
left the use of an unverified connection for generation as an open decision.
R44B11P1 resolves that decision for USER_BYO generation: an unverified
connection is not eligible for new generation. Issuance requires connection
status `ACTIVE` and verification status `VERIFIED`, and the exact bound
credential version must be `ACTIVE`.

The current customer ProviderConnection flow has no implemented verification
operation, so this requirement is not yet satisfiable through normal customer
flow. A separate provider-specific, non-generating verification capability
must be locked and implemented before customer generation is enabled. If no
safe verification operation is available for a provider, that provider
remains commercially disabled for issuance under this contract. A generation
request must never be used as a credential-verification probe.

**Post-issuance credential lifecycle.** Issuance-time eligibility and
post-issuance provenance are distinct. Once an authorization is issued, its
exact ProviderConnection and ProviderCredentialVersion are immutable. A
rotation never rewrites the authorization to the new current credential.

If the exact bound credential version later moves from `ACTIVE` to
`SUPERSEDED` because of rotation, the authorization remains bound to that
same version. A later claim may use that bound `SUPERSEDED` version if its
sealed material still exists and the ProviderConnection has not become
`INVALID`, `DISCONNECTED` or `DISABLED`. No lookup of a newer or
"current" credential is allowed.

Rotation resets the ProviderConnection to
`PENDING_VERIFICATION`/`UNVERIFIED` for the new current credential. That
reset alone does not invalidate an authorization issued earlier against the
previous verified credential. In that narrow case, claim may proceed only
when the authorization's bound version is `SUPERSEDED` and a distinct
`ACTIVE` version exists on the same connection. This exception applies only
to already-issued provenance; a `PENDING_VERIFICATION` connection remains
ineligible for a new authorization.

An `INVALID`, `DISCONNECTED` or `DISABLED` connection is not claimable.
A bound version in `RETAINED_FOR_RECOVERY` or `DESTROYED` is not claimable
for a new provider create. Claim never silently substitutes another
credential version.

**Disconnect before claim.** Disconnect stops new authorization use of the
connection. Any still-`ISSUED` authorization bound to that connection is
cancelled before it can become provider work. It moves
`ISSUED -> CANCELLED` with `cancelled_at`, produces safe audit evidence
and, where an AUTHORISED usage-ledger event already exists, appends the
corresponding cancellation evidence. It creates no execution job or attempt
and no provider call.

Issuance, claim and disconnect must serialise on the ProviderConnection
lifecycle so only one authoritative result can commit: either claim commits
first, or disconnect makes the authorization unclaimable. An implementation
must prove this race against PostgreSQL; process-local locking is
insufficient.

**Disconnect after claim but before provider submission.** The existing
worker-bridge rule remains unchanged:
`CREDENTIAL_RETENTION_OBLIGATION_OPENS_AT_GRANT=YES`. R44B11 does not move
that boundary back to authorization issuance or claim.

A claimed job that is still `QUEUED`, or a `LEASED` attempt that has not
crossed the durable `SUBMITTING` barrier, may not become a new provider
create after disconnect. R44B11 implementation therefore requires an
authoritative pre-submission disconnect-convergence path. If the attempt is
still safely pre-submission, it converges to `CANCELLED`, its job converges
to `CANCELLED`, and no provider call occurs. The GenerationAuthorization
remains `CLAIMED`, because that lifecycle state is terminal; cancellation
is recorded additively in usage/audit evidence and never fabricates another
authorization or usage identity.

If a credential grant committed before disconnect, the existing
credential-retention obligation protects the exact version until the
pre-submission attempt is safely cancelled or advances to the existing
submission/recovery lifecycle. If `SUBMITTING` committed first, disconnect
does not cancel or replace the provider execution: the existing recovery-only
retention and exact-version rules remain authoritative.

**Disconnect convergence and credential cleanup.** The existing disconnect
transaction deliberately locks Account -> ProviderConnection -> credential
versions and does not then lock execution attempts, because the credential-
grant path already locks an attempt before taking shared connection/version
locks. R44B11 must not introduce the opposite lock order and create a
deadlock.

Accordingly, safe pre-submission attempt/job cancellation after disconnect is
a post-disconnect authoritative convergence step, not an inversion of the
existing version-gate transaction. The first disconnect transaction makes
the connection ineligible and retains any exact credential whose current
attempt state still opens an obligation. After that transaction commits, the
convergence path may lock the pre-submission attempt/job under their existing
ordering and cancel them when still safe.

When such cancellation closes the final credential-retention obligation,
credential destruction eligibility must be re-evaluated deterministically.
A version retained only for that now-closed obligation is destroyed through
the existing destruction gate or its narrowly factored equivalent. Cleanup
must not depend on the customer issuing a second disconnect request, process
restart, lease timeout alone or an operator remembering to retry the action.

All claim/disconnect implementation must preserve the established relative
locking rule that the ProviderConnection lifecycle lock is obtained before a
new claim commits against that connection. A claim path must not hold a
GenerationAuthorization lock and then wait for a connection lock while
disconnect holds the connection and waits for the authorization.

This deliberately reconciles the older provider-connection wording about
already-authorised work with the later worker-bridge rule that retention opens
at grant and disconnect permits no new create. R44B11 does not weaken the
`SUBMITTING` barrier, recovery rules or credential-destruction gate.

**Shared generation-request authority.** The issuer and worker must not keep
two independent validators for the same provider/model generation contract.
Before issuance implementation, one pure shared contract authority must own
the locked provider/model constants, closed request grammar and cost-unit
compatibility used at both boundaries. It imports no provider SDK, engine,
network, credential or environment code. Exact package/module placement is
resolved by the first implementation sub-slice after inspecting repository
dependency boundaries.

**Reference-image validation boundary.** R44B11 does not silently change the
R44B10A/R44B10B input-media contract. At issuance and provider/model lease
admission, `referenceImage` remains the closed request's present-but-opaque
untrusted member. Its inner object-reference grammar is still owned by the
R44B10P1 input-media contract and is validated by the worker after credential
grant and before the pre-provider permit.

A malformed reference therefore remains an R44B10P2 input failure; R44B11
does not reclassify it as authorization failure merely because the request is
also hashed at issuance. The canonical generation-request hash includes the
exact JSON value stored for `referenceImage`; the issuer does not trim,
normalise, rewrite or substitute that member. Moving its inner validation to
an earlier boundary requires a deliberate later architecture revision.

**Canonical generation-request bytes and hash.** The shared contract authority
also owns the bytes hashed into
`generation_authorizations.generation_request_sha256`. After the closed
provider/model request has been validated, it is serialised using RFC 8785
JSON Canonicalization Scheme and encoded as UTF-8. The stored hash is the
lowercase hexadecimal SHA-256 of exactly those canonical UTF-8 bytes.

The hash is never computed from caller-supplied raw HTTP JSON bytes, property
insertion order, PostgreSQL `jsonb::text`, provider-SDK serialisation or any
normalised provider request. Unknown or invalid request members are rejected
before canonicalisation.

The lease carries both the stored generation request and its stored SHA-256.
Before credential grant, the worker-side shared admission contract recomputes
the canonical hash from the validated closed request and requires exact
equality with the lease hash. A mismatch is an issuer/control-plane invariant
fault: no credential grant, provider construction or provider call is
allowed. This future worker-side check is an R44B11 implementation obligation;
R44B11P1 itself changes no runtime source.

**Provider capability default.** Commercial generation capability is
explicit allow-list authority. The production default is no enabled
provider/model. Adding Google or Runway to the worker does not by itself
commercially enable issuance. A capability entry supplies the exact
provider/model, request contract and server-side expected-cost policy needed
for issuance.

**Issuance identity and idempotency.** One GenerationAuthorization represents
one exact logical generation intent. Its immutable identity includes Account,
Production, entitlement grant, `USER_BYO`, provider, model, exact
ProviderConnection, exact ProviderCredentialVersion, canonical generation
request/hash, expected-cost cap and expiry. A creation idempotency key replay
for exactly the same trusted intent returns the existing authorization.
Reusing that key for different trusted intent is an explicit conflict.
Issuance never creates provider work directly.

**Authorization expiry policy.** `expires_at` is server authority and is
never accepted from the browser, worker or provider. R44B11P1 deliberately
locks no numeric authorization lifetime: no TTL is invented here. Before an
issuance implementation can be commercially enabled, a reviewed generation-
authority policy must define the authorization claim lifetime and its versioned
source.

Issuance derives `expires_at` from database-server time plus that locked
policy value. Claim eligibility is evaluated against database-server time,
never a browser or worker clock. An idempotent issuance replay returns the
original authorization including its original `expires_at`; replay never
extends, refreshes or replaces the authorization lifetime.

Until a claim-lifetime policy is locked, production generation capability
remains disabled and no production issuer may create a GenerationAuthorization
by inventing a convenient expiry value.

**Usage-ledger authority.** R44B11 requires an append-only commercial usage
ledger. For USER_BYO it is accounting/provenance evidence, not a quota
counter and not provider billing authority. The stable logical usage identity
is the GenerationAuthorization ID. Exactly one AUTHORISED usage entry may
exist for one GenerationAuthorization. Worker attempt retries, provider
recovery, acceptance recovery and process restart reuse that same logical
usage identity and may not create a fresh AUTHORISED entry. Later terminal
or accounting events may be additive, but cannot rewrite the original
authority or fabricate another logical generation.

**Claim boundary.** Provider work becomes queue-eligible only after a
server-authoritative claim. Claiming an unexpired `ISSUED` authorization is
one database transaction that:

1. locks and revalidates the authorization, active User and Account, the
   non-archived Production, qualifying AVAILABLE FREE_BYO grant and supported
   policy version;
2. revalidates the exact ProviderConnection and bound
   ProviderCredentialVersion under the post-issuance credential-lifecycle
   rules above, without selecting a replacement credential;
3. transitions exactly that authorization `ISSUED -> CLAIMED` with
   `claimed_at`;
4. creates exactly one `execution_jobs` row for it;
5. creates exactly one initial `execution_attempts` row in `QUEUED`;
6. records the append-only CLAIMED usage event/evidence required by the usage
   ledger;
7. writes the corresponding safe audit evidence.

The existing unique job-per-authorization rule remains authoritative.
Idempotent claim replay returns the already-created job/attempt and adds no
second usage entry or audit transition. A claim at or after expiry is
refused; unclaimed expiry or cancellation creates no provider work.

**Retries and recovery.** A new execution attempt for the same claimed job is
not a new commercial generation and does not create a new entitlement
reservation or AUTHORISED usage identity. Recovery of an already-created
provider execution likewise consumes no fresh entitlement. Provider ambiguity
never authorises replacement work automatically.

**Failure and terminal semantics.** Claim is the commercial commitment point
for this USER_BYO slice. A later definitive provider rejection,
`OUTCOME_UNKNOWN`, recovery, output failure or completion failure does not
roll the GenerationAuthorization back to `ISSUED` and does not create a
fresh usage identity. Future policies may record additive terminal accounting
events without changing the original authorization provenance.

**Default-off boundary.** R44B11P1 adds no runtime code, migration, route,
worker call, provider call or process runner. Customer generation remains
unreachable from normal production startup. Production object storage,
production KMS/sealing, a production issuer composition, process/deployment
wiring and controlled live validation remain separate gates.
`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` remains authoritative.

**Implementation split after this lock.** Implementation must be discovered
and reviewed as separate narrow slices rather than one broad rewrite. The
expected decomposition is: shared issuer/worker generation-contract authority
including canonical request hashing while preserving the R44B10P1
reference-image boundary; usage-ledger persistence and database invariants;
USER_BYO issuance and claim services with concurrency/idempotency and expiry-
policy tests; ProviderConnection rotation/disconnect integration,
deterministic pre-submission cancellation and post-cancellation credential
cleanup; the separate provider-verification capability required before
customer generation enablement; then any customer HTTP composition that is
still justified by the production-storage and live-enablement gates. Exact revision
suffixes and file scope are locked only after the next implementation
discovery.

**Historical status (R44B11P1 contract lock).**

- **R44B11 discovery:** PASS.
- **R44B11 conflict screen:** PASS.
- **R44B11 prerequisite required:** YES.
- **R44B11P1 contract:** this revision.
- **R44B11P1 implementation:** not started.
- **R44B11 parent implementation:** not started.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

### Shared generation-request contract and canonical-hash authority (revision R44B11A)

**Historical locked decision (R44B11A contract lock; not implemented at lock
time).** R44B11A
is the first implementation slice following the R44B11P1 prerequisite lock.
It implements only the first item of the R44B11P1 decomposition: the shared
issuer/worker generation-request contract and canonical request hashing. It
resolves the package/module placement that R44B11P1 deliberately deferred to
this sub-slice. The usage ledger, issuance, claim, disconnect convergence,
provider verification and any customer route remain later slices.

**Discovery.** Discovery ran against
`cbdc7691d8b55cb8d173a05957ba35cb43b261dc`. The R44B11A shared-contract
discovery report SHA-256 is
`8835e6bdd5b7ac676ca2122195cc1afb009c22e64466a5f0b7e63d1b0d19c840`.

It found no suitable RFC 8785 generation-request canonicalization or hash
authority in `packages/commercial-worker-protocol`. The shared protocol
package currently has no runtime dependencies.

The repository does contain an editorial canonicalizer,
`src/editorial/canonicalizeEditorialPlan.ts`, with an `editorialSha256()`
helper built on `node:crypto`. R44B11A does not reuse it, for two reasons:

- it is local to the engine's editorial code, not part of the shared
  commercial protocol authority;
- its canonical-number policy rejects negative zero, while RFC 8785 requires
  negative zero to canonicalize as `0`, so it is not byte-compatible with
  the R44B11A JCS contract as written.

The editorial implementation is not changed in this slice.

**Placement.** The single shared authority lives in the existing private
package `packages/commercial-worker-protocol`. No other shared package is
introduced, so the worker boundary rule of exactly one shared package stays
true. The implementation adds
`packages/commercial-worker-protocol/src/generationRequestContract.ts` and
re-exports it from `src/index.ts`. The package manifest is unchanged: still
private, with no `dependencies`.

**Shared authority scope.** The shared module owns:

- the `GOOGLE_GENAI` / `gemini-omni-1.1-flash` identity;
- the `RUNWAY` / `gen4.5` identity;
- provider/model compatibility;
- the closed Google generation-request grammar
  (`{prompt, referenceImage, resolution}`);
- the closed Runway generation-request grammar
  (`{prompt, referenceImage, durationSeconds}`);
- the prompt limits that form part of request validity (non-empty, at most
  1000 UTF-16 code units, no edge whitespace, never trimmed);
- the Google resolution request authority (`720p` only);
- the Runway duration request authority (integer, 2 to 5 inclusive);
- expected-cost-cap unit compatibility (`MICRO_USD` for Google,
  `PROVIDER_CREDITS` for Runway);
- RFC 8785 JSON Canonicalization Scheme serialisation of the generation
  request;
- UTF-8 encoding of the canonical text;
- lowercase hexadecimal SHA-256 of exactly those bytes;
- worker-side recomputation of `generation_request_sha256` and the exact
  equality check against the lease.

These values and rules move; they are not copied. After R44B11A no worker
module keeps a second literal or validator for any of them.

**Adapter-owned values that do not move.** The following stay in the worker's
Google/Runway contract and adapter modules. They are not part of shared
generation authority:

- provider API origins;
- API versions;
- SDK construction;
- create timeout and retry settings;
- Google response-format and interaction flags;
- Runway output ratio and output format;
- reference-image byte ceilings;
- Runway data-URI limits;
- provider response and error classification;
- provider execution ID handling.

The provider execution ID rule already in the protocol package (R44B6P) is
unaffected.

**Purity.** The shared module stays pure in the sense the protocol package
already enforces. It has no provider SDK, network, database, environment,
filesystem, credential or KMS implementation, and no process or runtime
composition. Its only non-relative import is the Node built-in
`node:crypto`, used solely for `createHash("sha256")`. That is a built-in,
not an npm dependency, and it reads no key, environment, file or network. A
hand-written SHA-256 is not allowed.

**Independence from worker types.** The shared contract does not import or
depend on `WorkerLease` or `WorkerError`. It accepts plain values (provider,
model, generation request, expected-cost unit and expected hash) and reports
failure through its own closed classification. That classification
distinguishes:

- provider/model unsupported;
- request invalid;
- cost unit incompatible;
- value not canonicalizable;
- hash mismatch.

It never yields provider, credential or environment text.

The worker-local `googleProviderContract.ts` and `runwayProviderContract.ts`
remain thin adapters. They call the shared authority, map its classification
to the existing `WorkerError` semantics, and keep the adapter-only constants
listed above. Their exported names and the types consumed by the composers
and adapters do not change, so no other worker module changes.

**Worker-facing error semantics.** The outward worker failure taxonomy is
unchanged:

| Shared classification | Worker error |
|---|---|
| Unsupported provider or model | `LEASED_PROVIDER_INCOMPATIBLE` |
| Closed-grammar failure (including prompt, resolution and duration) | `LEASED_REQUEST_INVALID` |
| Expected-cost-unit mismatch | `LEASED_REQUEST_INVALID` |
| Value outside the JSON/JCS domain | `LEASED_REQUEST_INVALID` |
| Generation-request hash mismatch | `LEASED_REQUEST_INVALID` |

No new outward worker failure code is added for R44B11A.

**Admission order and the pre-grant seam.** The hash check runs inside the
existing authoritative lease admission. `credentialOpeningRun` already
invokes the `admitLease` hook on the lease before
`requestCredentialGrant`, and the Google and Runway composers already pass
`admitGoogleLease` / `admitRunwayLease` through that hook. R44B11A extends
those two admission functions only. Within admission the order is:

1. provider/model compatibility;
2. expected-cost-cap unit;
3. closed request grammar;
4. canonical hash recomputed from the validated closed request;
5. exact string equality with `lease.generationRequestSha256`.

The wire client already validates `lease.generationRequestSha256` as 64
lowercase hexadecimal characters, so step 5 has no case folding.

There is no second credential-grant path, no process-local gate and no
reordering of orchestration. `credentialOpeningRun.ts`,
`googleAttemptExecution.ts`, `runwayAttemptExecution.ts`,
`googleProviderAdapter.ts` and `runwayProviderAdapter.ts` are expected to stay
byte-identical. `CREDENTIAL_RETENTION_OBLIGATION_OPENS_AT_GRANT=YES` is
neither moved nor weakened. A mismatch is decided before any grant, so it
opens no retention obligation.

**Hash mismatch.** A mismatch is an issuer/control-plane invariant fault, not
a provider rejection or an input failure. It is handled exactly as every
existing `LEASED_REQUEST_INVALID` admission failure. After a mismatch there
is:

- no credential grant;
- no credential opening;
- no reference-image retrieval;
- no pre-provider permit;
- no provider SDK construction;
- no provider call.

**Reference-image boundary.** `referenceImage` remains a present but opaque,
untrusted member at generation-contract validation. Its exact JSON value
takes part, unchanged, in canonical generation-request hashing. R44B11A does
not parse its object-storage grammar, and does not trim, normalise, rewrite or
substitute it.

R44B10P1 remains the authority for the inner validation of the reference
image, after the credential grant. A malformed inner object therefore remains
an R44B10P2 input failure; R44B11A does not move that validation earlier.

Being inside the JSON/JCS domain is not inner grammar. A request containing a
value the issuer could not have canonicalized at all is an issuer invariant
fault (`LEASED_REQUEST_INVALID`), wherever in the request that value sits.
An example is a lone surrogate, including one inside `referenceImage`.

**Canonicalization.** The JCS implementation is dependency-free and written in
the shared module. No new npm runtime dependency is authorised by this lock.
A later conflict screen would have to prove that an external dependency is
necessary before one could be added.

Serialisation follows RFC 8785:

- object members are ordered by UTF-16 code units, recursively;
- array order is preserved;
- strings use the RFC 8785 escaping and are otherwise emitted literally
  (non-ASCII is not escaped);
- finite numbers use the ECMAScript number-to-string form;
- `-0` serialises as `0`.

The output is encoded as UTF-8, and the hash is the lowercase hexadecimal
SHA-256 of those bytes.

Canonicalization fails closed for every value outside the JSON/JCS domain:

- non-finite numbers;
- lone or unpaired surrogates, in strings or member names;
- `undefined`, functions, symbols and bigints;
- non-plain objects and sparse arrays.

It never invokes `toJSON`. It never hashes raw HTTP bytes, property insertion
order, PostgreSQL `jsonb::text`, provider-SDK serialisation or a normalised
provider request.

**Required tests.** Shared-contract tests
(`apps/commercial-worker/tests/generationRequestContract.test.ts`) cover at
least:

- object-key order independence;
- recursive ordering of nested objects;
- array order preservation;
- UTF-8 and non-ASCII strings;
- escaping;
- finite number serialisation;
- negative zero canonicalizing as zero;
- rejection of non-finite numbers;
- rejection of lone and unpaired surrogates;
- rejection of unsupported non-JSON JavaScript values;
- a stable lowercase SHA-256 pinned to a literal;
- exact-value participation of `referenceImage`;
- a different request producing a different hash.

Those tests must also include conformance vectors:

- At least one test is pinned directly to an official RFC 8785 published
  canonicalization vector. At minimum this is the RFC 8785 object-property
  sorting example. Its non-ASCII property names (including a non-BMP
  surrogate pair) prove that members are ordered by raw UTF-16 code units,
  not by UTF-8 byte order, locale collation, escaped-property text or
  insertion order.
- Number tests are RFC-compatible and pin at least negative zero as `0`,
  plus representative exponent and number serialisation forms (for example
  the `1e+21` and `1e-7` boundaries, and the trailing-zero and
  shortest-round-trip forms in the RFC 8785 number samples).
- Every expected canonical string and hash used as a conformance vector is an
  independently pinned literal, or comes from the published RFC 8785
  expectation. No expected value is derived by calling the production
  canonicalizer itself.
- No new dependency is authorised for these tests.

Worker provider-contract unit tests
(`googleProviderContract.test.ts`, `runwayProviderContract.test.ts`) prove
the shared classification and its `WorkerError` mapping, for both Google and
Runway:

- an exact valid lease hash admits;
- a wrong hash is refused by admission;
- mutating the request after hashing fails;
- a provider/model mismatch remains `LEASED_PROVIDER_INCOMPATIBLE`;
- a malformed request remains `LEASED_REQUEST_INVALID`;
- an expected-cost-unit mismatch remains `LEASED_REQUEST_INVALID`;
- this layer still does not validate the inner grammar of `referenceImage`.

**Behavioural proof that a mismatch stops before the grant.** Each composer
test file carries one R44B11A behavioural test:
`apps/commercial-worker/tests/googleAttemptExecution.test.ts` for Google and
`apps/commercial-worker/tests/runwayAttemptExecution.test.ts` for Runway.
Each test uses a lease whose provider/model, expected-cost unit and
generation request are all valid, but whose `generationRequestSha256` is a
deliberately incorrect 64-character lowercase hexadecimal value. It proves
that:

- the attempt fails with `LEASED_REQUEST_INVALID`;
- `requestCredentialGrant` is called zero times;
- reference-image retrieval is not reached;
- the pre-provider permit is not reached;
- provider preparation and execution are not reached;
- no provider call occurs.

These tests use the existing test seams, counters and mocks. They require no
production orchestration change and no additional production file.

**Implementation file scope.** The expected scope is narrow.

- New:
  - `packages/commercial-worker-protocol/src/generationRequestContract.ts`
  - `apps/commercial-worker/tests/generationRequestContract.test.ts`
- Modified:
  - `packages/commercial-worker-protocol/src/index.ts`
  - `apps/commercial-worker/src/googleProviderContract.ts`
  - `apps/commercial-worker/src/runwayProviderContract.ts`
  - `apps/commercial-worker/tests/googleProviderContract.test.ts`
  - `apps/commercial-worker/tests/runwayProviderContract.test.ts`
  - `apps/commercial-worker/tests/boundary.test.ts`. This covers the two
    contract modules joining the protocol importers, the protocol closure
    gaining the new module, and the vocabulary pins.

Direct repository evidence at `cbdc7691` shows that this list alone cannot
pass the existing suites. Each adjustment below is test-only, documented here
before any modification, and authorised by this lock.

1. **`apps/commercial-api/tests/boundary.test.ts`.** Its test "contains
   exactly the pure credential contract, importing only itself" has three
   rules that the new module conflicts with:
   - it pins the exact protocol source inventory;
   - it requires every non-relative protocol import to be absent;
   - it applies commercial-api's forbidden-vocabulary scan to every protocol
     file, including `Runway provider` (`/runway/i`) and `Google GenAI provider`
     (`/genai|gemini/i`).

   The only changes allowed are:
   - add the new module to the inventory;
   - allow exactly `node:crypto` in exactly that module;
   - exempt exactly those two provider-vocabulary labels in exactly that
     module.

   Every other rule stays as it is, including the provider-SDK-package and
   provider-secret rules, and so does the commercial-api source scan.
   commercial-api runtime source does not change.

2. **`apps/commercial-worker/tests/googleAttemptExecution.test.ts` and
   `apps/commercial-worker/tests/runwayAttemptExecution.test.ts`.** Their
   lease fixtures carry the placeholder hash `"c".repeat(64)`, which the
   extended admission correctly refuses. Each fixture's hash becomes the
   canonical hash of its fixture request. A case whose request is deliberately
   invalid keeps its expected `LEASED_*` outcome. These two files also carry
   the pre-grant hash-mismatch behavioural proof required above.

3. **`apps/commercial-worker/tests/integration/googleProviderExecution.test.ts`
   and `apps/commercial-worker/tests/integration/runwayProviderExecution.test.ts`.**
   Their tier-3 seeds insert `generation_request_sha256` as `repeat('c', 64)`.
   Each seed becomes the canonical hash of its seeded request.

Placeholder hashes in fixtures that never reach Google or Runway admission
stay unchanged. These include the fake-provider, credential-opening,
acceptance-journal and whole-chain fixtures.

Any further deviation needs direct repository evidence, documented before the
modification.

**Not in R44B11A.** R44B11A does not include:

- a database migration;
- a usage-ledger implementation;
- a commercial-api issuance service or other runtime change;
- a customer HTTP route;
- a provider-verification implementation;
- a provider selector;
- a process runner;
- production live-provider enablement.

`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` remains authoritative.

**Historical status (R44B11A contract lock).**

- **R44B11A discovery:** PASS.
- **R44B11A contract:** this revision.
- **R44B11A implementation:** not started.
- **R44B11 parent implementation:** not started.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

**Implementation result (R44B11A docs sync).** R44B11A was implemented,
validated and published in `c5a21f578ecc573e04a2438c876c3eb155f5cf84`. The
implementation changed exactly the 13 files this lock authorised: the
expected scope plus the three documented test-only adjustments.

What the implementation does:

- **Shared authority.** It lives in
  `packages/commercial-worker-protocol/src/generationRequestContract.ts`.
  The Google and Runway provider/model identities moved there rather than
  being copied, along with:
  - the closed Google and Runway generation-request grammars;
  - the prompt limits;
  - the Google resolution and the Runway duration authority;
  - the expected-cost units.
- **Hashing.** RFC 8785 canonicalization is dependency-free. The hash is the
  lowercase SHA-256 of the canonical UTF-8 bytes, computed with `node:crypto`.
- **Pre-grant check.** The worker recomputes the hash and compares it exactly
  inside the existing pre-grant lease admission. A mismatch prevents the
  credential grant and all provider execution.
- **Worker contracts.** The Google and Runway worker contracts are thin
  adapters. They re-export the shared authority, keep only the
  adapter-owned constants, and map shared failures to the existing worker
  codes: `LEASED_PROVIDER_INCOMPATIBLE` for an unsupported provider or model,
  and `LEASED_REQUEST_INVALID` for everything else.
- **Reference image.** `referenceImage` remains opaque at this layer. Its
  inner validation remains R44B10P1's, after the grant, so a malformed inner
  reference remains an R44B10P2 input failure.
- **Not included:** no database migration, commercial-api runtime
  implementation, usage ledger, issuance or claim implementation, provider
  verification, customer route, process runner or live-provider enablement.

The final review added one parser-hardening correction. The root request
structure is now checked through its own property descriptors before any
value is read:

- accessors, symbol keys and hidden (non-enumerable) members fail closed;
- getters are never invoked;
- unsupported non-JSON structure cannot be projected away before canonical
  hashing.

Validation of the final published implementation:

| Check | Result |
|---|---|
| Protocol, commercial-worker and commercial-api typechecks | PASS |
| Shared generation-request contract tests | 121/121 |
| Google provider contract | 46/46 |
| Runway provider contract | 62/62 |
| Google attempt execution | 39/39 |
| Runway attempt execution | 52/52 |
| Worker boundary | 135/135 |
| commercial-api boundary | 189/189 |
| Full commercial-worker unit suite | 1302/1302 across 26 files |
| Full commercial-api non-DB suite | 858/858 across 21 files |
| commercial-worker PostgreSQL integration | 67/67 across 6 files |
| `git diff --check` | clean |

The commercial-api PostgreSQL suite passed 628/628 across 20 files before the
final parser-hardening correction. It was not rerun afterwards: that
correction changed only the shared generation-request module and its worker
test file, with no commercial-api runtime, schema, migration or database
behaviour change. No real provider network call was made during automated
validation.

**Current status (R44B11A docs sync).**

- **R44B11A discovery:** PASS.
- **R44B11A contract lock:** published in
  `4ccefc9927786869fe80a5cc231a3e1365ab8108`.
- **R44B11A implementation:** PASS; validated and published in
  `c5a21f578ecc573e04a2438c876c3eb155f5cf84`.
- **R44B11A:** fully closed.
- **R44B11P1 implementation:** started, not complete.
- **R44B11 parent implementation:** started, not complete.
- **Remaining R44B11P1 slices:** each remains a separate future slice:
  - the usage ledger;
  - USER_BYO issuance, claim and expiry;
  - ProviderConnection disconnect/rotation convergence and credential
    cleanup;
  - provider verification;
  - any customer route that is still justified.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

### Generation usage-ledger persistence (revision R44B11B)

**Locked decision (R44B11B contract lock; not implemented at lock time).**
R44B11B is the second R44B11P1 implementation slice. R44B11A is fully closed
and is not reopened. R44B11B implements only the persistence and database
invariants for the append-only commercial generation usage ledger that
R44B11P1 requires. It does not implement issuance, claim, provider
verification, disconnect/rotation convergence, a customer generation route
or live-provider enablement. Discovery ran against
`e9e98954acfd6c6057c5a2fb654f836b7c3ccf1c`, the published R44B11A closure
commit.

**Repository facts.** Discovery found:

- `generation_authorizations` is created by migration 0003.
- Each authorization carries immutable provenance: account, production,
  entitlement grant, the `USER_BYO` billing mode, provider and model, the
  exact ProviderConnection and ProviderCredentialVersion binding, the frozen
  generation request and its SHA-256, the expected-cost cap, the creator and
  the issuance idempotency key. The `generation_authorizations_guard_update`
  trigger rejects provenance changes even for the owner.
- The constraint
  `generation_authorizations_production_scope_uq UNIQUE (account_id, production_id, id)`
  already exists as a composite-FK target.
- Migration 0004 allows one execution job per authorization
  (`execution_jobs_authorization_uq`). Retry attempts live below the
  job/authorization layer in `execution_attempts`.
- The existing future-claim DB test locks an `ISSUED` authorization, marks it
  `CLAIMED`, then creates the job and its first attempt.
- Migrations are committed through 0007 only.
- `applyRuntimeGrants()` refuses to run unless the public-table inventory
  equals the keys of `RUNTIME_TABLE_PRIVILEGES` exactly.

R44B11B therefore attaches usage identity to the existing generation
authorization. It must not invent a second commercial generation identity.

**Migration and table.** The migration is
`apps/commercial-api/migrations/0008_generation_usage_ledger.sql`. It creates
the table `generation_usage_ledger` with exactly these normalized columns:

| Column | Type |
|---|---|
| `generation_authorization_id` | `uuid NOT NULL` |
| `account_id` | `uuid NOT NULL` |
| `production_id` | `uuid NOT NULL` |
| `recorded_at` | `timestamptz NOT NULL DEFAULT clock_timestamp()` |

`generation_authorization_id` is the PRIMARY KEY. There is no surrogate
usage ID: the usage identity is exactly the generation authorization ID.

**Database-authoritative `recorded_at`.** `recorded_at` is database
authority. INSERT privilege does not let a caller choose, backdate or
future-date the accounting evidence timestamp. The migration 0008 insertion
guard sets `recorded_at` from `clock_timestamp()` on every insert,
overwriting any caller-supplied value. No user-supplied or worker-supplied
timestamp is introduced.

One composite foreign key
`(account_id, production_id, generation_authorization_id)` references
`generation_authorizations (account_id, production_id, id)` with
`ON DELETE RESTRICT`. It reuses the existing
`generation_authorizations_production_scope_uq` target. R44B11B does not alter
`generation_authorizations` to support this FK. The composite FK makes
cross-account and cross-production provenance unrepresentable.

**CLAIMED-state admission guard.** The composite FK proves authorization
identity, account scope and production scope. It does not prove lifecycle
state. Migration 0008 therefore also adds a database INSERT guard. An insert
into `generation_usage_ledger` is admitted only when the exact referenced
`generation_authorizations` row has:

- a matching `account_id`;
- a matching `production_id`;
- a matching `id`;
- `status = 'CLAIMED'`;
- `claimed_at IS NOT NULL`.

An authorization in any non-CLAIMED state (`ISSUED`, `EXPIRED` or
`CANCELLED`) cannot acquire a canonical CLAIMED usage row. The guard adds to
the composite FK and does not replace it:

| Mechanism | Authority |
|---|---|
| Composite FK | Identity and scope integrity |
| INSERT guard | Lifecycle admission integrity |

Migration 0003 already makes `CLAIMED` terminal, through
`generation_authorizations_claimed_at_ck` and the
`generation_authorizations_guard_update` trigger, which allows lifecycle
changes only from `ISSUED`. So an admitted row cannot later reference a
non-CLAIMED authorization.

**No duplicated provenance.** The ledger does not copy the entitlement grant,
billing mode, provider, model, ProviderConnection, ProviderCredentialVersion,
generation request, `generation_request_sha256`, expected-cost unit,
expected-cost amount or creator. Those remain authoritative on the immutable
generation authorization. The ledger is an append-only accounting/provenance
index over that authorization, not a second copy of it.

**No execution-layer identity.** The ledger contains no `execution_job_id`,
`execution_attempt_id`, attempt number, worker principal, fencing counter,
lease token or lease-token hash, or provider execution ID. Worker retry and
recovery mechanics can never create another commercial usage identity.

**Append-only enforcement.** Two layers enforce it:

1. **Runtime privilege manifest.** `RUNTIME_TABLE_PRIVILEGES` gains
   `generation_usage_ledger` with SELECT and INSERT and no update columns.
   The runtime role has no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER
   on the table, consistent with the manifest's existing rule that no table
   grants DELETE, TRUNCATE, REFERENCES or TRIGGER.
2. **Database immutability guards.** Migration 0008 adds guards that refuse
   the following, including for the migration/owner role:
   - every UPDATE of a ledger row;
   - every DELETE of a ledger row;
   - every TRUNCATE of the table.

   Row-level UPDATE/DELETE triggers do not fire for PostgreSQL TRUNCATE.
   TRUNCATE therefore needs its own statement-level
   `BEFORE TRUNCATE ... FOR EACH STATEMENT` guard that refuses the operation.

The table has no mutable status, balance, count or quota column. A row
exists or does not exist.

**Lifecycle.** `generation_usage_ledger` holds the canonical CLAIMED
authorised-usage record that the R44B11P1 claim boundary requires.

- **Issuance** creates the generation authorization and no usage-ledger row.
  An idempotent issuance replay also creates no usage row. R44B11B does not
  implement issuance.
- **Claim.** A future claim slice will run one atomic transaction that:
  1. locks the exact `ISSUED`, unexpired generation authorization;
  2. validates the claim authority required by R44B11P1;
  3. transitions the authorization `ISSUED -> CLAIMED`;
  4. records exactly one canonical append-only CLAIMED usage row for that
     generation authorization;
  5. creates the execution job;
  6. creates its first `QUEUED` attempt;
  7. performs the required audit work.

  R44B11B implements only the persistence and invariants step 4 needs. It
  does not implement the claim service or transaction.
- **Retry and recovery.** None of the following creates another authorised
  usage record:
  - idempotent issuance replay;
  - claim replay;
  - worker retry;
  - crash recovery;
  - a replacement execution attempt;
  - provider submission;
  - provider completion.

The commercial usage identity remains the generation authorization ID.

**Cardinality.** There is exactly one AUTHORISED USAGE identity per
generation authorization: zero CLAIMED usage rows before claim and exactly
one after successful claim. Two layers establish this, and they prove
different things.

- **What R44B11B (migration 0008) proves:**
  - at most one canonical CLAIMED usage row per generation authorization
    (zero or one);
  - any existing row references a CLAIMED authorization;
  - the PRIMARY KEY on `generation_authorization_id` is the at-most-one
    authority.
- **What the future claim transaction proves:** a successfully committed
  claim creates exactly one canonical usage row. It does so in the same
  transaction as the `CLAIMED` transition, the execution job, the first
  attempt and the required audit work.

Migration 0008 by itself does not guarantee that every CLAIMED authorization
already has a ledger row. That guarantee belongs to the future claim
transaction.

**Reconciliation with R44B11P1.** R44B11B follows the R44B11P1 claim boundary
and does not redefine it:

- The canonical CLAIMED usage row is created by the future claim
  transaction.
- R44B11B creates only its persistence substrate.
- Issuance creates no usage. Worker retry and recovery create no usage.

**Future terminal or accounting evidence.** R44B11P1 allows later additive
terminal or accounting evidence. R44B11B locks only the canonical CLAIMED
authorised-usage record and its invariants, not the storage design for later
evidence. Any later terminal or accounting evidence:

- requires its own architecture revision;
- must remain append-only;
- must not create another authorised-usage identity for the same generation
  authorization.

R44B11B does not decide whether that later evidence uses another append-only
relation, an additive extension, or another architecture-approved
representation.

**Semantics.** The ledger role is `ACCOUNTING_PROVENANCE`. It is not quota
authority, entitlement-consumption authority, a billing balance, provider
invoice truth or provider completion truth. FREE_BYO remains an
access/provenance grant, not a per-generation consumable balance.

**No backfill.** Migration 0008 creates an empty ledger. It does not infer
historical usage from existing `generation_authorizations`,
`execution_jobs`, `execution_attempts`, provider execution IDs or audit
events.

**Runtime grant manifest.** Because `applyRuntimeGrants()` compares every
public table against `RUNTIME_TABLE_PRIVILEGES`, implementing R44B11B
necessarily modifies `apps/commercial-api/src/database/runtimeGrants.ts` to
add the ledger with SELECT and INSERT and no update columns. That is a
runtime grant-manifest change only, not an issuance or claim service.

**Expected implementation scope (later, not this lock).**

Production changes:

- NEW: `apps/commercial-api/migrations/0008_generation_usage_ledger.sql`.
- MODIFIED: `apps/commercial-api/src/database/runtimeGrants.ts`.

Test changes:

- the migration harness, version and checksum tests;
- the catalog/schema tests;
- the privilege tests;
- a dedicated generation-usage-ledger DB invariant test, if repository
  conventions support one.

Exact file scope is confirmed by implementation discovery. Any deviation needs
direct repository evidence, documented before the modification.

**Required proof.** The implementation must prove at minimum:

- migration 0008 applies after 0001–0007, and a second run is a no-op;
- checksum drift protection covers 0008;
- the schema version becomes 8;
- a valid same-account, same-production `CLAIMED` authorization can receive
  one ledger row;
- an insert for an `ISSUED`, `CANCELLED` or `EXPIRED` authorization is refused
  by the INSERT state guard;
- a caller-supplied `recorded_at` (backdated or future-dated) is not stored;
  the stored value comes from the database clock;
- a duplicate `generation_authorization_id` is refused;
- cross-account and cross-production provenance is refused;
- the runtime role can SELECT and INSERT;
- the runtime role has no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER
  privilege, so runtime TRUNCATE is refused by privilege;
- owner/migrator UPDATE and DELETE are rejected by the append-only guard;
- owner/migrator TRUNCATE is rejected by the statement-level append-only
  guard, and the existing rows remain intact after the refusal;
- no backfill occurs;
- no execution-attempt, worker or provider-execution identity appears in the
  table;
- the existing authorization, bridge and runtime invariants remain green.

**Not in R44B11B.** R44B11B does not include:

- a generation authorization issuance service or issuance HTTP route;
- a claim service or claim HTTP route;
- execution-job or attempt creation wiring;
- disconnect/rotation convergence;
- provider verification;
- a customer generation route;
- worker, shared worker protocol or provider SDK changes;
- quota decrement or FREE_BYO consumption;
- live-provider enablement.

`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` remains authoritative.

**Implementation result (R44B11B docs sync).**

R44B11B was implemented and validated after the contract lock without
reopening the locked generation-authority semantics.

- Contract-lock commit:
  `149890216dae24119e7b7fd0bbf4e123b67d23cb`.
- Implementation commit:
  `374f36be992bd278a267db09c37046fbd16b6912`
  (`feat(commercial): add generation usage ledger`).
- Migration:
  `apps/commercial-api/migrations/0008_generation_usage_ledger.sql`.
- Migration SHA-256:
  `087c2d4512180bfd8607663120e90c8928ab48fefe8ca4ca1c4063ef5d9cfee5`.
- Exact implementation commit scope: nine files.
- `generation_usage_ledger` has exactly the four locked normalized columns:
  `generation_authorization_id`, `account_id`, `production_id` and
  database-authored `recorded_at`.
- `generation_authorization_id` remains the canonical authorised-usage
  identity and PRIMARY KEY. No surrogate usage identity or execution-layer
  identity was introduced.
- The composite authorization FK remains the identity/account/production
  scope authority with `ON DELETE RESTRICT`.
- The INSERT guard admits only the exact matching authorization in `CLAIMED`
  with non-NULL `claimed_at` and overwrites caller-supplied `recorded_at`
  with `clock_timestamp()`.
- Runtime authority is SELECT plus INSERT only, with no UPDATE columns and
  no DELETE, TRUNCATE, REFERENCES or TRIGGER privilege.
- Database append-only guards reject owner/migrator UPDATE and DELETE, and
  the statement-level `BEFORE TRUNCATE` guard rejects owner/migrator
  TRUNCATE.
- Migration 0008 performs no backfill and infers no historical usage.
- R44B11B does not implement issuance or the future claim service/transaction.
  A later claim slice remains responsible for atomically performing
  `ISSUED -> CLAIMED`, inserting exactly one canonical CLAIMED usage row,
  creating the execution job and first attempt, and performing required
  audit work.
- Worker retry, recovery, provider submission and provider completion create
  no second authorised-usage identity.
- Validation passed:
  - TypeScript typecheck: PASS;
  - targeted PostgreSQL suites: 118/118;
  - full commercial-api PostgreSQL suite: 650/650 across 21 files;
  - full commercial-api non-database suite: 859/859 across 21 files;
  - staged implementation diff check: PASS.
- PostgreSQL validation used the dedicated PostgreSQL 16 test database at
  `127.0.0.1:5433`; no production database was used.
- The unrelated
  `docs/commercial/BUSYBOOKIE_FREE_BYO_HOSTED_TRIAL_BACKLOG.md`
  remained untracked and unchanged.
- No worker, shared worker-protocol or provider-adapter production change was
  introduced.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` remains authoritative.

**Current status (R44B11B docs sync).**

- **R44B11A:** fully closed; unchanged.
- **R44B11B discovery:** PASS.
- **R44B11B contract lock:** `149890216dae24119e7b7fd0bbf4e123b67d23cb`.
- **R44B11B implementation:** PASS; validated in
  `374f36be992bd278a267db09c37046fbd16b6912`.
- **R44B11B:** fully closed by this docs-sync revision.
- **R44B11P1 implementation:** started, not complete.
- **R44B11 parent implementation:** started, not complete.
- **Remaining R44B11P1 slices after R44B11B:** each remains a separate future
  slice:
  - USER_BYO issuance, claim and expiry;
  - ProviderConnection disconnect/rotation convergence and credential
    cleanup;
  - provider verification;
  - any customer route that is still justified.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

### USER_BYO generation-authorization issuance (revision R44B11C)

**Locked decision (R44B11C contract lock; not implemented at lock time).**
R44B11C is the third R44B11P1 implementation slice. R44B11A and R44B11B
remain fully closed and are not reopened. R44B11C implements only the
commercial-api authority for issuing a new USER_BYO GenerationAuthorization,
plus the source-controlled generation-authority policy seam that issuance
requires. It does not implement claim, expiry convergence, provider
verification, disconnect convergence, a customer generation HTTP route,
worker execution or live-provider enablement.

Discovery ran against published R44B11B closure commit
`e5ecd6891ca3fd58dd64492b58bf890b8d9edee4`.

**Repository facts.** Discovery established all of the following:

- migration 0003 already creates `generation_authorizations` with the complete
  USER_BYO provenance required by R44B11P1: Account, Production, entitlement
  grant, billing mode, provider, model, exact ProviderConnection, exact
  ProviderCredentialVersion, frozen generation request, canonical request
  SHA-256, expected-cost cap, expiry, creator and creation idempotency key;
- migration 0003 already provides the unique
  `(account_id, production_id, creation_idempotency_key)` issuance-replay
  authority and all required same-account/provider/credential foreign keys;
- the existing `generation_authorizations_guard_update` makes issuance
  provenance immutable;
- migration 0003 already permits
  `audit_events.resource_type = 'generation_authorization'`, so issuance audit
  evidence does not require another migration;
- migration 0008 already proves that issuance cannot create a
  `generation_usage_ledger` row: the ledger admits only an exact authorization
  already in `CLAIMED` with non-NULL `claimed_at`;
- `resolveActivePrincipalForIdentity()` already establishes the authenticated
  active User and PERSONAL Account boundary before application service entry;
- `freeByoPolicy.ts` is the existing versioned FREE_BYO entitlement-policy
  authority. `free-byo-v1` is access/provenance authority and does not make a
  generation consumable;
- `providerCapabilityRegistry.ts` is specifically the ProviderConnection
  creation registry. It is not generation provider/model authority and must
  not be silently widened into one;
- the ProviderConnection read model defines the current credential as the
  newest credential version, while migration 0002 permits at most one ACTIVE
  credential version per connection;
- provider-connection mutations already use the Account ->
  ProviderConnection lifecycle lock order. R44B11C must preserve that order;
- R44B11A is the single request-grammar, provider/model-identity,
  cost-unit and canonical-hash authority. R44B11C must use it rather than
  duplicate its validators or canonicalizer;
- worker and database test fixtures contain numeric expected-cost amounts, but
  those fixture values are not commercial generation-pricing or issuance
  authority;
- there is currently no generation-authorization issuance application service
  and no production generation-authority policy registry.

No schema change is justified by those facts.

**Service boundary.** R44B11C introduces an internal commercial-api issuance
service. It receives a trusted active principal from the authenticated
application boundary. The untrusted issuance intent contains exactly:

- `productionId`;
- `providerConnectionId`;
- `model`;
- `generationRequest`;
- `idempotencyKey`.

Unknown input members are rejected. `idempotencyKey` is mandatory at the
R44B11C service boundary, is never trimmed or rewritten, and must satisfy the
existing database length contract.

The caller does not supply trusted Account identity, entitlement grant,
billing mode, provider, ProviderCredentialVersion, entitlement decision,
generation-policy version, expected-cost cap or `expires_at`.

`provider` is derived from the selected same-account ProviderConnection.
`billing_mode` is fixed by this slice to `USER_BYO`. The exact entitlement
grant, exact credential version, expected-cost cap and expiry are all
server-authoritative.

A customer HTTP route is deliberately outside R44B11C.

**Generation-authority policy.** R44B11C adds a dedicated source-controlled
generation-authority policy abstraction. It is separate from both the FREE_BYO
entitlement policy and the ProviderConnection-creation capability registry.

A generation capability resolves by exact provider and model. An enabled
entry supplies:

- a versioned generation-policy identifier;
- the exact provider/model pair;
- a positive claim lifetime expressed in whole seconds;
- a pure server-side expected-cost policy operating only on the already
  validated shared generation request.

The request grammar, provider/model constants, canonicalization and cost-unit
compatibility remain owned by R44B11A. A generation-policy entry cannot inject
an alternative request validator, canonicalizer or provider/model grammar.

The expected-cost policy returns a positive JavaScript-safe integer amount in
the exact cost unit required by the R44B11A provider/model contract. The
amount is an execution safety ceiling, not a customer charge or provider
billing record.

Neither policy version, claim lifetime nor expected-cost result may come from
request input, environment-variable fallback, worker input or provider
response.

The production generation-authority registry contains **no enabled
provider/model capability in R44B11C**. Tests may inject explicit capability
entries. This permits the issuance service and all authority invariants to be
implemented and proven without inventing a production authorization TTL,
Google cost ceiling or Runway cost ceiling.

Enabling any production provider/model later requires a deliberate reviewed
policy revision containing its numeric claim lifetime and expected-cost
policy. Merely having Google or Runway worker adapters does not enable
commercial issuance.

**Shared request authority at issuance.** For a genuinely new authorization,
the service resolves the exact provider/model generation capability and then
uses the corresponding R44B11A shared request parser. It computes
`generation_request_sha256` only through the R44B11A canonical generation
hash authority.

The stored `generation_request` is the validated closed request. The
`referenceImage` member remains opaque at this boundary exactly as R44B11A and
R44B10P1 require. R44B11C does not inspect, rewrite, normalize or pre-fetch
its inner object-reference grammar.

A request outside the shared contract fails before authorization insertion.
No provider SDK, credential opening, object retrieval or provider call occurs
during issuance.

**Idempotency and replay.** The existing database identity
`(account_id, production_id, creation_idempotency_key)` is the issuance
idempotency authority.

After revalidating that the trusted User and Account remain active, the
service first checks for an existing authorization under that exact
idempotency identity.

A replay is the same logical issuance intent only when the existing
authorization has the same:

- Production;
- ProviderConnection;
- model;
- canonical generation-request identity/hash.

For a true replay the existing authorization is returned unchanged, including
its original exact credential binding, expected-cost cap, `expires_at`,
lifecycle status and timestamps.

Replay does **not**:

- extend or refresh `expires_at`;
- rebind to a newer credential;
- apply a newly changed generation policy;
- recompute or replace the stored expected-cost cap;
- move the lifecycle state;
- create a usage-ledger row;
- create a job or attempt;
- write another issuance audit event.

Therefore an authorization already `CLAIMED`, `CANCELLED` or `EXPIRED`, or an
`ISSUED` authorization whose database expiry time has passed but which has
not yet been converged to `EXPIRED`, is still returned as that same immutable
authorization on a true replay. Replay never resurrects it.

A key reused for a different ProviderConnection, model or canonical request
is an explicit idempotency conflict.

For concurrent same-key requests, the implementation must re-check replay
after acquiring its authoritative database locks and must treat the existing
unique index as the final race guard. Exactly one authorization and exactly
one issuance audit transition may be committed.

**New-issuance authority and transaction.** A non-replay issuance executes in
one READ COMMITTED database transaction on one dedicated runtime client.
Application/process-local locks are never authority.

The transaction must:

1. lock the trusted User eligibility row with a row lock that conflicts with
   User-status updates, then lock the trusted PERSONAL Account using the existing
   account-lock pattern; retain both locks through commit, require the Account
   to remain owned by that User, and require both User and Account to remain
   `ACTIVE`;
2. acquire the selected same-account ProviderConnection lifecycle lock using
   the established Account -> ProviderConnection ordering;
3. require that ProviderConnection to be `ACTIVE` with
   `verification_status = 'VERIFIED'`;
4. read the newest credential version for that connection and require that
   exact newest version to be `ACTIVE`; an older ACTIVE row is never selected
   as a substitute;
5. bind that exact credential-version row immutably to the authorization;
6. lock the exact same-account Production row with a row lock that conflicts
   with archival updates, retain that lock through commit, and require
   `archived_at IS NULL`;
7. lock that Production's exact `creation_entitlement_grant_id` row with a
   row lock that conflicts with entitlement lifecycle updates, retain that
   lock through commit, and require the grant to belong to the same Account,
   have kind `FREE_BYO`, remain in `AVAILABLE`, and resolve under a supported
   FREE_BYO policy version;
8. resolve an enabled generation-authority capability for the connection's
   derived provider and requested model;
9. validate the generation request with the R44B11A shared provider/model
   contract and compute its canonical SHA-256 with that same authority;
10. derive the expected-cost cap from the source-controlled generation policy
    and require its unit to equal the shared provider/model cost unit;
11. derive `expires_at` from database-server time plus the capability's
    versioned positive claim lifetime;
12. insert exactly one `ISSUED` USER_BYO GenerationAuthorization;
13. append exactly one safe `generation_authorization.issued` audit event;
14. commit all of those effects atomically.

The User, Production and entitlement-grant eligibility locks are held until
that commit. A plain READ COMMITTED eligibility SELECT is insufficient:
runtime User-status mutation, Production archival or entitlement-state
mutation must not be able to make an eligibility row ineligible after it was
checked but before the authorization commits. The implementation may use
`FOR SHARE` or a stronger PostgreSQL row lock for those eligibility rows,
provided the documented lock ordering is preserved.

The database clock, not an application, browser or worker clock, is expiry
authority. The implementation must obtain the inserted expiry from a
database-side expression based on the database clock; it must not calculate
an absolute `expires_at` in application time and send that timestamp as
authority.

Issuance never changes the FREE_BYO grant to `RESERVED` or `CONSUMED` and
never writes `reserved_at` or `consumed_at`.

A `SUPERSEDED`, `RETAINED_FOR_RECOVERY` or `DESTROYED` credential version is
not eligible for new issuance. The narrow R44B11P1 `SUPERSEDED` exception is
claim-only provenance for an authorization issued earlier; it never applies
to R44B11C new issuance.

**Connection lifecycle concurrency.** New issuance serializes on the
ProviderConnection lifecycle lock used by the existing connection mutation
services.

If disconnect or rotation commits first, the issuance transaction must
observe the resulting ineligible connection/verification/current-credential
state and refuse to create a new authorization.

If issuance commits first, its exact connection and credential-version
provenance is immutable. A later credential rotation does not rewrite it;
the already-locked R44B11P1 post-issuance claim rules decide whether that
authorization remains claimable.

R44B11C does not claim to implement the separate disconnect path that cancels
still-ISSUED authorizations or converges pre-submission jobs/attempts. That
integration remains a later R44B11P1 slice. Because R44B11C exposes no
customer route and production has no enabled generation capability, this
slice does not make customer issuance reachable before that convergence work
is completed.

**Audit boundary.** A successful new issuance appends exactly one audit event:

- actor type `USER`;
- the trusted creator User;
- event type `generation_authorization.issued`;
- resource type `generation_authorization`;
- resource ID equal to the new GenerationAuthorization ID;
- the request correlation ID;
- safe metadata sufficient to identify the entitlement-policy version and
  generation-policy version used for the decision.

Audit metadata must not contain the generation prompt, `referenceImage`,
sealed credential, plaintext credential, credential fingerprint, encryption
key reference or provider response.

Failure to append the audit event rolls back the authorization insertion.
An idempotent replay writes no second issuance audit event.

**Side-effect boundary.** Issuance creates only the authorization and its
audit evidence. It creates no:

- `generation_usage_ledger` row;
- execution job;
- execution attempt;
- worker lease;
- credential grant;
- credential-retention obligation;
- provider execution;
- provider call.

Claim remains the commercial commitment and queue-eligibility boundary.

**Validation obligations.** R44B11C implementation must prove at minimum:

- active User and Account are revalidated inside the transaction;
- a foreign or archived Production cannot receive a new authorization;
- a missing, non-FREE_BYO, non-AVAILABLE or unsupported-policy grant fails
  closed;
- a foreign, non-ACTIVE or non-VERIFIED ProviderConnection fails closed;
- no credential, a non-current credential or a newest credential not in
  `ACTIVE` fails closed;
- unsupported provider/model generation capability fails closed;
- malformed shared generation request fails before insertion;
- the stored request hash is exactly the R44B11A canonical hash;
- the cost unit is exactly the R44B11A provider/model unit and the amount is a
  positive safe integer derived from server policy;
- expiry is database-clock-derived from the injected versioned policy;
- production's default empty generation-capability registry refuses issuance;
- true idempotent replay returns the original authorization without changing
  expiry, credential binding, cost cap, status, usage or audit cardinality;
- different-intent key reuse is a conflict;
- concurrent same-key issuance commits one authorization and one issuance
  audit event;
- if disconnect or rotation wins the ProviderConnection lifecycle lock before
  issuance, new issuance is refused;
- if User disablement wins its eligibility-row race before issuance locks the
  User, issuance observes the inactive User and is refused;
- if Account disablement wins the Account lifecycle-lock race before issuance
  locks the Account, issuance observes the inactive Account and is refused;
- if Production archival wins its eligibility-row race before issuance locks
  the Production, issuance observes the archived state and is refused;
- if entitlement revocation, expiry or another lifecycle mutation wins its
  eligibility-row race before issuance locks the grant, issuance observes the
  non-AVAILABLE state and is refused;
- PostgreSQL integration tests prove the User, Account, Production and
  entitlement-grant eligibility races and prove that an issuance holding the
  corresponding eligibility or lifecycle lock prevents the conflicting state
  mutation from committing ahead of it;
- issuance creates no usage row, job or attempt;
- transaction or audit failure leaves no partial authorization;
- no real provider network call is needed for validation.

PostgreSQL integration validation continues to use the dedicated test database,
never the production database.

**Not in R44B11C.** This slice does not include:

- a claim service or claim HTTP route;
- `ISSUED -> CLAIMED` transition;
- generation-usage ledger insertion;
- execution-job or execution-attempt creation;
- `ISSUED -> EXPIRED` convergence;
- disconnect cancellation/convergence for existing authorizations or
  pre-submission work;
- credential cleanup after disconnect convergence;
- provider verification;
- a customer generation HTTP route;
- production provider/model enablement;
- worker source changes;
- shared worker-protocol changes;
- provider-adapter changes;
- another database migration;
- runtime-grant changes;
- live-provider enablement.

`WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO` remains authoritative.

**Current status (R44B11C contract lock).**

- **R44B11A:** fully closed; unchanged.
- **R44B11B:** fully closed; unchanged.
- **R44B11C discovery:** PASS.
- **R44B11C contract:** this revision.
- **R44B11C implementation:** not started.
- **R44B11P1 implementation:** started, not complete.
- **R44B11 parent implementation:** started, not complete.
- **Remaining R44B11P1 work after R44B11C:** separate future discovery and
  contract locks remain required for:
  - USER_BYO claim;
  - any required expiry-convergence service;
  - ProviderConnection disconnect/rotation convergence and credential cleanup;
  - provider verification;
  - any customer route and production generation-policy enablement that remain
    justified after the other production gates are complete.
- Future revision suffixes for those slices are not locked by R44B11C.
- `WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED=NO`.

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
SUBMISSION_FAILED_FIRST_TRANSITION_REQUIRES_LIVE_LEASE=YES
SUBMISSION_FAILED_FIRST_TRANSITION_REQUIRES_SUBMISSION_EPOCH_MATCH=YES
SUBMISSION_FAILED_FIRST_TRANSITION_DESTROYED_VERSION_ALLOWED=NO
SUBMISSION_FAILED_REPLAY_REQUIRES_LIVE_LEASE=NO
SUBMISSION_FAILED_REPLAY_AUTHORITY=SUBMITTING_PRINCIPAL_AND_RETAINED_FENCING_COUNTER
SUBMISSION_FAILED_REPLAY_USES_LEASE_TOKEN_AS_AUTHORITY=NO
SUBMISSION_FAILED_REPLAY_REQUIRES_EXACT_OUTCOME_AND_FAILURE_CODE=YES
SUBMISSION_FAILED_REPLAY_MUTATES_STATE=NO
SUBMISSION_FAILED_REPLAY_DUPLICATES_AUDIT=NO
SUBMISSION_FAILED_REPLAY_REQUIRES_USABLE_CREDENTIAL_VERSION=NO
SUBMISSION_FAILED_RESPONSE_FIELDS=EXECUTION_ATTEMPT_ID_FENCING_COUNTER_STATE_FAILURE_CODE
SUBMISSION_FAILED_SWEEP_ONLY_FAILURE_CODE_WORKER_REPORTABLE=NO
SUBMISSION_FAILED_SWEEP_FAILURE_CODE_REPLACEABLE=NO
SUBMISSION_FAILED_INVALID_VOCABULARY_HTTP_STATUS=400
SUBMISSION_FAILED_VALID_PAIR_MISMATCH_HTTP_STATUS=409
SUBMISSION_FAILED_MISMATCH_CLASSIFIED_AFTER_AUTHORITY=YES
SUBMISSION_FAILED_ROUTE_AUTHENTICATES_BEFORE_BODY_PARSE=YES
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
WORKER_ACCEPTANCE_RECOVERY_CLIENT_IMPLEMENTED=YES
STARTUP_RECONCILIATION_CALLS_ACCEPTANCE_RECOVERY=YES
SUBMISSION_FAILED_ROUTE_IMPLEMENTED=YES
ACCEPTANCE_JOURNAL_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_IMPLEMENTED=YES
WORKER_SUBMITTED_CLIENT_USED_BY_LIVE_EXECUTION=NO
WORKER_SUBMITTING_CLIENT_IMPLEMENTED=YES
WORKER_SUBMITTING_CLIENT_USED_BY_LIVE_EXECUTION=NO
SUBMITTING_CLIENT_INTERNAL_RETRY_ENABLED=NO
SUBMITTING_CLIENT_OWNS_REQUEST_TIMEOUT=NO
SUBMITTING_CLIENT_CAN_DECLARE_LEASE_EXPIRED=NO
SUBMITTING_ACK_FAILURE_CALLS_SUBMISSION_FAILED=NO
SUBMITTING_CLIENT_REJECTION_WORKER_CODE=SUBMITTING_REJECTED
SUBMITTING_ORCHESTRATION_MAX_ATTEMPTS=2
SUBMITTING_ORCHESTRATION_RETRIES_CONTROL_API_UNAVAILABLE=YES
SUBMITTING_ORCHESTRATION_RETRIES_SUBMITTING_REJECTED=NO
SUBMITTING_ORCHESTRATION_RETRY_BACKOFF=NONE
SUBMITTING_ORCHESTRATION_RETRY_JITTER=NONE
SUBMITTING_ACK_REQUEST_DEADLINE_MS=10000
SUBMITTING_ACK_ABORT_OWNER=PRE_PROVIDER_ORCHESTRATION
SUBMITTING_ACK_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO
SUBMITTING_PRE_PROVIDER_HEARTBEAT_REQUIRED=YES
SUBMITTING_PRE_PROVIDER_HEARTBEAT_FAILURE_CALLS_PROVIDER=NO
SUBMITTING_PRE_PROVIDER_HEARTBEAT_FAILURE_CALLS_SUBMISSION_FAILED=NO
PRE_PROVIDER_PERMIT_REQUIRES_SUBMITTING_AND_HEARTBEAT=YES
PROVIDER_CONSTRUCTION_REQUIRES_PRE_PROVIDER_PERMIT=YES
PER_ATTEMPT_JOURNAL_PREPARE_REQUIRED_BEFORE_SUBMITTING=YES
PRE_PROVIDER_ORCHESTRATION_IMPLEMENTED=YES
WORKER_HEARTBEAT_CLIENT_IMPLEMENTED=YES
WORKER_HEARTBEAT_CLIENT_USED_BY_LIVE_EXECUTION=NO
HEARTBEAT_CLIENT_INTERNAL_RETRY_ENABLED=NO
HEARTBEAT_CLIENT_OWNS_REQUEST_TIMEOUT=NO
HEARTBEAT_CLIENT_OWNS_CADENCE=NO
HEARTBEAT_CLIENT_CAN_DECLARE_LEASE_EXPIRED=NO
HEARTBEAT_CLIENT_REJECTION_WORKER_CODE=HEARTBEAT_REJECTED
PRE_PROVIDER_HEARTBEAT_MAX_ATTEMPTS=2
PRE_PROVIDER_HEARTBEAT_RETRIES_CONTROL_API_UNAVAILABLE=YES
PRE_PROVIDER_HEARTBEAT_RETRIES_HEARTBEAT_REJECTED=NO
PRE_PROVIDER_HEARTBEAT_RETRY_BACKOFF=NONE
PRE_PROVIDER_HEARTBEAT_RETRY_JITTER=NONE
PRE_PROVIDER_HEARTBEAT_REQUEST_DEADLINE_MS=10000
PRE_PROVIDER_HEARTBEAT_ABORT_OWNER=PRE_PROVIDER_ORCHESTRATION
PRE_PROVIDER_HEARTBEAT_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO
GRANTED_EXPIRED_LEASE_RECOVERY_IMPLEMENTED=YES
GRANTED_EXPIRED_LEASE_RECOVERY_POLICY=REQUEUE
GRANTED_EXPIRED_LEASE_RECOVERY_OWNER=LEASE_ACQUISITION_TRANSACTION
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_STATE=LEASED
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_CREDENTIAL_GRANT=YES
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_SERVER_EXPIRY=YES
GRANTED_EXPIRED_LEASE_RECOVERY_TARGET_ATTEMPT_STATE=QUEUED
GRANTED_EXPIRED_LEASE_RECOVERY_TARGET_JOB_STATE=QUEUED
GRANTED_EXPIRED_LEASE_RECOVERY_CLEARS_CREDENTIAL_GRANTED_AT=YES
GRANTED_EXPIRED_LEASE_RECOVERY_CLEARS_LEASE_PROOF=YES
GRANTED_EXPIRED_LEASE_RECOVERY_INCREMENTS_FENCE=NO
GRANTED_EXPIRED_LEASE_NEXT_LEASE_INCREMENTS_FENCE=YES
GRANTED_EXPIRED_LEASE_RECOVERY_RUNS_BEFORE_CAPACITY_CHECK=YES
GRANTED_EXPIRED_LEASE_RECOVERY_REQUESTING_WORKER_CANNOT_BE_BATCH_STARVED=YES
GRANTED_EXPIRED_LEASE_RECOVERY_CALLS_PROVIDER=NO
GRANTED_EXPIRED_LEASE_RECOVERY_TARGETS_SUBMITTING=NO
GRANTED_EXPIRED_LEASE_RECOVERY_REQUIRES_MIGRATION=NO
GRANTED_EXPIRED_LEASE_RECOVERY_AUDIT_EVENT=execution_attempt.lease_expired
GRANTED_EXPIRED_LEASE_RECOVERY_EMITS_SECURITY_EVENT=NO
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
FAKE_PROVIDER_EXECUTION_IMPLEMENTED=YES
REAL_PROVIDER_EXECUTION_IMPLEMENTED=YES
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
WORKER_ACCEPTANCE_HANDLER_IMPLEMENTED=YES
WORKER_ACCEPTANCE_HANDLER_USED_BY_LIVE_EXECUTION=NO
ACCEPTANCE_HANDLER_ENGINE_IMPORTS_ALLOWED=NO
ACCEPTANCE_HANDLER_NORMALIZES_PROVIDER_EXECUTION_ID=NO
ACCEPTANCE_HANDLER_JOURNAL_BEFORE_SUBMITTED=YES
ACCEPTANCE_HANDLER_SINGLE_USE=YES
ACCEPTANCE_HANDLER_DELETES_RECORD_ON_SUBMITTED_ACK=NO
PRE_PROVIDER_PERMIT_INCLUDES_SUBMITTING_AT=YES
LIVE_SUBMITTED_MAX_ATTEMPTS=2
LIVE_SUBMITTED_RETRIES_CONTROL_API_UNAVAILABLE=YES
LIVE_SUBMITTED_RETRIES_SUBMITTED_REPORT_REJECTED=NO
LIVE_SUBMITTED_RETRY_BACKOFF=NONE
LIVE_SUBMITTED_RETRY_JITTER=NONE
LIVE_SUBMITTED_REQUEST_DEADLINE_MS=10000
LIVE_SUBMITTED_LOCAL_LEASE_EXPIRY_AUTHORITY=NO
LIVE_SUBMITTED_REJECTION_HANDS_TO_ACCEPTANCE_RECOVERY=YES
LIVE_SUBMITTED_UNAVAILABLE_EXHAUSTION_HANDS_TO_ACCEPTANCE_RECOVERY=YES
SUBMISSION_FAILED_CLIENT_IMPLEMENTED=YES
SUBMISSION_FAILED_CLIENT_INTERNAL_RETRY_ENABLED=NO
SUBMISSION_FAILED_CLIENT_OWNS_REQUEST_TIMEOUT=NO
SUBMISSION_FAILED_CLIENT_CAN_DECLARE_LEASE_EXPIRED=NO
SUBMISSION_FAILED_CLIENT_REJECTION_WORKER_CODE=SUBMISSION_FAILED_REJECTED
ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS=2
ACCEPTANCE_FAILURE_REPORT_RETRIES_CONTROL_API_UNAVAILABLE=YES
ACCEPTANCE_FAILURE_REPORT_RETRY_BACKOFF=NONE
ACCEPTANCE_FAILURE_REPORT_RETRY_JITTER=NONE
ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS=10000
ACCEPTANCE_RECORD_RETAINED_AFTER_SUBMITTED_ACK=YES
ACCEPTANCE_HOST_FAULT_LATCH_IMPLEMENTED=YES
ACCEPTANCE_HOST_FAULT_LATCH_RUNTIME_CLEAR_ALLOWED=NO
IN_FLIGHT_HEARTBEAT_KEEPER_IMPLEMENTED=YES
IN_FLIGHT_HEARTBEAT_USED_BY_LIVE_EXECUTION=NO
IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS=30000
IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS=30000
IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS=10000
IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK=2
IN_FLIGHT_HEARTBEAT_RETRIES_CONTROL_API_UNAVAILABLE=YES
IN_FLIGHT_HEARTBEAT_RETRY_BACKOFF=NONE
IN_FLIGHT_HEARTBEAT_RETRY_JITTER=NONE
IN_FLIGHT_HEARTBEAT_OVERLAP_ALLOWED=NO
IN_FLIGHT_HEARTBEAT_LOCAL_LEASE_EXPIRY_AUTHORITY=NO
IN_FLIGHT_HEARTBEAT_UNAVAILABLE_STOPS_KEEPER=NO
IN_FLIGHT_HEARTBEAT_UNAVAILABLE_TRIPS_HOST_FAULT=NO
IN_FLIGHT_HEARTBEAT_REJECTION_STOPS_KEEPER=YES
IN_FLIGHT_HEARTBEAT_REJECTION_TRIPS_HOST_FAULT=NO
IN_FLIGHT_HEARTBEAT_AUTH_FAILURE_TRIPS_HOST_FAULT=YES
IN_FLIGHT_HEARTBEAT_MALFORMED_RESPONSE_TRIPS_HOST_FAULT=YES
IN_FLIGHT_HEARTBEAT_CANCELS_PROVIDER_OPERATION=NO
IN_FLIGHT_HEARTBEAT_ABANDONS_PROVIDER_PROMISE=NO
IN_FLIGHT_HEARTBEAT_ABORT_SIGNAL_EXTENDS_TO_PROVIDER_CALL=NO
IN_FLIGHT_HEARTBEAT_KEEPER_STOP_ABORT_IS_FAILURE=NO
IN_FLIGHT_HEARTBEAT_FAILURE_OVERRIDES_OPERATION_OUTCOME=NO
IN_FLIGHT_HEARTBEAT_ACCEPTANCE_RECONCILIATION_INCLUDED=YES
IN_FLIGHT_HEARTBEAT_POLLING_PHASE_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_IMPLEMENTED=YES
WHOLE_CHAIN_CRASH_TESTS_TEST_ONLY_COMPOSITION=YES
WHOLE_CHAIN_CRASH_TESTS_PRODUCTION_ORCHESTRATOR_REQUIRED=NO
WHOLE_CHAIN_CRASH_TESTS_REAL_CONTROL_API_REQUIRED=YES
WHOLE_CHAIN_CRASH_TESTS_REAL_TEST_DATABASE_REQUIRED=YES
WHOLE_CHAIN_CRASH_TESTS_REAL_FILESYSTEM_JOURNAL_REQUIRED=YES
WHOLE_CHAIN_CRASH_TESTS_REAL_PROVIDER_REQUIRED=NO
WHOLE_CHAIN_CRASH_TESTS_FAKE_PROVIDER_REQUIRED=NO
WHOLE_CHAIN_CRASH_TESTS_PROVIDER_OPERATION_THUNK_TEST_ONLY=YES
WHOLE_CHAIN_CRASH_TESTS_POLLING_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_OUTPUT_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_COMPLETION_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_PROVIDER_RETRY_GUARD_INCLUDED=NO
WHOLE_CHAIN_CRASH_TESTS_PROVIDER_RESUBMISSION_ALLOWED=NO
WHOLE_CHAIN_CRASH_TESTS_RESTART_PRESERVES_DATABASE=YES
WHOLE_CHAIN_CRASH_TESTS_RESTART_PRESERVES_JOURNAL=YES
WHOLE_CHAIN_CRASH_TESTS_RESTART_PRESERVES_PROCESS_STATE=NO
WHOLE_CHAIN_CRASH_TESTS_TERMINAL_FIXTURE_ALLOWED=YES
WHOLE_CHAIN_CRASH_TESTS_STATE_ROOT_BINDING_INCLUDED=NO
WORKER_STATE_ROOT_BINDING_IMPLEMENTED=YES
WORKER_STATE_ROOT_CONFIG_KEY=COMMERCIAL_WORKER_STATE_ROOT
WORKER_ENV_CONFIG_KEY=COMMERCIAL_WORKER_ENV
WORKER_STATE_ROOT_DEPLOYMENT_PATH=/var/lib/busybookie/commercial-worker
WORKER_PERSISTENT_VOLUME_MOUNT=/var/lib/busybookie
WORKER_STATE_ROOT_ALWAYS_REQUIRED=YES
WORKER_STATE_ROOT_DEFAULT_ALLOWED=NO
WORKER_STATE_ROOT_MUST_BE_ABSOLUTE=YES
WORKER_STATE_ROOT_MUST_PREEXIST=YES
WORKER_STATE_ROOT_REALPATH_CANONICALIZATION=NO
WORKER_STATE_ROOT_SYMLINK_ALLOWED=NO
WORKER_STATE_ROOT_PRODUCTION_OWNER_CHECK=YES
WORKER_STATE_ROOT_PRODUCTION_OWNER_ONLY=YES
WORKER_STATE_ROOT_PRODUCTION_DIRECTORY_SYNC=REQUIRED
WORKER_STATE_ROOT_NETWORK_FILESYSTEM_ALLOWED=NO
WORKER_STATE_ROOT_EPHEMERAL_FILESYSTEM_ALLOWED=NO
WORKER_STATE_ROOT_SINGLE_FILESYSTEM_REQUIRED=YES
WORKER_STATE_ROOT_SHARED_BY_MULTIPLE_PROCESSES=NO
WORKER_STATE_ROOT_ONE_PRINCIPAL_PER_ROOT=YES
WORKER_STATE_ROOT_CROSS_ENVIRONMENT_REUSE_ALLOWED=NO
WORKER_STATE_ROOT_RELOCATION_WITH_RETAINED_STATE_ALLOWED=NO
WORKER_STATE_ROOT_IDENTITY_MARKER_REQUIRED=NO
WORKER_STATE_ROOT_PROCESS_ENTRYPOINT_REQUIRED_FOR_GATE=NO
WORKER_STATE_ROOT_DEPLOYMENT_BINDING_REQUIRED=YES
WORKER_STATE_ROOT_LIVE_HOST_REQUIRED_FOR_GATE=NO
WORKER_STATE_ROOT_LOCAL_FAKE_PROVIDER_STABLE_ROOT_REQUIRED=YES
WORKER_STATE_ROOT_PATH_LOGGED=NO
WORKER_STATE_ROOT_ACCEPTANCE_JOURNAL_INCLUDED=YES
WORKER_STATE_ROOT_PROVIDER_OUTPUT_INCLUDED=NO
FAKE_PROVIDER_ID=BUSYBOOKIE_FAKE
FAKE_PROVIDER_ALLOWED_WORKER_ENV=development
FAKE_PROVIDER_REAL_NETWORK_ALLOWED=NO
FAKE_PROVIDER_REAL_PROVIDER_IMPORTS_ALLOWED=NO
FAKE_PROVIDER_PROVIDER_CREDENTIAL_REQUIRED=NO
FAKE_PROVIDER_PROCESS_ENTRYPOINT_REQUIRED=NO
FAKE_PROVIDER_ENDPOINT=SUBMITTED
FAKE_PROVIDER_CREATE_RETRY_ALLOWED=NO
FAKE_PROVIDER_TEST_THUNK_COUNTS_AS_IMPLEMENTATION=NO
FAKE_PROVIDER_FAILURE_COMPOSITION_REQUIRED=YES
FAKE_PROVIDER_TIER3_SUCCESS_REQUIRED=YES
FAKE_PROVIDER_TIER3_DEFINITIVE_FAILURE_REQUIRED=YES
FAKE_PROVIDER_TIER3_AMBIGUOUS_FAILURE_REQUIRED=YES
FAKE_PROVIDER_KEEPER_WIRING_REQUIRED=YES
PROVIDER_CREATE_PHASE_CONTRACT_LOCKED=YES
PROVIDER_CREATE_PHASE_ACCEPTANCE_CALLBACK_MUST_BE_AWAITED=YES
PROVIDER_CREATE_PHASE_PROVIDER_ID_RETURN_AUTHORITY=CALLBACK_ONLY
PROVIDER_FAILURE_COMPOSITION_IMPLEMENTED=YES
PROVIDER_REAL_ADAPTER_CREATE_RETRY_ASSERTION_REQUIRED=YES
OBJECT_STORAGE_INPUT_CONTRACT_LOCKED=YES
OBJECT_STORAGE_PRODUCTION_IMPLEMENTED=NO
OBJECT_STORAGE_TEST_IMPLEMENTATION_IMPLEMENTED=YES
OBJECT_STORAGE_INPUT_LIBRARY_IMPLEMENTED=YES
OBJECT_STORAGE_INPUT_REFERENCE_TYPE=KEY_PLUS_INTEGRITY
OBJECT_STORAGE_INPUT_SIGNED_URL_DURABLE=NO
OBJECT_STORAGE_INPUT_ARBITRARY_URL_ALLOWED=NO
OBJECT_STORAGE_INPUT_LOCAL_PATH_ALLOWED=NO
OBJECT_STORAGE_INPUT_MEDIA_ROOT_ALLOWED=NO
OBJECT_STORAGE_INPUT_MAX_READ_ATTEMPTS=2
OBJECT_STORAGE_INPUT_READ_RETRY=UNAVAILABLE_ONLY
OBJECT_STORAGE_INPUT_READ_DEADLINE_MS=10000
OBJECT_STORAGE_INPUT_SHA256_REQUIRED=YES
OBJECT_STORAGE_INPUT_BYTE_COUNT_REQUIRED=YES
OBJECT_STORAGE_INPUT_MAGIC_BYTES_REQUIRED=YES
OBJECT_STORAGE_INPUT_ALLOWED_CONTENT_TYPES=image/png,image/jpeg,image/webp
OBJECT_STORAGE_INPUT_ACCOUNT_AUTHORITY=RELATIONAL_CONTEXT
OBJECT_STORAGE_INPUT_TEST_STORE=IN_MEMORY_INJECTED_NO_DEFAULT
OBJECT_STORAGE_INPUT_PROVIDER_DISPATCH_BEFORE_VERIFICATION=NO
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_IMPLEMENTED=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRED_BEFORE_REAL_PROVIDER=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_CONTRACT_LOCKED=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PATH=/worker-control/v1/attempts/:attemptId/input-failed
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_CODES=INPUT_REFERENCE_INVALID,INPUT_OBJECT_NOT_FOUND,INPUT_OBJECT_TOO_LARGE,INPUT_OBJECT_INTEGRITY_MISMATCH,INPUT_MEDIA_TYPE_INVALID
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REPLAY=EXACT_IDEMPOTENT
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PROVENANCE_MIGRATION_REQUIRED=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_SOURCE_STATE=LEASED
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_REQUIRES_CREDENTIAL_GRANT=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_CLEARS_LEASE=YES
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_JOB_STATE=FAILED
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PROVIDER_SEMANTICS=NO
OBJECT_STORAGE_INPUT_FAILURE_ROUTE_PROTOCOL_PACKAGE_CHANGE_REQUIRED=NO
OBJECT_STORAGE_INPUT_FAILURE_CLASSIFICATION_EXTENSION_REQUIRED=YES
R44B10A_CONTRACT_LOCKED=YES
R44B10A_IMPLEMENTATION_STARTED=YES
R44B10A_IMPLEMENTATION_VALIDATED=YES
R44B10A_IMPLEMENTATION_PUBLISHED=YES
R44B10A_IMPLEMENTATION_CRITERIA_PASSED=25/25
R44B10A_IMPLEMENTATION_COMMIT=aefd2ea95cc0d11652596fd2e099262bc4a945ac
R44B10A_FIRST_PROVIDER=GOOGLE_GENAI
R44B10A_REAL_PROVIDER_COUNT=1
R44B10A_PROVIDER_MODEL=gemini-omni-1.1-flash
R44B10A_PROVIDER_BACKEND=GEMINI_DEVELOPER_API
R44B10A_ADAPTER_PLACEMENT=apps/commercial-worker/src
R44B10A_ENGINE_IMPORT_REQUIRED=NO
R44B10A_SDK_DEPENDENCY=@google/genai@2.24.0
R44B10A_PROVIDER_CREATE_RETRY_MAX=0
R44B10A_PROVIDER_CREATE_RETRY_TRANSPORT_PROOF_REQUIRED=YES
R44B10A_PROVIDER_CREATE_TIMEOUT_MS=60000
R44B10A_PROVIDER_EXECUTION_ID_SOURCE=Interaction.id
R44B10A_PROVIDER_EXECUTION_ID_TRANSFORMATION=NONE
R44B10A_REQUEST_MEMBERS=prompt,referenceImage,resolution
R44B10A_PROMPT_MAX_UTF16_CODE_UNITS=1000
R44B10A_RESOLUTION=720p
R44B10A_CLIENT_CONSTRUCTION_BEFORE_PERMIT_ALLOWED=NO
R44B10A_SECOND_CREDENTIAL_GRANT=NO
R44B10A_ENDPOINT=SUBMITTED
R44B10A_INCLUDES_POLLING=NO
R44B10A_INCLUDES_OUTPUT_PERSISTENCE=NO
R44B10A_INCLUDES_COMPLETION=NO
R44B10A_DATABASE_MIGRATION_REQUIRED=NO
R44B10A_COMMERCIAL_API_CHANGE_REQUIRED=NO
R44B10A_SHARED_PROTOCOL_CHANGE_REQUIRED=NO
R44B10A_PROCESS_RUNNER_REQUIRED=NO
R44B10A_PRODUCTION_OBJECT_STORE_REQUIRED_FOR_IMPLEMENTATION=NO
R44B10A_PRODUCTION_OBJECT_STORE_REQUIRED_FOR_LIVE_ENABLEMENT=YES
R44B10B_DISCOVERY=PASS
R44B10B_CONFLICT_SCREEN=PASS
R44B10B_PREREQUISITE_REQUIRED=NO
R44B10B_CONTRACT_LOCKED=YES
R44B10B_IMPLEMENTATION_STARTED=YES
R44B10B_IMPLEMENTATION_VALIDATED=YES
R44B10B_IMPLEMENTATION_PUBLISHED=YES
R44B10B_IMPLEMENTATION_CRITERIA_PASSED=25/25
R44B10B_IMPLEMENTATION_COMMIT=c15a1186ab072dc32602c707b05f93807a0e25ef
R44B10B_RUNWAY_PROVIDER_IMPLEMENTED=YES
R44B10B_PROVIDER=RUNWAY
R44B10B_PROVIDER_MODEL=gen4.5
R44B10B_SDK_DEPENDENCY=@runwayml/sdk@4.20.0
R44B10B_API_VERSION=2024-11-06
R44B10B_API_BASE_URL=https://api.dev.runwayml.com
R44B10B_REQUEST_MEMBERS=prompt,referenceImage,durationSeconds
R44B10B_PROMPT_MAX_UTF16_CODE_UNITS=1000
R44B10B_DURATION_MIN_SECONDS=2
R44B10B_DURATION_MAX_SECONDS=5
R44B10B_RATIO=1280:720
R44B10B_OUTPUT_FORMAT=mp4
R44B10B_REFERENCE_IMAGE_TRANSPORT=INLINE_DATA_URI
R44B10B_DATA_URI_MAX_CHARS=5242880
R44B10B_MAX_REFERENCE_IMAGE_BYTES=3932142
R44B10B_EXPECTED_COST_CAP_UNIT=PROVIDER_CREDITS
R44B10B_PROVIDER_CREATE_RETRY_MAX=0
R44B10B_PROVIDER_CREATE_TIMEOUT_MS=60000
R44B10B_PROVIDER_EXECUTION_ID_SOURCE=task.id
R44B10B_PROVIDER_EXECUTION_ID_TRANSFORMATION=NONE
R44B10B_CLIENT_CONSTRUCTION_BEFORE_PERMIT_ALLOWED=NO
R44B10B_SECOND_CREDENTIAL_GRANT=NO
R44B10B_ENDPOINT=SUBMITTED
R44B10B_INCLUDES_PROVIDER_UPLOAD=NO
R44B10B_INCLUDES_POLLING=NO
R44B10B_INCLUDES_OUTPUT_PERSISTENCE=NO
R44B10B_INCLUDES_COMPLETION=NO
R44B10B_DATABASE_MIGRATION_REQUIRED=NO
R44B10B_COMMERCIAL_API_CHANGE_REQUIRED=NO
R44B10B_SHARED_PROTOCOL_CHANGE_REQUIRED=NO
R44B10B_PROCESS_RUNNER_REQUIRED=NO
R44B11_DISCOVERY=PASS
R44B11_CONFLICT_SCREEN=PASS
R44B11_PREREQUISITE_REQUIRED=YES
R44B11_CONTRACT_LOCKED=NO
R44B11_IMPLEMENTATION_STARTED=YES
R44B11P1_CONTRACT_LOCKED=YES
R44B11P1_IMPLEMENTATION_STARTED=YES
R44B11P1_SCOPE=USER_BYO_GENERATION_AUTHORITY_AND_USAGE_LEDGER
R44B11P1_PLATFORM_HOSTED_INCLUDED=NO
R44B11P1_HOSTED_TRIAL_INCLUDED=NO
R44B11P1_CREATOR_INCLUDED=NO
R44B11P1_FREE_BYO_GENERATION_CONSUMES_GRANT=NO
R44B11P1_NUMERIC_GENERATION_QUOTA_ENFORCED=NO
R44B11P1_USAGE_LEDGER_REQUIRED=YES
R44B11P1_USAGE_LEDGER_ROLE=ACCOUNTING_PROVENANCE
R44B11P1_USAGE_LEDGER_QUOTA_AUTHORITY=NO
R44B11P1_USAGE_IDENTITY=GENERATION_AUTHORIZATION_ID
R44B11P1_AUTHORISED_USAGE_CARDINALITY=ONE_PER_GENERATION_AUTHORIZATION
R44B11P1_WORKER_RETRY_CREATES_NEW_USAGE=NO
R44B11P1_RECOVERY_CREATES_NEW_USAGE=NO
R44B11P1_ISSUANCE_PROVIDER_CONNECTION_REQUIRED_STATUS=ACTIVE
R44B11P1_ISSUANCE_PROVIDER_CONNECTION_REQUIRED_VERIFICATION=VERIFIED
R44B11P1_ISSUANCE_CREDENTIAL_VERSION_REQUIRED_STATUS=ACTIVE
R44B11P1_ROTATION_REBINDS_ISSUED_AUTHORIZATION=NO
R44B11P1_CLAIM_BOUND_VERSION_ALLOWED_STATUS=ACTIVE_OR_SUPERSEDED
R44B11P1_CLAIM_RETAINED_VERSION_FOR_NEW_CREATE_ALLOWED=NO
R44B11P1_CLAIM_DESTROYED_VERSION_ALLOWED=NO
R44B11P1_CLAIM_INVALID_CONNECTION_ALLOWED=NO
R44B11P1_CLAIM_DISCONNECTED_CONNECTION_ALLOWED=NO
R44B11P1_CLAIM_DISABLED_CONNECTION_ALLOWED=NO
R44B11P1_PENDING_VERIFICATION_AFTER_ROTATION_INVALIDATES_ISSUED_AUTHORIZATION=NO
R44B11P1_CLAIM_REBINDS_TO_CURRENT_CREDENTIAL=NO
R44B11P1_DISCONNECT_BEFORE_CLAIM=CANCEL_ISSUED_AUTHORIZATION
R44B11P1_DISCONNECT_AFTER_CLAIM_BEFORE_SUBMITTING=CANCEL_PRE_SUBMISSION_WORK
R44B11P1_PRE_SUBMISSION_DISCONNECT_ATTEMPT_STATE=CANCELLED
R44B11P1_PRE_SUBMISSION_DISCONNECT_JOB_STATE=CANCELLED
R44B11P1_PRE_SUBMISSION_DISCONNECT_PROVIDER_CALL_ALLOWED=NO
R44B11P1_RETENTION_OBLIGATION_OPENS_AT_GRANT=UNCHANGED
R44B11P1_SUBMITTING_OR_LATER_DISCONNECT=EXISTING_RECOVERY_RULES
R44B11P1_PROVIDER_CONNECTION_DISCONNECT_INTEGRATION_REQUIRED=YES
R44B11P1_DISCONNECT_PRE_SUBMISSION_CONVERGENCE_REQUIRED=YES
R44B11P1_DISCONNECT_CONVERGENCE_PRESERVES_EXISTING_LOCK_ORDER=YES
R44B11P1_POST_CANCELLATION_CREDENTIAL_REEVALUATION_REQUIRED=YES
R44B11P1_CREDENTIAL_CLEANUP_REQUIRES_SECOND_CUSTOMER_DISCONNECT=NO
R44B11P1_CLAIM_MAY_LOCK_AUTHORIZATION_THEN_WAIT_CONNECTION=NO
R44B11P1_ARCHIVED_PRODUCTION_NEW_AUTHORIZATION_ALLOWED=NO
R44B11P1_UNVERIFIED_CONNECTION_GENERATION_ALLOWED=NO
R44B11P1_PROVIDER_VERIFICATION_REQUIRED_FOR_ISSUANCE=YES
R44B11P1_PROVIDER_VERIFICATION_IMPLEMENTED=NO
R44B11P1_PROVIDER_VERIFICATION_BLOCKS_CUSTOMER_ENABLEMENT=YES
R44B11P1_PROVIDER_MODEL_POLICY_SOURCE=SERVER_CAPABILITY_REGISTRY
R44B11P1_PROVIDER_MODEL_DEFAULT_ENABLED=NO
R44B11P1_SHARED_GENERATION_REQUEST_CONTRACT_REQUIRED=YES
R44B11P1_DUPLICATED_ISSUER_WORKER_VALIDATORS_ALLOWED=NO
R44B11P1_CANONICAL_REQUEST_SERIALIZATION=RFC8785_JCS
R44B11P1_CANONICAL_REQUEST_ENCODING=UTF8
R44B11P1_GENERATION_REQUEST_SHA256=LOWERCASE_SHA256_OF_CANONICAL_UTF8
R44B11P1_WORKER_RECOMPUTES_GENERATION_REQUEST_SHA256=YES
R44B11P1_REQUEST_HASH_CHECK_BEFORE_CREDENTIAL_GRANT=YES
R44B11P1_REQUEST_HASH_MISMATCH_PROVIDER_CALL_ALLOWED=NO
R44B11P1_REFERENCE_IMAGE_INNER_VALIDATION_AT_ISSUANCE=NO
R44B11P1_REFERENCE_IMAGE_VALIDATION_AUTHORITY=R44B10P1_POST_GRANT
R44B11P1_REFERENCE_IMAGE_MALFORMED_CLASSIFICATION=R44B10P2_INPUT_FAILURE
R44B11P1_REFERENCE_IMAGE_EARLY_VALIDATION_REQUIRES_ARCHITECTURE_REVISION=YES
R44B11P1_CLIENT_COST_CAP_AUTHORITY=NO
R44B11P1_AUTHORIZATION_EXPIRY_CLIENT_AUTHORITY=NO
R44B11P1_AUTHORIZATION_TTL_LOCKED=NO
R44B11P1_AUTHORIZATION_TTL_REQUIRED_BEFORE_PRODUCTION_ISSUANCE=YES
R44B11P1_AUTHORIZATION_EXPIRY_CLOCK=DATABASE_SERVER
R44B11P1_IDEMPOTENT_REPLAY_EXTENDS_EXPIRY=NO
R44B11P1_CLAIM_REQUIRED_BEFORE_WORKER_LEASE=YES
R44B11P1_CLAIM_CREATES_EXACTLY_ONE_JOB=YES
R44B11P1_CLAIM_CREATES_INITIAL_ATTEMPT=YES
R44B11P1_PROVIDER_RETRY_CREATES_NEW_AUTHORIZATION=NO
R44B11P1_DATABASE_MIGRATION_REQUIRED=NO
R44B11P1_COMMERCIAL_API_CHANGE_REQUIRED=NO
R44B11P1_WORKER_CHANGE_REQUIRED=NO
R44B11_USAGE_LEDGER_MIGRATION_REQUIRED=YES
R44B11P1_CUSTOMER_GENERATION_ROUTE_ENABLED=NO
R44B11P1_LIVE_PROVIDER_ENABLEMENT=NO
R44B11A_DISCOVERY=PASS
R44B11A_CONTRACT_LOCKED=YES
R44B11A_IMPLEMENTATION_STARTED=YES
R44B11A_IMPLEMENTATION_VALIDATED=YES
R44B11A_IMPLEMENTATION_PUBLISHED=YES
R44B11A_IMPLEMENTATION_COMMIT=c5a21f578ecc573e04a2438c876c3eb155f5cf84
R44B11A_SCOPE=SHARED_GENERATION_REQUEST_AND_CANONICAL_HASH_AUTHORITY
R44B11A_SHARED_PACKAGE=COMMERCIAL_WORKER_PROTOCOL
R44B11A_SHARED_MODULE=packages/commercial-worker-protocol/src/generationRequestContract.ts
R44B11A_NEW_SHARED_PACKAGE_REQUIRED=NO
R44B11A_EXTERNAL_RUNTIME_DEPENDENCY_REQUIRED=NO
R44B11A_JCS_IMPLEMENTATION=DEPENDENCY_FREE
R44B11A_SHA256_PRIMITIVE=NODE_CRYPTO_BUILTIN
R44B11A_EDITORIAL_CANONICALIZER_REUSED=NO
R44B11A_RFC8785_PUBLISHED_VECTOR_TEST_REQUIRED=YES
R44B11A_CONFORMANCE_EXPECTATIONS_FROM_PRODUCTION_CANONICALIZER=NO
R44B11A_PRE_GRANT_MISMATCH_BEHAVIOURAL_TEST_REQUIRED=YES
R44B11A_SHARED_CONTRACT_DEPENDS_ON_WORKER_TYPES=NO
R44B11A_CANONICALIZATION_FAILS_CLOSED_OUTSIDE_JSON_DOMAIN=YES
R44B11A_ADAPTER_ONLY_CONSTANTS_MOVED=NO
R44B11A_PROVIDER_INCOMPATIBLE_ERROR=LEASED_PROVIDER_INCOMPATIBLE
R44B11A_REQUEST_COST_UNIT_OR_HASH_ERROR=LEASED_REQUEST_INVALID
R44B11A_NEW_WORKER_FAILURE_CODE=NO
R44B11A_DATABASE_MIGRATION_REQUIRED=NO
R44B11A_USAGE_LEDGER_INCLUDED=NO
R44B11A_COMMERCIAL_API_RUNTIME_CHANGE_REQUIRED=NO
R44B11A_COMMERCIAL_API_BOUNDARY_TEST_CHANGE_REQUIRED=YES
R44B11A_WORKER_SOURCE_CHANGE_REQUIRED=YES
R44B11A_PLACEHOLDER_HASH_FIXTURE_UPDATE_REQUIRED=YES
R44B11A_CREDENTIAL_GRANT_FLOW_REWRITE_REQUIRED=NO
R44B11A_PRE_GRANT_HASH_CHECK_REQUIRED=YES
R44B11A_HASH_CHECK_SEAM=EXISTING_PRE_GRANT_LEASE_ADMISSION
R44B11A_HASH_MISMATCH_CREDENTIAL_GRANT_ALLOWED=NO
R44B11A_HASH_MISMATCH_PROVIDER_CALL_ALLOWED=NO
R44B11A_RETENTION_OBLIGATION_OPENS_AT_GRANT=UNCHANGED
R44B11A_REFERENCE_IMAGE_BOUNDARY_CHANGED=NO
R44B11A_PROVIDER_ADAPTER_BEHAVIOUR_CHANGED=NO
R44B11A_CUSTOMER_ROUTE_ENABLED=NO
R44B11A_PROCESS_RUNNER_REQUIRED=NO
R44B11A_LIVE_PROVIDER_ENABLEMENT=NO
R44B11B_DISCOVERY=PASS
R44B11B_CONTRACT_LOCKED=YES
R44B11B_IMPLEMENTATION_STARTED=YES
R44B11B_IMPLEMENTATION_VALIDATED=YES
R44B11B_IMPLEMENTATION_COMMIT=374f36be992bd278a267db09c37046fbd16b6912
R44B11B_SCOPE=GENERATION_USAGE_LEDGER_PERSISTENCE
R44B11B_DATABASE_MIGRATION_REQUIRED=YES
R44B11B_MIGRATION=0008_generation_usage_ledger.sql
R44B11B_TABLE=generation_usage_ledger
R44B11B_USAGE_IDENTITY=GENERATION_AUTHORIZATION_ID
R44B11B_SURROGATE_USAGE_ID=NO
R44B11B_AUTHORISED_USAGE_CARDINALITY=ONE_PER_GENERATION_AUTHORIZATION
R44B11B_CLAIMED_USAGE_ROW_CARDINALITY=ONE_PER_GENERATION_AUTHORIZATION
R44B11B_CLAIMED_USAGE_ROW_AUTHORITY=PRIMARY_KEY_GENERATION_AUTHORIZATION_ID
R44B11B_USAGE_RECORD_CREATION_POINT=CLAIM_TRANSACTION
R44B11B_INITIAL_USAGE_EVENT=CLAIMED
R44B11B_SCHEMA_ROW_CARDINALITY=ZERO_OR_ONE_PER_GENERATION_AUTHORIZATION
R44B11B_SUCCESSFUL_CLAIM_ROW_CARDINALITY=EXACTLY_ONE
R44B11B_SCHEMA_GUARANTEES_ROW_FOR_EVERY_CLAIMED_AUTHORIZATION=NO
R44B11B_INSERT_STATE_GUARD_REQUIRED=YES
R44B11B_INSERT_REQUIRES_CLAIMED_AUTHORIZATION=YES
R44B11B_INSERT_REQUIRES_CLAIMED_AT=YES
R44B11B_NON_CLAIMED_USAGE_INSERT_ALLOWED=NO
R44B11B_INSERT_STATE_GUARD_REPLACES_COMPOSITE_FK=NO
R44B11B_RECORDED_AT_AUTHORITY=DATABASE
R44B11B_RECORDED_AT_SOURCE=CLOCK_TIMESTAMP_AT_INSERT
R44B11B_CALLER_SUPPLIED_RECORDED_AT_ALLOWED=NO
R44B11B_AUTHORIZATION_COMPOSITE_FK=YES
R44B11B_AUTHORIZATION_FK_TARGET=generation_authorizations_production_scope_uq
R44B11B_AUTHORIZATION_DELETE_ACTION=RESTRICT
R44B11B_GENERATION_AUTHORIZATIONS_ALTERED=NO
R44B11B_APPEND_ONLY=YES
R44B11B_RUNTIME_SELECT=YES
R44B11B_RUNTIME_INSERT=YES
R44B11B_RUNTIME_UPDATE=NO
R44B11B_RUNTIME_DELETE=NO
R44B11B_RUNTIME_TRUNCATE=NO
R44B11B_RUNTIME_REFERENCES=NO
R44B11B_RUNTIME_TRIGGER=NO
R44B11B_RUNTIME_UPDATE_COLUMNS=NONE
R44B11B_OWNER_UPDATE_ALLOWED=NO
R44B11B_OWNER_DELETE_ALLOWED=NO
R44B11B_OWNER_TRUNCATE_ALLOWED=NO
R44B11B_TRUNCATE_GUARD_REQUIRED=YES
R44B11B_TRUNCATE_GUARD=BEFORE_TRUNCATE_FOR_EACH_STATEMENT
R44B11B_BACKFILL_EXISTING_AUTHORIZATIONS=NO
R44B11B_LEDGER_ROLE=ACCOUNTING_PROVENANCE
R44B11B_QUOTA_AUTHORITY=NO
R44B11B_ENTITLEMENT_CONSUMPTION_AUTHORITY=NO
R44B11B_COUNTER_OR_BALANCE_COLUMN=NO
R44B11B_STATUS_COLUMN=NO
R44B11B_AUTHORIZATION_PROVENANCE_DUPLICATED=NO
R44B11B_EXECUTION_JOB_ID_INCLUDED=NO
R44B11B_EXECUTION_ATTEMPT_ID_INCLUDED=NO
R44B11B_WORKER_PRINCIPAL_INCLUDED=NO
R44B11B_FENCING_COUNTER_INCLUDED=NO
R44B11B_PROVIDER_EXECUTION_ID_INCLUDED=NO
R44B11B_ISSUANCE_APPENDS_USAGE=NO
R44B11B_IDEMPOTENT_ISSUANCE_REPLAY_APPENDS_USAGE=NO
R44B11B_CLAIM_APPENDS_USAGE=YES
R44B11B_CLAIM_REPLAY_APPENDS_USAGE=NO
R44B11B_WORKER_RETRY_APPENDS_USAGE=NO
R44B11B_RECOVERY_APPENDS_USAGE=NO
R44B11B_PROVIDER_SUBMISSION_APPENDS_USAGE=NO
R44B11B_PROVIDER_COMPLETION_APPENDS_USAGE=NO
R44B11B_FUTURE_ACCOUNTING_EVENT_STORAGE_LOCKED=NO
R44B11B_RUNTIME_GRANT_MANIFEST_CHANGE_REQUIRED=YES
R44B11B_ISSUANCE_SERVICE_INCLUDED=NO
R44B11B_CLAIM_SERVICE_INCLUDED=NO
R44B11B_CUSTOMER_ROUTE_INCLUDED=NO
R44B11B_WORKER_CHANGE_REQUIRED=NO
R44B11B_SHARED_PROTOCOL_CHANGE_REQUIRED=NO
R44B11B_PROVIDER_VERIFICATION_INCLUDED=NO
R44B11B_LIVE_PROVIDER_ENABLEMENT=NO
R44B11C_DISCOVERY=PASS
R44B11C_CONTRACT_LOCKED=YES
R44B11C_IMPLEMENTATION_STARTED=NO
R44B11C_SCOPE=USER_BYO_GENERATION_AUTHORIZATION_ISSUANCE
R44B11C_DISCOVERY_BASE=e5ecd6891ca3fd58dd64492b58bf890b8d9edee4
R44B11C_DATABASE_MIGRATION_REQUIRED=NO
R44B11C_GENERATION_AUTHORIZATIONS_SCHEMA_REUSED=YES
R44B11C_AUDIT_RESOURCE_TYPE_ALREADY_SUPPORTED=YES
R44B11C_RUNTIME_GRANT_CHANGE_REQUIRED=NO
R44B11C_NEW_APPLICATION_SERVICE_REQUIRED=YES
R44B11C_GENERATION_AUTHORITY_POLICY_REQUIRED=YES
R44B11C_GENERATION_POLICY_SOURCE=SOURCE_CONTROLLED
R44B11C_GENERATION_POLICY_DEPENDENCY_INJECTED=YES
R44B11C_GENERATION_POLICY_VERSION_REQUIRED=YES
R44B11C_GENERATION_POLICY_VERSION_STORED_IN_AUTHORIZATION_COLUMN=NO
R44B11C_GENERATION_POLICY_VERSION_AUDIT_REQUIRED=YES
R44B11C_PRODUCTION_CAPABILITY_DEFAULT=NONE_ENABLED
R44B11C_TEST_POLICY_INJECTION_ALLOWED=YES
R44B11C_PRODUCTION_NUMERIC_TTL_LOCKED=NO
R44B11C_PRODUCTION_NUMERIC_COST_CAP_LOCKED=NO
R44B11C_POLICY_ENVIRONMENT_OVERRIDE_ALLOWED=NO
R44B11C_POLICY_CLIENT_OVERRIDE_ALLOWED=NO
R44B11C_PROVIDER_AUTHORITY=PROVIDER_CONNECTION
R44B11C_BILLING_MODE=USER_BYO
R44B11C_CLIENT_ACCOUNT_ID_ALLOWED=NO
R44B11C_CLIENT_GRANT_ID_ALLOWED=NO
R44B11C_CLIENT_PROVIDER_ALLOWED=NO
R44B11C_CLIENT_CREDENTIAL_VERSION_ID_ALLOWED=NO
R44B11C_CLIENT_GENERATION_POLICY_VERSION_ALLOWED=NO
R44B11C_CLIENT_EXPECTED_COST_CAP_ALLOWED=NO
R44B11C_CLIENT_EXPIRES_AT_ALLOWED=NO
R44B11C_MODEL_CLIENT_INPUT_TRUSTED=NO
R44B11C_IDEMPOTENCY_KEY_REQUIRED=YES
R44B11C_IDEMPOTENCY_SCOPE=ACCOUNT_PRODUCTION_KEY
R44B11C_REPLAY_RETURNS_ORIGINAL_AUTHORIZATION=YES
R44B11C_REPLAY_REVALIDATES_ACTIVE_PRINCIPAL=YES
R44B11C_REPLAY_REVALIDATES_OTHER_DYNAMIC_ISSUANCE_ELIGIBILITY=NO
R44B11C_REPLAY_EXTENDS_EXPIRY=NO
R44B11C_REPLAY_REBINDS_CREDENTIAL=NO
R44B11C_REPLAY_RECOMPUTES_COST_CAP=NO
R44B11C_REPLAY_CHANGES_STATUS=NO
R44B11C_REPLAY_APPENDS_AUDIT=NO
R44B11C_REPLAY_APPENDS_USAGE=NO
R44B11C_DIFFERENT_INTENT_KEY_REUSE=CONFLICT
R44B11C_REQUEST_VALIDATION_AUTHORITY=R44B11A_SHARED_CONTRACT
R44B11C_REQUEST_HASH_AUTHORITY=R44B11A_SHARED_CONTRACT
R44B11C_REFERENCE_IMAGE_BOUNDARY_CHANGED=NO
R44B11C_EXPECTED_COST_AUTHORITY=SERVER_GENERATION_POLICY
R44B11C_EXPECTED_COST_AMOUNT_POSITIVE_SAFE_INTEGER=YES
R44B11C_EXPECTED_COST_UNIT_MATCHES_SHARED_CONTRACT=YES
R44B11C_EXPIRY_AUTHORITY=DATABASE_SERVER_TIME_PLUS_VERSIONED_POLICY
R44B11C_CLAIM_LIFETIME_UNIT=SECONDS
R44B11C_CLAIM_LIFETIME_POSITIVE=YES
R44B11C_CONNECTION_REQUIRES_ACTIVE=YES
R44B11C_CONNECTION_REQUIRES_VERIFIED=YES
R44B11C_CURRENT_CREDENTIAL_SELECTION=NEWEST_VERSION
R44B11C_BOUND_CREDENTIAL_REQUIRES_ACTIVE=YES
R44B11C_SUPERSEDED_ALLOWED_AT_ISSUANCE=NO
R44B11C_PRODUCTION_ARCHIVED_ALLOWED=NO
R44B11C_FREE_BYO_GRANT_STATE=AVAILABLE
R44B11C_FREE_BYO_CONSUMED_BY_ISSUANCE=NO
R44B11C_CONNECTION_LIFECYCLE_LOCK_REQUIRED=YES
R44B11C_LOCK_ORDER=USER_THEN_ACCOUNT_THEN_PROVIDER_CONNECTION_THEN_PRODUCTION_THEN_ENTITLEMENT_GRANT
R44B11C_USER_ELIGIBILITY_LOCK_REQUIRED=YES
R44B11C_USER_ELIGIBILITY_LOCK_MODE=FOR_SHARE_OR_STRONGER
R44B11C_USER_ELIGIBILITY_LOCK_HELD_THROUGH_COMMIT=YES
R44B11C_PRODUCTION_ELIGIBILITY_LOCK_REQUIRED=YES
R44B11C_ENTITLEMENT_GRANT_ELIGIBILITY_LOCK_REQUIRED=YES
R44B11C_ELIGIBILITY_LOCK_MODE=FOR_SHARE_OR_STRONGER
R44B11C_ELIGIBILITY_LOCKS_HELD_THROUGH_COMMIT=YES
R44B11C_PROCESS_LOCAL_LOCKING_SUFFICIENT=NO
R44B11C_NEW_AUTHORIZATION_STATUS=ISSUED
R44B11C_NEW_ISSUANCE_AUDIT_EVENT=generation_authorization.issued
R44B11C_AUDIT_REQUEST_BODY_INCLUDED=NO
R44B11C_AUDIT_CREDENTIAL_MATERIAL_INCLUDED=NO
R44B11C_ISSUANCE_CREATES_USAGE_ROW=NO
R44B11C_ISSUANCE_CREATES_JOB=NO
R44B11C_ISSUANCE_CREATES_ATTEMPT=NO
R44B11C_ISSUANCE_CREATES_WORKER_LEASE=NO
R44B11C_ISSUANCE_CREATES_CREDENTIAL_GRANT=NO
R44B11C_ISSUANCE_CREATES_PROVIDER_WORK=NO
R44B11C_CUSTOMER_ROUTE_INCLUDED=NO
R44B11C_CLAIM_SERVICE_INCLUDED=NO
R44B11C_EXPIRY_TRANSITION_INCLUDED=NO
R44B11C_DISCONNECT_CONVERGENCE_INCLUDED=NO
R44B11C_PROVIDER_VERIFICATION_INCLUDED=NO
R44B11C_WORKER_CHANGE_REQUIRED=NO
R44B11C_SHARED_PROTOCOL_CHANGE_REQUIRED=NO
R44B11C_PROVIDER_ADAPTER_CHANGE_REQUIRED=NO
R44B11C_PRODUCTION_PROVIDER_MODEL_ENABLEMENT=NO
R44B11C_LIVE_PROVIDER_ENABLEMENT=NO
R44B11C_FUTURE_SLICE_SUFFIXES_LOCKED=NO
```

COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE_LOCK_END_2026_11_10
