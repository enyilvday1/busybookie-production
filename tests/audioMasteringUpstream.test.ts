import { describe, expect, it } from "vitest";
import { buildEpisodeRoughCutFfmpegCommand } from "../src/composition/buildEpisodeRoughCutFfmpegCommand.js";
import { buildEditorialEditFfmpegCommand } from "../src/editorial/buildEditorialEditFfmpegCommand.js";
import { buildEditorialMixFfmpegCommand } from "../src/editorial/buildEditorialMixFfmpegCommand.js";
import { planEditorialRenderV3 } from "../src/editorial/buildEditorialMixRenderPlan.js";
import { buildEditorialPlanV3 } from "../src/editorial/buildEditorialPlanV3.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { hashEditorialPlanV2 } from "../src/editorial/canonicalizeEditorialPlanV2.js";
import {
  checkAudioMasteringUpstreamArgv, checkedAddFrames, checkedFramesToSamples, checkUpstreamRecordBinding, deriveAudioMasteringUpstream,
  E2_ARGV_FIXED_TOKEN_COUNT, expectedE2UpstreamArgs, upstreamMatchesDerivation, validateE5UpstreamRenderAuthorityV1,
  type E5UpstreamDerivation,
} from "../src/editorial/deriveAudioMasteringUpstream.js";
import { deriveEditorialTimeline } from "../src/editorial/deriveEditorialTimeline.js";
import { assertEditorialEditRenderPreflight, type EditorialEditRenderPreflightResult } from "../src/editorial/editorialEditRenderPreflight.js";
import { assertEditorialMixRenderPreflight } from "../src/editorial/editorialMixRenderPreflight.js";
import type { EditorialPlanV2 } from "../src/editorial/editorialPlanV2.schema.js";
import { migrateEditorialPlanV2ToV3 } from "../src/editorial/migrateEditorialPlanV3.js";
import { validateEditorialPlanV2 } from "../src/editorial/validateEditorialPlanV2.js";

