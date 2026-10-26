import { classifyGoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";
import type { GoogleGenAiInteractionReplayResult, GoogleGenAiSecureOutputTransportPolicy } from "./googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "./googleGenAiSecureOutputTransportError.js";

function malformed(): never { throw new GoogleGenAiSecureOutputTransportError("SSE_MALFORMED_EVENT"); }
function changed(): never { throw new GoogleGenAiSecureOutputTransportError("INTERACTION_REPLAY_CONTRACT_CHANGED"); }

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
  if (value === null || typeof value !== "object" || Array.isArray(value)) changed();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) changed();
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
  const steps = new Map<number, { kind: "thought" | "model_output"; closed: boolean }>();

  const observation = (): GoogleGenAiInteractionReplayResult => {
    if (status === undefined) changed();
    return Object.freeze({ id: providerExecutionId, status, outputVideo: status === "completed" ? video : null });
  };
  const readStatus = (value: unknown): GoogleGenAiInteractionReplayResult["status"] => {
    try { classifyGoogleGenAiInteractionStatus(value); } catch { changed(); }
    return value as GoogleGenAiInteractionReplayResult["status"];
  };
  const identity = (value: unknown): void => { if (value !== providerExecutionId) changed(); };
  const update = (value: unknown): void => {
    const next = readStatus(value);
    if ((status === "completed" && next !== "completed") || (status === "in_progress" && next === "queued")) changed();
    status = next;
    if (next !== "queued" && next !== "in_progress" && next !== "completed") result = observation();
  };
  const reduce = (event: Record<string, unknown>): void => {
    if (result) changed();
    const kind = event.event_type;
    if (kind === "error") throw new GoogleGenAiSecureOutputTransportError("SSE_PROVIDER_ERROR");
    if (kind === "interaction.created" || kind === "interaction.completed") {
      keys(event, ["event_type", "event_id", "interaction"]);
      const interaction = record(event.interaction);
      keys(interaction, ["id", "status", "created", "updated", "model", "agent", "object", "service_tier", "usage"]);
      identity(interaction.id);
      if (kind === "interaction.created") {
        if (created) changed();
        created = true;
        update(interaction.status);
      } else {
        if (!created || interaction.status !== "completed" || !video || [...steps.values()].some((step) => !step.closed)) changed();
        update(interaction.status);
        result = observation();
      }
      return;
    }
    if (!created) changed();
    if (kind === "interaction.status_update") {
      keys(event, ["event_type", "event_id", "interaction_id", "status"]);
      identity(event.interaction_id);
      update(event.status);
      return;
    }
    if (kind !== "step.start" && kind !== "step.delta" && kind !== "step.stop") changed();
    if (!Number.isSafeInteger(event.index) || (event.index as number) < 0) changed();
    const index = event.index as number;
    if (kind === "step.start") {
      keys(event, ["event_type", "event_id", "index", "step"]);
      if (steps.has(index) || index <= lastStart) changed();
      const step = record(event.step);
      if (step.type === "thought") {
        keys(step, ["type", "signature", "summary"]);
        if (step.signature !== undefined && typeof step.signature !== "string") changed();
        if (step.summary !== undefined) {
          if (!Array.isArray(step.summary)) changed();
          for (const content of step.summary as unknown[]) {
            const text = record(content);
            keys(text, ["type", "text"]);
            if (text.type !== "text" || typeof text.text !== "string") changed();
          }
        }
      } else if (step.type === "model_output") {
        keys(step, ["type", "content"]);
        if (modelStepSeen || (step.content !== undefined && (!Array.isArray(step.content) || step.content.length !== 0))) changed();
        modelStepSeen = true;
      } else changed();
      steps.set(index, { kind: step.type as "thought" | "model_output", closed: false });
      lastStart = index;
      return;
    }
    const step = steps.get(index);
    if (!step || step.closed) changed();
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
        if (delta.signature !== undefined && typeof delta.signature !== "string") changed();
      } else if (delta.type === "thought_summary") {
        keys(delta, ["type", "content"]);
        if (delta.content !== undefined) {
          const content = record(delta.content);
          keys(content, ["type", "text"]);
          if (content.type !== "text" || typeof content.text !== "string") changed();
        }
      } else changed();
    } else {
      keys(delta, ["type", "mime_type", "uri", "resolution"]);
      if (video || delta.type !== "video" || delta.mime_type !== "video/mp4" || typeof delta.uri !== "string" || !delta.uri.trim()) changed();
      video = Object.freeze({ type: "video", mime_type: "video/mp4", uri: delta.uri as string });
    }
  };
  const dispatch = (): void => {
    if (!hasContent) return;
    if (++eventCount > maxEvents) throw new GoogleGenAiSecureOutputTransportError("SSE_EVENT_LIMIT_EXCEEDED");
    if (result) changed();
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(frame.subarray(0, length)); } catch { malformed(); }
    if (firstFrame && text.startsWith("\uFEFF")) text = text.slice(1);
    if (text.includes("\uFEFF") || text.includes("\0")) malformed();
    let name: string | undefined;
    let idSeen = false;
    const data: string[] = [];
    for (const line of text.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(":")) continue;
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
    if (data.length === 0) { if (name !== undefined || idSeen) malformed(); return; }
    if (name === undefined) malformed();
    const json = data.join("\n");
    rejectDuplicateGoogleGenAiJsonKeys(json);
    let event: unknown;
    try { event = JSON.parse(json); } catch { malformed(); }
    if (event === null || typeof event !== "object" || Array.isArray(event)) malformed();
    const object = event as Record<string, unknown>;
    if (object.event_type !== name) malformed();
    if (object.event_id !== undefined && typeof object.event_id !== "string") changed();
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
      if (finished || result) changed();
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
      if (result && (hasContent || lineLength !== 0)) changed();
      return result;
    },
    finish(): GoogleGenAiInteractionReplayResult {
      if (finished) changed();
      finished = true;
      if (pendingCR) { pendingCR = false; lineEnd(); }
      if (result && status !== "completed") return result;
      if (length !== 0 || [...steps.values()].some((step) => !step.closed)) malformed();
      if (result) return result;
      if (!created || (status !== "queued" && status !== "in_progress")) changed();
      return observation();
    },
  });
}
