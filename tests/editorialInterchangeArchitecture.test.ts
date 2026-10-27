import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Dedicated E7 architecture guard (Step 1118 section 18, Step 1120 section 12). It locates src/editorialInterchange by
// exact directory identity (never a string-prefix test that would conflate it with src/editorial).
const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const srcRoot = resolve(repoRoot, "src");
const scriptsRoot = resolve(repoRoot, "scripts");
const testsRoot = resolve(repoRoot, "tests");
const editorialDirectory = resolve(srcRoot, "editorial");
const governanceDirectory = resolve(srcRoot, "editorialGovernance");
const interchangeDirectory = resolve(srcRoot, "editorialInterchange");
const E7_PURE_SOURCES = ["editorialInterchangeTimeline.schema.ts", "deriveEditorialInterchangeTimeline.ts", "serializeEditorialInterchangeOtio.ts"];
const E7_STORE_FILES = ["editorialInterchangePaths.ts", "editorialInterchangeStore.ts"];
const E7_TESTS = ["editorialInterchangeTimelineSchema.test.ts", "editorialInterchangeDerivation.test.ts", "editorialInterchangeOtioSerialization.test.ts",
  "editorialInterchangeStore.test.ts", "editorialInterchangeArchitecture.test.ts"];
const PLATFORM_IMPORTS = ["node:fs/promises", "node:path", "node:crypto"];
const ALLOWED_STORE_IMPORTS: Record<string, readonly string[]> = {
  "editorialInterchangePaths.ts": PLATFORM_IMPORTS,
  "editorialInterchangeStore.ts": [...PLATFORM_IMPORTS, "./editorialInterchangePaths.js", "../filesystem/hardLink.js"],
};
// Pre-E7 production sources pinned at master 5a827d16 (LF-normalized blob SHA-256 per path, LC_ALL=C path order).
// B6 authorizes the governance store migration; the other 49 pre-E7 sources remain frozen.
const PRE_E7_SOURCES_MANIFEST_SHA256 = "09eb6946ac1d09299b66c5cc4496c2788b6e4f4582d48dcb686f2f2cb6068e03";
// Built by concatenation so this guard never matches its own pattern text.
const LAUNCH = new RegExp(["child", "_process|\\bspawn", "\\(|\\bexec", "(File|Sync)?\\(|\\bfork\\("].join(""));
const MEDIA_TOOLS = new RegExp(["ff", "mpeg|ff", "probe|pyt", "hon|opentime", "lineio|otio", "tool|Da", "Vinci"].join(""), "i");
const NLE_CONTROL = new RegExp(["\\bResol", "ve\\b|resolve", "Api|fusion", "script"].join(""));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}
function within(directory: string, path: string): boolean {
  const rel = relative(directory, resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
const read = (path: string) => readFileSync(path, "utf8");
// Production scans ignore full-line comments (which cite the OTIO reference version and the absence of fallbacks).
const code = (path: string) => read(path).split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line)).join("\n");
const specifiers = (text: string) => [...text.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g)].map((m) => m[1]!);
export function interchangeStoreImportViolations(fileName: string, text: string): string[] {
  const allowed = ALLOWED_STORE_IMPORTS[fileName] ?? PLATFORM_IMPORTS;
  const violations = specifiers(text).filter((s) => !allowed.includes(s)).map((s) => `forbidden import ${s}`);
  if (/\bimport\s*\(/.test(text)) violations.push("dynamic import");
  if (/\brequire\s*\(/.test(text)) violations.push("require");
  if (LAUNCH.test(text)) violations.push("process launch");
  return violations;
}

describe("E7 dedicated src/editorialInterchange guard (category 24)", () => {
  it("identifies the interchange directory itself, distinct from src/editorial and src/editorialGovernance", () => {
    expect(interchangeDirectory.endsWith(`${sep}editorialInterchange`)).toBe(true);
    for (const other of [editorialDirectory, governanceDirectory]) {
      expect(within(other, interchangeDirectory)).toBe(false);
      expect(within(interchangeDirectory, other)).toBe(false);
    }
    // A string-prefix filter would wrongly treat this directory as inside src/editorial.
    expect(interchangeDirectory.startsWith(editorialDirectory)).toBe(true);
  });

  it("exact production inventory: two files, no subdirectories", () => {
    const entries = readdirSync(interchangeDirectory, { withFileTypes: true });
    expect(entries.filter((entry) => !entry.isFile()).map((entry) => entry.name)).toStrictEqual([]);
    expect(entries.map((entry) => entry.name).sort()).toStrictEqual(E7_STORE_FILES);
  });

  it("store modules import only the bytes-only platform allowlist (store also its sibling paths module)", () => {
    for (const name of E7_STORE_FILES) {
      const text = code(join(interchangeDirectory, name));
      expect(interchangeStoreImportViolations(name, text), name).toStrictEqual([]);
      expect(text.replace('"../filesystem/hardLink.js"', '"hardLink"'), name).not.toMatch(/editorial\/|editorialGovernance|canonicalEditorialJson|editorialSha256|\.\.\//);
      expect(text, name).not.toMatch(MEDIA_TOOLS);
      expect(text, name).not.toMatch(/process\.|dotenv|fetch\(|https?:/);
    }
    expect(specifiers(read(join(interchangeDirectory, "editorialInterchangeStore.ts")))).toContain("./editorialInterchangePaths.js");
  });

  it("store uses the central hard-link operation and lstat with no copy/rename fallback or injectable primitive", () => {
    const text = code(join(interchangeDirectory, "editorialInterchangeStore.ts"));
    expect(text).toContain('import { attemptHardLink } from "../filesystem/hardLink.js"');
    expect(text).toMatch(/import \{[^}]*\blstat\b[^}]*\} from "node:fs\/promises"/);
    expect(text).not.toMatch(/import \{[^}]*\blink\b[^}]*\} from "node:fs\/promises"/);
    expect(text).not.toMatch(/\b(rename|copyFile|cp|symlink|writeFile\(finalPath)\b/);
    expect(text).not.toMatch(/linkFile|linkImpl|options\./);
    // lstat precedes any open of the final path inside the trusted-read routine.
    const routine = text.slice(text.indexOf("async function readTrustedRegularFile"), text.indexOf("const sameBytes"));
    expect(routine.indexOf("lstat(")).toBeGreaterThan(-1);
    expect(routine.indexOf("lstat(")).toBeLessThan(routine.indexOf("open("));
  });

  it("negative self-test: prohibited imports and launches are detected", () => {
    const store = "editorialInterchangeStore.ts";
    expect(interchangeStoreImportViolations(store, 'import { x } from "../editorial/editorialInterchangeTimeline.schema.js";'))
      .toContain("forbidden import ../editorial/editorialInterchangeTimeline.schema.js");
    expect(interchangeStoreImportViolations(store, 'import { y } from "../editorialGovernance/editorialGovernanceStore.js";').length).toBe(1);
    expect(interchangeStoreImportViolations(store, 'export { z } from "../operatorServer/server.js";').length).toBe(1);
    expect(interchangeStoreImportViolations(store, 'import "node:fs";').length).toBe(1);
    expect(interchangeStoreImportViolations(store, 'const m = await import("node:fs/promises");')).toContain("dynamic import");
    expect(interchangeStoreImportViolations(store, `import { spawn } from "node:child${"_"}process";`).length).toBe(2);
    expect(interchangeStoreImportViolations("editorialInterchangePaths.ts", 'import { a } from "./editorialInterchangePaths.js";').length).toBe(1);
    expect(interchangeStoreImportViolations(store, 'import { a } from "./editorialInterchangePaths.js";')).toStrictEqual([]);
    expect(MEDIA_TOOLS.test(`const t = "ff${"mpeg"}";`)).toBe(true);
    expect(LAUNCH.test(`exec${"File"}("x")`)).toBe(true);
  });
});

describe("E7 pure modules (category 24, T22 compatible)", () => {
  it("the three pure modules live in src/editorial; editorial inventory is exactly 51", () => {
    const names = sourceFiles(editorialDirectory).map((path) => path.slice(path.lastIndexOf(sep) + 1));
    expect(names).toHaveLength(51);
    for (const name of E7_PURE_SOURCES) expect(names, name).toContain(name);
    expect(sourceFiles(editorialDirectory).some((path) => within(interchangeDirectory, path) || within(governanceDirectory, path))).toBe(false);
  });

  it("pure modules: zod, node:crypto, node:path or sibling imports only; no fs, process, clock, randomness, locale order or launch", () => {
    for (const name of E7_PURE_SOURCES) {
      const text = code(join(editorialDirectory, name));
      for (const specifier of specifiers(text)) expect(specifier, name).toMatch(/^(zod|node:crypto|node:path|\.\/[A-Za-z0-9.]+\.js)$/);
      expect(text, name).not.toMatch(/node:fs|from\s+["']fs|process\.|dotenv|import\(|require\(|Date\b|Math\.random|randomUUID|randomBytes|localeCompare|Intl\./);
      expect(text, name).not.toMatch(LAUNCH);
      expect(text, name).not.toMatch(/fetch\(|https?:\/\/|@runwayml|@google\/genai/);
    }
  });

  it("no Python, OpenTimelineIO runtime, plugin, adapter or subprocess bridge in production; package has no such dependency (AC7-23)", () => {
    for (const path of [...E7_PURE_SOURCES.map((n) => join(editorialDirectory, n)), ...E7_STORE_FILES.map((n) => join(interchangeDirectory, n))]) {
      const text = code(path);
      expect(text, path).not.toMatch(new RegExp(["pyt", "hon|\\.py\\b|OTIO_PLUGIN|plugin_manifest|adapters?\\.|opentime", "lineio\\b"].join(""), "i"));
      // The adapter name (lowercase) never appears; the frozen output-format literal "OTIO_JSON" is not an adapter.
      expect(text, path).not.toMatch(new RegExp(["\\botio", "_json\\b"].join("")));
    }
    const pkg = JSON.parse(read(join(repoRoot, "package.json")));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies });
    expect(deps.filter((d) => /otio|opentimeline|python|pyodide/i.test(d))).toStrictEqual([]);
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/otio|python|opentimeline/i);
  });

  it("MissingReference is never emitted and the legacy singular media_reference key is never produced", () => {
    const serializer = read(join(editorialDirectory, "serializeEditorialInterchangeOtio.ts"));
    expect(serializer).not.toMatch(/["']MissingReference/);
    expect(serializer).not.toMatch(/\bmedia_reference\b(?!s)/);
    expect(serializer).toMatch(/media_references: \{ DEFAULT_MEDIA: reference \}, active_media_reference_key: "DEFAULT_MEDIA"/);
  });

  it("eligibility uses the exported E6 functions and the public E2-E5 builders (m1118-1)", () => {
    const text = read(join(editorialDirectory, "deriveEditorialInterchangeTimeline.ts"));
    for (const fn of ["validateEditorialSubjectPartition", "editorialHistoryHead", "revisionResultAuthority", "hashEditorialDecisionStateV1",
      "premasterEvidenceApplicable", "buildEditorialPlanV2", "buildEditorialPlanV3", "planEditorialRenderV3", "checkMasteringDecisionsAgainstSource",
      "buildAudioMasteringPlan"]) expect(text, fn).toMatch(new RegExp(`\\b${fn}\\b`));
    // No E6 write path: no planning of governance writes, no store import.
    expect(text).not.toMatch(/planEditorial(Genesis|ProposalWrite|ReviewWrite|ProposalApplication)|editorialGovernance\/|publishEditorialGovernanceRecord/);
  });
});

describe("boundaries: no adoption, E6 unchanged, E8-E11 excluded (category 24)", () => {
  it("no production module outside the five E7 modules imports E7 (test-only composition; no API/CLI)", () => {
    const own = new Set([...E7_PURE_SOURCES.map((n) => join(editorialDirectory, n)), ...E7_STORE_FILES.map((n) => join(interchangeDirectory, n))]);
    const production = [...sourceFiles(srcRoot), ...sourceFiles(scriptsRoot)].filter((path) => !own.has(path));
    expect(production.length).toBeGreaterThan(100);
    for (const path of production) {
      const text = read(path);
      expect(text, path).not.toMatch(/editorialInterchange|deriveEditorialInterchangeTimeline|serializeEditorialInterchangeOtio/);
    }
  });

  it("pre-E7 sources remain frozen except the authorized B6 governance store migration (AC7-01)", () => {
    const e7 = new Set(E7_PURE_SOURCES);
    const files = [...sourceFiles(editorialDirectory).filter((p) => !e7.has(p.slice(p.lastIndexOf(sep) + 1))), ...sourceFiles(governanceDirectory)]
      .map((p) => relative(repoRoot, p).split(sep).join("/")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(files).toHaveLength(50);
    const frozen = files.filter((p) => p !== "src/editorialGovernance/editorialGovernanceStore.ts");
    expect(frozen).toHaveLength(49);
    const manifest = frozen.map((p) => `${createHash("sha256").update(read(join(repoRoot, p)).replace(/\r\n/g, "\n"), "utf8").digest("hex")}  ${p}\n`).join("");
    expect(createHash("sha256").update(manifest, "utf8").digest("hex")).toBe(PRE_E7_SOURCES_MANIFEST_SHA256);
  });

  it("E7 modules contain no E8 reconciliation/import, E9 character, E10 provider or E11 delivery/social code (AC7-30, AC7-31)", () => {
    for (const path of [...E7_PURE_SOURCES.map((n) => join(editorialDirectory, n)), ...E7_STORE_FILES.map((n) => join(interchangeDirectory, n))]) {
      const text = code(path);
      expect(text, path).not.toMatch(NLE_CONTROL);
      expect(text, path).not.toMatch(/reconcil|importTimeline|readOtio|parseOtio|roundTrip|FCPXML|\bAAF\b|\bEDL\b/i);
      expect(text, path).not.toMatch(MEDIA_TOOLS);
      expect(text, path).not.toMatch(/CharacterBible|characterIdentity|continuityLedger|EpisodeApprovals/);
      expect(text, path).not.toMatch(/\b(VEO|RUNWAY|providerExecutionId|providerRouting)\b|@runwayml|@google\/genai/);
      expect(text, path).not.toMatch(/youtube|tiktok|instagram|socialPublish|publishSocial|\bupload\b|deliveryArtifact/i);
    }
  });

  it("E7 tests never launch processes or media/provider tools (AC7-32)", () => {
    for (const name of E7_TESTS) {
      const text = read(join(testsRoot, name));
      expect(text, name).not.toMatch(LAUNCH);
      // This guard file itself carries the forbidden names as pattern text; the behavioural E7 tests must not use them.
      if (name !== "editorialInterchangeArchitecture.test.ts") {
        expect(text, name).not.toMatch(new RegExp(["process\\.e", "nv|dot", "env|RUNWAYML_API_", "SECRET|GEMINI_API_", "KEY|GOOGLE_API_", "KEY"].join("")));
      }
      for (const specifier of specifiers(text)) {
        expect(specifier, name).toMatch(/^(vitest|node:(fs|os|path|url|crypto)|\.\.\/src\/(editorial|editorialInterchange|composition|schemas)\/[A-Za-z0-9.]+\.js)$/);
      }
    }
  });
});
