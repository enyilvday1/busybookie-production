import { describe, expect, it } from "vitest";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";
import {
  E7_INTERCHANGE_REASON_CODES, E7_MAX_TIMELINE_FRAMES, E7_OTIO_SCHEMAS, E7InterchangeRefusal, assignInterchangeAudioLanes,
  classifyInterchangeLocator, dissolveInOffset, dissolveOutOffset, findInterchangeJsonViolation, hashInterchangeTimelineV1,
  interchangeLaneTrackId, interchangeTransitionId, validateInterchangeTimelineV1,
} from "../src/editorial/editorialInterchangeTimeline.schema.js";

// Hand-computed InterchangeTimelineV1 (no derivation code involved): two shots, CROSS_DISSOLVE T=3 (in 1 / out 2).
//   clip 1 selected [0,100) start 0, b = 2 -> nominal [0,98) at 0; clip 2 selected [10,90) start 97, a = 1 -> nominal [11,90) at 98
//   duration 177 = 98 + 79; A1 = nominal x 1920; external lanes AX0 {a [0,48000), c [48000,49000)} AX1 {b [24000,54000)}.
type AnyRecord = Record<string, any>;
const SHA = (c: string) => c.repeat(64);
const shotPath = (shot: string) => `cache/composition-normalized/EP02/${shot}/EP02_${shot}_${SHA("9")}.mp4`;
function placement(slug: string, overrides: AnyRecord = {}): AnyRecord {
  return { layerId: `layer:${slug}`, role: "MUSIC", assetId: `audio:${slug}`, assetSha256: SHA("a"), mediaRootRelativePath: `music/${slug}.wav`,
    assetDurationSamples: 96_000, channelCount: 2, sourceInSample: 0, sourceOutSample: 48_000, timelineStartSample: 0, timelineEndSample: 48_000,
    gainCentiDb: 0, muted: false, fadeInSamples: 0, fadeOutSamples: 0, ...overrides };
}
function golden(): AnyRecord {
  return {
    interchangeTimelineVersion: "busybookie-interchange-timeline-v1", timelineId: `busybookie-timeline:${SHA("2")}`,
    episode: { episodeId: "EP02", manifestSha256: SHA("e") },
    provenance: { subjectSha256: SHA("1"), revisionNumber: 1, revisionSha256: SHA("2"), approval: "GENESIS_DECLARED", appliedProposalSha256: null,
      approvalReviewSha256: null, decisionStateSha256: SHA("3"), planSha256: SHA("4"), upstreamRoute: "E4_MIX", upstreamRenderKey: SHA("5"),
      masteringRenderKey: null, preMasterEvidenceSha256: null, editorialDecisionsSha256: SHA("6"), audioMixDecisionsSha256: SHA("7"), manifestSha256: SHA("e") },
    rates: { videoFrameRate: { numerator: 25, denominator: 1 }, audioSampleRateHz: 48_000, samplesPerFrame: 1_920 },
    timelineDurationFrames: 177,
    video: { trackId: "V1",
      clips: [
        { clipId: "V1-S01", shotId: "S01", sceneId: "SC01", assetId: "normalized:EP02:S01", assetSha256: SHA("d"), mediaRootRelativePath: shotPath("S01"),
          assetDurationFrames: 100, selectedSourceInFrame: 0, selectedSourceOutFrame: 100, timelineStartFrame: 0,
          nominalSourceInFrame: 0, nominalSourceOutFrame: 98, nominalTimelineStartFrame: 0 },
        { clipId: "V1-S02", shotId: "S02", sceneId: "SC01", assetId: "normalized:EP02:S02", assetSha256: SHA("d"), mediaRootRelativePath: shotPath("S02"),
          assetDurationFrames: 100, selectedSourceInFrame: 10, selectedSourceOutFrame: 90, timelineStartFrame: 97,
          nominalSourceInFrame: 11, nominalSourceOutFrame: 90, nominalTimelineStartFrame: 98 },
      ],
      transitions: [{ transitionId: "transition:V1-S01>V1-S02", type: "CROSS_DISSOLVE", outgoingClipId: "V1-S01", incomingClipId: "V1-S02",
        overlapFrames: 3, cutFrame: 98, inOffsetFrames: 1, outOffsetFrames: 2, blendProfile: "busybookie-edit-v1-j-over-t" }] },
    shotAudio: { trackId: "A1", bed: { bedGainCentiDb: -600, bedMuted: false },
      clips: [
        { clipId: "A1-S01", linkedClipId: "V1-S01", assetId: "normalized:EP02:S01", assetSha256: SHA("d"), mediaRootRelativePath: shotPath("S01"),
          assetDurationSamples: 192_000, audioMode: "PRESERVE_NATIVE", dialoguePlanKey: null, audioKey: null, sourceInSample: 0,
          sourceOutSample: 188_160, timelineStartSample: 0 },
        { clipId: "A1-S02", linkedClipId: "V1-S02", assetId: "normalized:EP02:S02", assetSha256: SHA("d"), mediaRootRelativePath: shotPath("S02"),
          assetDurationSamples: 192_000, audioMode: "PRESERVE_NATIVE", dialoguePlanKey: null, audioKey: null, sourceInSample: 21_120,
          sourceOutSample: 172_800, timelineStartSample: 188_160 },
      ] },
    externalAudio: { lanes: [
      { laneIndex: 0, trackId: "AX0", placements: [placement("a"),
        placement("c", { sourceOutSample: 1_000, timelineStartSample: 48_000, timelineEndSample: 49_000 })] },
      { laneIndex: 1, trackId: "AX1", placements: [placement("b", { role: "SFX", channelCount: 1, assetDurationSamples: 30_000, mediaRootRelativePath: "sfx/b.wav",
        sourceOutSample: 30_000, timelineStartSample: 24_000, timelineEndSample: 54_000 })] },
    ] },
    mastering: { mode: "MEASURE_ONLY", masteringDecisionsSha256: SHA("8"), policyId: "audio-delivery:test-episode", policySha256: SHA("b"),
      masteringRenderKey: null, preMasterEvidenceSha256: null },
  };
}
function reasonOf(input: unknown): string {
  try {
    validateInterchangeTimelineV1(input);
    return "OK";
  } catch (cause) {
    if (cause instanceof E7InterchangeRefusal) return cause.reason;
    throw cause;
  }
}
function mutated(edit: (t: AnyRecord) => void): AnyRecord {
  const t = golden();
  edit(t);
  return t;
}

