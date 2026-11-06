import { classifyGoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";
import type { GoogleGenAiInteractionReplayResult, GoogleGenAiSecureOutputTransportPolicy } from "./googleGenAiSecureOutputTransport.types.js";
import {
  GoogleGenAiSecureOutputTransportError,
  type GoogleGenAiReplayContractStage,
} from "./googleGenAiSecureOutputTransportError.js";

function malformed(): never { throw new GoogleGenAiSecureOutputTransportError("SSE_MALFORMED_EVENT"); }
function changed(
  stage: GoogleGenAiReplayContractStage,
): never {
  throw new GoogleGenAiSecureOutputTransportError(
    "INTERACTION_REPLAY_CONTRACT_CHANGED",
    {
      stage,
    },
  );
}

/** Iterative lexical pre-pass over an already byte-bounded JSON string. No provider-object recursion. */
function rejectDuplicateGoogleGenAiJsonKeys(json: string): void {
  const stack: Array<{ kind: "object" | "array"; keys: Set<string>; keyExpected: boolean }> = [];
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') {
      let decoded = "";
      let closed = false;
      while (++i < json.length) {
        const c = json[i]!;
        if (c === '"') { closed = true; break; }
        if (c.charCodeAt(0) < 32) malformed();
        if (c !== "\\") { decoded += c; continue; }
        const escape = json[++i];
        if (escape === "u") {
          const hex = json.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) malformed();
          decoded += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else {
          const escapes: Readonly<Record<string, string>> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (escape === undefined || !Object.hasOwn(escapes, escape)) malformed();
          decoded += escapes[escape]!;
        }
      }
      if (!closed) malformed();
      const parent = stack.at(-1);
      if (parent?.kind === "object" && parent.keyExpected) {
        if (parent.keys.has(decoded)) malformed();
        parent.keys.add(decoded);
        parent.keyExpected = false;
      }
    } else if (ch === "{" || ch === "[") {
      stack.push({ kind: ch === "{" ? "object" : "array", keys: new Set(), keyExpected: ch === "{" });
    } else if (ch === "}" || ch === "]") {
      const parent = stack.pop();
      if (!parent || parent.kind !== (ch === "}" ? "object" : "array")) malformed();
    } else if (ch === ",") {
      const parent = stack.at(-1);
      if (parent?.kind === "object") parent.keyExpected = true;
    }
  }
  if (stack.length !== 0) malformed();
}

export { rejectDuplicateGoogleGenAiJsonKeys };

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) changed("SSE_VALUE_NOT_OBJECT");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) changed("SSE_UNKNOWN_KEY");
}
function finiteNumber(value: unknown): void {
  if (typeof value !== "number" || !Number.isFinite(value)) changed("SSE_INVALID_NUMBER");
}
function boundedArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) changed("SSE_INVALID_BOUNDED_ARRAY");
  return value as unknown[];
}

// Closed, evidence-locked status_update usage (B4Y2E section 9). Validated, then discarded: never part of the result.
const USAGE_NUMBERS = [
  "total_tokens", "total_input_tokens", "total_cached_tokens", "total_output_tokens",
  "total_tool_use_tokens", "total_thought_tokens", "raw_prompt_token", "initial_input_tokens",
] as const;
const USAGE_MODALITY_ARRAYS = [
  "input_tokens_by_modality",
  "output_tokens_by_modality",
  "cached_tokens_by_modality",
  "tool_use_tokens_by_modality",
] as const;
const USAGE_GROUNDING_ARRAYS = ["grounding_tool_count"] as const;
const USAGE_INVOCATION_ARRAYS = ["model_invocation_token_counts", "non_grounding_model_invocation_token_counts"] as const;
const INVOCATION_MODALITY_ARRAYS = ["prompt_tokens_details", "candidates_tokens_details", "thoughts_tokens_details"] as const;

function modalityCounts(value: unknown): void {
  for (const entry of boundedArray(value)) {
    const count = record(entry);
    keys(count, ["modality", "tokens"]);

    if (
      Object.hasOwn(count, "modality") &&
      (typeof count.modality !== "string" ||
        count.modality.length === 0)
    ) {
      changed("SSE_USAGE_SHAPE_CHANGED");
    }

    if (Object.hasOwn(count, "tokens")) {
      finiteNumber(count.tokens);
    }
  }
}

