import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseCharacterReferenceOnboardingCliArgs,
  runCharacterReferenceOnboardingCli,
  type RunCharacterReferenceOnboardingCliDependencies,
} from "../src/characterIdentity/cli/characterReferenceOnboarding.js";

import { CHARACTER_REFERENCE_ACCEPTANCE_RULES } from "../src/characterIdentity/characterVisualIdentityApproval.schema.js";

import {
  approveCharacterVisualIdentity,
  registerCharacterReferenceAsset,
} from "../src/characterIdentity/onboardCharacterVisualIdentity.js";

import { verifyCharacterVisualIdentityApprovalForConsumption } from "../src/characterIdentity/verifyCharacterVisualIdentityApprovalForConsumption.js";

import { readVisualReferenceRegistrySha256 } from "../src/execution/appendVisualReferenceAssetRegistry.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";

import { createConsumptionFixture } from "./fixtures/characterIdentityConsumptionFixture.js";

const V1_FIXTURE = new URL("./fixtures/characterBible.pre1137e.v1.json", import.meta.url);

type Json = Record<string, any>;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 4)]);
const ASSET_ID = "ollie-master-identity-reference-v1";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function mediaRoot(withRegistry = true): Promise<{ root: string; sourceFile: string }> {
  const root = await mkdtemp(join(tmpdir(), "busybookie-onboarding-cli-"));
  roots.push(root);

  const sourceFile = resolve(root, "references", "characters", "OLLIE", `${ASSET_ID}.png`);
  await mkdir(dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, PNG);

  if (withRegistry) {
    await writeFile(createVisualReferenceAssetRegistryPath(root), `${JSON.stringify({ schemaVersion: "1.0", assets: [] }, null, 2)}\n`);
  }

  return { root, sourceFile };
}

function dependencies(log: string[], seenMediaRoots: string[]): RunCharacterReferenceOnboardingCliDependencies {
  return {
    registerReference: (input) => {
      seenMediaRoots.push(input.mediaRoot);
      return registerCharacterReferenceAsset(input);
    },
    approveIdentity: (input) => {
      seenMediaRoots.push(input.mediaRoot);
      // D1 creation is v1-only (D-2): approve against the frozen pre-1137E fixture, not the live v2 config.
      return approveCharacterVisualIdentity(input, {
        readCharacterBibleDocument: async () => JSON.parse(readFileSync(V1_FIXTURE, "utf8")),
      });
    },
    verifyIdentity: () => {
      throw new Error("verify-identity is not exercised by these approval tests");
    },
    loadCharacterBible: async () => JSON.parse(readFileSync(V1_FIXTURE, "utf8")),
    readRequest: async (path) => JSON.parse(await readFile(path, "utf8")),
    log: (line) => log.push(line),
  };
}