describe("E7 frozen literals and reason codes", () => {
  it("has exactly the 17 frozen reason codes and the 9 pinned OTIO schema tags", () => {
    expect([...E7_INTERCHANGE_REASON_CODES]).toStrictEqual([
      "UNAPPROVED_HEAD", "HISTORY_INVALID", "STALE_AUTHORITY", "PROVENANCE_MISMATCH", "INVALID_INTERCHANGE_INPUT",
      "UNSUPPORTED_EDITORIAL_SEMANTIC", "TRANSITION_HANDLE_INVALID", "TRANSITION_MAPPING_INVALID", "AUDIO_RANGE_INVALID",
      "MEDIA_REFERENCE_INVALID", "ABSOLUTE_PATH_FORBIDDEN", "SERIALIZATION_INVALID", "PROFILE_UNSUPPORTED", "IDENTITY_MISMATCH",
      "STORE_EXISTS_CONFLICT", "STORE_UNSUPPORTED", "STORED_ARTIFACT_CORRUPT",
    ]);
    expect(new Set(E7_INTERCHANGE_REASON_CODES).size).toBe(17);
    expect([...E7_OTIO_SCHEMAS].sort()).toStrictEqual(["Clip.2", "ExternalReference.1", "Gap.1", "RationalTime.1", "Stack.1", "TimeRange.1",
      "Timeline.1", "Track.1", "Transition.1"]);
    expect(E7_OTIO_SCHEMAS).not.toContain("MissingReference.1");
  });
});

describe("InterchangeTimelineV1 validation: golden shape and hash (category 4)", () => {
  it("accepts the hand-computed golden timeline and hashes canonical JSON", () => {
    expect(reasonOf(golden())).toBe("OK");
    expect(hashInterchangeTimelineV1(golden())).toBe(editorialSha256(canonicalEditorialJson(golden())));
    expect(hashInterchangeTimelineV1(golden())).toBe(hashInterchangeTimelineV1(golden()));
  });

  it("returns a frozen copy and never trusts caller objects", () => {
    const t = validateInterchangeTimelineV1(golden());
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.video.clips[0])).toBe(true);
  });

  it("rejects unknown keys at any level (strict shape) and wrong version literals", () => {
    expect(reasonOf(mutated((t) => { t.video.clips[0].speed = 2; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.provenance.title = "x"; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.interchangeTimelineVersion = "busybookie-interchange-timeline-v2"; }))).toBe("PROFILE_UNSUPPORTED");
    expect(reasonOf(mutated((t) => { t.rates.videoFrameRate.numerator = 30; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.rates.audioSampleRateHz = 44_100; }))).toBe("SERIALIZATION_INVALID");
  });
});

