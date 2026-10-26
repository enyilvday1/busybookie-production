import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK constructor is observed; its interactions.create is a tripwire.
const sdkCreate = vi.fn(() => {
  throw new Error("Real Google provider submission is forbidden in this offline test.");
});
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function GoogleGenAI(this: unknown) {
    return { interactions: { create: sdkCreate } };
  }),
}));

const { GoogleGenAI } = await import("@google/genai");
const { createGoogleGenAiOperatorProductionDependencies } = await import("../src/execution/createGoogleGenAiOperatorProductionDependencies.js");

const SYNTHETIC_KEY = "synthetic-b4x2-operator-key";

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network is forbidden in these offline tests."));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(sdkCreate).not.toHaveBeenCalled();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("operator-only Google production dependency composition", () => {
  it("constructs the creator and the secure recovery factory with zero network or provider calls", () => {
    const dependencies = createGoogleGenAiOperatorProductionDependencies(SYNTHETIC_KEY);
    expect(Object.isFrozen(dependencies)).toBe(true);
    expect(Object.keys(dependencies).sort()).toEqual(["createInteraction", "submittedRecovery"]);
    expect(typeof dependencies.createInteraction).toBe("function");
    expect(typeof dependencies.submittedRecovery.replayInteraction).toBe("function");
    expect(typeof dependencies.submittedRecovery.prepareUri).toBe("function");
    expect(typeof dependencies.submittedRecovery.downloadUri).toBe("function");
    expect(dependencies.submittedRecovery.policy).toBeDefined();
    expect(vi.mocked(GoogleGenAI)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(GoogleGenAI).mock.calls[0]![0]).toEqual({ apiKey: SYNTHETIC_KEY });
  });

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["internal whitespace", "synthetic key"],
    ["control character", "synthetic\u0007key"],
    ["non-ASCII", "synthetic-kéy"],
  ])("rejects a %s key before constructing any client and never echoes it", (_label, key) => {
    let caught: unknown;
    try {
      createGoogleGenAiOperatorProductionDependencies(key as string);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    if (typeof key === "string" && key.trim()) expect(message).not.toContain(key.trim());
    expect(message).not.toContain("synthetic");
    expect(vi.mocked(GoogleGenAI)).not.toHaveBeenCalled();
  });

  it("is a narrow composition: exactly the two existing factories, no environment, policy, network or routing authority", async () => {
    const source = await readFile(join(process.cwd(), "src/execution/createGoogleGenAiOperatorProductionDependencies.ts"), "utf8");
    const specifiers = [...source.matchAll(/from\s*"([^"]+)"/g)].map((match) => match[1]).sort();
    expect(specifiers).toEqual([
      "./providers/createGoogleGenAiSingleShotProductionInteractionCreator.js",
      "./providers/createGoogleGenAiSingleShotSecureProductionRecovery.js",
    ]);
    expect(source).not.toMatch(/process\.env|loadEnvironment|dotenv|ActivationPolicy|newSubmissionsEnabled|\bfetch\s*\(|@google\/genai|console\.|\/routing\/|executeSingleShot|ProductionInteractionGetter|ProductionOutputRetriever|GOOGLE_GENAI/);
  });
});
