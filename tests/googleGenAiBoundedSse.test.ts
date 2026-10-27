import { describe, expect, it } from "vitest";
import { GOOGLE_GENAI_ACTIVATION_LIMITS as policy } from "../src/googleGenai/googleGenAiActivationLimits.js";
import { createGoogleGenAiInteractionSseParser, rejectDuplicateGoogleGenAiJsonKeys } from "../src/googleGenai/transport/parseGoogleGenAiInteractionSse.js";
import { GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES, GoogleGenAiSecureOutputTransportError } from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";

const id = "interaction_test";
const uri = "https://generativelanguage.googleapis.com/v1beta/files/test:download?alt=media";
const encoder = new TextEncoder();
const created = { event_type: "interaction.created", interaction: { id, status: "in_progress" } };
const start = { event_type: "step.start", index: 0, step: { type: "model_output" } };
const delta = { event_type: "step.delta", index: 0, delta: { type: "video", mime_type: "video/mp4", uri } };
const stop = { event_type: "step.stop", index: 0 };
const complete = { event_type: "interaction.completed", interaction: { id, status: "completed" } };
const sequence = [created, start, delta, stop, { event_type: "interaction.status_update", interaction_id: id, status: "completed" }, complete];
type Event = { event_type: string; [key: string]: unknown };
function frame(value: Event, ending = "\n"): string {
  return `event: ${value.event_type}${ending}data: ${JSON.stringify(value)}${ending}${ending}`;
}
function parser(bytes = 4096, events = 512) {
  return createGoogleGenAiInteractionSseParser({ providerExecutionId: id, limits: { sseMaxEventBytes: bytes, sseMaxEventsPerAttempt: events } });
}
function parse(values: Event[]) {
  const p = parser();
  p.push(encoder.encode(values.map((v) => frame(v)).join("")));
  return p.finish();
}
function code(run: () => unknown, expected = "INTERACTION_REPLAY_CONTRACT_CHANGED") {
  expect(run).toThrow(expect.objectContaining({ code: expected }));
}