describe("stable ids (category 6)", () => {
  it("id helpers follow the frozen grammars", () => {
    expect(interchangeTransitionId("V1-S01", "V1-S02")).toBe("transition:V1-S01>V1-S02");
    expect([0, 1, 9, 10, 11].map(interchangeLaneTrackId)).toStrictEqual(["AX0", "AX1", "AX9", "AX10", "AX11"]);
  });

  it("rejects ids not derived from their sources", () => {
    expect(reasonOf(mutated((t) => { t.timelineId = `busybookie-timeline:${SHA("3")}`; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[1].clipId = "V1-S03"; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.video.transitions[0].transitionId = "transition:x"; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[1].trackId = "AX01"; }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[0].placements[1].layerId = "layer:a"; }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[1].linkedClipId = "V1-S01"; }))).toBe("SERIALIZATION_INVALID");
  });

  it("rejects provenance whose approval kind, revision number and review linkage disagree", () => {
    expect(reasonOf(mutated((t) => { t.provenance.approval = "HUMAN_APPROVED"; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.provenance.revisionNumber = 2; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { Object.assign(t.provenance, { revisionNumber: 2, approval: "HUMAN_APPROVED", appliedProposalSha256: SHA("c"),
      approvalReviewSha256: SHA("f") }); }))).toBe("OK");
    expect(reasonOf(mutated((t) => { t.provenance.revisionNumber = 0; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.episode.manifestSha256 = SHA("f"); }))).toBe("SERIALIZATION_INVALID");
  });
});

describe("dissolve offsets and transition mapping (categories 8-11)", () => {
  it("reproduces the normative T=1..5 table: odd T gives the extra frame to out_offset", () => {
    const table = [1, 2, 3, 4, 5].map((t) => [t, dissolveInOffset(t), dissolveOutOffset(t)]);
    expect(table).toStrictEqual([[1, 0, 1], [2, 1, 1], [3, 1, 2], [4, 2, 2], [5, 2, 3]]);
  });

  it("swapped or wrong offsets, wrong cut frame and wrong blend profile are TRANSITION_MAPPING_INVALID", () => {
    expect(reasonOf(mutated((t) => { Object.assign(t.video.transitions[0], { inOffsetFrames: 2, outOffsetFrames: 1 }); }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.video.transitions[0].cutFrame = 99; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.video.transitions[0].blendProfile = "xfade-chroma"; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.video.transitions[0].overlapFrames = 0; }))).toBe("TRANSITION_MAPPING_INVALID");
  });

  it("an unsupported transition type is TRANSITION_MAPPING_INVALID (AC7-29)", () => {
    expect(reasonOf(mutated((t) => { t.video.transitions[0].type = "WIPE"; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.video.transitions[0].type = "CUT"; }))).toBe("TRANSITION_MAPPING_INVALID");
  });

  it("a transition that does not join adjacent clips or breaks the timeline start law is TRANSITION_MAPPING_INVALID", () => {
    expect(reasonOf(mutated((t) => { t.video.transitions[0].incomingClipId = "V1-S01"; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[1].timelineStartFrame = 98; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.video.transitions.push({ ...t.video.transitions[0] }); }))).toBe("TRANSITION_MAPPING_INVALID");
  });

  it("insufficient handles are TRANSITION_HANDLE_INVALID before any serialization (AC7-13)", () => {
    // Selected range shorter than the offsets it must carry (D = 2, a = 1, b = 0 is fine; D = 1 with a = 1 is not).
    expect(reasonOf(mutated((t) => { Object.assign(t.video.clips[1], { selectedSourceInFrame: 89, nominalSourceInFrame: 90 }); }))).toBe("TRANSITION_HANDLE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[1].selectedSourceOutFrame = 101; }))).toBe("TRANSITION_HANDLE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[0].selectedSourceInFrame = -1; }))).toBe("TRANSITION_HANDLE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[0].nominalSourceOutFrame = 99; }))).toBe("TRANSITION_HANDLE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[1].nominalTimelineStartFrame = 97; }))).toBe("TRANSITION_HANDLE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[0].assetDurationFrames = 0; }))).toBe("TRANSITION_HANDLE_INVALID");
  });

  it("timeline duration must equal both the clip geometry and the sum of nominal durations (category 13)", () => {
    expect(reasonOf(mutated((t) => { t.timelineDurationFrames = 178; }))).toBe("TRANSITION_MAPPING_INVALID");
    expect(reasonOf(mutated((t) => { t.timelineDurationFrames = 0; }))).toBe("SERIALIZATION_INVALID");
  });
});

