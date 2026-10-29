import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../src/schemas/productionRules.schema.js";
import { buildBoundEpisodePreflight } from "../src/execution/buildBoundEpisodePreflight.js";
import { rawSha256 } from "../src/execution/episodeInputBinding.js";
import type { RuntimeIdentity } from "../src/execution/boundEpisodeProduction.types.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(provider: "RUNWAY" | "GOOGLE_GENAI" = "RUNWAY") {
  const root = await mkdtemp(join(process.cwd(), ".b7-plan-")); roots.push(root);
  const repositoryRoot = join(root, "repo"); const mediaRoot = join(root, "media");
  await mkdir(join(repositoryRoot, "episodes/EP02"), { recursive: true });
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  await mkdir(join(mediaRoot, "references"), { recursive: true });
  const episode = EpisodeManifestSchema.parse(JSON.parse(await readFile("episodes/EP02/episode.json", "utf8")));
  episode.status = "IN_PRODUCTION"; episode.approvals.script = "APPROVED";
  episode.approvals.storyboard = "APPROVED"; episode.approvals.references = "APPROVED";
  const template = episode.scenes[0]!.shots[0]!;
  const shot = (id: string, order: number) => ({ ...structuredClone(template), id, order,
    references: { required: true, assetIds: ["ref"], approvalStatus: "APPROVED" as const },
    generation: { provider, nativeAudio: false, status: "APPROVED_FOR_GENERATION" as const } });
  episode.scenes = [{ ...episode.scenes[0]!, id: "SC02", shots: [shot("S10", 3), shot("S11", 1)] },
    { ...episode.scenes[0]!, id: "SC01", shots: [shot("S01", 2)] }];
  for (const name of ["characters.json", "provider-routing-policy.json", "runway-policy.json", "veo-policy.json", "google-genai-policy.json", "google-genai-activation-policy.json"]) {
    await writeFile(join(repositoryRoot, "config", name), await readFile(join("config", name)));
  }
  const rules = ProductionRulesSchema.parse(JSON.parse(await readFile("config/production-rules.json", "utf8")));
  rules.storage.requireExternalMediaRoot = false;
  await writeFile(join(repositoryRoot, "config/production-rules.json"), JSON.stringify(rules));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==", "base64");
  await writeFile(join(mediaRoot, "references/ref.png"), png);
  const asset = { assetId: "ref", mediaRootRelativePath: "references/ref.png", bytes: png.length, sha256: rawSha256(png), contentType: "image/png" };
  await writeFile(join(mediaRoot, "references/visual-reference-asset-registry.json"), JSON.stringify({ schemaVersion: "1.0", assets: [asset] }));
  await writeFile(join(repositoryRoot, "runtime.txt"), "reviewed-runtime");
  const runtimeIdentity: RuntimeIdentity = { reviewedRevision: "a".repeat(40), repositoryRoot, mediaRoot, physicalMediaRoot: mediaRoot,
    executableInputs: [{ role: "RUNTIME", canonicalPath: join(repositoryRoot, "runtime.txt"), exists: true,
      rawSha256: rawSha256("reviewed-runtime"), bytes: 16 }], ffprobe: null };
  const manifest = join(repositoryRoot, "episodes/EP02/episode.json");
  const save = () => writeFile(manifest, JSON.stringify(episode)); await save();
  return { episode, save, manifest, root, repositoryRoot, mediaRoot, runtimeIdentity, asset,
    input: { episodeId: "EP02", mediaRoot, runtimeIdentity } };
}
async function snapshot(path: string): Promise<unknown> {
  const rows: unknown[] = [];
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(path, entry.name);
    rows.push([entry.name, entry.isDirectory() ? await snapshot(child) : rawSha256(await readFile(child))]);
  }
  return rows;
}
describe("full read-only episode preflight", () => {
  it("the actual plan-only CLI imports no credential loader and leaves an absent lifecycle tree absent", async () => {
    const f = await fixture(); const before = await snapshot(f.mediaRoot);
    const script = `const {runEpisodeAutomationCli}=await import(process.argv[1]); await runEpisodeAutomationCli(['--episode','EP02','--plan-only','--json']);`;
    const child = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script,
      new URL("../src/execution/cli/runEpisodeAutomationCli.ts", import.meta.url).href], {
      windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, BUSYBOOKIE_MEDIA_ROOT: f.mediaRoot },
    }).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === 1 && "stdout" in error && typeof error.stdout === "string") return { stdout: error.stdout };
      throw error;
    });
    const report: unknown = JSON.parse(child.stdout);
    expect(report).toMatchObject({ schemaVersion: "2.0", episodeId: "EP02", completion: "INCOMPLETE" });
    expect(child.stdout).not.toMatch(/injected env|confirmPaidGeneration|API_SECRET|API_KEY/);
    expect(await snapshot(f.mediaRoot)).toEqual(before);
  }, 35000);
  it("reports native units, refuses unknown or over-cap selected costs, and labels sum overflow incomplete", async () => {
    const f = await fixture();
    const later = f.episode.scenes[0]!.shots[0]!;
    later.generation.provider = "VEO"; later.generation.nativeAudio = true; later.durationSeconds = 8; await f.save();
    const mixed = await buildBoundEpisodePreflight(f.input);
    expect(mixed.shots[2]!.cost).toMatchObject({ status: "KNOWN", unit: "USD_CENTS", modeledValue: 80,
      normalizedMicroUsd: { status: "KNOWN", value: 800000 } });
    expect(mixed.shots[0]!.cost).toMatchObject({ normalizedMicroUsd: { status: "UNAVAILABLE" } });
    const policyPath = join(f.repositoryRoot, "config/runway-policy.json");
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.gen45.creditsPerSecond = 1000000000000000; policy.gen45.maxCreditsPerGeneration = 5000000000000000;
    await writeFile(policyPath, JSON.stringify(policy));
    const overflow = await buildBoundEpisodePreflight(f.input);
    expect(overflow.costs.readyByNativeUnit).toContainEqual(expect.objectContaining({ unit: "RUNWAY_CREDITS", complete: false }));
    policy.gen45.creditsPerSecond = 12; policy.gen45.maxCreditsPerGeneration = 48;
    await writeFile(policyPath, JSON.stringify(policy));
    const capped = await buildBoundEpisodePreflight(f.input);
    expect(capped.shots[0]!.cost.status).toBe("UNKNOWN"); expect(capped.nextActionCandidate).toBeNull();
    await rm(policyPath);
    const unknown = await buildBoundEpisodePreflight(f.input);
    expect(unknown.shots[0]!.disposition).toBe("ERROR"); expect(unknown.nextActionCandidate).toBeNull();
  });
  it("retains every shot in numeric order, reconciles counts, and never writes or uses a provider", async () => {
    const f = await fixture();
    f.episode.scenes[0]!.shots[0]!.generation.status = "PLANNED"; await f.save();
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider network tripwire"));
    const before = await snapshot(f.root);
    const result = await buildBoundEpisodePreflight(f.input);
    expect(result.inventory.fatalReasons).toEqual([]);
    expect(result.shots.map(shot => [shot.sceneId, shot.shotId, shot.order])).toEqual([["SC02", "S11", 1], ["SC01", "S01", 2], ["SC02", "S10", 3]]);
    expect(result.totalIntended).toBe(3);
    expect(Object.values(result.counts.episode).reduce((a, b) => a + b, 0)).toBe(3);
    expect(result.shots[2]!.disposition).toBe("NOT_READY");
    expect(result.nextActionCandidate?.shotId).toBe("S11");
    expect(await snapshot(f.root)).toEqual(before);
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("confirmPaidGeneration");
    expect(result.costs.readyByNativeUnit).toEqual([{ unit: "RUNWAY_CREDITS", value: 120, count: 2, complete: true }]);
  });
  it("blocks disabled Google with original admission code and no network", async () => {
    const f = await fixture("GOOGLE_GENAI");
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider network tripwire"));
    const result = await buildBoundEpisodePreflight(f.input);
    expect(result.shots[0]!.disposition).toBe("BLOCKED");
    expect(result.shots[0]!.reasons).toContainEqual(expect.objectContaining({ code: "PROVIDER_ACTIVATION_BLOCKED",
      lowerCause: expect.objectContaining({ code: "NEW_SUBMISSIONS_DISABLED", stage: "ADMISSION", stateChange: "NONE" }) }));
    expect(result.shots[0]!.cost).toMatchObject({ status: "KNOWN", unit: "MICRO_USD", modeledValue: 1513600, billingKnown: false });
    expect(result.nextActionCandidate).toBeNull(); expect(network).not.toHaveBeenCalled();
  });
  it("cannot skip the episode frontier using a selected subset", async () => {
    const f = await fixture();
    const result = await buildBoundEpisodePreflight({ ...f.input, scope: { kind: "SELECTED_SCOPE", shotIds: ["S01", "S10"] } });
    expect(result.shots).toHaveLength(3); expect(result.scopeTotal).toBe(2);
    expect(result.nextActionCandidate).toBeNull(); expect(result.completion).toBe("INCOMPLETE");
    await expect(buildBoundEpisodePreflight({ ...f.input, scope: { kind: "SELECTED_SCOPE", shotIds: ["S10", "S01"] } })).rejects.toThrow();
  });
  it("invalid manifest reports an unknown total and no invented shot list", async () => {
    const f = await fixture(); await writeFile(f.manifest, "{invalid");
    const result = await buildBoundEpisodePreflight(f.input);
    expect(result.totalIntended).toBeNull(); expect(result.shots).toEqual([]);
    expect(result.inventory.complete).toBe(false); expect(result.nextActionCandidate).toBeNull();
  });
  it("binds optional authorization absence and detects drift on review comparison", async () => {
    const f = await fixture(); const before = await buildBoundEpisodePreflight(f.input);
    expect(before.binding?.fileBindings.filter(file => file.role.startsWith("AUTHORIZATION:")).every(file => !file.exists)).toBe(true);
    await writeFile(join(f.repositoryRoot, "config/runway-policy.json"), "{}");
    const result = await buildBoundEpisodePreflight({ ...f.input, expectedBinding: before.binding! });
    expect(result.nextActionCandidate).toBeNull(); expect(result.inventory.complete).toBe(false);
  });
  it("reports reference ambiguity without picking the first asset", async () => {
    const f = await fixture();
    const second = { ...f.asset, assetId: "ref2", mediaRootRelativePath: "references/ref2.png" };
    await writeFile(join(f.mediaRoot, second.mediaRootRelativePath), await readFile(join(f.mediaRoot, f.asset.mediaRootRelativePath)));
    await writeFile(join(f.mediaRoot, "references/visual-reference-asset-registry.json"), JSON.stringify({ schemaVersion: "1.0", assets: [f.asset, second] }));
    f.episode.scenes[0]!.shots[1]!.references.assetIds.push("ref2"); await f.save();
    const result = await buildBoundEpisodePreflight(f.input);
    expect(result.shots[0]!.referenceBindings).toHaveLength(2);
    expect(result.shots[0]!.selectedReference).toBeNull();
    expect(result.shots[0]!.reasons).toContainEqual(expect.objectContaining({ code: "REFERENCE_SELECTION_REQUIRED" }));
    expect(result.nextActionCandidate).toBeNull();
  });
});
