import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeEditorialInterchangeOtio } from "../src/editorial/serializeEditorialInterchangeOtio.js";
import {
  interchangeArtifactFileName, interchangeArtifactPath, interchangeArtifactRelativePath, interchangeDirectoryPath, isCanonicalInterchangeFileName,
  isReservedInterchangeTempName, reservedInterchangeTempName,
} from "../src/editorialInterchange/editorialInterchangePaths.js";
import {
  classifyInterchangeLinkFailure, publishEditorialInterchangeArtifact, verifyEditorialInterchangeArtifact,
} from "../src/editorialInterchange/editorialInterchangeStore.js";

// Test-level observation of the real node:fs/promises primitives (no production seam): calls are recorded and delegated
// to the real implementation unless a test forces one errno to exercise the production classification.
const fsProbe = vi.hoisted(() => ({
  linkCalls: 0, linkFailWith: null as string | null, openCalls: [] as [string, string][], openFailFor: null as string | null,
  lstatFailFor: null as string | null,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const forced = (code: string) => Object.assign(new Error(`forced ${code}`), { code });
  return {
    ...actual,
    link: async (existingPath: string, newPath: string) => {
      fsProbe.linkCalls += 1;
      if (fsProbe.linkFailWith !== null) throw forced(fsProbe.linkFailWith);
      return actual.link(existingPath, newPath);
    },
    open: async (path: string, flags?: string) => {
      fsProbe.openCalls.push([String(path), String(flags)]);
      if (fsProbe.openFailFor !== null && String(path) === fsProbe.openFailFor && flags === "r") throw forced("EACCES");
      return actual.open(path, flags);
    },
    lstat: async (path: string, options?: unknown) => {
      if (fsProbe.lstatFailFor !== null && String(path) === fsProbe.lstatFailFor) throw forced("EIO");
      return actual.lstat(path, options as never);
    },
  };
});

// Local fixture (repeated per E7 test file). Composition of pure core and bytes-only store exists only in tests.
type AnyRecord = Record<string, any>;
const SHA = (c: string) => c.repeat(64);
const EP = "EP02";
function timeline(bedGainCentiDb = -600): AnyRecord {
  const path = `cache/composition-normalized/EP02/S01/EP02_S01_${SHA("9")}.mp4`;
  return {
    interchangeTimelineVersion: "busybookie-interchange-timeline-v1", timelineId: `busybookie-timeline:${SHA("2")}`,
    episode: { episodeId: EP, manifestSha256: SHA("e") },
    provenance: { subjectSha256: SHA("1"), revisionNumber: 1, revisionSha256: SHA("2"), approval: "GENESIS_DECLARED", appliedProposalSha256: null,
      approvalReviewSha256: null, decisionStateSha256: SHA("3"), planSha256: SHA("4"), upstreamRoute: "E2_ROUGH_CUT", upstreamRenderKey: SHA("5"),
      masteringRenderKey: null, preMasterEvidenceSha256: null, editorialDecisionsSha256: null, audioMixDecisionsSha256: null, manifestSha256: SHA("e") },
    rates: { videoFrameRate: { numerator: 25, denominator: 1 }, audioSampleRateHz: 48_000, samplesPerFrame: 1_920 },
    timelineDurationFrames: 100,
    video: { trackId: "V1", transitions: [], clips: [{ clipId: "V1-S01", shotId: "S01", sceneId: "SC01", assetId: "normalized:EP02:S01", assetSha256: SHA("d"),
      mediaRootRelativePath: path, assetDurationFrames: 100, selectedSourceInFrame: 0, selectedSourceOutFrame: 100, timelineStartFrame: 0,
      nominalSourceInFrame: 0, nominalSourceOutFrame: 100, nominalTimelineStartFrame: 0 }] },
    shotAudio: { trackId: "A1", bed: { bedGainCentiDb, bedMuted: false }, clips: [{ clipId: "A1-S01", linkedClipId: "V1-S01", assetId: "normalized:EP02:S01",
      assetSha256: SHA("d"), mediaRootRelativePath: path, assetDurationSamples: 192_000, audioMode: "SYNTHETIC_SILENCE", dialoguePlanKey: null, audioKey: null,
      sourceInSample: 0, sourceOutSample: 192_000, timelineStartSample: 0 }] },
    externalAudio: { lanes: [] },
    mastering: null,
  };
}
function serialized(bedGainCentiDb = -600) {
  const out = serializeEditorialInterchangeOtio({ timeline: timeline(bedGainCentiDb) });
  if (!out.ok) throw new Error(out.reason);
  return out;
}
const ART = serialized();
const KEY = ART.exportIdentitySha256;

const roots: string[] = [];
afterEach(() => {
  Object.assign(fsProbe, { linkCalls: 0, linkFailWith: null, openCalls: [], openFailFor: null, lstatFailFor: null });
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "busybookie-e7-store-"));
  roots.push(root);
  return root;
}
const publish = (mediaRoot: string, bytes: Uint8Array = ART.bytes, exportIdentitySha256 = KEY) =>
  publishEditorialInterchangeArtifact({ mediaRoot, episodeId: EP, exportIdentitySha256, bytes });
