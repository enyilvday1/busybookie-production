# BusyBookie F6 safety protocol (pure contracts only)

**Status (2026-11-27):** F6-A1.4e.5d hardened candidate passed Windows-native TypeScript 7.0.2 typecheck/build and Vitest 5.0.1 (8 test files, 42/42 tests, Node 24.11.0). F6-A1.4e.6b is a separately scoped dependency/documentation/boundary-test amendment **pending guarded local application and native retest**. The package is NOT an operational safety, attestation or admission mechanism.

The library provides *structural* checks for synthetic-only run manifests, signed receipt **envelopes**, leases, containment **claims**, and potential lifecycle transitions. It has no operational signing/verifying key, independent replay ledger, cloud client, host launcher, database connection, or execution authority.

A successful parse **never** grants permission to start QEMU, PostgreSQL, Vitest, a synthetic workload or the existing F6 B/H/K/S scenarios. R1 `f6RequireResourceAdmission()` remains a separate unconditional fail-closed barrier in the original unmodified commercial database test.

## Boundaries

- External JSON bytes must first enter through `strictJsonDecode(Uint8Array)`. Ordinary `JSON.parse` silently discards duplicate member names and is **not** permitted as the external admission decoder.
- The strict decoder caps inputs at 64 KiB, nesting depth at 32 and aggregate object members/array items at 4096. It rejects malformed UTF-8, duplicate decoded member names, unsafe integer values and numeric underflow. It returns frozen null-prototype objects. This is intentionally a restricted I-JSON subset; it is not a full RFC 8259 acceptance implementation.
- In-memory canonicalization enforces a cumulative 64 KiB **while emitting** each UTF-8 token, rather than after building an oversized serialized value. It also bounds 4096 visited values and depth 32. It uses RFC 8785 key ordering (UTF-16 units), string escaping and supported ECMAScript number formatting, but intentionally restricts the input domain to **safe integers** plus finite nonintegral numbers. Consequently this is an F6-v1 strict I-JSON subset, not a claim to accept every numeric RFC 8785 vector (for example, `1e30` is intentionally rejected by both input paths). It refuses accessors, sparse arrays, symbol keys, non-JSON values, cycles, and invalid Unicode. **Do not pass hostile JavaScript Proxies**: reflection can execute their traps. Decode untrusted byte inputs first.
- `sha256F6Document` uses fixed protocol-v1 domains. Hashes prove only content identity; they are not signatures or trust evidence.
- `compareF6ManifestToExpectedResourcePolicy` separately compares the complete proposed resource policy and exact four disk roles (`EXEC_BOOT`, `EXEC_BACKING`, `CTRL_BOOT`, `CTRL_EVIDENCE`) against caller-held independently authenticated expected input, and recomputes its domain-separated digest. It returns `operationallyAuthorized: false`. The library **cannot authenticate where the caller obtained the expected policy**. A structurally parsed manifest remains non-authoritative, and real resource enforcement remains unverified.
- `parseF6AdmissionReceipt` only returns `STRUCTURALLY_VALID_UNVERIFIED`. Ed25519-shaped signature bytes are *not cryptographically verified*. No receipt is consumed or authenticated.
- `parseF6Lease` only checks grammar, bounded timestamps and optionally relative fencing/sequence ordering. It does not check trusted time, durable sequence state or active authority.
- `parseF6ContainmentReceipt` only returns `UNVERIFIED_CLAIM`, including claims marked `INDEPENDENT_VERIFIED` by the sender.
- `validateF6Transition` always returns `operationallyAuthorized: false`; sensitive transitions to `SYNTHETIC_ACTIVE`, `CONTAINED` and `CLOSED` remain externally blocked.

## Source layout

The runtime modules are under `src`. Test files are under `tests` and end in `.f6.spec.ts`. The dedicated `vitest.config.ts` selects only these tests; neither the repository root suite nor the commercial API database suite should collect them.

The package uses **no new runtime dependency**. Its import-boundary tests use the Rolldown `parseAst` TypeScript-aware AST (not the removed classic TypeScript 7 compiler API). Under the separately approved F6-A1.4e.6b scope, the **repository root** declares an exact `rolldown: 1.2.9` devDependency and synchronizes root `package-lock.json`; the F6 folder is **not an npm workspace** and does not declare its own test dependencies. The AST tests seal the nine runtime `.ts` modules, refuse unexpected source entries or local dependencies, restrict `node:crypto` imports to `{ createHash }`, and prohibit all `node:crypto` re-exports, side-effect imports and dynamic imports. These tests are defense in depth, not proof that arbitrary JavaScript cannot perform side effects.

**Test runtime:** The verified native run used Node **24.11.0**, TypeScript **7.0.2** and Vitest **5.0.1**. Vitest 5.0.1 declares Node `^22.12.0 || ^24.0.0 || >=26.0.0`; the existing F6 package `engines` entry (`^22.13.0 || >=24.0.0`) and repository root `engines` (`>=20`) are broader, so **Node 20/21/25 must not be assumed supported for these F6 tests**. Actual `npm ci` reproducibility and support across Node versions require a separately authorized disposable-install check. Do not install or update dependencies on the Windows worktree as part of the F6 test command.

From the repository root, once separately reviewed and installed:

```sh
./node_modules/.bin/tsc -p packages/f6-safety-protocol/tsconfig.json --noEmit
./node_modules/.bin/vitest run --config packages/f6-safety-protocol/vitest.config.ts --passWithNoTests=false
./node_modules/.bin/tsc -p packages/f6-safety-protocol/tsconfig.build.json
```

The tests are for pure protocols and do **not** authorize `npm test:db`, cloud activity or F6 scenario execution.

## Domain hash preimage (v1)