describe("bounded raw Interaction SSE", () => {
  it.each(["\n", "\r", "\r\n"])("supports %j and every one-byte chunk boundary", (ending) => {
    const p = parser();
    const thought = [
      created, { event_type: "step.start", index: 0, step: { type: "thought" } },
      { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "π🙂-private" } },
      { event_type: "step.delta", index: 0, delta: { type: "thought_summary", content: { type: "text", text: "summary" } } },
      { event_type: "step.stop", index: 0 },
      { ...start, index: 1 }, { ...delta, index: 1 }, { ...stop, index: 1 }, complete,
    ];
    for (const byte of encoder.encode(thought.map((v) => frame(v, ending)).join(""))) p.push(new Uint8Array([byte]));
    const result = p.finish();
    expect(result).toEqual({ id, status: "completed", outputVideo: delta.delta });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.outputVideo)).toBe(true);
    expect(Object.keys(p)).toEqual(["push", "finish"]);
    expect(JSON.stringify(result)).not.toMatch(/private|summary|event_id|event_type/);
  });

  it("allows BOM only at start, multiline data, comments and an optional discarded id", () => {
    const p = parser();
    const json = JSON.stringify(created).replace(',"interaction"', ',\n"interaction"');
    p.push(encoder.encode(`\uFEFF: comment\nid: discarded\nevent: interaction.created\ndata: ${json.split("\n")[0]}\ndata: ${json.split("\n")[1]}\n\n`));
    expect(p.finish()).toEqual({ id, status: "in_progress", outputVideo: null });
    code(() => parser().push(encoder.encode("\n\uFEFF: later\n\n")), "SSE_MALFORMED_EVENT");
  });

  it.each(["queued", "in_progress", "failed", "cancelled", "incomplete", "budget_exceeded", "requires_action"])("preserves %s without inventing output", (status) => {
    expect(parse([{ ...created, interaction: { id, status } }])).toEqual({ id, status, outputVideo: null });
  });

  it.each([
    "event: interaction.created\nevent: interaction.created\ndata: {}\n\n",
    "id: a\nid: b\nevent: interaction.created\ndata: {}\n\n",
    "retry: 5\n\n", "unknown: value\n\n", "event\n\n", "data: {}\n\n",
    "event: interaction.created\n\n", "id: only\n\n", "event: x\ndata: []\n\n",
    "event: x\ndata: 42\n\n", "event: x\ndata: null\n\n", "event: x\ndata: {\n\n",
    'event: x\ndata: {"event_type":"different"}\n\n',
    'event: x\ndata: {"event_type":"x","event_type":"x"}\n\n',
    'event: x\ndata: {"event_type":"x","\\u0065vent_type":"x"}\n\n',
    'event: x\ndata: {"event_type":"x","nested":{"a":1,"a":2}}\n\n',
    ": NUL\0\n\n",
  ])("rejects malformed framing/JSON without arbitrary text: %j", (text) => code(() => parser().push(encoder.encode(text)), "SSE_MALFORMED_EVENT"));

  it("rejects malformed UTF-8 before JSON parsing", () => {
    code(() => parser().push(new Uint8Array([58, 32, 255, 10, 10])), "SSE_MALFORMED_EVENT");
  });

  it("detects escaped key aliases with bounded iterative nesting and separate scopes", () => {
    expect(() => rejectDuplicateGoogleGenAiJsonKeys('{"x":{"a":1},"y":[{"a":2}],"q":"\\\"{["}')).not.toThrow();
    code(() => rejectDuplicateGoogleGenAiJsonKeys('{"a":1,"\\u0061":2}'), "SSE_MALFORMED_EVENT");
    expect(() => rejectDuplicateGoogleGenAiJsonKeys("[".repeat(4000) + "0" + "]".repeat(4000))).not.toThrow();
    code(() => parser().push(encoder.encode('event: x\ndata: {"event_type":"x","a":"\\q"}\n\n')), "SSE_MALFORMED_EVENT");
  });

  it.each([
    [{ event_type: "unknown" }],
    [{ ...created, interaction: { id, status: "unknown-secret" } }],
    [{ ...created, interaction: { id: "wrong", status: "in_progress" } }],
    [created, { event_type: "interaction.status_update", interaction_id: "wrong", status: "in_progress" }],
    [created, created], [start], [created, delta], [created, stop],
    [created, { ...start, index: -1 }], [created, { ...start, index: 0.5 }], [created, { ...start, index: Number.MAX_SAFE_INTEGER + 1 }],
    [created, start, start], [created, start, stop, stop], [created, start, stop, delta],
    [created, { ...start, index: 2 }, { ...stop, index: 2 }, { ...start, index: 1 }],
    [created, start, { ...delta, index: 8 }],
    [created, { ...start, step: { type: "unsupported" } }],
    [created, { ...start, step: { type: "model_output", content: [{}] } }],
    [created, { ...start, step: { type: "model_output", error: {} } }],
    [created, { ...start, step: { type: "thought" } }, delta],
    [created, { ...start, step: { type: "thought" } }, { ...delta, delta: { type: "thought_summary", content: { type: "video", uri } } }],
    [created, start, { ...delta, delta: { type: "text", text: "unsupported" } }],
    [created, start, { ...delta, delta: { ...delta.delta, mime_type: "video/webm" } }],
    [created, start, { ...delta, delta: { type: "video", mime_type: "video/mp4", data: "AAAA" } }],
    ...["AAAA", "", null].map((data) => [created, start, { ...delta, delta: { ...delta.delta, data } }]),
    [created, start, delta, delta], [created, start, delta, stop, { ...start, index: 1 }],
    [created, complete], [created, start, delta, complete],
    [created, start, delta, stop, { ...complete, interaction: { id: "wrong", status: "completed" } }],
    [created, start, delta, stop, { ...complete, interaction: { id, status: "in_progress" } }],
    [created, start, delta, stop, { ...complete, interaction: { id, status: "completed", steps: [] } }],
    [created, { event_type: "interaction.status_update", interaction_id: id, status: "queued" }],
    [created, { event_type: "interaction.status_update", interaction_id: id, status: "completed" }, { event_type: "interaction.status_update", interaction_id: id, status: "in_progress" }],
    [...sequence, complete],
  ])("fails closed on unsupported identity/status/step/output sequence %#", (...values) => code(() => parse(values as Event[])));

  it("requires a completed event and rejects truncated/open-step EOF", () => {
    const truncated = parser(); truncated.push(encoder.encode(frame(created).slice(0, -1)));
    code(() => truncated.finish(), "SSE_MALFORMED_EVENT");
    const open = parser(); open.push(encoder.encode(frame(created) + frame(start)));
    code(() => open.finish(), "SSE_MALFORMED_EVENT");
    const incomplete = parser(); incomplete.push(encoder.encode(frame(created) + frame({ event_type: "interaction.status_update", interaction_id: id, status: "completed" })));
    code(() => incomplete.finish());
    code(() => parser().finish());
  });

  it("returns a parsed terminal/action state immediately even if a prior step was open", () => {
    for (const status of ["failed", "requires_action"]) {
      const p = parser();
      const observed = p.push(encoder.encode(frame(created) + frame(start) + frame({ event_type: "interaction.status_update", interaction_id: id, status }) + "unconsumed trailing bytes"));
      expect(observed).toEqual({ id, status, outputVideo: null });
      expect(p.finish()).toEqual(observed);
    }
  });

  it("accepts a replay snapshot already marked completed only with full supported output evidence", () => {
    expect(parse([{ ...created, interaction: { id, status: "completed" } }, start, delta, stop, complete]).status).toBe("completed");
    const p = parser(); p.push(encoder.encode(sequence.map((v) => frame(v)).join("")));
    code(() => p.push(encoder.encode(frame(complete))));
  });

  it("provider error is a sanitized nonretryable machine error", () => {
    code(() => parse([{ event_type: "error", error: { message: "SECRET raw error" } }]), "SSE_PROVIDER_ERROR");
    try { parse([{ event_type: "error", error: { message: "SECRET" } }]); } catch (e) {
      expect(e).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
      expect((e as GoogleGenAiSecureOutputTransportError).retryable).toBe(false);
      expect(String(e) + JSON.stringify(e) + (e as Error).stack).not.toContain("SECRET");
    }
  });

  it("counts all raw frame bytes, including delimiters, before retention/decoding", () => {
    const cap = 32;
    expect(() => parser(cap).push(encoder.encode(":" + "x".repeat(cap - 3) + "\n\n"))).not.toThrow();
    code(() => parser(cap).push(encoder.encode(":" + "x".repeat(cap - 2) + "\n\n")), "SSE_EVENT_TOO_LARGE");
    const exact = policy.limits.sseMaxEventBytes;
    expect(exact).toBe(1048576);
    expect(() => parser(exact).push(encoder.encode(":" + "x".repeat(exact - 3) + "\n\n"))).not.toThrow();
  });

  it("counts comment frames and accepts exactly 512, without retaining event history", () => {
    expect(policy.limits.sseMaxEventsPerAttempt).toBe(512);
    const p = parser(); p.push(encoder.encode(": heartbeat\n\n".repeat(511) + frame(created)));
    expect(p.finish()).toEqual({ id, status: "in_progress", outputVideo: null });
    code(() => parser().push(encoder.encode(": heartbeat\n\n".repeat(512) + frame(created))), "SSE_EVENT_LIMIT_EXCEEDED");
    const empty = parser(4096, 1); empty.push(encoder.encode("\n\r\n\r" + frame(created))); expect(empty.finish().status).toBe("in_progress");
  });

  it("keeps the full closed error tuple frozen and numeric details narrow", () => {
    expect(new Set(GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES).size).toBe(41);
    expect(Object.isFrozen(GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES)).toBe(true);
    const error = new GoogleGenAiSecureOutputTransportError("SSE_HTTP_FAILED", { attempt: 1, httpStatus: 403 });
    expect(Object.isFrozen(error)).toBe(true); expect(error.retryable).toBe(false);
    expect(new GoogleGenAiSecureOutputTransportError("SSE_HTTP_FAILED", { httpStatus: 503 }).retryable).toBe(true);
    expect(new GoogleGenAiSecureOutputTransportError("SSE_HTTP_FAILED", { attempt: NaN, httpStatus: 999 }).httpStatus).toBeUndefined();
  });
});