const verify = (mediaRoot: string, expectedBytes: Uint8Array = ART.bytes) =>
  verifyEditorialInterchangeArtifact({ mediaRoot, episodeId: EP, exportIdentitySha256: KEY, expectedBytes });
const finalPath = (root: string) => interchangeArtifactPath(root, EP, KEY);
const listing = (root: string) => readdirSync(interchangeDirectoryPath(root, EP)).sort();
const finalReads = (root: string) => fsProbe.openCalls.filter(([path, flags]) => path === finalPath(root) && flags === "r").length;
const RELATIVE = `exports/EP02/interchange/EP02_interchange_${KEY}.otio`;
// Symlink creation needs privilege on Windows; the mandatory directory/junction cases cover the same predicate (n1121-6).
function trySymlinkFile(target: string, path: string): boolean {
  try {
    symlinkSync(target, path, "file");
    return true;
  } catch (cause) {
    if ((cause as { code?: string }).code === "EPERM") return false;
    throw cause;
  }
}

describe("deterministic path and names (category 23, AC7-27)", () => {
  it("path pattern is exports/<episodeId>/interchange/<episodeId>_interchange_<exportIdentitySha256>.otio", () => {
    expect(interchangeArtifactRelativePath(EP, KEY)).toBe(RELATIVE);
    expect(interchangeArtifactFileName(EP, KEY)).toBe(`EP02_interchange_${KEY}.otio`);
    const root = freshRoot();
    expect(finalPath(root)).toBe(join(root, "exports", "EP02", "interchange", `EP02_interchange_${KEY}.otio`));
    expect(isCanonicalInterchangeFileName(`EP02_interchange_${KEY}.otio`)).toBe(true);
    expect(isCanonicalInterchangeFileName(`EP02_interchange_${KEY}.json`)).toBe(false);
  });

  it("reserved temporaries use '.' + final + '.tmp-' + 32 lowercase hex and are never artifacts", () => {
    const final = interchangeArtifactFileName(EP, KEY);
    const temp = reservedInterchangeTempName(final, "0".repeat(32));
    expect(temp).toBe(`.${final}.tmp-${"0".repeat(32)}`);
    expect(isReservedInterchangeTempName(temp)).toBe(true);
    expect(isCanonicalInterchangeFileName(temp)).toBe(false);
    expect(() => reservedInterchangeTempName(final, "Z".repeat(32))).toThrow();
    expect(() => reservedInterchangeTempName("x.otio", "0".repeat(32))).toThrow();
  });

  it("names are validated before any join; unsafe inputs never touch the filesystem", async () => {
    const root = freshRoot();
    for (const episodeId of ["../EP02", "EP1", "ep02", "EP02/..", ""]) {
      await expect(publishEditorialInterchangeArtifact({ mediaRoot: root, episodeId, exportIdentitySha256: KEY, bytes: ART.bytes }), episodeId).rejects.toThrow();
    }
    for (const sha of [SHA("A"), "abc", `${KEY}/..`, `../${KEY}`]) {
      await expect(publish(root, ART.bytes, sha), sha).rejects.toThrow();
    }
    await expect(publishEditorialInterchangeArtifact({ mediaRoot: "relative/root", episodeId: EP, exportIdentitySha256: KEY, bytes: ART.bytes })).rejects.toThrow();
    await expect(publish(root, new Uint8Array(0))).rejects.toThrow();
    expect(existsSync(join(root, "exports"))).toBe(false);
    expect(fsProbe.linkCalls).toBe(0);
  });
});

