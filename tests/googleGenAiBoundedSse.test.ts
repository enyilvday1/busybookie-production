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
