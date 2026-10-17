import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import { E7InterchangeRefusal, hashInterchangeTimelineV1 } from "../src/editorial/editorialInterchangeTimeline.schema.js";
import {
  E7_OTIO_KEY_SETS, auditEditorialInterchangeOtio, buildE7InterchangeIdentityV1, findAbsolutePathLeak, hashE7InterchangeIdentityV1,
  serializeEditorialInterchangeOtio, validateE7InterchangeIdentityV1,
} from "../src/editorial/serializeEditorialInterchangeOtio.js";

// Local fixture generator (repeated per E7 test file; no shared helper path is authorized). It lays out an
// InterchangeTimelineV1 with the frozen formulas and an independent greedy lane pass; the production validator checks it.
type AnyRecord = Record<string, any>;
const SHA = (c: string) => c.repeat(64);
const shotPath = (shot: string) => `cache/composition-normalized/EP02/${shot}/EP02_${shot}_${SHA("9")}.mp4`;
type Shot = { in?: number; out?: number; frames?: number };
type Place = { slug: string; start: number; in?: number; out: number; o?: AnyRecord };
function timeline(shots: Shot[], edges: number[], places: Place[] = [], mastering: AnyRecord | null = null): AnyRecord {
  const n = shots.length;
  const ids = shots.map((_, i) => `S${String(i + 1).padStart(2, "0")}`);
  const sel = shots.map((s) => ({ frames: s.frames ?? 100, i: s.in ?? 0, o: s.out ?? s.frames ?? 100 }));
  const starts: number[] = [];
  let cursor = 0;
  sel.forEach((x, k) => { starts.push(cursor); if (k < n - 1) cursor += x.o - x.i - edges[k]!; });
  const a = (k: number) => (k > 0 ? Math.floor(edges[k - 1]! / 2) : 0);
  const b = (k: number) => (k < n - 1 ? Math.ceil(edges[k]! / 2) : 0);
  const clips = ids.map((id, k) => ({ clipId: `V1-${id}`, shotId: id, sceneId: "SC01", assetId: `normalized:EP02:${id}`, assetSha256: SHA("d"),
    mediaRootRelativePath: shotPath(id), assetDurationFrames: sel[k]!.frames, selectedSourceInFrame: sel[k]!.i, selectedSourceOutFrame: sel[k]!.o,
    timelineStartFrame: starts[k]!, nominalSourceInFrame: sel[k]!.i + a(k), nominalSourceOutFrame: sel[k]!.o - b(k), nominalTimelineStartFrame: starts[k]! + a(k) }));
  const transitions = edges.flatMap((t, k) => (t === 0 ? [] : [{ transitionId: `transition:V1-${ids[k]}>V1-${ids[k + 1]}`, type: "CROSS_DISSOLVE",
    outgoingClipId: `V1-${ids[k]}`, incomingClipId: `V1-${ids[k + 1]}`, overlapFrames: t, cutFrame: starts[k + 1]! + Math.floor(t / 2),
    inOffsetFrames: Math.floor(t / 2), outOffsetFrames: Math.ceil(t / 2), blendProfile: "busybookie-edit-v1-j-over-t" }]));
  const audio = clips.map((c) => ({ clipId: `A1-${c.shotId}`, linkedClipId: c.clipId, assetId: c.assetId, assetSha256: c.assetSha256,
    mediaRootRelativePath: c.mediaRootRelativePath, assetDurationSamples: c.assetDurationFrames * 1920, audioMode: "PRESERVE_NATIVE", dialoguePlanKey: null,
    audioKey: null, sourceInSample: c.nominalSourceInFrame * 1920, sourceOutSample: c.nominalSourceOutFrame * 1920, timelineStartSample: c.nominalTimelineStartFrame * 1920 }));
  const placements = places.map((p) => ({ layerId: `layer:${p.slug}`, role: "MUSIC", assetId: `audio:${p.slug}`, assetSha256: SHA("a"),
    mediaRootRelativePath: `music/${p.slug}.wav`, assetDurationSamples: 96_000, channelCount: 2, sourceInSample: p.in ?? 0, sourceOutSample: p.out,
    timelineStartSample: p.start, timelineEndSample: p.start + p.out - (p.in ?? 0), gainCentiDb: 0, muted: false, fadeInSamples: 0, fadeOutSamples: 0, ...p.o }));
  const order = [...placements].sort((x, y) => x.timelineStartSample - y.timelineStartSample || x.timelineEndSample - y.timelineEndSample ||
    (x.layerId < y.layerId ? -1 : x.layerId > y.layerId ? 1 : 0));
  const ends: number[] = [];
  const lanes: AnyRecord[][] = [];
  for (const p of order) {
    let lane = ends.findIndex((end) => end <= p.timelineStartSample);
    if (lane < 0) { lane = ends.length; ends.push(0); lanes.push([]); }
    ends[lane] = p.timelineEndSample;
    lanes[lane]!.push(p);
  }
  return {
    interchangeTimelineVersion: "busybookie-interchange-timeline-v1", timelineId: `busybookie-timeline:${SHA("2")}`,
    episode: { episodeId: "EP02", manifestSha256: SHA("e") },
    provenance: { subjectSha256: SHA("1"), revisionNumber: 1, revisionSha256: SHA("2"), approval: "GENESIS_DECLARED", appliedProposalSha256: null,
      approvalReviewSha256: null, decisionStateSha256: SHA("3"), planSha256: SHA("4"), upstreamRoute: "E4_MIX", upstreamRenderKey: SHA("5"),
      masteringRenderKey: mastering?.masteringRenderKey ?? null, preMasterEvidenceSha256: mastering?.preMasterEvidenceSha256 ?? null,
      editorialDecisionsSha256: SHA("6"), audioMixDecisionsSha256: SHA("7"), manifestSha256: SHA("e") },
    rates: { videoFrameRate: { numerator: 25, denominator: 1 }, audioSampleRateHz: 48_000, samplesPerFrame: 1_920 },
    timelineDurationFrames: starts[n - 1]! + sel[n - 1]!.o - sel[n - 1]!.i,
    video: { trackId: "V1", clips, transitions },
    shotAudio: { trackId: "A1", bed: { bedGainCentiDb: -600, bedMuted: false }, clips: audio },
    externalAudio: { lanes: lanes.map((items, laneIndex) => ({ laneIndex, trackId: `AX${laneIndex}`, placements: items })) },
    mastering,
  };
}
// FULL: S01 [0,100) -D3-> S02 [10,90) -CUT-> S03 [5,100); S2 = 97, S3 = 177, duration 272.
// Lanes: AX0 a [0,48000), c [48000,49001), d [100003,101003) (muted); AX1 b [24000,54000).
const FULL_PLACES: Place[] = [
  { slug: "a", start: 0, out: 48_000, o: { gainCentiDb: -300, fadeInSamples: 4_800 } },
  { slug: "b", start: 24_000, out: 30_000, o: { role: "SFX", channelCount: 1, assetDurationSamples: 30_000, mediaRootRelativePath: "sfx/b.wav" } },
  { slug: "c", start: 48_000, in: 7, out: 1_008 },
  { slug: "d", start: 100_003, out: 1_000, o: { role: "AMBIENCE", mediaRootRelativePath: "ambience/d.wav", gainCentiDb: -9_600, muted: true, fadeInSamples: 2, fadeOutSamples: 100 } },
];
const MEASURE = { mode: "MEASURE_ONLY", masteringDecisionsSha256: SHA("8"), policyId: "audio-delivery:test-episode", policySha256: SHA("b"),
  masteringRenderKey: null, preMasterEvidenceSha256: null };