describe("hard-link no-clobber publication and idempotency (category 23, AC7-27)", () => {
  it("publishes complete bytes by the real hard link and leaves no reserved temporary", async () => {
    const root = freshRoot();
    expect(await publish(root)).toStrictEqual({ status: "PUBLISHED", relativePath: RELATIVE });
    expect(fsProbe.linkCalls).toBe(1);
    expect(new Uint8Array(readFileSync(finalPath(root)))).toStrictEqual(ART.bytes);
    expect(listing(root)).toStrictEqual([`EP02_interchange_${KEY}.otio`]);
    expect(fsProbe.openCalls.some(([path, flags]) => path === finalPath(root) && flags !== "r")).toBe(false);
  });

  it("equal regular bytes at the identity path are idempotent EXISTS; the file is untouched", async () => {
    const root = freshRoot();
    await publish(root);
    expect(await publish(root)).toStrictEqual({ status: "EXISTS", relativePath: RELATIVE });
    expect(new Uint8Array(readFileSync(finalPath(root)))).toStrictEqual(ART.bytes);
    expect(listing(root)).toStrictEqual([`EP02_interchange_${KEY}.otio`]);
  });

  it("different regular bytes at the identity path are STORE_EXISTS_CONFLICT; never overwritten", async () => {
    const root = freshRoot();
    await publish(root);
    const other = serialized(-900).bytes;
    expect(await publish(root, other)).toMatchObject({ status: "STORE_EXISTS_CONFLICT" });
    expect(new Uint8Array(readFileSync(finalPath(root)))).toStrictEqual(ART.bytes);
    expect(listing(root)).toStrictEqual([`EP02_interchange_${KEY}.otio`]);
  });

  it("a caller cannot inject a replacement publication primitive", async () => {
    const root = freshRoot();
    let injected = 0;
    const linkFile = async () => { injected += 1; throw Object.assign(new Error("injected"), { code: "ENOTSUP" }); };
    const withExtras = publishEditorialInterchangeArtifact as unknown as (input: unknown, options: unknown) => ReturnType<typeof publishEditorialInterchangeArtifact>;
    expect(await withExtras({ mediaRoot: root, episodeId: EP, exportIdentitySha256: KEY, bytes: ART.bytes, linkFile }, { linkFile, link: linkFile }))
      .toStrictEqual({ status: "PUBLISHED", relativePath: RELATIVE });
    expect(injected).toBe(0);
    expect(fsProbe.linkCalls).toBe(1);
  });

  it("a crashed writer's leftover reserved temporary is ignored and never treated as the artifact", async () => {
    const root = freshRoot();
    mkdirSync(interchangeDirectoryPath(root, EP), { recursive: true });
    const leftover = reservedInterchangeTempName(interchangeArtifactFileName(EP, KEY), "f".repeat(32));
    writeFileSync(join(interchangeDirectoryPath(root, EP), leftover), "{\"partial\":");
    expect(await verify(root)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    expect(await publish(root)).toStrictEqual({ status: "PUBLISHED", relativePath: RELATIVE });
    expect(await verify(root)).toStrictEqual({ status: "VERIFIED", relativePath: RELATIVE });
  });

  it("concurrent identical publications: one PUBLISHED, one EXISTS; different bytes: one PUBLISHED, one CONFLICT", async () => {
    const same = freshRoot();
    const twins = await Promise.all([publish(same), publish(same)]);
    expect(twins.map((r) => r.status).sort()).toStrictEqual(["EXISTS", "PUBLISHED"]);
    expect(listing(same)).toStrictEqual([`EP02_interchange_${KEY}.otio`]);
    const race = freshRoot();
    const results = await Promise.all([publish(race), publish(race, serialized(-900).bytes)]);
    expect(results.map((r) => r.status).sort()).toStrictEqual(["PUBLISHED", "STORE_EXISTS_CONFLICT"]);
    expect(listing(race)).toStrictEqual([`EP02_interchange_${KEY}.otio`]);
  });
});

describe("existing-target validation is lstat-first (category 23, AC7-28, Step 1120 section 5)", () => {
  it("EEXIST + directory at the identity path is STORED_ARTIFACT_CORRUPT without reading any bytes", async () => {
    const root = freshRoot();
    mkdirSync(finalPath(root), { recursive: true });
    expect(await publish(root)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    expect(finalReads(root)).toBe(0);
    expect(listing(root)).toStrictEqual([`EP02_interchange_${KEY}.otio`]);
  });

  it("EEXIST + junction/reparse link (unprivileged on Windows) is STORED_ARTIFACT_CORRUPT, never followed", async () => {
    const root = freshRoot();
    const target = join(root, "elsewhere");
    mkdirSync(target);
    mkdirSync(interchangeDirectoryPath(root, EP), { recursive: true });
    symlinkSync(target, finalPath(root), "junction");
    const result = await publish(root);
    expect(result).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    expect(result.status === "STORED_ARTIFACT_CORRUPT" && result.detail).toMatch(/symbolic link|not a regular file/);
    expect(finalReads(root)).toBe(0);
  });

  it("EEXIST + file symlink to equal bytes is STORED_ARTIFACT_CORRUPT (never success through a link)", async (ctx) => {
    const root = freshRoot();
    const target = join(root, "equal.otio");
    writeFileSync(target, ART.bytes);
    mkdirSync(interchangeDirectoryPath(root, EP), { recursive: true });
    if (!trySymlinkFile(target, finalPath(root))) return ctx.skip();
    expect(await publish(root)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT", detail: "final entry is a symbolic link or reparse link" });
    expect(finalReads(root)).toBe(0);
  });

  it("EEXIST + unreadable regular file is STORED_ARTIFACT_CORRUPT (OS error kept as detail)", async () => {
    const root = freshRoot();
    await publish(root);
    fsProbe.openFailFor = finalPath(root);
    expect(await publish(root)).toStrictEqual({ status: "STORED_ARTIFACT_CORRUPT", detail: "final entry could not be opened (EACCES)" });
  });

  it("EEXIST + lstat failure is STORED_ARTIFACT_CORRUPT, before any read", async () => {
    const root = freshRoot();
    await publish(root);
    fsProbe.lstatFailFor = finalPath(root);
    fsProbe.openCalls = [];
    expect(await publish(root)).toStrictEqual({ status: "STORED_ARTIFACT_CORRUPT", detail: "lstat failed (EIO)" });
    expect(finalReads(root)).toBe(0);
  });

  it("EEXIST + truncated regular file is a regular different-bytes CONFLICT at publication, CORRUPT on the read path", async () => {
    const root = freshRoot();
    await publish(root);
    writeFileSync(finalPath(root), ART.bytes.slice(0, 40));
    expect(await publish(root)).toMatchObject({ status: "STORE_EXISTS_CONFLICT" });
    expect(await verify(root)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
  });
});

describe("hard-link errno classification is unchanged from E6 (category 23)", () => {
  const UNSUPPORTED = ["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"];
  const OPERATIONAL = ["EPERM", "EACCES", "EINVAL", "EROFS", "ENOENT", "EXDEV", "EUNKNOWNCODE"];

  it("classifier: EEXIST -> existing-target validation; only reliable unsupported codes are STORE_UNSUPPORTED", () => {
    expect(classifyInterchangeLinkFailure(Object.assign(new Error("x"), { code: "EEXIST" }))).toBe("EXISTS");
    expect(classifyInterchangeLinkFailure(new Error("no code"))).toBe("OPERATIONAL");
    expect(classifyInterchangeLinkFailure(null)).toBe("OPERATIONAL");
    for (const code of [...UNSUPPORTED, ...OPERATIONAL]) {
      expect(classifyInterchangeLinkFailure(Object.assign(new Error(code), { code })), code).toBe(UNSUPPORTED.includes(code) ? "STORE_UNSUPPORTED" : "OPERATIONAL");
    }
  });

  it("end to end: unsupported codes return STORE_UNSUPPORTED, others propagate; no final file, temp removed, never CORRUPT", async () => {
    for (const code of [...UNSUPPORTED, ...OPERATIONAL]) {
      const root = freshRoot();
      fsProbe.linkFailWith = code;
      const attempt = publish(root);
      if (UNSUPPORTED.includes(code)) expect(await attempt, code).toStrictEqual({ status: "STORE_UNSUPPORTED", detail: `hard link unavailable (${code})` });
      else await expect(attempt, code).rejects.toMatchObject({ code });
      fsProbe.linkFailWith = null;
      expect(existsSync(finalPath(root)), code).toBe(false);
      expect(listing(root), code).toStrictEqual([]);
    }
  });
});

describe("direct stored-artifact read path (category 23, Step 1120 section 6)", () => {
  it("a regular file with the identity's exact bytes is VERIFIED", async () => {
    const root = freshRoot();
    await publish(root);
    expect(await verify(root)).toStrictEqual({ status: "VERIFIED", relativePath: RELATIVE });
  });

  it("missing, different, truncated, directory, junction or unreadable stored artifacts are STORED_ARTIFACT_CORRUPT", async () => {
    const missing = freshRoot();
    expect(await verify(missing)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    const different = freshRoot();
    await publish(different);
    expect(await verify(different, serialized(-900).bytes)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    writeFileSync(finalPath(different), ART.bytes.slice(0, ART.bytes.length - 1));
    expect(await verify(different)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    const directory = freshRoot();
    mkdirSync(finalPath(directory), { recursive: true });
    expect(await verify(directory)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT", detail: "final entry is not a regular file" });
    const junction = freshRoot();
    mkdirSync(join(junction, "elsewhere"));
    mkdirSync(interchangeDirectoryPath(junction, EP), { recursive: true });
    symlinkSync(join(junction, "elsewhere"), finalPath(junction), "junction");
    expect(await verify(junction)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    const unreadable = freshRoot();
    await publish(unreadable);
    fsProbe.openFailFor = finalPath(unreadable);
    expect(await verify(unreadable)).toStrictEqual({ status: "STORED_ARTIFACT_CORRUPT", detail: "final entry could not be opened (EACCES)" });
  });

  it("a file symlink to equal bytes is STORED_ARTIFACT_CORRUPT on the read path", async (ctx) => {
    const root = freshRoot();
    const target = join(root, "equal.otio");
    writeFileSync(target, ART.bytes);
    mkdirSync(interchangeDirectoryPath(root, EP), { recursive: true });
    if (!trySymlinkFile(target, finalPath(root))) return ctx.skip();
    expect(await verify(root)).toMatchObject({ status: "STORED_ARTIFACT_CORRUPT" });
    expect(finalReads(root)).toBe(0);
  });
});

describe("test-only composition: pure serialization -> bytes-only store (n1118-3)", () => {
  it("serialized bytes publish at the identity path, verify, and never record the media root", async () => {
    const root = freshRoot();
    const out = serialized();
    const result = await publishEditorialInterchangeArtifact({ mediaRoot: root, episodeId: EP, exportIdentitySha256: out.exportIdentitySha256, bytes: out.bytes });
    expect(result).toStrictEqual({ status: "PUBLISHED", relativePath: interchangeArtifactRelativePath(EP, out.exportIdentitySha256) });
    expect(await verifyEditorialInterchangeArtifact({ mediaRoot: root, episodeId: EP, exportIdentitySha256: out.exportIdentitySha256, expectedBytes: serialized().bytes }))
      .toMatchObject({ status: "VERIFIED" });
    const stored = readFileSync(interchangeArtifactPath(root, EP, out.exportIdentitySha256), "utf8");
    expect(stored).not.toContain(root);
    expect(stored).not.toContain(root.replace(/\\/g, "/"));
    expect(stored).not.toContain("exports/");
  });
});