describe("shot audio (category 14) and 48 kHz precision (category 15)", () => {
  it("A1 must equal the video nominal geometry x 1920 with contiguous hard cuts", () => {
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[1].sourceInSample = 21_121; }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[1].timelineStartSample = 188_161; }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips.pop(); }))).toBe("AUDIO_RANGE_INVALID");
  });

  it("n1121-2: assetDurationSamples must equal assetDurationFrames x 1920", () => {
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[0].assetDurationSamples = 191_999; }))).toBe("AUDIO_RANGE_INVALID");
  });

  it("dialogue keys exist exactly for REPLACE_SOURCE_WITH_DIALOGUE; unknown audio modes are unsupported (AC7-29)", () => {
    expect(reasonOf(mutated((t) => { Object.assign(t.shotAudio.clips[0], { audioMode: "REPLACE_SOURCE_WITH_DIALOGUE", dialoguePlanKey: SHA("1"), audioKey: SHA("2") }); }))).toBe("OK");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[0].audioMode = "REPLACE_SOURCE_WITH_DIALOGUE"; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[0].dialoguePlanKey = SHA("1"); }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[0].audioMode = "SPLIT_DIALOGUE_STEM"; }))).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[0].audioMode = "SYNTHETIC_SILENCE"; }))).toBe("OK");
  });

  it("non-frame-aligned external sample values are carried exactly", () => {
    const t = mutated((x) => { Object.assign(x.externalAudio.lanes[0].placements[1], { sourceInSample: 7, sourceOutSample: 1_008, timelineStartSample: 48_001, timelineEndSample: 49_002 }); });
    expect(reasonOf(t)).toBe("OK");
    expect(validateInterchangeTimelineV1(t).externalAudio.lanes[0]!.placements[1]).toMatchObject({ sourceInSample: 7, timelineEndSample: 49_002 });
  });

  it("accepts the maximum timeline (22,275,000 frames = 42,768,000,000 samples) as safe integers; rejects one more frame", () => {
    const max = E7_MAX_TIMELINE_FRAMES;
    const single = (frames: number) => mutated((t) => {
      t.video.clips = [{ ...t.video.clips[0], assetDurationFrames: frames, selectedSourceOutFrame: frames, nominalSourceOutFrame: frames }];
      t.video.transitions = [];
      t.shotAudio.clips = [{ ...t.shotAudio.clips[0], assetDurationSamples: frames * 1_920, sourceOutSample: frames * 1_920 }];
      t.timelineDurationFrames = frames;
      t.externalAudio.lanes = [{ laneIndex: 0, trackId: "AX0", placements: [placement("a", { assetDurationSamples: frames * 1_920,
        sourceInSample: 1, sourceOutSample: frames * 1_920, timelineStartSample: 1, timelineEndSample: frames * 1_920 })] }];
    });
    expect(max * 1_920).toBe(42_768_000_000);
    expect(reasonOf(single(max))).toBe("OK");
    expect(reasonOf(single(max + 1))).toBe("SERIALIZATION_INVALID");
  });
});