function groundingToolCounts(value: unknown): void {
  for (const entry of boundedArray(value)) {
    const count = record(entry);
    keys(count, ["type", "count"]);

    if (
      Object.hasOwn(count, "type") &&
      count.type !== "google_search" &&
      count.type !== "google_maps"
    ) {
      changed("SSE_USAGE_SHAPE_CHANGED");
    }

    if (Object.hasOwn(count, "count")) {
      finiteNumber(count.count);
    }
  }
}

function validateStatusUpdateUsage(value: unknown): void {
  const usage = record(value);

  keys(
    usage,
    [
      ...USAGE_NUMBERS,
      ...USAGE_MODALITY_ARRAYS,
      ...USAGE_GROUNDING_ARRAYS,
      ...USAGE_INVOCATION_ARRAYS,
    ],
  );

  for (const key of USAGE_NUMBERS) {
    if (Object.hasOwn(usage, key)) {
      finiteNumber(usage[key]);
    }
  }

  for (const key of USAGE_MODALITY_ARRAYS) {
    if (Object.hasOwn(usage, key)) {
      modalityCounts(usage[key]);
    }
  }

  for (const key of USAGE_GROUNDING_ARRAYS) {
    if (Object.hasOwn(usage, key)) {
      groundingToolCounts(usage[key]);
    }
  }

  for (const key of USAGE_INVOCATION_ARRAYS) {
    if (!Object.hasOwn(usage, key)) {
      continue;
    }

    for (const entry of boundedArray(usage[key])) {
      const invocation = record(entry);
      keys(invocation, INVOCATION_MODALITY_ARRAYS);

      for (const nested of INVOCATION_MODALITY_ARRAYS) {
        if (Object.hasOwn(invocation, nested)) {
          modalityCounts(invocation[nested]);
        }
      }
    }
  }
}