SHA-256 is computed over UTF-8 bytes of:

`busybookie.r44b11g.f6.v1` + NUL + an allowlisted ASCII domain (such as `RUN_MANIFEST`) + NUL + the JCS JSON text.

Do not change the preimage recipe under the `v1` identifier. A future authenticated issuance protocol must separately specify precisely what signed bytes cover (including how signature fields are excluded), issuer trust, durable consumption, and identity binding.

## Release blockers

This is an isolated development deliverable, **not production-ready authorization software**. Prior to any use in a trusted path, require an independent security review of the bounded raw JSON parser, protocol/crypto preimages, cross-language canonical vectors, authenticated transport and identity, host attestation, replay ledger, provider containment and independent evidence verification. The 60-second containment objective is unproven.

The original 23-file delivery did not change the root manifest or lockfile. F6-A1.4e.6b separately authorizes a **devDependency-only root metadata amendment**, not runtime integration. The existing commercial F6 source, database tests and cloud resources must remain unchanged. Do not merge into `master` or activate a launcher without a separate approval gate.

## F6-A1.4e.4 hardening review gates

The patch modifies only pre-existing files from the approved 23-file manifest: cumulative canonical-output accounting (F6-SEC-01), strict numeric profile consistency (F6-SEC-02), an independent-resource-policy comparison API (F6-SEC-03), and a TypeScript AST import test (F6-SEC-04). The current pure parser accepts some structurally valid but unrealistic values because it is **not** the policy authority; only an independently anchored expected policy and later measured runtime controls can enforce allocation. The comparison API does not authorize a VM or lift R1.

The user's previously modified commercial F6 test, root package and lockfile, cloud project, database and operating-system launcher are **outside** this patch's authority. Reverify original per-file hashes before applying full-file replacements, and run the actual repository-native Vitest suite afterward.

## F6-A1.4e.6b dependency-governance and AST-coverage amendment (pending native retest)

- **Amendment beyond the original 23-file scope:** root `package.json` and `package-lock.json` receive only an exact `rolldown: 1.2.9` direct devDependency and corresponding lockfile root metadata. All other locked package versions and resolutions must remain unchanged. This is no production runtime dependency or workspace migration.
- `tests/importBoundary.f6.spec.ts` now rejects `node:crypto` re-exports, unknown relative `.js` imports, side-effect local imports and additional/unscanned source files (including `.js/.mjs/.cjs/.tsx`). The sealed nine-file source list must change only under a new reviewed amendment.
- The package README and `docs/commercial/R44B11G_F6_A14D_FILE_MANIFEST.md` record the history and the remaining gate. The amendment does not modify the F6 public API, receipt verification, policy trust, R1, cloud, database or QEMU.
- **F6-A1.4e.6b is NOT complete on the operator's computer** until the guarded five-path update, native TypeScript/Vitest/build results, dependency/lockfile consistency and per-file integrity checks are independently reviewed. A disposable clean installation is still required before claiming installation-strategy portability.


## F6-A1.4e.7 current status reconciliation (2026-11-27)

**Authoritative latest checkpoint within the pure-protocol scope:** The historical heading and notes above describing F6-A1.4e.6b as pending application or describing 42/42 tests as the latest result are retained as chronology; the following subsequently reported and reviewed results supersede those status statements.

- **F6-A1.4e.6b2 guarded application:** After an initial lockfile end-of-line preimage failure that stopped before replacement, the corrected installer applied exactly five authorized files. Operator output confirmed the expected root Git blobs (`package.json` `6bb482e010e2538f5a088fc26454af37b55c5a50`; `package-lock.json` `9ca72c4b0d41c446348f55634f8a863c395637cf`), all 23 F6 file hashes, an unchanged staging index, and protected R1 source preservation.
- **F6-A1.4e.6c native verification:** Operator-run Windows Node 24.11.0, TypeScript 7.0.2 and Vitest 5.0.1 passed package typechecking, all **45/45 tests across eight files**, build, and pre/post source-integrity checks. The import-boundary suite contains **7** tests.
- **F6-A1.4e.6d clean-install verification:** A separately reconstructed Samsung T7 worktree passed `npm ci --ignore-scripts` (86 packages installed), typechecking, all **45/45** Vitest tests, build and original-repository preservation. This verifies a *scriptless* clean installation in the tested Windows environment, not Linux portability, arbitrary Node releases, or installs requiring lifecycle scripts.
- **F6-A1.4e.6e independent scoped review:** The 2026-11-27 review accepted the reproducible, isolated, **non-authorizing** pure-data-contract implementation within its declared test and inspection limits. F6-SEC-01 through F6-SEC-05 had corresponding corrections and regression evidence. No privileged runtime or independent containment approval was granted.
- **Dependency ownership:** The repository root directly pins the test-only `rolldown: 1.2.9` devDependency and matching lockfile root metadata. The private F6 package remains non-workspace and has no cloud, database, provider or process-launcher dependency.

**Publication boundary:** A1.4e.7 permits documentation status reconciliation and a controlled, *read-only* publication review. A prospective isolated protocol publication comprises exactly the original **23** package/manifest paths plus root `package.json` and `package-lock.json` (**25 paths total**). It excludes the pre-existing modified `apps/commercial-api/tests/db/workerProviderVerificationDeferral.test.ts` and untracked `docs/commercial/BUSYBOOKIE_FREE_BYO_HOSTED_TRIAL_BACKLOG.md`. No file is staged, committed or pushed merely because the protocol package passed tests.

**Safety boundary unchanged:** No receipt is cryptographically verified, no caller-held policy is authenticated, no independent containment is established, no R1 run or Z01-Z26 cloud negative-control proof exists, and no paid Runway/Veo or production-worker operation is authorized. Structural validity is never operational permission.