const full = () => timeline([{}, { in: 10, out: 90 }, { in: 5 }], [3, 0], FULL_PLACES, MEASURE);

function bytesOf(t: unknown, extra: AnyRecord = {}): Uint8Array {
  const out = serializeEditorialInterchangeOtio({ timeline: t, ...extra });
  if (!out.ok) throw new Error(JSON.stringify(out));
  return out.bytes;
}
const textOf = (t: unknown) => new TextDecoder().decode(bytesOf(t));
const otioOf = (t: unknown): AnyRecord => JSON.parse(textOf(t));
const reasonOf = (input: AnyRecord) => { const out = serializeEditorialInterchangeOtio(input as any); return out.ok ? "OK" : out.reason; };
const tracks = (o: AnyRecord): AnyRecord[] => o.tracks.children;
const track = (o: AnyRecord, name: string): AnyRecord => tracks(o).find((t) => t.name === name)!;
function objects(node: unknown, inMetadata = false, out: AnyRecord[] = []): AnyRecord[] {
  if (Array.isArray(node)) { for (const item of node) objects(item, inMetadata, out); return out; }
  if (node === null || typeof node !== "object") return out;
  const record = node as AnyRecord;
  if (!inMetadata && typeof record.OTIO_SCHEMA === "string") out.push(record);
  for (const [key, child] of Object.entries(record)) objects(child, inMetadata || key === "metadata", out);
  return out;
}
const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value });
const range = (start: number, duration: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(duration, rate) });

