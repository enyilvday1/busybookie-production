import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAst } from "rolldown/parseAst";
import { describe, expect, it } from "vitest";
import * as protocol from "../src/index.js";

const srcUrl = new URL("../src/", import.meta.url);
const src = fileURLToPath(srcUrl);
const allowedExports = [
  "F6ProtocolError", "canonicalizeF6Document", "compareF6ManifestToExpectedResourcePolicy",
  "parseF6AdmissionReceipt", "parseF6ContainmentReceipt", "parseF6Lease",
  "parseF6RunManifest", "sha256F6Document", "strictJsonDecode", "validateF6Transition",
].sort();

// Intentional sealed F6-v1 runtime inventory. New modules require security review.
// This also refuses unscanned .js/.mjs/.cjs/.tsx and unexpected directories.
const approvedSourceFiles = [
  "admissionReceipt.ts", "canonicalEncoding.ts", "containmentReceipt.ts",
  "errors.ts", "index.ts", "leaseContract.ts", "runManifest.ts",
  "stateMachine.ts", "strictJsonDecode.ts",
].sort();
const allowedRelativeModules = new Set(
  approvedSourceFiles.map(name => `./${name.slice(0, -3)}.js`),
);

// The AST parser is a directly pinned ROOT devDependency, not a runtime import.
// TypeScript 7.0.2 no longer exports the classic createSourceFile API.
// Missing Rolldown fails test collection rather than silently skipping checks.
type ASTObject = Record<string, unknown>;
function objectOf(value: unknown): ASTObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ASTObject : null;
}

function inventoryViolations(names: readonly string[]): string[] {
  if (names.length !== approvedSourceFiles.length
      || names.slice().sort().some((name, i) => name !== approvedSourceFiles[i])) {
    return ["runtime source inventory differs from sealed F6-v1 list"];
  }
  return [];
}

function sourceBoundaryViolations(filename: string, content: string): string[] {
  const violations: string[] = [];
  let visited = 0;
  const seen = new WeakSet<object>();

  const checkSpecifier = (value: unknown): string | null => {
    const literal = objectOf(value);
    const name = literal?.value;
    if (typeof name !== "string") {
      violations.push("non-literal module specifier");
      return null;
    }
    if (name !== "node:crypto" && !allowedRelativeModules.has(name)) {
      violations.push(`unapproved import or re-export: ${name}`);
    }
    return name;
  };

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const element of value) visit(element);
      return;
    }
    const node = objectOf(value);
    if (!node || seen.has(node)) return;
    seen.add(node);
    visited += 1;
    if (visited > 100_000) throw new Error("AST node budget exceeded");

    if (node.type === "ImportDeclaration") {
      const moduleName = checkSpecifier(node.source);
      const specs = node.specifiers;
      if (!Array.isArray(specs) || specs.length === 0) {
        violations.push("side-effect-only imports prohibited");
      }
      if (moduleName === "node:crypto") {
        const only = Array.isArray(specs) && specs.length === 1 ? objectOf(specs[0]) : null;
        const imported = objectOf(only?.imported);
        const local = objectOf(only?.local);
        if (node.importKind === "type" || !only || only.type !== "ImportSpecifier"
            || only.importKind === "type" || imported?.name !== "createHash"
            || local?.name !== "createHash") {
          violations.push("node:crypto may import only the named createHash value");
        }
      }
    }
    if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration")
        && node.source !== null && node.source !== undefined) {
      const moduleName = checkSpecifier(node.source);
      // Import permission is NOT re-export permission: never surface node:crypto.
      if (moduleName === "node:crypto") {
        violations.push("node:crypto re-export prohibited");
      }
    }
    if (node.type === "TSImportEqualsDeclaration") violations.push("import-equals declaration");
    if (node.type === "TSImportType") violations.push("import type expression");
    if (node.type === "ImportExpression") violations.push("dynamic import");
    if (node.type === "CallExpression") {
      const callee = objectOf(node.callee);
      if (callee?.type === "Import") violations.push("dynamic import");
      if (callee?.type === "Identifier" && typeof callee.name === "string"
          && ["require", "fetch", "eval", "Function"].includes(callee.name)) {
        violations.push(`forbidden call: ${callee.name}`);
      }
    }
    if (node.type === "Identifier" && typeof node.name === "string"
        && ["process", "globalThis", "Deno", "Bun", "require", "fetch", "eval",
            "Function", "WebSocket", "XMLHttpRequest"].includes(node.name)) {
      violations.push(`forbidden runtime identifier: ${node.name}`);
    }

    for (const [key, child] of Object.entries(node)) {
      if (key !== "parent") visit(child);
    }
  };

  try {
    const ast = parseAst(content, { lang: "ts", astType: "ts", sourceType: "module" }, filename);
    if (objectOf(ast)?.type !== "Program") return ["AST parser did not return a Program"];
    visit(ast);
  } catch (error) {
    violations.push(`AST parser/traversal failed: ${String(error)}`);
  }
  return violations;
}

