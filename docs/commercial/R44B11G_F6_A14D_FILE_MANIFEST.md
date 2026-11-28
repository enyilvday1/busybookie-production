# BusyBookie R44B11G — F6-A1.4e proposed implementation evidence

**Date:** 2026-11-27  
**Scope:** isolated, pure TypeScript F6 safety protocol. **Not execution admission.**  
**Remote Git baseline:** `d47e7e591929288b363055faa38a9a1dc5dbc0d8` (`master`).  
**Previously verified local F6 source SHA-256:** `9567dc0f5e8e95a52629bbcf1bc45a74636b4da9e48867df0cfb8ebe364698bc`.

## Exact 23-file manifest

1. `packages/f6-safety-protocol/package.json`
2. `packages/f6-safety-protocol/tsconfig.json`
3. `packages/f6-safety-protocol/tsconfig.build.json`
4. `packages/f6-safety-protocol/vitest.config.ts`
5. `packages/f6-safety-protocol/README.md`
6. `packages/f6-safety-protocol/src/index.ts`
7. `packages/f6-safety-protocol/src/errors.ts`
8. `packages/f6-safety-protocol/src/canonicalEncoding.ts`
9. `packages/f6-safety-protocol/src/strictJsonDecode.ts`
10. `packages/f6-safety-protocol/src/runManifest.ts`
11. `packages/f6-safety-protocol/src/admissionReceipt.ts`
12. `packages/f6-safety-protocol/src/leaseContract.ts`
13. `packages/f6-safety-protocol/src/containmentReceipt.ts`
14. `packages/f6-safety-protocol/src/stateMachine.ts`
15. `packages/f6-safety-protocol/tests/canonicalEncoding.f6.spec.ts`
16. `packages/f6-safety-protocol/tests/strictJsonDecode.f6.spec.ts`
17. `packages/f6-safety-protocol/tests/runManifest.f6.spec.ts`
18. `packages/f6-safety-protocol/tests/admissionReceipt.f6.spec.ts`
19. `packages/f6-safety-protocol/tests/leaseContract.f6.spec.ts`
20. `packages/f6-safety-protocol/tests/containmentReceipt.f6.spec.ts`
21. `packages/f6-safety-protocol/tests/stateMachine.f6.spec.ts`
22. `packages/f6-safety-protocol/tests/importBoundary.f6.spec.ts`
23. `docs/commercial/R44B11G_F6_A14D_FILE_MANIFEST.md`

No other creation, existing-file changes or lockfile changes are authorized by this manifest. The files are supplied as a reviewable ZIP for guarded local integration; no edits were made to the Windows repository or the linked GitHub branch.

## Preservation and admission

**Protected source:** `apps/commercial-api/tests/db/workerProviderVerificationDeferral.test.ts` must retain its SHA-256 fingerprint above. The existing `f6RequireResourceAdmission()` unconditional throw remains a non-negotiable external gate. Preserve `docs/commercial/BUSYBOOKIE_FREE_BYO_HOSTED_TRIAL_BACKLOG.md` and the guarded PostgreSQL test lifecycle. The actual local working tree must be checked again before extracting any file.

## Safety scope

The package parses, canonicalizes, hashes and classifies **untrusted synthetic-only documents**. A receipt may be structurally well-formed yet have an entirely forged signature. Structural validation does not establish identity, authentic issuer, live lease, consumption, host integrity, real resource limits or containment success. It exports no cloud SDK, network, database or process launcher API.

## Test evidence and remaining gates

Execution evidence is reported separately in the delivery response. The isolated staging environment does not represent the Windows working tree. Any unavailable Vitest or Node type dependencies must be recorded; do not claim the repository's own test suite passed unless it actually ran.

Before privileged runtime integration, require independent security review, signature preimage lock, full JSON parser hardening, signing authority/ledger/attestation, containment proofs and a distinct R1 authorization. Provider fault-to-containment time remains unverified.

## F6-A1.4e.4 controlled hardening amendment (candidate, unintegrated)

The original 23-file creation manifest above remains the only eligible file set. A subsequent narrowly scoped hardening stage proposes **full-file replacements**, not additional files, to close findings F6-SEC-01 through F6-SEC-04. The separate patch report must list each changed path with its original archive SHA-256 and new SHA-256. No original protected F6 test file, root configuration, dependency lockfile, cloud resource or database may be changed.

A package-local `compareF6ManifestToExpectedResourcePolicy` API is added to validate a caller-held policy and exact four-disk mapping; it does not verify trust provenance or authorize execution. Raw manifest parsing remains structural only. F6-v1 canonicalization now rejects unsafe integral JavaScript numbers consistently with the strict JSON decoder, a deliberate stricter subset of the RFC 8785 numeric domain. The strict output byte bound is checked incrementally, and the import boundary test uses TypeScript AST inspection.

This amendment becomes a validated local implementation only after guarded application, source hash rechecks, native typecheck/build, real Vitest and final read-only review. R1 remains unmodified and fail-closed.

## F6-A1.4e.6b separate five-path scope amendment (2026-11-27)