describe("busybookie-otio-v1 exact profile (category 22, AC7-22)", () => {
  // Expected key sets written independently of the production constant (Step 1121 OTIO_FIELD_AUDIT).
  const KEYS: Record<string, string[]> = {
    "Timeline.1": ["OTIO_SCHEMA", "global_start_time", "metadata", "name", "tracks"],
    "Stack.1": ["OTIO_SCHEMA", "children", "color", "effects", "enabled", "markers", "metadata", "name", "source_range"],
    "Track.1": ["OTIO_SCHEMA", "children", "color", "effects", "enabled", "kind", "markers", "metadata", "name", "source_range"],
    "Clip.2": ["OTIO_SCHEMA", "active_media_reference_key", "color", "effects", "enabled", "markers", "media_references", "metadata", "name", "source_range"],
    "Transition.1": ["OTIO_SCHEMA", "in_offset", "metadata", "name", "out_offset", "transition_type"],
    "ExternalReference.1": ["OTIO_SCHEMA", "available_image_bounds", "available_range", "metadata", "name", "target_url"],
    "Gap.1": ["OTIO_SCHEMA", "color", "effects", "enabled", "markers", "metadata", "name", "source_range"],
    "TimeRange.1": ["OTIO_SCHEMA", "duration", "start_time"],
    "RationalTime.1": ["OTIO_SCHEMA", "rate", "value"],
  };

  it("emits exactly the 9 pinned schema tags, never MissingReference or the legacy media_reference key", () => {
    const o = otioOf(full());
    expect([...new Set(objects(o).map((x) => x.OTIO_SCHEMA))].sort()).toStrictEqual(Object.keys(KEYS).sort());
    expect(auditEditorialInterchangeOtio(o).sort()).toStrictEqual(Object.keys(KEYS).sort());
    const text = textOf(full());
    expect(text).not.toContain("MissingReference");
    expect(text).not.toContain('"media_reference"');
    expect(E7_OTIO_KEY_SETS).toStrictEqual(KEYS);
  });

  it("every emitted object carries exactly its frozen key set", () => {
    for (const object of objects(otioOf(full()))) expect(Object.keys(object).sort(), object.OTIO_SCHEMA).toStrictEqual(KEYS[object.OTIO_SCHEMA]);
  });

  it("fixed values: Timeline, Stack, Track, Clip, Transition, ExternalReference and Gap", () => {
    const o = otioOf(full());
    expect([o.name, o.global_start_time]).toStrictEqual(["EP02", null]);
    const { children: _c, ...stack } = o.tracks;
    expect(stack).toStrictEqual({ OTIO_SCHEMA: "Stack.1", metadata: {}, name: "tracks", source_range: null, effects: [], markers: [], enabled: true, color: null });
    for (const object of objects(o)) {
      if (["Track.1", "Clip.2", "Gap.1"].includes(object.OTIO_SCHEMA)) {
        expect([object.effects, object.markers, object.enabled, object.color], object.name).toStrictEqual([[], [], true, null]);
      }
      if (object.OTIO_SCHEMA === "Track.1") expect(object.source_range).toBeNull();
      if (object.OTIO_SCHEMA === "Clip.2") {
        expect(object.active_media_reference_key).toBe("DEFAULT_MEDIA");
        expect(Object.keys(object.media_references)).toStrictEqual(["DEFAULT_MEDIA"]);
      }
      if (object.OTIO_SCHEMA === "Transition.1") expect(object.transition_type).toBe("SMPTE_Dissolve");
      if (object.OTIO_SCHEMA === "ExternalReference.1" || object.OTIO_SCHEMA === "Gap.1") expect([object.metadata, object.name]).toStrictEqual([{}, ""]);
      if (object.OTIO_SCHEMA === "ExternalReference.1") expect(object.available_image_bounds).toBeNull();
    }
  });

  it("Track name = trackId and kind per trackId, in order V1, A1, AX0..AXn", () => {
    const o = otioOf(full());
    expect(tracks(o).map((t) => [t.name, t.kind])).toStrictEqual([["V1", "Video"], ["A1", "Audio"], ["AX0", "Audio"], ["AX1", "Audio"]]);
    expect(tracks(o).map((t) => t.metadata.busybookie)).toStrictEqual([{ trackId: "V1", role: "VIDEO" },
      { trackId: "A1", role: "SHOT_AUDIO", bed: { bedGainCentiDb: -600, bedMuted: false } },
      { trackId: "AX0", role: "EXTERNAL_AUDIO_LANE", laneIndex: 0 }, { trackId: "AX1", role: "EXTERNAL_AUDIO_LANE", laneIndex: 1 }]);
  });

  it("eleven overlapping layers produce AX0..AX10 with unpadded decimal names", () => {
    const places = Array.from({ length: 11 }, (_, i) => ({ slug: `l${String(i).padStart(2, "0")}`, start: 0, out: 1_000 }));
    const o = otioOf(timeline([{}], [], places));
    expect(tracks(o).map((t) => t.name)).toStrictEqual(["V1", "A1", "AX0", "AX1", "AX2", "AX3", "AX4", "AX5", "AX6", "AX7", "AX8", "AX9", "AX10"]);
    expect(track(o, "AX10").children.map((c: AnyRecord) => c.name)).toStrictEqual(["layer:l10"]);
    expect(track(o, "AX10").metadata.busybookie.laneIndex).toBe(10);
  });

  it("all numbers are JSON integers; every RationalTime rate is 25 (video) or 48000 (audio)", () => {
    const o = otioOf(full());
    const text = textOf(full());
    expect(text).not.toMatch(/[0-9]\.[0-9]/);
    for (const time of objects(o).filter((x) => x.OTIO_SCHEMA === "RationalTime.1")) {
      expect([25, 48_000]).toContain(time.rate);
      expect(Number.isSafeInteger(time.value)).toBe(true);
    }
    for (const object of objects(track(o, "V1"))) if (object.OTIO_SCHEMA === "RationalTime.1") expect(object.rate).toBe(25);
    for (const name of ["A1", "AX0", "AX1"]) for (const object of objects(track(o, name))) if (object.OTIO_SCHEMA === "RationalTime.1") expect(object.rate, name).toBe(48_000);
  });

  it("the audit rejects any extra key, foreign schema or non-namespaced metadata", () => {
    const base = otioOf(full());
    const refusal = (edit: (o: AnyRecord) => void) => {
      const o = structuredClone(base);
      edit(o);
      try { auditEditorialInterchangeOtio(o); return "OK"; } catch (cause) { return cause instanceof E7InterchangeRefusal ? cause.reason : "THROW"; }
    };
    expect(refusal(() => undefined)).toBe("OK");
    expect(refusal((o) => { o.tracks.children[0].children[0].media_reference = {}; })).toBe("SERIALIZATION_INVALID");
    expect(refusal((o) => { o.tracks.children[0].children.push({ OTIO_SCHEMA: "Marker.2" }); })).toBe("SERIALIZATION_INVALID");
    expect(refusal((o) => { o.tracks.children[0].children[0].media_references.DEFAULT_MEDIA.OTIO_SCHEMA = "MissingReference.1"; })).toBe("SERIALIZATION_INVALID");
    expect(refusal((o) => { o.metadata.other = {}; })).toBe("SERIALIZATION_INVALID");
    expect(refusal((o) => { o.tracks.children[0].children[0].media_references.ALT = o.tracks.children[0].children[0].media_references.DEFAULT_MEDIA; })).toBe("SERIALIZATION_INVALID");
  });
});