describe("F6 isolated import and export boundary P18", () => {
  it("exports structural contracts only, with no operational admission or resource API", () => {
    expect(Object.keys(protocol).sort()).toEqual(allowedExports);
    expect(Object.keys(protocol)).not.toContain("admitSyntheticRun");
    expect(Object.keys(protocol)).not.toContain("startCapsule");
  });
  it("uses a sealed inventory and AST allowlist for every runtime source file", () => {
    const actual = readdirSync(src);
    expect(inventoryViolations(actual)).toEqual([]);
    for (const name of actual) {
      const url = new URL(name, srcUrl);
      const path = fileURLToPath(url);
      expect(lstatSync(path).isFile(), `source must be a regular file: ${name}`).toBe(true);
      expect(lstatSync(path).isSymbolicLink(), `source must not be a symlink: ${name}`).toBe(false);
      const content = readFileSync(path, "utf8");
      expect(sourceBoundaryViolations(name, content), `forbidden source in ${name}`).toEqual([]);
    }
  });
  it("catches side-effect imports, network modules, dynamic imports and re-exports", () => {
    for (const content of [
      'import "node:child_process";',
      'import { connect } from "node:tls";',
      'export * from "node:fs";',
      'await import("node:net");',
      'const client = require("pg");',
      'const secret = process.env.SECRET;',
      'import { createSign } from "node:crypto";',
      'import type { createHash } from "node:crypto";',
      'type X = typeof import("node:tls");',
    ]) {
      expect(sourceBoundaryViolations("malicious.ts", content).length).not.toBe(0);
    }
    expect(sourceBoundaryViolations("allowed.ts", 'import { createHash } from "node:crypto";\nimport { fail } from "./errors.js";')).toEqual([]);
  });
  it("does not expose operationally authorized results", () => {
    expect(protocol.parseF6RunManifest).toBeTypeOf("function");
    expect(protocol.compareF6ManifestToExpectedResourcePolicy).toBeTypeOf("function");
    expect(protocol.F6ProtocolError).toBeTypeOf("function");
  });
  it("rejects all forms of crypto re-export, including type-only exports", () => {
    for (const content of [
      'export * from "node:crypto";',
      'export * as crypto from "node:crypto";',
      'export { createHash } from "node:crypto";',
      'export { createSign } from "node:crypto";',
      'export type { Hash } from "node:crypto";',
    ]) {
      expect(sourceBoundaryViolations("crypto-reexport.ts", content).length).not.toBe(0);
    }
  });
  it("rejects unknown relative imports and side-effect-only local imports", () => {
    for (const content of [
      'import { unknown } from "./unknown.js";',
      'export { unknown } from "./unknown.js";',
      'import "./errors.js";',
      'import { fail } from "./errors.mjs";',
      'import { fail } from "../src/errors.js";',
    ]) {
      expect(sourceBoundaryViolations("unapproved.ts", content).length).not.toBe(0);
    }
  });
  it("rejects any unscanned JavaScript, TypeScript or nested source entry", () => {
    for (const extra of ["helper.js", "helper.mjs", "helper.cjs", "helper.ts", "nested"] ) {
      expect(inventoryViolations([...approvedSourceFiles, extra]).length).not.toBe(0);
    }
    expect(inventoryViolations(approvedSourceFiles.slice(1)).length).not.toBe(0);
  });
});
