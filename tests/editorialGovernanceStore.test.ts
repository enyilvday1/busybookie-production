import { mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCompositionShotNormalizationPlan } from "../src/composition/buildCompositionShotNormalizationPlan.js";
import type { PreparedEpisodeCompositionShot } from "../src/composition/prepareEpisodeComposition.js";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV2 } from "../src/editorial/buildEditorialPlanV2.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { hashEditorialPlanV3 } from "../src/editorial/canonicalizeEditorialPlanV3.js";
import type { EditorialPlanSourceInput } from "../src/editorial/validateEditorialPlanAgainstSource.js";
import {
  planEditorialGenesis, planEditorialProposalApplication, planEditorialProposalWrite, planEditorialReviewWrite, resolveEditorialPublishRace,
  type EditorialGovernanceWrite,
} from "../src/editorial/applyEditorialProposal.js";
import { validateEditorialSubjectPartition } from "../src/editorial/deriveEditorialGovernanceState.js";
import { hashEditorialSubjectRefV1 } from "../src/editorial/editorialProposal.schema.js";
import { governanceFilePath, governanceSubjectPath, isReservedGovernanceTempName } from "../src/editorialGovernance/editorialGovernancePaths.js";
import {
  classifyGovernanceLinkFailure, publishEditorialGovernanceRecord, readEditorialGovernancePartition,
} from "../src/editorialGovernance/editorialGovernanceStore.js";

// Test-level observation of the real node:fs/promises hard link (no production seam): every call is counted and
// delegated to the real primitive unless a test forces one errno to exercise the production classification.
const realLink = vi.hoisted(() => ({ calls: 0, failWith: null as string | null }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: async (existingPath: string, newPath: string) => {
    realLink.calls += 1;
    if (realLink.failWith !== null) throw Object.assign(new Error(`forced ${realLink.failWith}`), { code: realLink.failWith });
    return actual.link(existingPath, newPath);
  } };
});

// Local fixtures only (repeated per E6 test file). Orchestration of pure core + bytes-only adapter exists only in tests.
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
const SUBJECT = { kind: "EPISODE", id: "busybookie:episode:EP02" };
const SUBJECT_SHA = hashEditorialSubjectRefV1(SUBJECT);
const HUMAN_A = { kind: "HUMAN", actorId: "human:editor-a", authentication: "DECLARED_UNVERIFIED" };
const HUMAN_B = { kind: "HUMAN", actorId: "human:editor-b", authentication: "DECLARED_UNVERIFIED" };
function sourceFixture(): EditorialPlanSourceInput {
  const postProduction = { aspectRatio: "16:9" as const, width: 1920, height: 1080, timelineFps: 25, audioSampleRateHz: 48000 };
  const episode = EpisodeManifestSchema.parse({
    schemaVersion: "1.0", episodeId: "EP02", title: "Synthetic episode", slug: "synthetic-episode", status: "DRAFT",
    audience: { description: "Children", minAgeYears: 3, maxAgeYears: 6 }, learningGoals: ["Share"], emotionalTheme: "Kindness",
    targetDurationSeconds: 60, approvals: { script: "PENDING", storyboard: "PENDING", references: "PENDING", roughCut: "PENDING", finalQc: "PENDING" },
    scenes: [{ id: "SC01", title: "SC01", summary: "Synthetic scene", shots: [0, 1].map((i) => ({
      id: `S0${i + 1}`, order: i + 1, title: `Shot ${i + 1}`, type: "ACTION", durationSeconds: 4, characters: ["OLLIE"], visualAction: "Walk",
      camera: "Wide", dialogue: [], audio: { sfx: [], ambience: "Non-rendering intent" },
      references: { required: false, assetIds: [], approvalStatus: "NOT_REQUIRED" },
      generation: { provider: "VEO", nativeAudio: false, status: "PLANNED" }, continuityNotes: [] })) }],
  });
  const shots: PreparedEpisodeCompositionShot[] = episode.scenes[0]!.shots.map((shot, i) => {
    const admitted = { sceneId: "SC01", shotId: shot.id, order: shot.order, title: shot.title, durationSeconds: shot.durationSeconds,
      nativeAudio: false, provider: "VEO" as const, providerExecutionId: `task-${i}`, sourceVideoPath: `D:/generated/${shot.id}.mp4`,
      sourceBytes: 100 + i, sourceSha256: String(i % 10).repeat(64), sourceContentType: null };
    const sourceMedia = { sourceVideoPath: admitted.sourceVideoPath, formatName: "mp4", durationSeconds: shot.durationSeconds,
      video: { codecName: "h264", profile: "High", width: 1920, height: 1080, pixelFormat: "yuv420p", frameRate: 25 }, audio: null };
    const normalizationPlan = buildCompositionShotNormalizationPlan({ mediaRoot: MEDIA_ROOT, episodeId: episode.episodeId, shot: admitted, sourceMedia, postProduction });
    return { ...admitted, normalizationPlan, normalizationCacheStatus: "HIT" as const, normalizedArtifact: { outputPath: normalizationPlan.outputPath,
      sha256: SHA("d"), bytes: 200, contentType: "video/mp4", durationSeconds: shot.durationSeconds, durationToleranceSeconds: 1 / 25 } };
  });
  return { episode, postProduction, mediaRoot: MEDIA_ROOT, preparedComposition: { episodeId: episode.episodeId, title: episode.title,
    totalShots: 2, totalDurationSeconds: 8, shots } };
}
const SOURCE = sourceFixture();
const EVIDENCE = { source: SOURCE, externalAudioAssets: [] };
const EMPTY = { editorialDecisions: null, audioMixDecisions: null, masteringDecisions: null };
function e3Doc(overlapFrames: number): AnyRecord {
  const v2 = buildEditorialPlanV2(SOURCE, null);
  return { schemaVersion: "1.0", decisionsType: "BUSYBOOKIE_EDITORIAL_DECISIONS", episodeId: "EP02",
    sourceBinding: { manifestSha256: v2.episode.manifestSha256, shotAssets: v2.shots.map((s, i) => ({ shotId: s.shotId, normalizedAssetSha256: v2.assets[i]!.sha256 })) },
    clips: [], transitions: [{ outgoingShotId: "S01", incomingShotId: "S02", type: "CROSS_DISSOLVE", overlapFrames }] };
}
function oracle(state: AnyRecord): AnyRecord {
  const v3 = buildEditorialPlanV3({ basePlan: buildEditorialPlanV2(SOURCE, state.editorialDecisions), externalAudioAssets: [], audioMixDecisions: null });
  const route = planEditorialRenderV3({ plan: v3, mediaRoot: MEDIA_ROOT });
  return { decisionStateSha256: editorialSha256(canonicalEditorialJson(state)), planSha256: hashEditorialPlanV3(v3), upstreamRoute: route.route,
    upstreamRenderKey: route.renderPlan.renderKey, masteringRenderKey: null, preMasterEvidenceSha256: null };
}
function must<T extends { ok: boolean }>(value: T): Extract<T, { ok: true }> {
  if (!value.ok) throw new Error(JSON.stringify(value));
  return value as Extract<T, { ok: true }>;
}