// Local, in-memory fixtures only (repeated per E5 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
const MEDIA_ROOT = "D:/Busybookie/Production";
const SHA = (c: string) => c.repeat(64);
function basePlan(frames: readonly number[] = [100, 100], dissolves: readonly number[] = []): EditorialPlanV2 {
  const episodeId = "EP02";
  const ids = frames.map((_, i) => `S${String(i + 1).padStart(2, "0")}`);
  const edges = ids.slice(1).map((_, i) => ((dissolves[i] ?? 0) > 0
    ? { type: "CROSS_DISSOLVE" as const, overlapFrames: dissolves[i]! } : { type: "CUT" as const }));
  const ranges = frames.map((f) => ({ assetDurationFrames: f, sourceInFrame: 0, sourceOutFrame: f }));
  const timeline = deriveEditorialTimeline(ranges, edges);
  const assetId = (id: string) => `normalized:${episodeId}:${id}`;
  return validateEditorialPlanV2({
    schemaVersion: "2.0", planType: "BUSYBOOKIE_EDITORIAL_PLAN",
    episode: { episodeId, title: "Synthetic episode", manifestSha256: SHA("e") }, editorialDecisionsSha256: null,
    profile: { profileId: "busybookie-master-v1", aspectRatio: "16:9", width: 1920, height: 1080, frameRate: { numerator: 25, denominator: 1 },
      audioSampleRateHz: 48000, audioChannels: 2, audioChannelLayout: "stereo" },
    timelineDurationFrames: timeline.timelineDurationFrames,
    shots: ids.map((id, i) => ({ shotId: id, sceneId: "SC01", order: i + 1, title: `Shot ${i + 1}`, assetId: assetId(id) })),
    assets: ids.map((id, i) => {
      const cacheKey = SHA(String(i % 10));
      return { assetId: assetId(id), kind: "NORMALIZED_SHOT", sha256: SHA(String((i + 3) % 10)), bytes: 200, contentType: "video/mp4",
        mediaRootRelativePath: `cache/composition-normalized/${episodeId}/${id}/${episodeId}_${id}_${cacheKey}.mp4`,
        normalization: { schemaVersion: "1.0", profileId: "busybookie-master-normalization-v1", cacheKey },
        generatedSource: { provider: "VEO", providerExecutionId: `task-${i}`, sourceSha256: SHA("1"), sourceBytes: 100, sourceContentType: null },
        assetDurationFrames: frames[i]! };
    }),
    tracks: [
      { trackId: "V1", kind: "VIDEO", clips: ids.map((id, i) => ({ clipId: `V1-${id}`, shotId: id, assetId: assetId(id),
        sourceInFrame: 0, sourceOutFrame: frames[i]!, timelineStartFrame: timeline.video[i]!.timelineStartFrame })) },
      { trackId: "A1", kind: "SHOT_AUDIO", clips: ids.map((id, i) => ({ clipId: `A1-${id}`, shotId: id, assetId: assetId(id),
        sourceInFrame: timeline.audio[i]!.sourceInFrame, sourceOutFrame: timeline.audio[i]!.sourceOutFrame,
        timelineStartFrame: timeline.audio[i]!.timelineStartFrame, linkedClipId: `V1-${id}`, audio: { mode: "PRESERVE_NATIVE" } })) },
    ],
    transitions: edges.map((edge, i) => ({ outgoingClipId: `V1-${ids[i]}`, incomingClipId: `V1-${ids[i + 1]}`, ...edge })),
  });
}
const e2Plan = (frames: readonly number[] = [100, 100]) => migrateEditorialPlanV2ToV3(basePlan(frames));
const e3Plan = () => migrateEditorialPlanV2ToV3(basePlan([100, 100], [10]));
function e4Plan(bedGainCentiDb = -600) {
  const base = basePlan();
  return buildEditorialPlanV3({ basePlan: base, externalAudioAssets: [], audioMixDecisions: { schemaVersion: "1.0",
    decisionsType: "BUSYBOOKIE_AUDIO_MIX_DECISIONS", sourceBinding: { baseEditorialPlanSha256: hashEditorialPlanV2(base), externalAudioAssets: [] },
    bed: { bedGainCentiDb, bedMuted: false }, layers: [] } });
}
type Upstream = { args: string[]; e3Preflight?: EditorialEditRenderPreflightResult; e4Receipt?: unknown };
function upstreamFor(plan: unknown): Upstream {
  const route = planEditorialRenderV3({ plan, mediaRoot: MEDIA_ROOT });
  if (route.route === "E2_ROUGH_CUT") {
    return { args: [...buildEpisodeRoughCutFfmpegCommand({ ffmpegExecutable: "ffmpeg", plan: route.renderPlan, outputPath: route.renderPlan.outputPath }).args] };
  }
  if (route.route === "E3_EDIT") {
    const rp = route.renderPlan;
    const e3Preflight = assertEditorialEditRenderPreflight({ renderPlan: rp, evidence: rp.inputs.map((e) => ({ assetId: e.assetId,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 })) });
    return { args: [...buildEditorialEditFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: rp, preflight: e3Preflight, outputPath: rp.outputPath }).args], e3Preflight };
  }
  const rp = route.renderPlan;
  const e4Receipt = assertEditorialMixRenderPreflight({ renderPlan: rp, outputPath: rp.outputPath, externalEvidence: [],
    baseEvidence: rp.inputs.flatMap((e) => (e.mediaKind === "NORMALIZED_SHOT" ? [{ assetId: e.assetId, sha256: e.sha256, bytes: e.bytes,
      decodedVideoFrameCount: e.assetDurationFrames, decodedAudioSampleCount: e.assetDurationFrames * 1920 }] : [])),
    peakEvidence: { renderKey: rp.renderKey, mixGraphSha256: rp.mixGraphSha256, channelCount: 2, decodedSampleFrameCount: rp.timelineDurationSamples,
      nonFiniteSampleCount: 0, maxAbsSampleF32Bits: 0x3f000000 } });
  return { args: [...buildEditorialMixFfmpegCommand({ ffmpegExecutable: "ffmpeg", renderPlan: rp, receipt: e4Receipt, outputPath: rp.outputPath }).args], e4Receipt };
}
function derive(plan: unknown): E5UpstreamDerivation {
  const result = deriveAudioMasteringUpstream({ plan, mediaRoot: MEDIA_ROOT });
  if (!result.ok) throw new Error(`not masterable: ${result.reasons.join(",")}`);
  return result.derivation;
}
const tOf = (args: readonly string[]) => args[args.indexOf("-t") + 1];
function argvCheck(derivation: E5UpstreamDerivation, up: Upstream, args: readonly unknown[] = up.args) {
  return checkAudioMasteringUpstreamArgv({ derivation, args,
    ...(up.e3Preflight === undefined ? {} : { e3Preflight: up.e3Preflight }), ...(up.e4Receipt === undefined ? {} : { e4Receipt: up.e4Receipt }) });
}