describe("status_update usage and terminal done (synthetic, evidence-shaped)", () => {
  const count = (modality: string, tokens: number) => ({ modality, tokens });
  const invocation = () => ({
    prompt_tokens_details: [count("MODALITY_A", 11), count("MODALITY_B", 12)],
    candidates_tokens_details: [count("MODALITY_C", 13)],
    thoughts_tokens_details: [count("MODALITY_A", 14)],
  });
  const usage = (): Record<string, unknown> => ({
    total_tokens: 100, total_input_tokens: 40, input_tokens_by_modality: [count("MODALITY_A", 10), count("MODALITY_B", 30)],
    total_cached_tokens: 0, total_output_tokens: 50, output_tokens_by_modality: [count("MODALITY_C", 50)],
    total_tool_use_tokens: 0, total_thought_tokens: 10, raw_prompt_token: 40,
    model_invocation_token_counts: [invocation()], non_grounding_model_invocation_token_counts: [invocation()], initial_input_tokens: 40,
  });
  const update = (extra: Record<string, unknown> = {}): Event => ({ event_type: "interaction.status_update", interaction_id: id, status: "in_progress", ...extra });
  const finalInteraction = { id, status: "completed", usage: { ...usage(), billable_usage: { total_tokens: 1 } }, created: "2026-01-01T00:00:00Z",
    updated: "2026-01-01T00:00:01Z", service_tier: "synthetic", object: "interaction", model: "synthetic-model" };
  // Synthetic stream shaped like the sanitized B4Y2D/B4Y2E1 structure (frames 0-9); no real provider material.
  const shaped: Event[] = [
    { event_type: "interaction.created", interaction: { id, status: "in_progress", object: "interaction", model: "synthetic-model" } },
    update(),
    { event_type: "step.start", index: 0, step: { type: "thought" } },
    { event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "synthetic-signature" } },
    { event_type: "step.stop", index: 0 },
    { event_type: "step.start", index: 1, step: { type: "model_output" } },
    { event_type: "step.delta", index: 1, event_id: "synthetic-event-id", delta: { type: "video", mime_type: "video/mp4", uri } },
    update({ usage: usage() }),
    { event_type: "step.stop", index: 1 },
    { event_type: "interaction.completed", interaction: finalInteraction },
  ];
  const DONE = "event: done\ndata: [DONE]\n\n";
  const expected = { id, status: "completed", outputVideo: { type: "video", mime_type: "video/mp4", uri } };
  const text = (values: Event[] = shaped, tail = "", ending = "\n") => values.map((v) => frame(v, ending)).join("") + tail;
  /** Pushes bytes split at the given offsets, asserting push() never releases a completed result, then finishes. */
  function feed(input: string, cuts: number[] = []) {
    const bytes = encoder.encode(input);
    const p = parser();
    let last = 0;
    for (const cut of [...cuts, bytes.length]) { expect(p.push(bytes.subarray(last, cut))).toBeUndefined(); last = cut; }
    return p.finish();
  }
  const oneByte = (input: string) => Array.from({ length: encoder.encode(input).length - 1 }, (_, i) => i + 1);
  const withUsage = (value: unknown) => [shaped[0]!, update({ usage: value }), start, delta, stop, complete];
  /** Production frame cap (1 MiB) so large usage fixtures reach the usage rule rather than the byte cap. */
  const parseFull = (values: Event[]) => { const p = parser(policy.limits.sseMaxEventBytes); p.push(encoder.encode(values.map((v) => frame(v)).join(""))); return p.finish(); };

  it("P1/P2 accepts status_update with the exact usage object and without usage", () => {
    expect(parse(withUsage(usage()))).toEqual({ id, status: "completed", outputVideo: delta.delta });
    expect(parse([shaped[0]!, update(), start, delta, stop, complete])).toEqual({ id, status: "completed", outputVideo: delta.delta });
  });

  it("accepts the 16-entry array bound at every usage array position", () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => count("MODALITY_A", i));
    const value = usage();
    value.input_tokens_by_modality = sixteen;
    value.model_invocation_token_counts = Array.from({ length: 16 }, () => ({ ...invocation(), prompt_tokens_details: sixteen }));
    expect(parseFull(withUsage(value)).status).toBe("completed");
  });

  it("P3/P10 historical completed -> EOF succeeds", () => {
    expect(feed(text())).toEqual(expected);
  });

  it.each(["\n", "\r\n", "\r"])("P4 completed -> done -> EOF with %j endings equals the EOF result at every one-byte boundary", (ending) => {
    const input = text(shaped, `event: done${ending}data: [DONE]${ending}${ending}`, ending);
    expect(feed(input)).toEqual(expected);
    expect(feed(input, oneByte(input))).toEqual(expected);
  });

  it("P6/P7/P8 same chunk, next chunk and a done frame split across five chunks all succeed", () => {
    const input = text(shaped, DONE);
    const at = encoder.encode(text()).length;
    expect(feed(input)).toEqual(expected);
    expect(feed(input, [at])).toEqual(expected);
    expect(feed(input, [at, at + 3, at + 9, at + 15, at + 20, at + 22])).toEqual(expected);
  });

  it("P9 operates above the existing framer: no-space colon and CRLF framing yield the same done", () => {
    expect(feed(text(shaped, "event:done\ndata:[DONE]\n\n"))).toEqual(expected);
    expect(feed(text(shaped, "event: done\r\ndata: [DONE]\r\n\r\n"))).toEqual(expected);
  });

  it("chunk partitions of one valid stream all produce the identical completed result", () => {
    const input = text(shaped, DONE);
    const at = encoder.encode(text()).length;
    const partitions = [[], [at], [at + 2], [at + 16], [at - 1, at + 1], oneByte(input).filter((n) => n > at - 64), oneByte(input)];
    for (const cuts of partitions) expect(feed(input, cuts)).toEqual(expected);
  });

  it.each([
    ["primitive string", "usage"], ["primitive number", 1], ["boolean", true], ["array", []], ["null", null],
    ["unknown top-level key", { ...usage(), extra: 1 }], ["billable_usage on status_update", { ...usage(), billable_usage: {} }],
    ["unknown modality-count key", { ...usage(), input_tokens_by_modality: [{ ...count("MODALITY_A", 1), extra: 1 }] }],
    ["unknown invocation key", { ...usage(), model_invocation_token_counts: [{ ...invocation(), extra: [] }] }],
    ["number as string", { ...usage(), total_tokens: "100" }], ["number as null", { ...usage(), raw_prompt_token: null }],
    ["number as object", { ...usage(), initial_input_tokens: {} }],
    ["tokens as string", { ...usage(), output_tokens_by_modality: [{ modality: "MODALITY_C", tokens: "1" }] }],
    ["array replaced by object", { ...usage(), input_tokens_by_modality: count("MODALITY_A", 1) }],
    ["invocation array replaced by object", { ...usage(), non_grounding_model_invocation_token_counts: invocation() }],
    ["entry replaced by array", { ...usage(), input_tokens_by_modality: [[count("MODALITY_A", 1)]] }],
    ["nested array replaced by object", { ...usage(), model_invocation_token_counts: [{ ...invocation(), candidates_tokens_details: count("MODALITY_C", 1) }] }],
    ["null entry", { ...usage(), output_tokens_by_modality: [null] }],
    ["empty modality array", { ...usage(), output_tokens_by_modality: [] }],
    ["empty invocation array", { ...usage(), model_invocation_token_counts: [] }],
    ["empty nested array", { ...usage(), model_invocation_token_counts: [{ ...invocation(), thoughts_tokens_details: [] }] }],
    ["17 modality entries", { ...usage(), input_tokens_by_modality: Array.from({ length: 17 }, () => count("MODALITY_A", 1)) }],
    ["17 invocations", { ...usage(), model_invocation_token_counts: Array.from({ length: 17 }, invocation) }],
    ["empty modality", { ...usage(), input_tokens_by_modality: [count("", 1)] }],
    ["numeric modality", { ...usage(), input_tokens_by_modality: [{ modality: 5, tokens: 1 }] }],
    ["missing modality", { ...usage(), input_tokens_by_modality: [{ tokens: 1 }] }],
    ["missing tokens", { ...usage(), input_tokens_by_modality: [{ modality: "MODALITY_A" }] }],
  ])("N-U rejects usage with %s", (_name, value) => code(() => parseFull(withUsage(value))));

  it.each(Object.keys(usage()))("N-U7 rejects usage missing required member %s", (member) => {
    const value = usage(); delete value[member];
    code(() => parse(withUsage(value)));
  });

  it("N-U5 rejects a non-finite usage number (1e400 decodes to Infinity)", () => {
    const json = JSON.stringify(update({ usage: usage() })).replace('"total_tokens":100', '"total_tokens":1e400');
    expect(json).toContain("1e400");
    const p = parser();
    p.push(encoder.encode(frame(shaped[0]!)));
    code(() => p.push(encoder.encode(`event: interaction.status_update\ndata: ${json}\n\n`)));
  });

  const before = text(shaped.slice(0, 9));
  it.each([
    ["N-D1 done before completed", before + DONE + frame(shaped[9]!)],
    ["N-D2 done right after created", frame(shaped[0]!) + DONE],
    ["N-D2 done alone", DONE],
    ["N-D3 second done", text(shaped, DONE + DONE)],
    ["N-D4 status_update after completed", text(shaped, frame(update()))],
    ["N-D4 step.stop after completed", text(shaped, frame({ event_type: "step.stop", index: 1 }))],
    ["N-D4/N-D6 second completed", text(shaped, frame(shaped[9]!))],
    ["N-D5 semantic event after done", text(shaped, DONE + frame(update()))],
    ["N-D6 completed after done", text(shaped, DONE + frame(shaped[9]!))],
    ["N-D7 unknown event after completed", text(shaped, frame({ event_type: "ping" }))],
    ["N-D7 provider error after completed", text(shaped, frame({ event_type: "error", error: { message: "x" } }))],
    ...["[DONE ]", "[done]", "DONE", "", "[DONE]x", "x[DONE]", '{"event_type":"done"}', " [DONE]"].map((value) =>
      [`N-D8 sentinel ${JSON.stringify(value)}`, text(shaped, `event: done\ndata: ${value}\n\n`)]),
    ["N-D8 sentinel via two spaces", text(shaped, "event: done\ndata:  [DONE]\n\n")],
    ["N-D8b event Done", text(shaped, "event: Done\ndata: [DONE]\n\n")],
    ["N-D8b event DONE", text(shaped, "event: DONE\ndata: [DONE]\n\n")],
    ["N-D9 non-JSON data after completed", text(shaped, "event: x\ndata: not json\n\n")],
    ["N-D10 done with id", text(shaped, "event: done\nid: 1\ndata: [DONE]\n\n")],
    ["N-D10 done with comment", text(shaped, "event: done\n: note\ndata: [DONE]\n\n")],
    ["N-D11 two data lines", text(shaped, "event: done\ndata: [DONE]\ndata: [DONE]\n\n")],
    ["N-D11 frame after done", text(shaped, DONE + "event: done\ndata: x\n\n")],
    ["N-D12 comment-only frame after completed", text(shaped, ": keepalive\n\n")],
    ["N-D12 comment-only frame after done", text(shaped, DONE + ": keepalive\n\n")],
  ])("%s -> INTERACTION_REPLAY_CONTRACT_CHANGED in one chunk and one byte at a time (N-S1)", (_name, input) => {
    code(() => feed(input));
    code(() => feed(input, oneByte(input)));
  });

  it.each([
    ["done with retry", "event: done\nretry: 5\ndata: [DONE]\n\n"],
    ["done with unknown field", "event: done\nfoo: bar\ndata: [DONE]\n\n"],
    ["done without its blank-line terminator at EOF", "event: done\ndata: [DONE]\n"],
    ["unterminated bytes after done", DONE + "garbage"],
  ])("N-D9/N-D10 framer-level %s stays SSE_MALFORMED_EVENT", (_name, tail) => {
    code(() => feed(text(shaped, tail)), "SSE_MALFORMED_EVENT");
  });

  it("chunk partitions of invalid post-completion streams all fail with the same code", () => {
    for (const tail of [frame({ event_type: "ping" }), DONE + frame({ event_type: "ping" }), DONE + DONE]) {
      const input = text(shaped, tail);
      const at = encoder.encode(text()).length;
      for (const cuts of [[], [at], [at + 3, at + 9, at + 15, at + 20], oneByte(input)]) code(() => feed(input, cuts));
    }
  });

  it("N-S2 never releases a completed result from push(), even at a chunk boundary", () => {
    const p = parser();
    expect(p.push(encoder.encode(text()))).toBeUndefined();
    expect(p.push(encoder.encode(DONE))).toBeUndefined();
    expect(p.finish()).toEqual(expected);
    code(() => p.push(encoder.encode("\n")));
    code(() => p.finish());
  });

  it("N-E1 new usage and done failures carry no payload, sentinel, URL or provider text", () => {
    const failures: unknown[] = [];
    for (const run of [
      () => parse(withUsage({ ...usage(), SECRETKEY: "SECRET-usage-value", input_tokens_by_modality: [count("SECRET-modality", 1)] })),
      () => feed(text(shaped, "event: done\ndata: [SECRET]\n\n")),
      () => feed(text(shaped, "event: SECRET\ndata: SECRET-trailing\n\n")),
    ]) {
      try { run(); } catch (error) { failures.push(error); }
    }
    expect(failures).toHaveLength(3);
    for (const error of failures) {
      expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
      expect((error as GoogleGenAiSecureOutputTransportError).code).toBe("INTERACTION_REPLAY_CONTRACT_CHANGED");
      const rendered = String(error) + JSON.stringify(error) + String((error as Error).stack) + String((error as Error).message);
      for (const leaked of ["SECRET", "DONE", uri, "MODALITY", "googleapis"]) expect(rendered).not.toContain(leaked);
    }
  });
});