const roots: string[] = [];
afterEach(() => {
  realLink.calls = 0;
  realLink.failWith = null;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "busybookie-e6-store-"));
  roots.push(root);
  return root;
}
const list = (root: string) => readEditorialGovernancePartition(root, SUBJECT_SHA);
const publish = (root: string, write: EditorialGovernanceWrite) => publishEditorialGovernanceRecord({ root, subjectSha256: SUBJECT_SHA, ...write });
async function commit(root: string, write: EditorialGovernanceWrite): Promise<void> {
  const result = await publish(root, write);
  if (result.status !== "PUBLISHED") throw new Error(`unexpected ${result.status}`);
}
// Genesis + two approved proposals bound to revision 1.
async function lineageWithTwoApprovedProposals(root: string) {
  const g = must(planEditorialGenesis({ listing: await list(root), subject: SUBJECT, decisionState: EMPTY, evidence: EVIDENCE }));
  if (g.action !== "PUBLISH") throw new Error("expected genesis publish");
  await commit(root, g.write);
  const shas: string[] = [];
  for (const frames of [10, 12]) {
    const record = { recordType: "BUSYBOOKIE_EDITORIAL_PROPOSAL", recordVersion: "1", subject: SUBJECT,
      base: { revisionNumber: 1, revisionSha256: g.revisionSha256, planSha256: g.revision.planSha256 }, proposer: HUMAN_A,
      rationale: `Dissolve ${frames}`, replacements: { editorialDecisions: e3Doc(frames) }, expectedResult: oracle({ ...EMPTY, editorialDecisions: e3Doc(frames) }) };
    const prop = must(planEditorialProposalWrite({ listing: await list(root), proposal: record }));
    await commit(root, prop.write);
    const review = { recordType: "BUSYBOOKIE_EDITORIAL_REVIEW", recordVersion: "1", subject: SUBJECT, proposalSha256: prop.proposalSha256,
      base: { revisionNumber: 1, revisionSha256: g.revisionSha256 }, outcome: "APPROVED", reviewer: HUMAN_B, reason: "Approved" };
    await commit(root, must(planEditorialReviewWrite({ listing: await list(root), review })).write);
    shas.push(prop.proposalSha256);
  }
  return { genesis: g, shas };
}
const revisionFiles = (root: string) => readdirSync(join(governanceSubjectPath(root, SUBJECT_SHA), "revisions"));