**Historical notice:** The original 23-path restriction and the A1.4e.4 ``candidate/unintegrated`` wording above describe the state *when those stages were authored*. They are not statements about the later operator-confirmed checkpoints. The original 23-path inventory is preserved.

**Operator-reported checkpoint results:** A1.4e.1 guarded integration PASS (23/23); A1.4e.2 native TypeScript/Vitest PASS (35/35); A1.4e.4 nine-file security patch guarded application PASS; A1.4e.5c Rolldown compatibility single-file patch guarded application PASS; A1.4e.5d native TypeScript **7.0.2** typecheck/build PASS and Vitest **5.0.1**, **42/42** tests PASS on Node **24.11.0**. Protected commercial F6 source retains SHA-256 `9567dc0f5e8e95a52629bbcf1bc45a74636b4da9e48867df0cfb8ebe364698bc` according to operator output. These are operator logs, not cloud or operational F6 safety evidence.

**Newly approved F6-A1.4e.6b amendment scope (five existing paths only):**

1. `package.json` -- direct root pinned **devDependency** `rolldown: 1.2.9`; no other declaration changes.
2. `package-lock.json` -- root package devDependency metadata synchronized to that direct pin; no dependency-resolution or integrity churn.
3. `packages/f6-safety-protocol/README.md` -- parser, dependency-governance, Node/Vitest test compatibility and checkpoint chronology.
4. `packages/f6-safety-protocol/tests/importBoundary.f6.spec.ts` -- enforce no crypto re-exports and a sealed nine-module source inventory; add negative coverage for unknown/unscanned local modules and side effects.
5. `docs/commercial/R44B11G_F6_A14D_FILE_MANIFEST.md` -- this append-only scope amendment and evidence chronology.

This scope **does not** permit any other root config change, dependency installation, staging/commit, F6 integration test, provider or QEMU launch, VM/IAM change, Google Cloud billing/API action or modification of the unconditional R1 gate. Root `package-lock.json` is a complete locally generated postimage from its validated exact Git preimage because the offline patch contains only the four other complete replacement files. The guarded installer must reject unexpected versions, incorrect blob hashes, unexpected untracked paths and non-empty staging; retain recovery copies on Samsung T7.

**F6-A1.4e.6b acceptance remains pending:** guarded five-path application, full 23-file source-integrity verification, root metadata/lock consistency verification, TypeScript 7 native typecheck/build, native Vitest with at least 45 tests, and a separate review of disposable-install reproducibility. Completing these pure-protocol steps **never** grants admission, authenticates receipts, verifies containment or lifts R1.


## F6-A1.4e.7 final-status reconciliation and pre-publication scope (2026-11-27)

**Supersession rule:** Earlier ``candidate/unintegrated``, ``6b pending`` and ``native retest pending`` language above is preserved as time-of-authoring evidence. The following later checkpoint records supersede those *status* claims; they do not retroactively expand the original scope or certify runtime safety.

1. **6b2 guarded amendment applied:** The first 6b installer stopped during lockfile preparation without replacing files. The corrected end-of-line-aware 6b2 installer subsequently reported exactly five authorized replacements, exact package/lockfile Git postimage blobs (`6bb482e010e2538f5a088fc26454af37b55c5a50` and `9ca72c4b0d41c446348f55634f8a863c395637cf` respectively), 23/23 final F6 source checks, preserved index, and unchanged protected commercial F6 source.
2. **6c native regression:** Windows Node 24.11.0, TypeScript 7.0.2 and Vitest 5.0.1: typecheck PASS; exactly **8 test files, 45/45 tests PASS**; build PASS; post-test source integrity PASS. The seven-test import-boundary suite covers the additional AST regression cases.
3. **6d reproducibility:** Independent worktree reconstructed on Samsung T7, `npm ci --ignore-scripts` installed 86 packages; typecheck PASS, **45/45** tests PASS, build PASS, original repository preservation PASS. This is scriptless Windows installation evidence, not a Linux/runtime compatibility certification.
4. **6e scoped security closure:** Independent read-only source/contract review accepted only the reproducible, isolated, structurally validating **non-authorizing** protocol component. Its acceptance does not validate receipt signatures, lease authority, live resource measurement, trusted policy issuer, independent containment, provider spending control or F6 execution.

**F6-A1.4e.7 documentation patch scope:** Only the existing `packages/f6-safety-protocol/README.md` and this manifest receive append-only status text. The other 21 original F6 files, the two approved root dependency files, and every protected or unrelated file remain byte-for-byte unchanged. Original 23-path inventory stays exact, and Git staging is not authorized by this amendment.

**Controlled Git publication candidate:** Exactly **25 paths** (23 initial F6 package/manifest paths plus `package.json` and `package-lock.json`), subject to a separate publication/staging authorization and recheck of the actual Windows worktree. Explicit exclusions: modified `apps/commercial-api/tests/db/workerProviderVerificationDeferral.test.ts` and untracked `docs/commercial/BUSYBOOKIE_FREE_BYO_HOSTED_TRIAL_BACKLOG.md`. As of this documentation update, the F6 protocol is not committed, merged or deployed by this checkpoint. Protected source must continue to hash to `9567dc0f5e8e95a52629bbcf1bc45a74636b4da9e48867df0cfb8ebe364698bc`.