describe("external audio ranges and deterministic lanes (category 16)", () => {
  const lanes = (items: [string, number, number][]) => assignInterchangeAudioLanes(items.map(([layerId, startSample, endSample]) => ({ layerId, startSample, endSample })));

  it("greedy lowest-lane assignment: overlap opens a lane, touching intervals share one", () => {
    expect(lanes([["layer:a", 0, 100], ["layer:b", 50, 150], ["layer:c", 100, 200], ["layer:d", 150, 250]])).toStrictEqual([0, 1, 0, 1]);
    expect(lanes([["layer:a", 0, 10], ["layer:b", 10, 20], ["layer:c", 20, 30]])).toStrictEqual([0, 0, 0]);
    expect(lanes([])).toStrictEqual([]);
  });

  it("lane count equals maximum overlap; a freed lower lane is reused before higher lanes", () => {
    const result = lanes([["layer:a", 0, 100], ["layer:b", 0, 50], ["layer:c", 0, 200], ["layer:d", 60, 70], ["layer:e", 120, 130]]);
    expect(result).toStrictEqual([1, 0, 2, 0, 0]);
    expect(Math.max(...result) + 1).toBe(3);
  });

  it("ties sort by end then layerId in UTF-16 code-unit order (never locale order); input order is irrelevant", () => {
    const forward = lanes([["layer:b", 0, 10], ["layer:a", 0, 10], ["layer:a-2", 0, 5]]);
    expect(forward).toStrictEqual([2, 1, 0]);
    const reversed = lanes([["layer:a-2", 0, 5], ["layer:a", 0, 10], ["layer:b", 0, 10]]);
    expect(reversed).toStrictEqual([0, 1, 2]);
    // Code-unit order puts "layer:z1" before "layer:za" ('1' < 'a'), regardless of any locale collation.
    expect(lanes([["layer:za", 0, 10], ["layer:z1", 0, 10]])).toStrictEqual([1, 0]);
  });

  it("validator recomputes lanes: misassigned, unordered or overlapping lanes are AUDIO_RANGE_INVALID", () => {
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[0].placements.reverse(); }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => {
      const moved = t.externalAudio.lanes[0].placements.pop();
      t.externalAudio.lanes[1].placements.push(moved);
      t.externalAudio.lanes[1].placements.sort((x: AnyRecord, y: AnyRecord) => x.timelineStartSample - y.timelineStartSample);
    }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes.push({ laneIndex: 2, trackId: "AX2", placements: [] }); }))).toBe("AUDIO_RANGE_INVALID");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[1].laneIndex = 2; }))).toBe("AUDIO_RANGE_INVALID");
  });

  it("empty, negative, out-of-asset and out-of-timeline sample ranges are AUDIO_RANGE_INVALID", () => {
    const p = (edit: (x: AnyRecord) => void) => reasonOf(mutated((t) => edit(t.externalAudio.lanes[1].placements[0])));
    expect(p((x) => { x.sourceInSample = -1; })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { Object.assign(x, { sourceOutSample: 0, timelineEndSample: 24_000 }); })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { Object.assign(x, { sourceOutSample: 30_001, timelineEndSample: 54_001 }); })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { x.timelineEndSample = 54_001; })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { Object.assign(x, { timelineStartSample: 339_840 - 29_999, timelineEndSample: 339_841 }); })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { x.channelCount = 6; })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { x.fadeInSamples = 1; })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { x.gainCentiDb = 1_201; })).toBe("AUDIO_RANGE_INVALID");
    expect(p((x) => { x.role = "DIALOGUE"; })).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
    expect(reasonOf(mutated((t) => { t.shotAudio.bed.bedGainCentiDb = -9_601; }))).toBe("AUDIO_RANGE_INVALID");
  });
});

describe("mastering metadata boundary and unsupported semantics (AC7-19, AC7-29)", () => {
  it("mastering nullness/identity must be consistent; unknown modes are unsupported", () => {
    expect(reasonOf(mutated((t) => { t.mastering = null; }))).toBe("OK");
    expect(reasonOf(mutated((t) => { t.mastering.mode = "LIMIT_DYNAMIC"; }))).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
    expect(reasonOf(mutated((t) => { t.mastering.mode = "NORMALIZE_STATIC"; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.mastering.integratedCentiLufs = -1600; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.provenance.masteringRenderKey = SHA("c"); }))).toBe("SERIALIZATION_INVALID");
  });

  it("an extra track or unclassified top-level semantic is UNSUPPORTED_EDITORIAL_SEMANTIC, never silently dropped", () => {
    expect(reasonOf(mutated((t) => { t.video2 = { trackId: "V2", clips: [] }; }))).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
    expect(reasonOf(mutated((t) => { t.video.overlayClips = []; }))).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
    expect(reasonOf(mutated((t) => { t.shotAudio.dialogueStem = []; }))).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
    expect(reasonOf(mutated((t) => { t.externalAudio.effects = []; }))).toBe("UNSUPPORTED_EDITORIAL_SEMANTIC");
  });
});

