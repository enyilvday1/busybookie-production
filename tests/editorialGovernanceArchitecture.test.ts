import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Dedicated E6 architecture guard (Step 1103 section 11, G1-G5). It locates src/editorialGovernance by exact
// directory identity; it never uses a string-prefix test that would conflate it with src/editorial.
const srcRoot = resolve(fileURLToPath(new URL("../src/", import.meta.url)));
const scriptsRoot = resolve(fileURLToPath(new URL("../scripts/", import.meta.url)));
const governanceDirectory = resolve(srcRoot, "editorialGovernance");
const editorialDirectory = resolve(srcRoot, "editorial");
const GOVERNANCE_FILES = ["editorialGovernancePaths.ts", "editorialGovernanceStore.ts"];
const PLATFORM_IMPORTS = ["node:fs", "node:fs/promises", "node:path", "node:crypto"];
const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
  "editorialGovernancePaths.ts": PLATFORM_IMPORTS,
  "editorialGovernanceStore.ts": [...PLATFORM_IMPORTS, "./editorialGovernancePaths.js"],
};
const E6_PURE_SOURCES = [
  "editorialProposal.schema.ts", "editorialReview.schema.ts", "editorialRevision.schema.ts",
  "deriveEditorialGovernanceState.ts", "applyEditorialProposal.ts",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".ts") ? [path] : [];
  });
}
// Exact containment by path.relative: true only for the directory itself or a real descendant.
function within(directory: string, path: string): boolean {
  const rel = relative(directory, resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
// Every static/re-export specifier, plus forbidden dynamic/CommonJS/process forms.
export function governanceImportViolations(fileName: string, text: string): string[] {
  const allowed = ALLOWED_IMPORTS[fileName] ?? PLATFORM_IMPORTS;
  const violations: string[] = [];
  for (const match of text.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g)) {
    if (!allowed.includes(match[1]!)) violations.push(`forbidden import ${match[1]}`);
  }
  if (/\bimport\s*\(/.test(text)) violations.push("dynamic import");
  if (/\brequire\s*\(/.test(text)) violations.push("require");
  if (/child_process|\bspawn\b|\bexecFile\b/.test(text)) violations.push("process launch");
  return violations;
}

describe("E6 dedicated src/editorialGovernance guard (category 21)", () => {
  it("G1 identifies the governance directory itself, distinct from src/editorial", () => {
    expect(governanceDirectory.endsWith(`${sep}editorialGovernance`)).toBe(true);
    expect(within(editorialDirectory, governanceDirectory)).toBe(false);
    expect(within(governanceDirectory, editorialDirectory)).toBe(false);
    // The legacy prefix filter would wrongly treat this directory as inside src/editorial.
    expect(governanceDirectory.startsWith(editorialDirectory)).toBe(true);
  });

  it("G2 exact production inventory: two files, no subdirectories", () => {
    const entries = readdirSync(governanceDirectory, { withFileTypes: true });
    expect(entries.filter((entry) => !entry.isFile()).map((entry) => entry.name)).toStrictEqual([]);
    expect(entries.map((entry) => entry.name).sort()).toStrictEqual(GOVERNANCE_FILES);
  });

  it("G3/G4 both modules import only the bytes-only platform allowlist (store also its sibling path module)", () => {
    for (const name of GOVERNANCE_FILES) {
      const text = readFileSync(join(governanceDirectory, name), "utf8");
      expect(governanceImportViolations(name, text), name).toStrictEqual([]);
      expect(text, name).not.toMatch(/editorial\/|canonicalEditorialJson|editorialSha256|\.\.\//);
    }
  });

  it("G5 negative self-test: prohibited imports are detected", () => {
    const store = "editorialGovernanceStore.ts";
    expect(governanceImportViolations(store, 'import { x } from "../editorial/editorialProposal.schema.js";')).toContain("forbidden import ../editorial/editorialProposal.schema.js");
    expect(governanceImportViolations(store, 'import type { y } from "../application/runEpisode.js";').length).toBe(1);
    expect(governanceImportViolations(store, 'export { z } from "../operatorServer/server.js";').length).toBe(1);
    expect(governanceImportViolations(store, 'import "../runway/client.js";').length).toBe(1);
    expect(governanceImportViolations(store, 'const m = await import("node:fs");')).toContain("dynamic import");
    expect(governanceImportViolations(store, 'import { spawn } from "node:child_process";').length).toBe(2);
    expect(governanceImportViolations("editorialGovernancePaths.ts", 'import { a } from "./editorialGovernancePaths.js";').length).toBe(1);
    expect(governanceImportViolations(store, 'import { a } from "./editorialGovernancePaths.js";')).toStrictEqual([]);
  });

  it("no production module adopts E6 governance (no API/CLI/UI/runner); only tests compose the core and adapter", () => {
    const production = [...sourceFiles(srcRoot), ...sourceFiles(scriptsRoot)].filter((path) => !within(governanceDirectory, path));
    for (const path of production) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/editorialGovernance\//);
      if (!within(editorialDirectory, path)) expect(text, path).not.toMatch(/from\s+["'][^"']*editorial\//);
    }
  });
});

describe("E6 pure modules: inventory 51, purity and roadmap boundaries (category 21)", () => {
  it("the five pure E6 modules are in src/editorial and the editorial inventory is exactly 51", () => {
    const names = sourceFiles(editorialDirectory).map((path) => path.slice(path.lastIndexOf(sep) + 1));
    expect(names).toHaveLength(51);
    for (const name of E6_PURE_SOURCES) expect(names, name).toContain(name);
    expect(sourceFiles(editorialDirectory).some((path) => within(governanceDirectory, path))).toBe(false);
  });

  it("pure E6 modules: no fs, process, clock, randomness, tool launch, media, providers or E7-E11 concerns", () => {
    for (const name of E6_PURE_SOURCES) {
      const text = readFileSync(join(editorialDirectory, name), "utf8");
      expect(text, name).not.toMatch(/node:fs|from\s+["']fs|child_process|process\.|dotenv|import\(|spawn|exec[A-Z(]|Date\.now|new Date|Math\.random/);
      for (const specifier of text.matchAll(/from\s+["']([^"']+)["']/g)) expect(specifier[1], name).toMatch(/^(zod|\.\/[A-Za-z0-9.]+\.js)$/);
      expect(text, name).not.toMatch(/OTIO|FCPXML|DaVinci|Resolve\b|CharacterBible|continuityLedger|@runwayml|@google\/genai|signature|EpisodeApprovals/);
    }
  });
});
