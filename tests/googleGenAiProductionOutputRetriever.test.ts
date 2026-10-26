import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Retirement contract for the legacy SDK-backed output retriever (B4V7).
 * The former SDK lookup behavior (client construction, interactions.get,
 * raw id/status/output_video mapping, SDK error wrapping) intentionally no longer exists;
 * these tests prove the fail-closed stub instead.
 */

// Every potential authority the stub could reach is a pass-through spy, so
// any accidental SDK, secure-factory, transport or network use is observable.
vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return { ...actual, GoogleGenAI: vi.fn(actual.GoogleGenAI) };
});
vi.mock("../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js")>();
  return { ...actual, createGoogleGenAiSingleShotSecureProductionRecovery: vi.fn(actual.createGoogleGenAiSingleShotSecureProductionRecovery) };
});
vi.mock("../src/googleGenai/transport/replayGoogleGenAiInteraction.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/googleGenai/transport/replayGoogleGenAiInteraction.js")>();
  return { ...actual, replayGoogleGenAiInteraction: vi.fn(actual.replayGoogleGenAiInteraction) };
});

import { GoogleGenAI } from "@google/genai";
import { createGoogleGenAiSingleShotProductionOutputRetriever as retiredFactory } from "../src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.js";
import { createGoogleGenAiSingleShotSecureProductionRecovery } from "../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";
import { replayGoogleGenAiInteraction } from "../src/googleGenai/transport/replayGoogleGenAiInteraction.js";

const RETIRED_SOURCE = "src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.ts";
const RETIRED_EXPORT = "createGoogleGenAiSingleShotProductionOutputRetriever";
const ONLY_TYPE_IMPORT = "./materializeGoogleGenAiSingleShotOutput.js";
const RETIRED_MESSAGE =
  "createGoogleGenAiSingleShotProductionOutputRetriever is retired: the legacy SDK output lookup conflicts with secure one-replay recovery and streaming materialization. Use createGoogleGenAiSingleShotSecureProductionRecovery with reconcileGoogleGenAiExecutionLifecycle.";
const SYNTHETIC_KEY = "synthetic-retired-retriever-key";

const envReads: string[] = [];
let restoreEnv: (() => void) | undefined;

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network is forbidden in these offline tests."));
  // Observe (without changing) every environment read during the test.
  const original = process.env;
  process.env = new Proxy(original, {
    get(target, property, receiver) {
      if (typeof property === "string") envReads.push(property);
      return Reflect.get(target, property, receiver);
    },
  });
  restoreEnv = () => { process.env = original; };
});
afterEach(() => {
  restoreEnv?.();
  envReads.length = 0;
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
  expect(vi.mocked(createGoogleGenAiSingleShotSecureProductionRecovery)).not.toHaveBeenCalled();
  expect(vi.mocked(replayGoogleGenAiInteraction)).not.toHaveBeenCalled();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function thrownBy(invoke: () => unknown): unknown {
  try {
    invoke();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("retired legacy Google GenAI production output retriever (B4V7 fail-closed stub)", () => {
  it.each([
    ["a valid-looking key", SYNTHETIC_KEY],
    ["a padded key", `  ${SYNTHETIC_KEY}  `],
    ["an empty key", ""],
    ["a blank key", " \n\t "],
    ["a runtime non-string key", 42],
    ["a runtime undefined key", undefined],
  ] as const)(
    "fails closed synchronously for %s with the exact static retirement message and returns no adapter",
    (_label, apiKey) => {
      let returned: unknown = "not-assigned";
      const error = thrownBy(() => { returned = retiredFactory(apiKey as string); });
      expect(returned).toBe("not-assigned");
      expect(error).toBeInstanceOf(Error);
      expect(Object.getPrototypeOf(error)).toBe(Error.prototype);
      expect((error as Error).message).toBe(RETIRED_MESSAGE);
    },
  );

  it("is deterministic across repeated calls and never yields a retriever, promise or fallback", () => {
    const first = thrownBy(() => retiredFactory(SYNTHETIC_KEY));
    const second = thrownBy(() => retiredFactory(SYNTHETIC_KEY));
    expect((first as Error).message).toBe(RETIRED_MESSAGE);
    expect((second as Error).message).toBe(RETIRED_MESSAGE);
    expect(first).not.toBe(second);
    expect(first).not.toBeInstanceOf(Promise);
  });

  it("performs zero SDK construction, zero interaction retrieval, zero network and zero secure-factory/replay delegation", () => {
    thrownBy(() => retiredFactory(SYNTHETIC_KEY));
    expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(vi.mocked(createGoogleGenAiSingleShotSecureProductionRecovery)).not.toHaveBeenCalled();
    expect(vi.mocked(replayGoogleGenAiInteraction)).not.toHaveBeenCalled();
  });

  it("reads no environment variables and never echoes the key", () => {
    const error = thrownBy(() => retiredFactory(SYNTHETIC_KEY));
    expect(envReads).toEqual([]);
    const surfaced = String(error) + (error as Error).stack + JSON.stringify(error) + JSON.stringify(Object.getOwnPropertyNames(error));
    expect(surfaced).not.toContain(SYNTHETIC_KEY);
  });

  it("retains no raw cause and carries no provider/SDK error properties", () => {
    const error = thrownBy(() => retiredFactory(SYNTHETIC_KEY)) as object;
    expect(Object.hasOwn(error, "cause")).toBe(false);
    expect(Object.getOwnPropertyNames(error).sort()).toEqual(["message", "stack"]);
  });

  it("keeps the export name and declared return type while its source holds no SDK, network or recovery authority", async () => {
    const raw = await readFile(join(process.cwd(), RETIRED_SOURCE), "utf8");
    const ast = parseAst(raw, { lang: "ts" }, RETIRED_SOURCE);
    const imports = ast.body.filter((node) => node.type === "ImportDeclaration");
    expect(imports.map((node) => node.type === "ImportDeclaration" ? [node.source.value, node.importKind] : [])).toEqual([[ONLY_TYPE_IMPORT, "type"]]);
    expect(ast.body.some((node) => node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration")).toBe(true);
    expect(raw).toContain(`export function ${RETIRED_EXPORT}(`);
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/@google\/genai|GoogleGenAI\b|new\s+GoogleGenAI|interactions\.|\.get\(|\bfetch\b|process\.env|loadEnvironment|https?:\/\/|x-goog-api-key|\bcause\b|\bawait\b|async\s|Promise|replayGoogleGenAiInteraction|getGoogleGenAiFilesMetadata|downloadGoogleGenAiFile|\bimport\s*\(|\brequire\s*\(|GOOGLE_GENAI|gemini-omni/);
    // The secure factory is named only in the static migration message, never imported or called.
    expect(code.match(/createGoogleGenAiSingleShotSecureProductionRecovery/g)).toHaveLength(1);
    expect(code.match(/throw new Error\(/g)).toHaveLength(1);
  });
});