export function createGoogleGenAiInteractionSseParser(input: Readonly<{
  providerExecutionId: string;
  limits: Pick<GoogleGenAiSecureOutputTransportPolicy["limits"], "sseMaxEventBytes" | "sseMaxEventsPerAttempt">;
}>) {
  const { providerExecutionId } = input;
  const { sseMaxEventBytes: maxBytes, sseMaxEventsPerAttempt: maxEvents } = input.limits;
  if (!/^[A-Za-z0-9_-]+$/.test(providerExecutionId) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxEvents) || maxEvents <= 0) {
    throw new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
  }
  const frame = new Uint8Array(maxBytes);
  let length = 0;
  let lineLength = 0;
  let hasContent = false;
  let pendingCR = false;
  let firstFrame = true;
  let eventCount = 0;
  let created = false;
  let status: GoogleGenAiInteractionReplayResult["status"] | undefined;
  let result: GoogleGenAiInteractionReplayResult | undefined;
  let video: GoogleGenAiInteractionReplayResult["outputVideo"] = null;
  let modelStepSeen = false;
  let lastStart = -1;
  let finished = false;
  let doneSeen = false;
  const steps = new Map<number, { kind: "thought" | "model_output"; closed: boolean }>();

  const observation = (): GoogleGenAiInteractionReplayResult => {
    if (status === undefined) changed("SSE_STATUS_MISSING");
    return Object.freeze({ id: providerExecutionId, status, outputVideo: status === "completed" ? video : null });
  };
  const readStatus = (value: unknown): GoogleGenAiInteractionReplayResult["status"] => {
    try { classifyGoogleGenAiInteractionStatus(value); } catch { changed("SSE_STATUS_UNKNOWN"); }
    return value as GoogleGenAiInteractionReplayResult["status"];
  };
  const identity = (value: unknown): void => { if (value !== providerExecutionId) changed("SSE_IDENTITY_MISMATCH"); };
  const update = (value: unknown): void => {
    const next = readStatus(value);
    if ((status === "completed" && next !== "completed") || (status === "in_progress" && next === "queued")) changed("SSE_STATUS_REGRESSION");
    status = next;
    if (next !== "queued" && next !== "in_progress" && next !== "completed") result = observation();
  };
  const reduce = (event: Record<string, unknown>): void => {
    if (result) changed("SSE_EVENT_AFTER_TERMINAL");
    const kind = event.event_type;
    if (kind === "error") throw new GoogleGenAiSecureOutputTransportError("SSE_PROVIDER_ERROR");
    if (kind === "interaction.created" || kind === "interaction.completed") {
      keys(event, ["event_type", "event_id", "interaction"]);
      const interaction = record(event.interaction);
      keys(interaction, ["id", "status", "created", "updated", "model", "agent", "object", "service_tier", "usage", "steps", "continuation_token"]);
      if (Object.hasOwn(interaction, "steps") && !Array.isArray(interaction.steps)) changed("SSE_INTERACTION_SNAPSHOT_CHANGED");
      if (Object.hasOwn(interaction, "continuation_token") &&
          typeof interaction.continuation_token !== "string") changed("SSE_CONTINUATION_TOKEN_CHANGED");
      // Google lifecycle SSE events may include steps and continuation_token
      // snapshots. They are compatibility-only context, never recovery
      // authority: ordered step.start/step.delta/step.stop events remain
      // authoritative here, and BusyBookie does not automatically continue
      // decoding from a continuation token.
      identity(interaction.id);
      if (kind === "interaction.created") {
        if (created) changed("SSE_INTERACTION_SNAPSHOT_CHANGED");
        created = true;
        update(interaction.status);
      } else {
        if (!created || interaction.status !== "completed" || !video || [...steps.values()].some((step) => !step.closed)) changed("SSE_COMPLETION_PRECONDITION_FAILED");
        update(interaction.status);
        result = observation();
      }
      return;
    }
    if (!created) changed("SSE_EVENT_BEFORE_CREATED");
    if (kind === "interaction.status_update") {
      keys(event, ["event_type", "event_id", "interaction_id", "status", "usage"]);
      identity(event.interaction_id);
      if (Object.hasOwn(event, "usage")) validateStatusUpdateUsage(event.usage);
      update(event.status);
      return;
    }
    if (kind !== "step.start" && kind !== "step.delta" && kind !== "step.stop") changed("SSE_EVENT_KIND_UNKNOWN");
    if (!Number.isSafeInteger(event.index) || (event.index as number) < 0) changed("SSE_EVENT_INDEX_INVALID");
    const index = event.index as number;
    if (kind === "step.start") {
      keys(event, ["event_type", "event_id", "index", "step"]);
      if (steps.has(index) || index <= lastStart) changed("SSE_STEP_ORDER_INVALID");
      const step = record(event.step);
      if (step.type === "thought") {
        keys(step, ["type", "signature", "summary"]);
        if (step.signature !== undefined && typeof step.signature !== "string") changed("SSE_STEP_SHAPE_CHANGED");
        if (step.summary !== undefined) {
          if (!Array.isArray(step.summary)) changed("SSE_STEP_SHAPE_CHANGED");
          for (const content of step.summary as unknown[]) {
            const text = record(content);
            keys(text, ["type", "text"]);
            if (text.type !== "text" || typeof text.text !== "string") changed("SSE_STEP_SHAPE_CHANGED");
          }
        }
      } else if (step.type === "model_output") {
        keys(step, ["type", "content"]);
        if (modelStepSeen || (step.content !== undefined && (!Array.isArray(step.content) || step.content.length !== 0))) changed("SSE_STEP_SHAPE_CHANGED");
        modelStepSeen = true;
      } else changed("SSE_STEP_SHAPE_CHANGED");
      steps.set(index, { kind: step.type as "thought" | "model_output", closed: false });
      lastStart = index;
      return;
    }
    const step = steps.get(index);
    if (!step || step.closed) changed("SSE_STEP_STATE_INVALID");
    if (kind === "step.stop") {
      keys(event, ["event_type", "event_id", "index", "step_usage", "usage"]);
      step.closed = true;
      return;
    }
    keys(event, ["event_type", "event_id", "index", "delta", "metadata"]);
    const delta = record(event.delta);
    if (step.kind === "thought") {
      if (delta.type === "thought_signature") {
        keys(delta, ["type", "signature"]);
        if (delta.signature !== undefined && typeof delta.signature !== "string") changed("SSE_THOUGHT_DELTA_CHANGED");
      } else if (delta.type === "thought_summary") {
        keys(delta, ["type", "content"]);
        if (delta.content !== undefined) {
          const content = record(delta.content);
          keys(content, ["type", "text"]);
          if (content.type !== "text" || typeof content.text !== "string") changed("SSE_THOUGHT_DELTA_CHANGED");
        }
      } else changed("SSE_THOUGHT_DELTA_CHANGED");
    } else {
      keys(delta, ["type", "mime_type", "uri", "resolution"]);
      // An omitted mime_type stays omitted: absence is not evidence, and Files metadata and the download prove the type.
      const declaresMime = Object.hasOwn(delta, "mime_type");
      if (video || delta.type !== "video" || (declaresMime && delta.mime_type !== "video/mp4") || typeof delta.uri !== "string" || !delta.uri.trim()) changed("SSE_VIDEO_DELTA_CHANGED");
      video = Object.freeze({ type: "video", ...(declaresMime ? { mime_type: "video/mp4" as const } : {}), uri: delta.uri as string });
    }
  };
  const dispatch = (): void => {
    if (!hasContent) return;
    if (++eventCount > maxEvents) throw new GoogleGenAiSecureOutputTransportError("SSE_EVENT_LIMIT_EXCEEDED");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(frame.subarray(0, length)); } catch { malformed(); }
    if (firstFrame && text.startsWith("\uFEFF")) text = text.slice(1);
    if (text.includes("\uFEFF") || text.includes("\0")) malformed();
    let name: string | undefined;
    let idSeen = false;
    let commentSeen = false;
    const data: string[] = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (!line) continue;
      if (line.startsWith(":")) { commentSeen = true; continue; }
      const colon = line.indexOf(":");
      if (colon < 0) malformed();
      const field = line.slice(0, colon);
      const raw = line.slice(colon + 1);
      const value = raw.startsWith(" ") ? raw.slice(1) : raw;
      if (field === "event") { if (name !== undefined || !value) malformed(); name = value; }
      else if (field === "id") { if (idSeen) malformed(); idSeen = true; }
      else if (field === "data") data.push(value);
      else malformed();
    }
    if (data.length === 0) { if (name !== undefined || idSeen) malformed(); if (result) changed("SSE_RESULT_TRAILING_EVENT"); return; }
    if (name === undefined) malformed();
    // Post-completion grammar (B4Y2E2): after a valid interaction.completed only ONE exact framed
    // `done` / `[DONE]` event may occur, then EOF. Checked before any JSON parsing.
    if (result || name === "done") {
      if (result?.status !== "completed" || doneSeen || name !== "done" || idSeen || commentSeen || data.length !== 1 || data[0] !== "[DONE]") changed("SSE_TERMINAL_FRAME_CHANGED");
      doneSeen = true;
      return;
    }
    const json = data.join("\n");
    rejectDuplicateGoogleGenAiJsonKeys(json);
    let event: unknown;
    try { event = JSON.parse(json); } catch { malformed(); }
    if (event === null || typeof event !== "object" || Array.isArray(event)) malformed();
    const object = event as Record<string, unknown>;
    if (object.event_type !== name) malformed();
    if (object.event_id !== undefined && typeof object.event_id !== "string") changed("SSE_EVENT_ID_CHANGED");
    reduce(object);
  };
  const lineEnd = (): void => {
    if (lineLength !== 0) hasContent = true;
    else {
      dispatch();
      frame.fill(0, 0, length);
      length = 0;
      hasContent = false;
      firstFrame = false;
    }
    lineLength = 0;
  };
  const append = (byte: number): void => {
    if (length >= maxBytes) throw new GoogleGenAiSecureOutputTransportError("SSE_EVENT_TOO_LARGE");
    frame[length++] = byte;
  };
  return Object.freeze({
    push(chunk: Uint8Array): GoogleGenAiInteractionReplayResult | undefined {
      if (finished || (result && status !== "completed")) changed("SSE_PUSH_AFTER_TERMINAL");
      if (!(chunk instanceof Uint8Array)) malformed();
      for (const byte of chunk) {
        if (pendingCR) {
          pendingCR = false;
          if (byte === 10) {
            append(byte);
            lineEnd();
            if (result && status !== "completed") return result;
            continue;
          }
          lineEnd();
          if (result && status !== "completed") return result;
        }
        append(byte);
        if (byte === 13) pendingCR = true;
        else if (byte === 10) {
          lineEnd();
          if (result && status !== "completed") return result;
        }
        else lineLength++;
      }
      // A completed result is released only by finish() at EOF, never at a network chunk boundary.
      return status === "completed" ? undefined : result;
    },
    finish(): GoogleGenAiInteractionReplayResult {
      if (finished) changed("SSE_FINISH_REPEATED");
      finished = true;
      if (pendingCR) { pendingCR = false; lineEnd(); }
      if (result && status !== "completed") return result;
      if (length !== 0 || [...steps.values()].some((step) => !step.closed)) malformed();
      if (result) return result;
      if (!created || (status !== "queued" && status !== "in_progress")) changed("SSE_FINAL_PENDING_STATE_INVALID");
      return observation();
    },
  });
}