describe("numeric and JSON-type pass (Step 1120 section 9)", () => {
  it("accepts safe integers and rejects fractional, NaN, Infinity, -0, unsafe and non-JSON values", () => {
    for (const ok of [0, 1, 25, 48_000, 42_768_000_000, -9_600]) expect(findInterchangeJsonViolation({ v: ok }), String(ok)).toBeNull();
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0, 2 ** 53, 9_007_199_254_740_993]) {
      expect(findInterchangeJsonViolation({ v: bad }), String(bad)).not.toBeNull();
    }
    expect(findInterchangeJsonViolation({ v: undefined })).not.toBeNull();
    expect(findInterchangeJsonViolation({ v: 1n })).not.toBeNull();
    expect(findInterchangeJsonViolation({ v: () => 1 })).not.toBeNull();
    expect(findInterchangeJsonViolation({ v: new Date(0) })).not.toBeNull();
    expect(findInterchangeJsonViolation(JSON.parse('{"__proto__":{"x":1}}'))).not.toBeNull();
    expect(findInterchangeJsonViolation([1, , 3])).not.toBeNull();
  });

  it("an explicit Object.is(-0) check rejects negative zero even though Number.isSafeInteger(-0) is true", () => {
    expect(Number.isSafeInteger(-0)).toBe(true);
    expect(reasonOf(mutated((t) => { t.video.clips[0].timelineStartFrame = -0; }))).toBe("SERIALIZATION_INVALID");
  });

  it("timeline numeric violations are SERIALIZATION_INVALID before any domain rule", () => {
    expect(reasonOf(mutated((t) => { t.video.clips[0].selectedSourceOutFrame = 99.5; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[0].placements[0].gainCentiDb = Number.NaN; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.timelineDurationFrames = Number.POSITIVE_INFINITY; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(mutated((t) => { t.shotAudio.clips[0].sourceOutSample = 2 ** 53; }))).toBe("SERIALIZATION_INVALID");
    expect(reasonOf(null)).toBe("SERIALIZATION_INVALID");
    expect(reasonOf([])).toBe("SERIALIZATION_INVALID");
  });
});

describe("media locators (categories 20, 21; n1121-3)", () => {
  it("valid canonical relative locators are accepted", () => {
    expect(classifyInterchangeLocator(shotPath("S01"))).toBeNull();
    expect(classifyInterchangeLocator("music/theme.wav")).toBeNull();
    expect(classifyInterchangeLocator("ambience/forest/night-rain.wav")).toBeNull();
  });

  it("absolute, drive, UNC, home and scheme forms are ABSOLUTE_PATH_FORBIDDEN, checked before generic segment rules", () => {
    for (const value of ["C:/media/a.wav", "C:\\media\\a.wav", "c:a.wav", "\\\\server\\share\\a.wav", "//server/share/a.wav", "/home/user/a.wav",
      "/tmp/a.wav", "\\media\\a.wav", "~/a.wav", "~", "file:///C:/a.wav", "https://host/a.wav", "x:y", "music:theme/a.wav", "/a/../b.wav"]) {
      expect(classifyInterchangeLocator(value), value).toBe("ABSOLUTE_PATH_FORBIDDEN");
    }
  });

  it("missing, empty, non-string, traversal, backslash, empty-segment and control-character locators are MEDIA_REFERENCE_INVALID", () => {
    for (const value of [undefined, null, "", 7, {}, "music/../a.wav", "./music/a.wav", "music/./a.wav", "music//a.wav", "music\\a.wav",
      "music/a\u0000.wav", "music/a\n.wav", "music/a.wav/"]) {
      expect(classifyInterchangeLocator(value), String(value)).toBe("MEDIA_REFERENCE_INVALID");
    }
  });

  it("timeline locators are re-checked against relative rules and the canonical grammar", () => {
    expect(reasonOf(mutated((t) => { t.video.clips[0].mediaRootRelativePath = "D:/Busybookie/Production/cache/x.mp4"; }))).toBe("ABSOLUTE_PATH_FORBIDDEN");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[0].placements[0].mediaRootRelativePath = "\\\\nas\\music\\a.wav"; }))).toBe("ABSOLUTE_PATH_FORBIDDEN");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[0].placements[0].mediaRootRelativePath = "music/../a.wav"; }))).toBe("MEDIA_REFERENCE_INVALID");
    expect(reasonOf(mutated((t) => { t.externalAudio.lanes[0].placements[0].mediaRootRelativePath = "video/a.wav"; }))).toBe("MEDIA_REFERENCE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[0].mediaRootRelativePath = "music/a.wav"; }))).toBe("MEDIA_REFERENCE_INVALID");
    expect(reasonOf(mutated((t) => { t.video.clips[0].mediaRootRelativePath = ""; }))).toBe("MEDIA_REFERENCE_INVALID");
  });
});