function ollieRequest(overrides: Json = {}): Json {
  return {
    referenceBindings: [{ role: "MASTER_IDENTITY", assetId: ASSET_ID }],
    defaultStateDecisions: [
      { itemKey: "BACKPACK", source: { field: "appearance.outfit", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "teal explorer backpack" },
      { itemKey: "PENDANT", source: { field: "appearance.accessories", index: 0 }, disposition: "DEFAULT_STATE_ITEM", approvedDescription: "small compass pendant" },
      { itemKey: "SATCHEL", source: { field: "appearance.accessories", index: 1 }, disposition: "EXCLUDED_SHOT_OR_STORY_STATE" },
    ],
    acceptanceAttestations: Object.fromEntries(CHARACTER_REFERENCE_ACCEPTANCE_RULES.map((rule) => [rule, true])),
    ...overrides,
  };
}

async function registerViaCli(root: string, sourceFile: string, log: string[], seen: string[], digest?: string) {
  await runCharacterReferenceOnboardingCli([
    "register-reference",
    "--media-root", root,
    "--source-file", sourceFile,
    "--asset-id", ASSET_ID,
    "--expected-registry-sha256", digest ?? await readVisualReferenceRegistrySha256(root),
  ], dependencies(log, seen));
}

describe("character reference onboarding CLI arguments", () => {
  it("rejects unknown subcommands, unknown or duplicate flags and missing options", () => {
    expect(() => parseCharacterReferenceOnboardingCliArgs([])).toThrow(/Unknown character reference onboarding subcommand/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["activate-identity"])).toThrow(/Unknown/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["register-reference", "--media-root", "/m", "--character-id", "OLLIE"]))
      .toThrow(/Unknown register-reference argument/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["approve-identity", "--media-root", "/m", "--media-root", "/n"]))
      .toThrow(/Duplicate/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["register-reference", "--media-root", "/m", "--asset-id", ASSET_ID]))
      .toThrow(/requires --source-file/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["approve-identity", "--media-root", "/m", "--character-id", "OLLIE", "--identity-version", "1.5", "--request", "r.json"]))
      .toThrow(/positive integer/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["register-reference", "--media-root"])).toThrow(/requires a value/);
  });

  it("never defaults or relativises the media root", () => {
    expect(() => parseCharacterReferenceOnboardingCliArgs(["register-reference", "--source-file", "/x.png", "--asset-id", ASSET_ID, "--expected-registry-sha256", "0".repeat(64)]))
      .toThrow(/requires --media-root/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["approve-identity", "--media-root", "relative/root", "--character-id", "OLLIE", "--identity-version", "1", "--request", "r.json"]))
      .toThrow(/absolute/);
  });

  it("has no production media-root default, environment or git dependency in the onboarding modules", () => {
    for (const file of [
      "../src/characterIdentity/cli/characterReferenceOnboarding.ts",
      "../src/characterIdentity/onboardCharacterVisualIdentity.ts",
      "../src/characterIdentity/createCharacterVisualIdentityApproval.ts",
      "../src/characterIdentity/validateCharacterVisualIdentityApproval.ts",
      "../src/characterIdentity/readCharacterVisualIdentityApproval.ts",
      "../src/characterIdentity/characterVisualIdentityApprovalPath.ts",
      "../src/execution/appendVisualReferenceAssetRegistry.ts",
    ]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");

      expect(text, file).not.toMatch(/D:[\\/]|Busybookie[\\/]Production|BUSYBOOKIE_MEDIA_ROOT|process\.env|loadEnvironment|validateMediaRoot|dotenv|child_process|\bgit\b/);
    }
  });
});

describe("character reference onboarding CLI", () => {
  it("register-reference appends against a temporary media root and prints the evidence", async () => {
    const { root, sourceFile } = await mediaRoot();
    const log: string[] = [];
    const seen: string[] = [];

    await registerViaCli(root, sourceFile, log, seen);

    const output = JSON.parse(log[0]!);
    expect(output.result).toBe("REFERENCE_REGISTERED");
    expect(output.entry.assetId).toBe(ASSET_ID);
    expect(output.registrySha256).toBe(await readVisualReferenceRegistrySha256(root));
    expect(seen).toEqual([root]);
  });

  it("register-reference fails on a missing registry and on a wrong expected digest", async () => {
    const missing = await mediaRoot(false);
    await expect(registerViaCli(missing.root, missing.sourceFile, [], [], "0".repeat(64))).rejects.toThrow(/does not exist/);
    await expect(readFile(createVisualReferenceAssetRegistryPath(missing.root))).rejects.toMatchObject({ code: "ENOENT" });

    const wrong = await mediaRoot();
    await expect(registerViaCli(wrong.root, wrong.sourceFile, [], [], "0".repeat(64))).rejects.toThrow(/registry changed/);
  });

  it("approve-identity records the receipt from an operational request file", async () => {
    const { root, sourceFile } = await mediaRoot();
    const log: string[] = [];
    const seen: string[] = [];
    await registerViaCli(root, sourceFile, log, seen);

    const requestPath = join(root, "ollie-request.json");
    await writeFile(requestPath, JSON.stringify(ollieRequest()));

    await runCharacterReferenceOnboardingCli([
      "approve-identity", "--media-root", root, "--character-id", "OLLIE", "--identity-version", "1", "--request", requestPath,
    ], dependencies(log, seen));

    const output = JSON.parse(log[1]!);
    expect(output).toMatchObject({ result: "IDENTITY_APPROVAL_RECORDED", characterId: "OLLIE", targetIdentityVersion: 1, activationEffect: "NONE_EVIDENCE_ONLY" });
    expect(output.approvalPath.startsWith(root)).toBe(true);
    expect(await readFile(output.approvalPath, "utf8")).not.toBe(await readFile(requestPath, "utf8"));
    expect(seen).toEqual([root, root]);
  });

  it("approve-identity rejects requests that inject trusted values", async () => {
    const { root, sourceFile } = await mediaRoot();
    await registerViaCli(root, sourceFile, [], []);

    for (const injection of [{ approvalId: "9b1f6a3e-2c4d-4e5f-8a7b-1c2d3e4f5a6b" }, { approvedAt: "2020-01-01T00:00:00.000Z" }]) {
      const requestPath = join(root, "injected.json");
      await writeFile(requestPath, JSON.stringify(ollieRequest(injection)));

      await expect(runCharacterReferenceOnboardingCli([
        "approve-identity", "--media-root", root, "--character-id", "OLLIE", "--identity-version", "1", "--request", requestPath,
      ], dependencies([], []))).rejects.toThrow(/operator request is invalid/);
    }
  });
});