describe("E5 upstream authority: three members", () => {
  it("T5-21 E2, E3 and E4 plans derive exactly one member each; E3/E4 identities verbatim; no fake E4 identity", () => {
    const e2 = derive(e2Plan());
    const e3 = derive(e3Plan());
    const e4 = derive(e4Plan());
    expect([e2.route, e3.route, e4.route]).toStrictEqual(["E2_ROUGH_CUT", "E3_EDIT", "E4_MIX"]);
    expect(Object.keys(e2.upstream).sort()).toStrictEqual(["renderIdentityParts", "renderKey", "renderProfileId", "route", "timelineDurationSamples"]);
    expect(e2.upstream).not.toHaveProperty("renderIdentity");
    if (e3.route !== "E3_EDIT" || e3.upstream.route !== "E3_EDIT") throw new Error("route");
    expect(canonicalEditorialJson(e3.upstream.renderIdentity)).toBe(canonicalEditorialJson(e3.renderPlan.renderIdentity));
    expect(e3.upstream.renderIdentity.identityType).toBe("BUSYBOOKIE_E3_RENDER_IDENTITY");
    if (e4.route !== "E4_MIX" || e4.upstream.route !== "E4_MIX") throw new Error("route");
    expect(canonicalEditorialJson(e4.upstream.renderIdentity)).toBe(canonicalEditorialJson(e4.renderPlan.renderIdentity));
    expect(e4.upstream.mixGraphSha256).toBe(e4.renderPlan.mixGraphSha256);
    for (const derivation of [e2, e3, e4]) {
      expect(validateE5UpstreamRenderAuthorityV1(derivation.upstream)).toStrictEqual(derivation.upstream);
      expect(derivation.timelineDurationSamples).toBe(derivation.timelineDurationFrames * 1920);
    }
    expect([e2.videoTerminal, e2.audioTerminal, e3.videoTerminal, e3.audioTerminal, e4.videoTerminal, e4.audioTerminal])
      .toStrictEqual(["[v]", "[a]", "[vout]", "[aout]", "[vout]", "[mout]"]);
  });

  it("T5-22 E2 frame-sum authority: drift fixtures are masterable, T depends only on F, -t stays real-builder bytes", () => {
    for (const [frames, F, T, text] of [
      [[7, 7, 7], 21, 40_320, "0.8400000000000001"], [[249, 2], 251, 481_920, "10.040000000000001"],
      [[26, 226], 252, 483_840, "10.079999999999998"], [[28], 28, 53_760, "1.12"], [[25, 50, 75], 150, 288_000, "6"],
    ] as const) {
      const plan = e2Plan(frames);
      const derivation = derive(plan);
      expect(derivation.timelineDurationFrames, String(frames)).toBe(F);
      expect(derivation.timelineDurationSamples, String(frames)).toBe(T);
      expect(derivation.upstream.timelineDurationSamples).toBe(T);
      const up = upstreamFor(plan);
      expect(tOf(up.args), String(frames)).toBe(text);
      expect(argvCheck(derivation, up)).toStrictEqual({ ok: true, args: up.args });
    }
  });

  it("T5-23 float text must not control T: shot order changes the -t text but never F, T or masterability", () => {
    const a = e2Plan([30, 45, 60]);
    const b = e2Plan([30, 60, 45]);
    const da = derive(a);
    const db = derive(b);
    expect(tOf(upstreamFor(a).args)).toBe("5.4");
    expect(tOf(upstreamFor(b).args)).toBe("5.3999999999999995");
    expect([da.timelineDurationFrames, db.timelineDurationFrames]).toStrictEqual([135, 135]);
    expect([da.timelineDurationSamples, db.timelineDurationSamples]).toStrictEqual([259_200, 259_200]);
    expect(da.upstream.renderKey).not.toBe(db.upstream.renderKey);
    expect(argvCheck(da, upstreamFor(a)).ok).toBe(true);
    expect(argvCheck(db, upstreamFor(b)).ok).toBe(true);
  });

  it("T5-24 E2 member integrity: parts recompute to renderKey; tampered stored members are rejected", () => {
    const derivation = derive(e2Plan([7, 7, 7]));
    if (derivation.upstream.route !== "E2_ROUGH_CUT") throw new Error("route");
    const parts = derivation.upstream.renderIdentityParts;
    expect(editorialSha256(parts.join("\n"))).toBe(derivation.upstream.renderKey);
    expect(parts[3]).toBe("0.8400000000000001");
    expect(parts.slice(6, 10)).toStrictEqual(["S01", "1", "0.28", SHA("3")]);
    const tampered = structuredClone(derivation.upstream) as AnyRecord;
    tampered.renderIdentityParts[3] = "0.84";
    expect(() => validateE5UpstreamRenderAuthorityV1(tampered)).toThrow(/renderKey/);
    const wrongT = { ...structuredClone(derivation.upstream), timelineDurationSamples: 40_320 + 1920 };
    expect(validateE5UpstreamRenderAuthorityV1(wrongT)).toBeTruthy();
    expect(upstreamMatchesDerivation(wrongT, derivation)).toBe(false);
    expect(upstreamMatchesDerivation(structuredClone(derivation.upstream), derivation)).toBe(true);
  });

  it("T5-25 checked frame accumulation and checked sample multiplication", () => {
    expect(checkedAddFrames(0, 7)).toBe(7);
    expect(checkedAddFrames(Number.MAX_SAFE_INTEGER - 5, 5)).toBe(Number.MAX_SAFE_INTEGER);
    for (const [acc, x] of [[Number.MAX_SAFE_INTEGER - 4, 5], [-1, 1], [0, 0], [0, -3], [0, 1.5], [1.5, 1], [Number.MAX_SAFE_INTEGER + 1, 1],
      [0, Number.NaN], [0, Number.POSITIVE_INFINITY]] as const) {
      expect(checkedAddFrames(acc, x), `${acc}+${x}`).toBeNull();
    }
    expect(checkedFramesToSamples(1)).toBe(1920);
    expect(checkedFramesToSamples(22_275_000)).toBe(42_768_000_000);
    expect(checkedFramesToSamples(4_691_249_611_844)).toBe(4_691_249_611_844 * 1920);
    expect(checkedFramesToSamples(4_691_249_611_845)).toBeNull();
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(checkedFramesToSamples(bad)).toBeNull();
  });
});