describe("deterministic TypeScript OTIO bytes (category 22, AC7-24)", () => {
  it("20 serializations are byte-identical", () => {
    const first = bytesOf(full());
    for (let i = 0; i < 20; i += 1) expect(bytesOf(full())).toStrictEqual(first);
  });

  it("UTF-8 without BOM, recursively sorted keys, compact, exactly one trailing LF and no CR", () => {
    const bytes = bytesOf(full());
    expect([bytes[0], bytes[1], bytes[2]]).not.toStrictEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(bytes);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.indexOf("\n")).toBe(text.length - 1);
    expect(text).not.toContain("\r");
    expect(`${canonicalEditorialJson(JSON.parse(text))}\n`).toBe(text);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text))}\n`);
  });

  it("the same timeline built with different key insertion order yields identical bytes", () => {
    const reversed = (value: unknown): unknown => (Array.isArray(value) ? value.map(reversed) : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)])) : value);
    expect(bytesOf(reversed(full()))).toStrictEqual(bytesOf(full()));
  });

  it("timeline metadata: profile literals and interchangeTimelineSha256 over the InterchangeTimelineV1 object", () => {
    const t = full();
    const meta = otioOf(t).metadata;
    expect(Object.keys(meta)).toStrictEqual(["busybookie"]);
    expect(meta.busybookie).toStrictEqual({ metadataVersion: "busybookie-otio-metadata-v1", otioProfile: "busybookie-otio-v1",
      interchangeTimelineVersion: "busybookie-interchange-timeline-v1", interchangeTimelineSha256: hashInterchangeTimelineV1(t),
      timelineId: t.timelineId, episode: t.episode, provenance: t.provenance, rates: t.rates, mastering: MEASURE });
    expect(meta.busybookie.interchangeTimelineSha256).toBe(editorialSha256(canonicalEditorialJson(t)));
  });

  it("mastering metadata carries no QC, measurement, toolchain or path fields (AC7-19)", () => {
    const normalize = { mode: "NORMALIZE_STATIC", masteringDecisionsSha256: SHA("8"), policyId: "audio-delivery:test-episode", policySha256: SHA("b"),
      masteringRenderKey: SHA("c"), preMasterEvidenceSha256: SHA("f") };
    const meta = otioOf(timeline([{}], [], [], normalize)).metadata.busybookie;
    expect(meta.mastering).toStrictEqual(normalize);
    expect(Object.keys(meta.mastering).sort()).toStrictEqual(["masteringDecisionsSha256", "masteringRenderKey", "mode", "policyId", "policySha256", "preMasterEvidenceSha256"]);
    expect(otioOf(timeline([{}], [])).metadata.busybookie.mastering).toBeNull();
    const text = textOf(timeline([{}], [], [], normalize));
    for (const forbidden of ["loudnorm", "input_i", "toolchain", "ffmpeg", "outputPath", "Lufs\":", "truePeak"]) expect(text, forbidden).not.toContain(forbidden);
  });

  it("only metadata.busybookie is populated; every other metadata dict is empty (AC7-25)", () => {
    for (const object of objects(otioOf(full()))) {
      if (!("metadata" in object)) continue;
      const keys = Object.keys(object.metadata);
      if (["Timeline.1", "Track.1", "Clip.2", "Transition.1"].includes(object.OTIO_SCHEMA)) expect(keys, object.OTIO_SCHEMA).toStrictEqual(["busybookie"]);
      else expect(keys, object.OTIO_SCHEMA).toStrictEqual([]);
    }
  });
});

describe("export identity and profile requests (category 22, AC7-26)", () => {
  it("identity is exact; exportIdentitySha256 = SHA-256(canonical identity) and is recomputed equal", () => {
    const t = full();
    const out = serializeEditorialInterchangeOtio({ timeline: t });
    if (!out.ok) throw new Error(out.reason);
    expect(out.identity).toStrictEqual({ identityType: "BUSYBOOKIE_E7_INTERCHANGE_IDENTITY", identityVersion: "1", interchangeTimelineSha256: hashInterchangeTimelineV1(t),
      interchangeTimelineVersion: "busybookie-interchange-timeline-v1", outputFormat: "OTIO_JSON", otioProfile: "busybookie-otio-v1",
      metadataVersion: "busybookie-otio-metadata-v1", mediaReferenceMode: "RELATIVE", serialization: "CANONICAL_SORTED_COMPACT_LF_V1" });
    expect(out.exportIdentitySha256).toBe(editorialSha256(canonicalEditorialJson(out.identity)));
    expect(hashE7InterchangeIdentityV1(buildE7InterchangeIdentityV1(out.interchangeTimelineSha256))).toBe(out.exportIdentitySha256);
    expect(canonicalEditorialJson(out.identity)).not.toMatch(/[/\\]|tmp|[0-9]{4}-[0-9]{2}-[0-9]{2}/);
  });

  it("identity is sensitive to every field; a literal drift is refused as PROFILE_UNSUPPORTED", () => {
    const identity = buildE7InterchangeIdentityV1(SHA("1")) as AnyRecord;
    const base = editorialSha256(canonicalEditorialJson(identity));
    for (const key of Object.keys(identity)) {
      const changed = { ...identity, [key]: key === "interchangeTimelineSha256" ? SHA("2") : `${identity[key]}x` };
      expect(editorialSha256(canonicalEditorialJson(changed)), key).not.toBe(base);
      const reason = (() => { try { validateE7InterchangeIdentityV1(changed); return "OK"; } catch (cause) { return (cause as E7InterchangeRefusal).reason; } })();
      expect(reason, key).toBe(key === "interchangeTimelineSha256" ? "OK" : "PROFILE_UNSUPPORTED");
    }
    const extra = (() => { try { validateE7InterchangeIdentityV1({ ...identity, createdAt: "x" }); return "OK"; } catch (cause) { return (cause as E7InterchangeRefusal).reason; } })();
    expect(extra).toBe("IDENTITY_MISMATCH");
    const other = full();
    other.shotAudio.bed.bedGainCentiDb = -900;
    const a = serializeEditorialInterchangeOtio({ timeline: full() });
    const b = serializeEditorialInterchangeOtio({ timeline: other });
    expect(a.ok && b.ok && a.exportIdentitySha256 !== b.exportIdentitySha256 && a.interchangeTimelineSha256 !== b.interchangeTimelineSha256).toBe(true);
  });

  it("m1123-1: a non-string interchangeTimelineSha256 is IDENTITY_MISMATCH at runtime, never coerced", () => {
    const sha = hashInterchangeTimelineV1(full());
    const identity = buildE7InterchangeIdentityV1(sha) as AnyRecord;
    const reason = (value: unknown) => { try { validateE7InterchangeIdentityV1(value); return "OK"; } catch (cause) { return cause instanceof E7InterchangeRefusal ? cause.reason : "THROW"; } };
    // The valid string identity still validates and hashes as before.
    expect(reason({ ...identity })).toBe("OK");
    expect(validateE7InterchangeIdentityV1({ ...identity }).interchangeTimelineSha256).toBe(sha);
    expect(hashE7InterchangeIdentityV1({ ...identity })).toBe(editorialSha256(canonicalEditorialJson(identity)));
    // The exact Step 1123 exploit: a single-element array whose String() equals the valid SHA.
    expect(String([sha])).toBe(sha);
    expect(reason({ ...identity, interchangeTimelineSha256: [sha] })).toBe("IDENTITY_MISMATCH");
    expect(() => hashE7InterchangeIdentityV1({ ...identity, interchangeTimelineSha256: [sha] })).toThrow(E7InterchangeRefusal);
    // No general coercion seam: number, toString object, throwing toString object, null, boolean, String wrapper.
    for (const value of [12_345, { toString: () => sha }, { toString: () => { throw new Error("toString"); } }, null, true, Object(sha)]) {
      expect(reason({ ...identity, interchangeTimelineSha256: value }), String(typeof value)).toBe("IDENTITY_MISMATCH");
    }
  });

  it("supplied identity values must match the recomputed ones (IDENTITY_MISMATCH)", () => {
    const out = serializeEditorialInterchangeOtio({ timeline: full() });
    if (!out.ok) throw new Error(out.reason);
    expect(reasonOf({ timeline: full(), expectedInterchangeTimelineSha256: out.interchangeTimelineSha256, expectedExportIdentitySha256: out.exportIdentitySha256 })).toBe("OK");
    expect(reasonOf({ timeline: full(), expectedInterchangeTimelineSha256: SHA("0") })).toBe("IDENTITY_MISMATCH");
    expect(reasonOf({ timeline: full(), expectedExportIdentitySha256: out.interchangeTimelineSha256 })).toBe("IDENTITY_MISMATCH");
  });

  it("requested profile, format, mode or serialization other than the frozen literals is PROFILE_UNSUPPORTED", () => {
    expect(reasonOf({ timeline: full(), profile: { otioProfile: "busybookie-otio-v1", outputFormat: "OTIO_JSON", mediaReferenceMode: "RELATIVE" } })).toBe("OK");
    for (const profile of [{ otioProfile: "busybookie-otio-v2" }, { outputFormat: "FCPXML" }, { outputFormat: "AAF" }, { outputFormat: "EDL" },
      { mediaReferenceMode: "LINKED" }, { metadataVersion: "busybookie-otio-metadata-v2" }, { serialization: "PRETTY" },
      { interchangeTimelineVersion: "busybookie-interchange-timeline-v2" }, { adapter: "otio_json" }, { identityType: "BUSYBOOKIE_E7_INTERCHANGE_IDENTITY" }]) {
      expect(reasonOf({ timeline: full(), profile }), JSON.stringify(profile)).toBe("PROFILE_UNSUPPORTED");
    }
  });

  it("invalid numbers reaching the serializer are SERIALIZATION_INVALID and produce no bytes (Step 1120 section 9)", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, -0, 2 ** 53]) {
      const t = full();
      t.externalAudio.lanes[0].placements[0].gainCentiDb = bad;
      const out = serializeEditorialInterchangeOtio({ timeline: t });
      expect(out.ok ? "OK" : out.reason, String(bad)).toBe("SERIALIZATION_INVALID");
      expect("bytes" in out).toBe(false);
    }
    expect(reasonOf({ timeline: undefined })).toBe("SERIALIZATION_INVALID");
  });

  it("crafted insufficient-handle geometry is TRANSITION_HANDLE_INVALID with no bytes (AC7-13)", () => {
    const t = timeline([{}, { in: 10, out: 12 }], [3]);
    expect(t.video.clips[1].nominalSourceOutFrame - t.video.clips[1].nominalSourceInFrame).toBe(1);
    expect(reasonOf({ timeline: t })).toBe("OK");
    t.video.clips[1].selectedSourceOutFrame = 11;
    t.video.clips[1].nominalSourceOutFrame = 11;
    const out = serializeEditorialInterchangeOtio({ timeline: t });
    expect(out.ok ? "OK" : out.reason).toBe("TRANSITION_HANDLE_INVALID");
    expect("bytes" in out).toBe(false);
  });
});

describe("video mapping in OTIO (categories 7-12)", () => {
  it("CUT edges emit no Transition: V1 children are adjacent clips", () => {
    const o = otioOf(timeline([{}, {}, {}], [0, 0]));
    expect(track(o, "V1").children.map((c: AnyRecord) => [c.OTIO_SCHEMA, c.name])).toStrictEqual([["Clip.2", "V1-S01"], ["Clip.2", "V1-S02"], ["Clip.2", "V1-S03"]]);
    expect(objects(o).some((x) => x.OTIO_SCHEMA === "Transition.1")).toBe(false);
  });

  it("V1 children are clip, Transition (dissolve edges only), clip in manifest order; no Gap in V1", () => {
    const v1 = track(otioOf(full()), "V1").children as AnyRecord[];
    expect(v1.map((c) => [c.OTIO_SCHEMA, c.name])).toStrictEqual([["Clip.2", "V1-S01"], ["Transition.1", "transition:V1-S01>V1-S02"], ["Clip.2", "V1-S02"], ["Clip.2", "V1-S03"]]);
  });

  it("odd T=3, even T=4 and T=1 transitions carry floor/ceil offsets at rate 25 and blend-profile metadata only", () => {
    for (const [t, inOffset, outOffset] of [[3, 1, 2], [4, 2, 2], [1, 0, 1], [5, 2, 3]] as const) {
      const transition = track(otioOf(timeline([{}, {}], [t])), "V1").children[1] as AnyRecord;
      expect([transition.in_offset, transition.out_offset], String(t)).toStrictEqual([rt(inOffset, 25), rt(outOffset, 25)]);
      expect(transition.metadata.busybookie).toStrictEqual({ transitionId: "transition:V1-S01>V1-S02", type: "CROSS_DISSOLVE", overlapFrames: t,
        cutFrame: 100 - t + inOffset, blendProfile: "busybookie-edit-v1-j-over-t" });
    }
    const text = textOf(full());
    for (const forbidden of ["xfade", "chroma", "Custom_Transition", "weight"]) expect(text, forbidden).not.toContain(forbidden);
  });

  it("clip source_range is the nominal range; visible range with transition offsets reconstructs the selection (category 12)", () => {
    const v1 = track(otioOf(full()), "V1").children as AnyRecord[];
    const [c1, tr, c2, c3] = v1 as [AnyRecord, AnyRecord, AnyRecord, AnyRecord];
    expect([c1.source_range, c2.source_range, c3.source_range]).toStrictEqual([range(0, 98, 25), range(11, 79, 25), range(5, 95, 25)]);
    expect(c1.source_range.start_time.value).toBe(c1.metadata.busybookie.selectedSourceInFrame);
    expect(c1.source_range.start_time.value + c1.source_range.duration.value + tr.out_offset.value).toBe(c1.metadata.busybookie.selectedSourceOutFrame);
    expect(c2.source_range.start_time.value - tr.in_offset.value).toBe(c2.metadata.busybookie.selectedSourceInFrame);
    expect(c2.source_range.start_time.value + c2.source_range.duration.value).toBe(c2.metadata.busybookie.selectedSourceOutFrame);
    expect(v1.filter((c) => c.OTIO_SCHEMA === "Clip.2").reduce((n, c) => n + c.source_range.duration.value, 0)).toBe(272);
  });

  it("video clip metadata carries identity and selection only", () => {
    const c2 = track(otioOf(full()), "V1").children[2] as AnyRecord;
    expect(c2.metadata.busybookie).toStrictEqual({ clipId: "V1-S02", shotId: "S02", sceneId: "SC01", assetId: "normalized:EP02:S02", assetSha256: SHA("d"),
      mediaRootRelativePath: shotPath("S02"), selectedSourceInFrame: 10, selectedSourceOutFrame: 90, timelineStartFrame: 97 });
  });
});

describe("audio carriage in OTIO (categories 14, 17, 18, 19)", () => {
  it("A1 holds one shot-audio clip per shot (no Gap, no Transition) at nominal x 1920 samples", () => {
    const a1 = track(otioOf(full()), "A1").children as AnyRecord[];
    expect(a1.map((c) => [c.OTIO_SCHEMA, c.name])).toStrictEqual([["Clip.2", "A1-S01"], ["Clip.2", "A1-S02"], ["Clip.2", "A1-S03"]]);
    expect(a1.map((c) => c.source_range)).toStrictEqual([range(0, 98 * 1920, 48_000), range(11 * 1920, 79 * 1920, 48_000), range(5 * 1920, 95 * 1920, 48_000)]);
    expect(a1[1]!.metadata.busybookie).toStrictEqual({ clipId: "A1-S02", linkedClipId: "V1-S02", assetId: "normalized:EP02:S02", assetSha256: SHA("d"),
      mediaRootRelativePath: shotPath("S02"), audioMode: "PRESERVE_NATIVE", dialoguePlanKey: null, audioKey: null, sourceInSample: 21_120,
      sourceOutSample: 172_800, timelineStartSample: 188_160 });
  });

  it("external lanes: leading and inter-placement gaps only; touching placements get no zero gap; no trailing gap", () => {
    const o = otioOf(full());
    const shape = (name: string) => track(o, name).children.map((c: AnyRecord) =>
      (c.OTIO_SCHEMA === "Gap.1" ? ["Gap", c.source_range.duration.value] : [c.name, c.source_range.duration.value]));
    expect(shape("AX0")).toStrictEqual([["layer:a", 48_000], ["layer:c", 1_001], ["Gap", 51_002], ["layer:d", 1_000]]);
    expect(shape("AX1")).toStrictEqual([["Gap", 24_000], ["layer:b", 30_000]]);
    for (const gap of objects(o).filter((x) => x.OTIO_SCHEMA === "Gap.1")) {
      expect(gap.source_range.start_time).toStrictEqual(rt(0, 48_000));
      expect(gap.source_range.duration.value).toBeGreaterThanOrEqual(1);
    }
  });

  it("external clips keep exact sample ranges and gain/mute/fade/role metadata with exact types, muted layers included", () => {
    const [a, c, , d] = track(otioOf(full()), "AX0").children as AnyRecord[];
    expect(c!.source_range).toStrictEqual(range(7, 1_001, 48_000));
    expect(d!.metadata.busybookie).toStrictEqual({ layerId: "layer:d", role: "AMBIENCE", assetId: "audio:d", assetSha256: SHA("a"), mediaRootRelativePath: "ambience/d.wav",
      channelCount: 2, sourceInSample: 0, sourceOutSample: 1_000, timelineStartSample: 100_003, gainCentiDb: -9_600, muted: true, fadeInSamples: 2, fadeOutSamples: 100 });
    const meta = a!.metadata.busybookie;
    expect([typeof meta.gainCentiDb, typeof meta.muted, typeof meta.fadeInSamples, typeof meta.role]).toStrictEqual(["number", "boolean", "number", "string"]);
    expect([meta.gainCentiDb, meta.fadeInSamples, meta.muted]).toStrictEqual([-300, 4_800, false]);
  });

  it("ExternalReference available_range is the full asset range per medium (category 19)", () => {
    const o = otioOf(full());
    const ref = (c: AnyRecord) => c.media_references.DEFAULT_MEDIA;
    const v = track(o, "V1").children[0];
    expect(ref(v)).toStrictEqual({ OTIO_SCHEMA: "ExternalReference.1", metadata: {}, name: "", available_image_bounds: null,
      target_url: shotPath("S01"), available_range: range(0, 100, 25) });
    expect(ref(track(o, "A1").children[0]).available_range).toStrictEqual(range(0, 192_000, 48_000));
    expect(ref(track(o, "A1").children[0]).target_url).toBe(shotPath("S01"));
    expect(ref(track(o, "AX1").children[1])).toMatchObject({ target_url: "sfx/b.wav", available_range: range(0, 30_000, 48_000) });
    expect(ref(track(o, "AX0").children[0]).available_range).toStrictEqual(range(0, 96_000, 48_000));
  });
});

describe("missing or invalid canonical locators fail closed; offline determinism (category 20)", () => {
  const withLocator = (where: "video" | "audio" | "external", value: unknown, remove = false) => {
    const t = full();
    const target = where === "video" ? t.video.clips[0] : where === "audio" ? t.shotAudio.clips[0] : t.externalAudio.lanes[0].placements[0];
    if (remove) delete target.mediaRootRelativePath; else target.mediaRootRelativePath = value;
    const out = serializeEditorialInterchangeOtio({ timeline: t });
    return { reason: out.ok ? "OK" : out.reason, hasBytes: "bytes" in out };
  };

  it("missing, empty and non-string locators are MEDIA_REFERENCE_INVALID with no bytes", () => {
    for (const where of ["video", "audio", "external"] as const) {
      expect(withLocator(where, undefined, true), where).toStrictEqual({ reason: "MEDIA_REFERENCE_INVALID", hasBytes: false });
      expect(withLocator(where, ""), where).toStrictEqual({ reason: "MEDIA_REFERENCE_INVALID", hasBytes: false });
      expect(withLocator(where, 42), where).toStrictEqual({ reason: "MEDIA_REFERENCE_INVALID", hasBytes: false });
      expect(withLocator(where, null), where).toStrictEqual({ reason: "MEDIA_REFERENCE_INVALID", hasBytes: false });
    }
  });

  it("drive, UNC, absolute POSIX and URI-scheme locators are ABSOLUTE_PATH_FORBIDDEN; traversal is MEDIA_REFERENCE_INVALID", () => {
    for (const value of ["C:/media/x.wav", "\\\\nas\\share\\x.wav", "/srv/media/x.wav", "file:///srv/x.wav", "https://cdn.example/x.wav"]) {
      expect(withLocator("external", value), value).toStrictEqual({ reason: "ABSOLUTE_PATH_FORBIDDEN", hasBytes: false });
    }
    for (const value of ["music/../x.wav", "music/./x.wav", "music//x.wav", "music\\x.wav"]) {
      expect(withLocator("external", value), value).toStrictEqual({ reason: "MEDIA_REFERENCE_INVALID", hasBytes: false });
    }
  });

  it("a valid relative locator stays an ExternalReference with identical bytes whether or not the media file exists locally", () => {
    const absent = bytesOf(full());
    const root = mkdtempSync(join(tmpdir(), "busybookie-e7-offline-"));
    try {
      mkdirSync(join(root, "music"), { recursive: true });
      writeFileSync(join(root, "music", "a.wav"), new Uint8Array([1, 2, 3]));
      expect(bytesOf(full())).toStrictEqual(absent);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
    const refs = objects(otioOf(full())).filter((x) => x.OTIO_SCHEMA === "ExternalReference.1");
    expect(refs).toHaveLength(3 + 3 + 4);
  });
});

describe("absolute-path rejection in bytes (category 21, AC7-21)", () => {
  it("the byte scan flags drive, UNC, POSIX-absolute, URI and home paths", () => {
    expect(findAbsolutePathLeak('{"a":"music/x.wav"}')).toBeNull();
    expect(findAbsolutePathLeak('{"a":"C:/x"}')).toBe("drive path");
    expect(findAbsolutePathLeak('{"a":"\\\\\\\\server"}')).toBe("backslash");
    expect(findAbsolutePathLeak('{"a":"/home/u"}')).toBe("absolute POSIX or UNC path");
    expect(findAbsolutePathLeak('{"a":"//server/share"}')).toBe("absolute POSIX or UNC path");
    expect(findAbsolutePathLeak('{"a":"s3://bucket/x"}')).toBe("URI authority");
    expect(findAbsolutePathLeak('{"a":"~/x"}')).toBe("home-relative path");
  });

  it("serialized bytes contain no workstation, home, temp or repository path", () => {
    const text = textOf(full());
    expect(findAbsolutePathLeak(text)).toBeNull();
    for (const local of [tmpdir(), homedir(), process.cwd()]) {
      expect(text).not.toContain(local);
      expect(text).not.toContain(local.replace(/\\/g, "/"));
    }
    expect(text).not.toMatch(/[A-Za-z]:[\\/]|\\\\|"\/(home|Users|tmp|var|mnt)\//);
  });
});