**Evidence provenance:** 6b2, 6c and 6d outcomes come from operator-provided Git Bash logs, with the pure source independently reconstructed and inspected at 6e. Documentation reconciliation itself is not new runtime test evidence. R1 remains fail-closed; F6/QEMU/PostgreSQL, cloud billing/IAM, synthetic execution, independent containment and paid Runway/Veo remain **NO-GO** without their own explicit authorization and evidence.


## F6-ISO-001 heavyweight-assessment lifecycle isolation and governance amendment (2026-11-28)

**Separate scope:** F6-ISO-001 is its own authorized scope. It is not a retroactive authorization under A1.4e.7, and it does not expand, amend or re-open any earlier scope. The historical 25-path pure-protocol publication candidate above stays unchanged as a historical record.

**Relocation and hashes (SHA-256, raw working-file bytes, LF):**

| Role | Path | SHA-256 |
|---|---|---|
| Historical protected assessment source (pre-isolation working copy) | `apps/commercial-api/tests/db/workerProviderVerificationDeferral.test.ts` | `9567dc0f5e8e95a52629bbcf1bc45a74636b4da9e48867df0cfb8ebe364698bc` |
| Restored regression file (equals the `54a8351` HEAD blob) | `apps/commercial-api/tests/db/workerProviderVerificationDeferral.test.ts` | `eaa779c9820843ec8b6dc842ba61d25db3f6da65ee5835ce45697d7bfe372c12` |
| New isolated heavyweight assessment | `apps/commercial-api/tests/db/f6/defaultPlannerAssessment.heavyweight.ts` | `5a54bfce33224799eba9640c618e01885203221da3298eed39c343a7a0cf4a7c` |

**Supersession (narrow):** The earlier requirement that the protected source "must continue to hash to `9567dc0f…`" is superseded **only** for the approved relocation of the heavyweight assessment into its own module. It is not superseded for any other purpose. The restored regression file is a protected verification target: it must equal the HEAD blob (`eaa779c9…`) and is **not** an authorized modification under this scope.

**F6-ISO-001 isolation and governance scope (exactly five paths):**

1. `apps/commercial-api/tests/db/f6/defaultPlannerAssessment.heavyweight.ts`
2. `apps/commercial-api/vitest.f6.config.ts`
3. `apps/commercial-api/vitest.db.config.ts`
4. `apps/commercial-api/tests/boundary.test.ts`
5. `docs/commercial/R44B11G_F6_A14D_FILE_MANIFEST.md`

`docs/commercial/BUSYBOOKIE_FREE_BYO_HOSTED_TRIAL_BACKLOG.md` remains untracked, unrelated and untouched.

**Safety status:**

- The heavyweight assessment remains **blocked**. `f6RequireResourceAdmission()` still throws unconditionally, and no environment-variable or injected-token bypass exists. Selecting the assessment through `vitest.f6.config.ts` is not admission.
- The ordinary `test:db` runner excludes `tests/db/f6/**`. `vitest.f6.config.ts` is now in the commercial-api boundary scanner's configuration inventory.
- No production service change, provider enablement, PostgreSQL execution, migration, schema reset or heavyweight assessment run is authorized by this amendment.

**Unresolved:**

- The pinned Git baseline (`d47e7e591929288b363055faa38a9a1dc5dbc0d8`, not the current HEAD) and the tracked-modification allowlist are preserved as authored. They fail closed and need a separate review.
- **Historical source backup:** the `9567dc0f…` bytes currently exist only in a session-local scratch copy. They need durable evidence retention. Archival is complete only after the retained copy is re-hashed and matches `9567dc0f5e8e95a52629bbcf1bc45a74636b4da9e48867df0cfb8ebe364698bc`.

Git staging and commit are not authorized by this amendment.

### F6-ISO-001 historical archive verification (2026-11-28)

The historical F6 assessment source retention requirement was subsequently satisfied by a verified external archival copy.

- Medium: Samsung T7 Shield, drive D:.
- Archive: `D:\Busybookie\Recovery\F6-ISO-001\workerProviderVerificationDeferral.pre-isolation.9567dc0f.ts`
- SHA-256: `9567dc0f5e8e95a52629bbcf1bc45a74636b4da9e48867df0cfb8ebe364698bc`.
- Evidence: operator-provided Git Bash output confirmed the source hash, archive hash, external-drive identity and `STEP_727=PASS`.
- Original temporary source was not deleted.
- No repository staging or commit occurred during archival.

This closes the F6-ISO-001 historical-source archival requirement for the verified Samsung T7 copy. It does not certify a secondary OneDrive backup, authorize heavyweight execution, lift resource admission, or resolve the pinned-baseline and modification-allowlist blockers.

F6-ISO-001 archival evidence is separate from F6 runtime acceptance.