describe("E6 bytes-only store: atomic no-clobber publication (category 19)", () => {
  it("publishes complete bytes by hard link, never overwrites, and leaves no reserved temporary", async () => {
    const root = freshRoot();
    const bytes = new TextEncoder().encode("{\"a\":1}\n");
    const write = { directory: "proposals" as const, name: `${SHA("a")}.json`, bytes };
    expect(await publish(root, write)).toStrictEqual({ status: "PUBLISHED" });
    const second = await publish(root, { ...write, bytes: new TextEncoder().encode("{\"a\":2}\n") });
    expect(second.status).toBe("EXISTS");
    expect(second.status === "EXISTS" && new TextDecoder().decode(second.existingBytes!)).toBe("{\"a\":1}\n");
    const names = readdirSync(join(governanceSubjectPath(root, SUBJECT_SHA), "proposals"));
    expect(names).toStrictEqual([`${SHA("a")}.json`]);
    expect(governanceFilePath(root, SUBJECT_SHA, "proposals", `${SHA("a")}.json`)).not.toContain(SUBJECT.id);
  });

  it("m1106-1 a caller cannot replace the hard-link publication primitive", async () => {
    const root = freshRoot();
    const name = `${SHA("b")}.json`;
    let injectedCalls = 0;
    // A substitute that would refuse publication if honored (and an overwrite-capable copy is never reachable).
    const linkFile = async () => { injectedCalls += 1; throw Object.assign(new Error("injected"), { code: "ENOTSUP" }); };
    const input = { root, subjectSha256: SUBJECT_SHA, directory: "proposals" as const, name, bytes: new Uint8Array([1, 10]), linkFile };
    const publishWithExtras = publishEditorialGovernanceRecord as unknown as (input: unknown, options: unknown) => ReturnType<typeof publishEditorialGovernanceRecord>;
    expect(await publishWithExtras(input, { linkFile, publishFile: linkFile, linkImpl: linkFile })).toStrictEqual({ status: "PUBLISHED" });
    expect(injectedCalls).toBe(0);
    expect(realLink.calls).toBe(1);
    // The real hard link still governs: no-clobber on an existing target, original bytes kept.
    const again = await publishWithExtras({ ...input, bytes: new Uint8Array([2, 10]) }, { linkFile });
    expect(again.status).toBe("EXISTS");
    expect(again.status === "EXISTS" && [...again.existingBytes!]).toStrictEqual([1, 10]);
    expect(injectedCalls).toBe(0);
    expect(realLink.calls).toBe(2);
    expect(readdirSync(join(governanceSubjectPath(root, SUBJECT_SHA), "proposals"))).toStrictEqual([name]);
  });

  it("m1106-2 hard-link failures: only reliable unsupported codes are STORE_UNSUPPORTED; ambiguous codes propagate", async () => {
    const unsupported = ["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"];
    const operational = ["EPERM", "EACCES", "EINVAL", "EROFS", "ENOENT", "EXDEV", "EUNKNOWNCODE"];
    expect(classifyGovernanceLinkFailure(Object.assign(new Error("x"), { code: "EEXIST" }))).toBe("EXISTS");
    expect(classifyGovernanceLinkFailure(new Error("no code"))).toBe("OPERATIONAL");
    for (const [index, code] of [...unsupported, ...operational].entries()) {
      expect(classifyGovernanceLinkFailure(Object.assign(new Error(code), { code })), code)
        .toBe(unsupported.includes(code) ? "STORE_UNSUPPORTED" : "OPERATIONAL");
      // End to end through the production publisher (real classifier); no fallback, no final file, temp removed.
      const root = freshRoot();
      const name = `${index.toString(16).repeat(64)}.json`;
      realLink.failWith = code;
      const attempt = publishEditorialGovernanceRecord({ root, subjectSha256: SUBJECT_SHA, directory: "proposals", name, bytes: new Uint8Array([1, 10]) });
      if (unsupported.includes(code)) {
        expect(await attempt, code).toStrictEqual({ status: "STORE_UNSUPPORTED", detail: `hard link unavailable (${code})` });
      } else {
        await expect(attempt, code).rejects.toMatchObject({ code });
      }
      realLink.failWith = null;
      expect(existsSync(governanceFilePath(root, SUBJECT_SHA, "proposals", name)), code).toBe(false);
      expect(readdirSync(join(governanceSubjectPath(root, SUBJECT_SHA), "proposals")), code).toStrictEqual([]);
    }
  });

  it("EEXIST from the real hard link stays the no-clobber existing-target path, never STORE_UNSUPPORTED", async () => {
    const root = freshRoot();
    const write = { directory: "proposals" as const, name: `${SHA("e")}.json`, bytes: new Uint8Array([7, 10]) };
    expect(await publish(root, write)).toStrictEqual({ status: "PUBLISHED" });
    const second = await publish(root, { ...write, bytes: new Uint8Array([8, 10]) });
    expect(second.status).toBe("EXISTS");
    expect(second.status === "EXISTS" && [...second.existingBytes!]).toStrictEqual([7, 10]);
    expect(readdirSync(join(governanceSubjectPath(root, SUBJECT_SHA), "proposals"))).toStrictEqual([write.name]);
  });

  it("rejects unsafe roots, names and subject partitions", async () => {
    await expect(publishEditorialGovernanceRecord({ root: "relative/root", subjectSha256: SUBJECT_SHA, directory: "proposals", name: `${SHA("a")}.json`, bytes: new Uint8Array([1]) })).rejects.toThrow();
    const root = freshRoot();
    for (const name of ["../x.json", `${SHA("A")}.json`, "0000000000000001.json"]) {
      await expect(publish(root, { directory: "proposals", name, bytes: new Uint8Array([1]) })).rejects.toThrow();
    }
    await expect(readEditorialGovernancePartition(root, "busybookie:episode:EP02")).rejects.toThrow();
    expect((await list(root)).entries).toStrictEqual([]);
  });

  it("a torn canonical file is RECORD_CORRUPT; a crashed writer's reserved temporary is ignored", async () => {
    const root = freshRoot();
    const g = must(planEditorialGenesis({ listing: await list(root), subject: SUBJECT, decisionState: EMPTY, evidence: EVIDENCE }));
    if (g.action !== "PUBLISH") throw new Error("expected publish");
    await commit(root, g.write);
    const temp = `.0000000000000002.json.tmp-${"0".repeat(32)}`;
    expect(isReservedGovernanceTempName("revisions", temp)).toBe(true);
    writeFileSync(join(governanceSubjectPath(root, SUBJECT_SHA), "revisions", temp), "{\"partial\":");
    expect(validateEditorialSubjectPartition(await list(root)).ok).toBe(true);
    writeFileSync(governanceFilePath(root, SUBJECT_SHA, "revisions", "0000000000000002.json"), g.write.bytes.slice(0, 40));
    const v = validateEditorialSubjectPartition(await list(root));
    expect(v.ok ? "OK" : `${v.primaryReason}/${v.historyStatus}`).toBe("RECORD_CORRUPT/HISTORY_INVALID");
    mkdirSync(join(governanceSubjectPath(root, SUBJECT_SHA), "unknown"));
    expect(validateEditorialSubjectPartition(await list(root)).ok).toBe(false);
  });
});