describe("character reference onboarding CLI verify-identity", () => {
  const CLI_PATH = fileURLToPath(new URL("../src/characterIdentity/cli/characterReferenceOnboarding.ts", import.meta.url));
  const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

  function verifyDependencies(log: string[], bible: Json, calls: string[]): RunCharacterReferenceOnboardingCliDependencies {
    return {
      registerReference: () => { throw new Error("verify-identity must not register references"); },
      approveIdentity: () => { throw new Error("verify-identity must not create approvals"); },
      verifyIdentity: (input) => {
        calls.push(input.characterId);
        return verifyCharacterVisualIdentityApprovalForConsumption(input);
      },
      loadCharacterBible: async () => bible,
      readRequest: () => { throw new Error("verify-identity must not read a request"); },
      log: (line) => log.push(line),
    };
  }

  function runCliProcess(args: string[]) {
    return spawnSync(process.execPath, ["--import", "tsx", CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, BUSYBOOKIE_FFMPEG_PATH: "", BUSYBOOKIE_FFPROBE_PATH: "" },
    });
  }

  it("enforces its arguments", () => {
    expect(parseCharacterReferenceOnboardingCliArgs(["verify-identity", "--media-root", "/m", "--character-id", "OLLIE"]))
      .toEqual({ subcommand: "verify-identity", mediaRoot: "/m", characterId: "OLLIE" });
    expect(() => parseCharacterReferenceOnboardingCliArgs(["verify-identity", "--media-root", "/m"])).toThrow(/requires --character-id/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["verify-identity", "--character-id", "OLLIE"])).toThrow(/requires --media-root/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["verify-identity", "--media-root", "relative", "--character-id", "OLLIE"])).toThrow(/absolute/);
    expect(() => parseCharacterReferenceOnboardingCliArgs(["verify-identity", "--media-root", "/m", "--character-id", "OLLIE", "--request", "r.json"]))
      .toThrow(/Unknown verify-identity argument/);
  });

  it("prints consumption evidence through the consumption verifier only and writes nothing", async () => {
    const f = await createConsumptionFixture();
    roots.push(f.mediaRoot);
    const registryBefore = await readVisualReferenceRegistrySha256(f.mediaRoot);
    const log: string[] = [];
    const calls: string[] = [];

    await runCharacterReferenceOnboardingCli(["verify-identity", "--media-root", f.mediaRoot, "--character-id", "MONT"], verifyDependencies(log, f.bible, calls));

    const output = JSON.parse(log[0]!);
    expect(calls).toEqual(["MONT"]);
    expect(output).toMatchObject({
      result: "CONSUMPTION_VERIFIED",
      characterId: "MONT",
      identityVersion: 1,
      masterAssetId: "mont-master-identity-reference-v1",
      physicalVerification: "PASS",
      historicalSourceDigestEqualityRequired: false,
    });
    expect(output.traitDecisionEvidence.filter((evidence: Json) => evidence.historicalReceiptCorroboration)).toHaveLength(2);
    expect(await readVisualReferenceRegistrySha256(f.mediaRoot)).toBe(registryBefore);
  });

  it("fails without printing evidence when consumption verification fails", async () => {
    const f = await createConsumptionFixture();
    roots.push(f.mediaRoot);
    const log: string[] = [];
    await writeFile(f.masterPath("OLLIE"), Buffer.from("drifted"));

    await expect(runCharacterReferenceOnboardingCli(["verify-identity", "--media-root", f.mediaRoot, "--character-id", "OLLIE"], verifyDependencies(log, f.bible, [])))
      .rejects.toThrow(/consumption verification failed|mismatch/);
    expect(log).toEqual([]);
  });

  it("exits non-zero as a process on missing arguments and on failed verification", async () => {
    const { root } = await mediaRoot();

    const missing = runCliProcess(["verify-identity", "--media-root", root]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/requires --character-id/);

    const failed = runCliProcess(["verify-identity", "--media-root", root, "--character-id", "OLLIE"]);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/Character visual identity consumption verification failed: OLLIE IV1 receipt unavailable/);
    expect(failed.stdout).toBe("");
  }, 30000);
});