describe("E5 upstream argv authority", () => {
  it("T5-26 the E2 structural law equals the real E2 builder output and has length 5 + 2N + 37", () => {
    for (const frames of [[28], [7, 7, 7], [249, 2], [26, 226], [10, 20, 30, 40, 50, 60]]) {
      const plan = e2Plan(frames);
      const derivation = derive(plan);
      if (derivation.route !== "E2_ROUGH_CUT") throw new Error("route");
      const real = upstreamFor(plan).args;
      expect(expectedE2UpstreamArgs(derivation.renderPlan)).toStrictEqual(real);
      expect(real).toHaveLength(5 + 2 * frames.length + 37);
    }
    expect(E2_ARGV_FIXED_TOKEN_COUNT).toBe(42);
  });

  it("T5-27 every E2 operand is byte-bound: substitution, order, count, -t text, output, graph, maps and options", () => {
    const plan = e2Plan([7, 7, 7]);
    const derivation = derive(plan);
    const up = upstreamFor(plan);
    const at = (needle: string, offset = 1) => up.args.indexOf(needle) + offset;
    const mutate = (fn: (args: string[]) => void) => { const args = [...up.args]; fn(args); return args; };
    const firstInput = at("-i");
    const cases: Record<string, unknown[]> = {
      substitutedInput: mutate((a) => { a[firstInput] = "D:/Busybookie/Production/other.mp4"; }),
      swappedInputs: mutate((a) => { [a[firstInput], a[firstInput + 2]] = [a[firstInput + 2]!, a[firstInput]!]; }),
      missingInput: mutate((a) => { a.splice(firstInput - 1, 2); }),
      extraInput: mutate((a) => { a.splice(firstInput - 1, 0, "-i", "D:/x.mp4"); }),
      equalNumberT: mutate((a) => { a[at("-t")] = "0.84"; }),
      exponentT: mutate((a) => { a[at("-t")] = "8.400000000000001e-1"; }),
      wrongOutput: mutate((a) => { a[a.length - 1] = "D:/Busybookie/Production/exports/EP02/rough-cut/tmp.mp4"; }),
      graph: mutate((a) => { a[at("-filter_complex")] = a[at("-filter_complex")]!.replace("concat=n=3", "concat=n=2"); }),
      map: mutate((a) => { a[at("[a]", 0)] = "[aa]"; }),
      encoder: mutate((a) => { a[at("-crf")] = "17"; }),
      injected: mutate((a) => { a.splice(a.length - 1, 0, "-af", "volume=2"); }),
      trailing: [...up.args, "-y"],
      nonString: up.args.map((arg, i) => (i === 1 ? 7 : arg)),
    };
    for (const [name, args] of Object.entries(cases)) {
      expect(argvCheck(derivation, up, args), name).toStrictEqual({ ok: false, reasons: ["UPSTREAM_ARGV_MISMATCH"] });
    }
  });

  it("T5-28 E3: literal rebuild through the E3 builder; T = checked audioSegments sum = frames x 1920", () => {
    const plan = e3Plan();
    const derivation = derive(plan);
    if (derivation.route !== "E3_EDIT") throw new Error("route");
    const up = upstreamFor(plan);
    expect(argvCheck(derivation, up).ok).toBe(true);
    const segments = derivation.renderPlan.renderIdentity.audioSegments;
    expect(segments.reduce((sum, s) => sum + (s.sourceOutSample - s.sourceInSample), 0)).toBe(derivation.timelineDurationSamples);
    expect(derivation.timelineDurationSamples).toBe(190 * 1920);
    expect(argvCheck(derivation, up, up.args.map((a) => (a === "-crf" ? "-crf" : a === "18" ? "19" : a))).ok).toBe(false);
    expect(() => checkAudioMasteringUpstreamArgv({ derivation, args: up.args })).toThrow(/preflight/);
  });

  it("T5-29 E4: literal rebuild through the E4 builder with its receipt; T = identity T", () => {
    const plan = e4Plan();
    const derivation = derive(plan);
    if (derivation.route !== "E4_MIX") throw new Error("route");
    const up = upstreamFor(plan);
    expect(argvCheck(derivation, up).ok).toBe(true);
    expect(derivation.timelineDurationSamples).toBe(derivation.renderPlan.renderIdentity.timelineDurationSamples);
    const fc = up.args.indexOf("-filter_complex") + 1;
    expect(argvCheck(derivation, up, up.args.map((a, i) => (i === fc ? `${a};[mout]anull[x]` : a))).ok).toBe(false);
    expect(() => checkAudioMasteringUpstreamArgv({ derivation, args: up.args })).toThrow(/receipt/);
  });

  it("T5-30 MEASURE_ONLY upstream record binding: E2 attestation required and exact; E3/E4 have no record lifecycle", () => {
    const derivation = derive(e2Plan());
    const attestation = { route: "E2_ROUGH_CUT", renderKey: derivation.upstream.renderKey, artifactSha256: SHA("9"), artifactBytes: 5000 };
    const check = (value: unknown, sha = SHA("9"), bytes = 5000) =>
      checkUpstreamRecordBinding({ derivation, attestation: value, measuredMediaSha256: sha, measuredMediaBytes: bytes });
    expect(check(attestation)).toStrictEqual({ ok: true, binding: "E2_RENDER_RECORD_VERIFIED" });
    expect(check(null)).toStrictEqual({ ok: false, reasons: ["UPSTREAM_RECORD_MISSING"] });
    expect(check(attestation, SHA("8"))).toStrictEqual({ ok: false, reasons: ["UPSTREAM_RECORD_MISMATCH"] });
    expect(check(attestation, SHA("9"), 5001)).toStrictEqual({ ok: false, reasons: ["UPSTREAM_RECORD_MISMATCH"] });
    expect(check({ ...attestation, renderKey: SHA("0") })).toStrictEqual({ ok: false, reasons: ["UPSTREAM_RECORD_MISMATCH"] });
    expect(check({ ...attestation, extra: 1 })).toStrictEqual({ ok: false, reasons: ["UPSTREAM_RECORD_MISMATCH"] });
    for (const plan of [e3Plan(), e4Plan()]) {
      expect(checkUpstreamRecordBinding({ derivation: derive(plan), attestation: null, measuredMediaSha256: SHA("9"), measuredMediaBytes: 1 }))
        .toStrictEqual({ ok: true, binding: "NO_UPSTREAM_RECORD_LIFECYCLE" });
    }
  });
});