describe("E6 concurrency on a real temporary filesystem (categories 15, 16)", () => {
  it("T same proposal applied concurrently: one revision, the loser resolves idempotently", async () => {
    const root = freshRoot();
    const { shas } = await lineageWithTwoApprovedProposals(root);
    const listing = await list(root);
    const a = must(planEditorialProposalApplication({ listing, proposalSha256: shas[0]!, evidence: EVIDENCE }));
    const b = must(planEditorialProposalApplication({ listing, proposalSha256: shas[0]!, evidence: EVIDENCE }));
    if (a.action !== "PUBLISH" || b.action !== "PUBLISH") throw new Error("expected publish plans");
    expect(a.write.bytes).toStrictEqual(b.write.bytes);
    const results = await Promise.all([publish(root, a.write), publish(root, b.write)]);
    expect(results.map((r) => r.status).sort()).toStrictEqual(["EXISTS", "PUBLISHED"]);
    const race = resolveEditorialPublishRace({ listing: await list(root), write: b.write });
    expect(race.ok && race.action).toBe("EXISTING");
    expect(revisionFiles(root)).toStrictEqual(["0000000000000001.json", "0000000000000002.json"]);
    expect(must(planEditorialProposalApplication({ listing: await list(root), proposalSha256: shas[0]!, evidence: EVIDENCE })).action).toBe("EXISTING");
  });

  it("U different proposals on the same base: one winner, the loser is STALE with no retry onto N+1", async () => {
    const root = freshRoot();
    const { shas } = await lineageWithTwoApprovedProposals(root);
    const listing = await list(root);
    const plans = shas.map((proposalSha256) => must(planEditorialProposalApplication({ listing, proposalSha256, evidence: EVIDENCE })));
    const writes = plans.map((plan) => { if (plan.action !== "PUBLISH") throw new Error("expected publish"); return plan.write; });
    const results = await Promise.all(writes.map((write) => publish(root, write)));
    expect(results.map((r) => r.status).sort()).toStrictEqual(["EXISTS", "PUBLISHED"]);
    const loser = writes[results.findIndex((r) => r.status === "EXISTS")]!;
    expect(resolveEditorialPublishRace({ listing: await list(root), write: loser })).toMatchObject({ ok: false, reason: "STALE" });
    expect(revisionFiles(root)).toStrictEqual(["0000000000000001.json", "0000000000000002.json"]);
    expect(validateEditorialSubjectPartition(await list(root)).ok).toBe(true);
    const loserSha = shas[results.findIndex((r) => r.status === "EXISTS")]!;
    expect(planEditorialProposalApplication({ listing: await list(root), proposalSha256: loserSha, evidence: EVIDENCE })).toMatchObject({ ok: false, reason: "STALE" });
  });

  it("racing reviews: the first stands; an identical loser is idempotent, a different loser is REVIEW_CONFLICT", async () => {
    const root = freshRoot();
    const g = must(planEditorialGenesis({ listing: await list(root), subject: SUBJECT, decisionState: EMPTY, evidence: EVIDENCE }));
    if (g.action !== "PUBLISH") throw new Error("expected publish");
    await commit(root, g.write);
    const record = { recordType: "BUSYBOOKIE_EDITORIAL_PROPOSAL", recordVersion: "1", subject: SUBJECT,
      base: { revisionNumber: 1, revisionSha256: g.revisionSha256, planSha256: g.revision.planSha256 }, proposer: HUMAN_A,
      rationale: "Dissolve", replacements: { editorialDecisions: e3Doc(10) }, expectedResult: oracle({ ...EMPTY, editorialDecisions: e3Doc(10) }) };
    const prop = must(planEditorialProposalWrite({ listing: await list(root), proposal: record }));
    await commit(root, prop.write);
    const review = (outcome: string) => ({ recordType: "BUSYBOOKIE_EDITORIAL_REVIEW", recordVersion: "1", subject: SUBJECT, proposalSha256: prop.proposalSha256,
      base: { revisionNumber: 1, revisionSha256: g.revisionSha256 }, outcome, reviewer: HUMAN_B, reason: "Reviewed" });
    const listing = await list(root);
    const approve = must(planEditorialReviewWrite({ listing, review: review("APPROVED") }));
    const reject = must(planEditorialReviewWrite({ listing, review: review("REJECTED") }));
    const results = await Promise.all([publish(root, approve.write), publish(root, reject.write)]);
    expect(results.map((r) => r.status).sort()).toStrictEqual(["EXISTS", "PUBLISHED"]);
    const loser = results[0]!.status === "EXISTS" ? approve.write : reject.write;
    const winner = loser === approve.write ? reject.write : approve.write;
    expect(resolveEditorialPublishRace({ listing: await list(root), write: loser })).toMatchObject({ ok: false, reason: "REVIEW_CONFLICT" });
    expect(resolveEditorialPublishRace({ listing: await list(root), write: winner })).toMatchObject({ ok: true, action: "EXISTING" });
  });

  it("racing different genesis attempts: one stands, the other is GENESIS_CONFLICT", async () => {
    const root = freshRoot();
    const listing = await list(root);
    const a = must(planEditorialGenesis({ listing, subject: SUBJECT, decisionState: EMPTY, evidence: EVIDENCE }));
    const b = must(planEditorialGenesis({ listing, subject: SUBJECT, decisionState: { ...EMPTY, editorialDecisions: e3Doc(10) }, evidence: EVIDENCE }));
    if (a.action !== "PUBLISH" || b.action !== "PUBLISH") throw new Error("expected publish");
    const results = await Promise.all([publish(root, a.write), publish(root, b.write)]);
    const loser = results[0]!.status === "EXISTS" ? a.write : b.write;
    expect(resolveEditorialPublishRace({ listing: await list(root), write: loser })).toMatchObject({ ok: false, reason: "GENESIS_CONFLICT" });
    expect(revisionFiles(root)).toStrictEqual(["0000000000000001.json"]);
  });
});
