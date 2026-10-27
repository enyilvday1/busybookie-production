import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { parseAst } from "rolldown/parseAst";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attemptHardLink } from "../src/filesystem/hardLink.js";

const { rawLink } = vi.hoisted(() => ({ rawLink: vi.fn() }));
vi.mock("node:fs/promises", () => ({ link: rawLink }));

const root = process.cwd();
const owner = "src/filesystem/hardLink.ts";
// Policy remains with these consumers; this registry routes additions through review.
const consumers = [
  "src/editorialGovernance/editorialGovernanceStore.ts", // FAIL_CLOSED_STORE_UNSUPPORTED
  "src/editorialInterchange/editorialInterchangeStore.ts", // FAIL_CLOSED_STORE_UNSUPPORTED
  "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts", // EXFAT_SAFE_FALLBACK
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts", // EXFAT_SAFE_FALLBACK
];
const fsModules = new Set(["fs", "node:fs", "fs/promises", "node:fs/promises"]);
// B6B3 structural policy: a repository architecture control over ordinary production syntax, not a sandbox for
// hostile JavaScript. Dangerous ROOTS are rejected where they are referenced, so nothing downstream is analysed.
const loaderModules = new Set(["module", "process", "vm", "worker_threads", "inspector", "inspector/promises", "repl", "wasi"].flatMap(m => [m, `node:${m}`]));
const dangerousRoots = new Set(["globalThis", "global", "eval", "Function", "require", "module", "exports"]);
const reservedNames = new Set(["globalThis", "global", "eval", "Function", "require", "module", "exports", "process"]);
const processMembers = new Set(["argv", "cwd", "env", "exitCode", "off", "once", "pid", "stderr", "stdout"]);
const typeKeys = new Set(["typeAnnotation", "returnType", "typeParameters", "typeArguments", "superTypeArguments", "implements"]);
const typeNodes = new Set(["TSInterfaceDeclaration", "TSTypeAliasDeclaration", "TSDeclareFunction", "TSIndexSignature", "TSTypeQuery"]);
const bindingSlots: Record<string, string[]> = {
  VariableDeclarator: ["id"], FunctionDeclaration: ["id", "params"], FunctionExpression: ["id", "params"], ArrowFunctionExpression: ["params"],
  TSEmptyBodyFunctionExpression: ["id", "params"], ClassDeclaration: ["id"], ClassExpression: ["id"], CatchClause: ["param"],
  TSEnumDeclaration: ["id"], TSModuleDeclaration: ["id"], TSImportEqualsDeclaration: ["id"],
};
type Syntax = Record<string, unknown>;
const node = (value: unknown): Syntax => value !== null && typeof value === "object" ? value as Syntax : {};
const nodes = (value: unknown): Syntax[] => Array.isArray(value) ? value.map(node) : [];
function literal(value: unknown): string | undefined {
  const n = node(value);
  if (n.type === "Literal" && typeof n.value === "string") return n.value;
  if (n.type === "TemplateLiteral" && nodes(n.expressions).length === 0 && nodes(n.quasis).length === 1) {
    const cooked = node(nodes(n.quasis)[0]?.value).cooked;
    if (typeof cooked === "string") return cooked;
  }
  return undefined;
}
const name = (value: unknown) => typeof node(value).name === "string" ? String(node(value).name) : literal(value);
// The one static property decoder: identifier, string literal or expression-free template; never evaluates.
const property = (member: Syntax) => member.computed ? literal(member.property) : name(member.property);
const typeOnly = (n: Syntax) => typeNodes.has(String(n.type)) || n.declare === true || n.importKind === "type" || n.exportKind === "type";
// Closed list of Identifier slots that are not runtime references. Every other slot is a reference (fail closed).
function nonReference(parent: Syntax, key: string): boolean {
  switch (parent.type) {
    case "MemberExpression": return key === "property" && !parent.computed;
    case "Property": case "MethodDefinition": case "PropertyDefinition": case "AccessorProperty":
    case "TSAbstractMethodDefinition": case "TSAbstractPropertyDefinition": case "TSAbstractAccessorProperty": return key === "key" && !parent.computed;
    case "TSEnumMember": return key === "id";
    case "LabeledStatement": case "BreakStatement": case "ContinueStatement": return key === "label";
    case "MetaProperty": return true;
    case "ExportSpecifier": return key === "exported";
    case "ImportAttribute": return key === "key";
    default: return false;
  }
}
// Unsupported production syntax families fail closed before any capability semantics: JSX and decorators are not
// approved production-language features (B6B5). The whole AST is scanned, independent of the classifier's traversal.
function unsupportedSyntax(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const child of value) unsupportedSyntax(child, found); return; }
  const n = value as Syntax;
  if (typeof n.type === "string" && n.type.startsWith("JSX")) found.add("unsupported JSX production syntax");
  if (n.type === "Decorator") found.add("unsupported decorator production syntax");
  for (const child of Object.values(n)) unsupportedSyntax(child, found);
}
function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:[cm]?[jt]s|[jt]sx)$/.test(entry.name) ? [file] : [];
  });
}

// STRUCTURAL_ACQUISITION_ONLY: syntax-position classification, with no scope, alias or value-flow analysis.
function inspect(source: string, file: string) {
  const ast = parseAst(source, { lang: /\.[jt]sx$/.test(file) ? "tsx" : "ts" }, file);
  const raw: string[] = [], violations: string[] = [], runtimeExports: string[] = [];
  let consumer = false;
  const reference = (specifier: string | undefined) => {
    if (specifier?.startsWith(".") && relative(root, resolve(root, dirname(file), specifier.replace(/\.js$/, ".ts"))).split(sep).join("/") === owner) {
      consumer = true;
      if (!consumers.includes(file)) violations.push("unregistered consumer");
    }
  };
  // Binding identifiers may not take a reserved root name, so every reference to one is the global root.
  const bind = (pattern: unknown): void => {
    const p = node(pattern);
    if (p.type === "Identifier") { if (reservedNames.has(String(p.name))) violations.push(`reserved binding: ${String(p.name)}`); }
    else if (p.type === "ObjectPattern") for (const q of nodes(p.properties)) {
      if (q.type === "RestElement") bind(q.argument);
      else { if (q.computed) visit(q.key, q, "key"); bind(q.value); }
    }
    else if (p.type === "ArrayPattern") nodes(p.elements).forEach(bind);
    else if (p.type === "RestElement") bind(p.argument);
    else if (p.type === "AssignmentPattern") { bind(p.left); visit(p.right, p, "right"); }
    else if (p.type === "TSParameterProperty") bind(p.parameter);
    else visit(pattern, {}, "");
  };
  function visit(value: unknown, parent: Syntax, key: string): void {
    if (Array.isArray(value)) { for (const child of value) visit(child, parent, key); return; }
    const n = node(value);
    if (typeof n.type !== "string") { for (const child of Object.values(n)) visit(child, parent, key); return; }
    const source = literal(n.source);
    if (n.type === "ImportDeclaration") {
      reference(source);
      if (file === owner && source !== "node:fs/promises") violations.push("owner dependency");
      if (typeOnly(n)) return;
      if (loaderModules.has(source ?? "")) violations.push("loader module");
      for (const binding of nodes(n.specifiers)) {
        if (typeOnly(binding)) continue;
        bind(binding.local);
        const imported = name(binding.imported);
        if (fsModules.has(source ?? "")) {
          if (binding.type !== "ImportSpecifier") violations.push("whole fs import");
          // Classify by imported name only: these specifiers yield the whole module object, whatever the local alias.
          if (imported === "default") violations.push("default fs import");
          if (imported === "promises" && ["fs", "node:fs"].includes(source ?? "")) violations.push("fs promises namespace import");
          if (["link", "linkSync"].includes(imported ?? "")) {
            raw.push(imported!);
            if (file !== owner) violations.push("raw hard-link import");
          }
        }
      }
      return;
    }
    if (["ExportNamedDeclaration", "ExportAllDeclaration"].includes(String(n.type)) && source !== undefined) {
      reference(source);
      if (fsModules.has(source)) violations.push("fs re-export");
      if (loaderModules.has(source) && !typeOnly(n)) violations.push("loader module");
      return;
    }
    if (typeOnly(n)) return;
    if (n.type === "TSImportEqualsDeclaration") {
      const target = node(n.moduleReference);
      reference(literal(target.expression));
      if (target.type === "TSExternalModuleReference") violations.push("import-equals");
      else visit(target, n, "moduleReference");
      bind(n.id);
      return;
    }
    if (n.type === "ImportExpression") {
      reference(source);
      if (source === undefined || fsModules.has(source) || loaderModules.has(source)) violations.push("dynamic acquisition");
    }
    if (n.type === "Identifier") {
      if (nonReference(parent, key)) return;
      const id = String(n.name);
      if (dangerousRoots.has(id)) violations.push(`dangerous root: ${id}`);
      if (id === "process") {
        if (parent.type !== "MemberExpression" || key !== "object") violations.push("process bare reference");
        else if (parent.computed) violations.push("process computed member");
        else if (!processMembers.has(String(name(parent.property)))) violations.push(`process member: ${String(name(parent.property))}`);
      }
      return;
    }
    if (n.type === "MemberExpression" && property(n) === "constructor") violations.push("constructor member");
    for (const [childKey, child] of Object.entries(n)) {
      if (typeKeys.has(childKey)) continue;
      if (bindingSlots[String(n.type)]?.includes(childKey)) { (Array.isArray(child) ? child : [child]).forEach(bind); continue; }
      visit(child, n, childKey);
    }
  }
  const unsupported = new Set<string>();
  unsupportedSyntax(ast, unsupported);
  violations.push(...unsupported);
  visit(ast, {}, "");
  if (file === owner) {
    // Inspect only this tiny module's declarations; re-exports/defaults are forbidden outright.
    for (const statement of ast.body) {
      if (statement.type === "ExportNamedDeclaration" && statement.exportKind !== "type") {
        if (statement.source || statement.specifiers.length || statement.declaration?.type !== "FunctionDeclaration") violations.push("owner export form");
        runtimeExports.push(name(node(statement).declaration && node(node(statement).declaration).id) ?? "invalid");
      } else if (["ExportDefaultDeclaration", "ExportAllDeclaration"].includes(statement.type)) violations.push("owner export form");
    }
    if (runtimeExports.join(",") !== "attemptHardLink") violations.push("owner export surface");
    if (raw.join(",") !== "link") violations.push("owner raw import");
  }
  return { raw, violations, runtimeExports, consumer };
}
// One read/parse per production file. Fixtures below parse only their own source.
const production = [...sourceFiles("src"), ...sourceFiles("scripts")].map(file => ({ file, ...inspect(readFileSync(resolve(root, file), "utf8"), file) }));
const fixture = (source: string, file = "src/unregistered.ts") => inspect(source, file).violations;
const ownerSource = 'import { link } from "node:fs/promises"; export async function attemptHardLink() {}';

// B6B3 category matrix: [category, source, violation the category's policy must report].
const rejectedByCategory: ReadonlyArray<readonly [string, string, string]> = [
  ["A", 'import { link } from "node:fs/promises";', "raw hard-link import"],
  ["A", 'import { link as publish } from "fs/promises";', "raw hard-link import"],
  ["A", 'import { linkSync } from "node:fs";', "raw hard-link import"],
  ["A", 'export { link } from "node:fs";', "fs re-export"],
  ["A", 'import { link } from "node:\\u0066s/promises";', "raw hard-link import"],
  ["B", 'import * as fs from "fs";', "whole fs import"],
  ["B", 'import fs from "node:fs/promises";', "whole fs import"],
  ["B", 'import fs = require("fs");', "import-equals"],
  ["B", 'export * from "fs/promises";', "fs re-export"],
  ["B", 'await import("node:fs/promises");', "dynamic acquisition"],
  ["B", "await import(`node:fs`);", "dynamic acquisition"],
  ["B", "await import(variable);", "dynamic acquisition"],
  ["C", 'import { promises } from "node:fs";', "fs promises namespace import"],
  ["C", 'import { promises as fsPromises } from "fs";', "fs promises namespace import"],
  ["C", 'import { default as fs } from "node:fs";', "default fs import"],
  ["C", 'import { default as fsp } from "node:fs/promises";', "default fs import"],
  ["D", "globalThis;", "dangerous root: globalThis"],
  ["D", 'globalThis.eval("x");', "dangerous root: globalThis"],
  ["D", 'globalThis["eval"]("x");', "dangerous root: globalThis"],
  ["D", 'globalThis[`eval`]("x");', "dangerous root: globalThis"],
  ["D", 'globalThis?.["eval"]("x");', "dangerous root: globalThis"],
  ["D", 'globalThis["\\u0065val"]("x");', "dangerous root: globalThis"],
  ["D", "const g = globalThis;", "dangerous root: globalThis"],
  ["D", 'Reflect.get(globalThis, "eval");', "dangerous root: globalThis"],
  ["D", 'globalThis.Function("x");', "dangerous root: globalThis"],
  ["D", 'globalThis.process.binding("fs");', "dangerous root: globalThis"],
  ["D", "global;", "dangerous root: global"],
  ["D", "global.process;", "dangerous root: global"],
  ["D", 'global["anything"];', "dangerous root: global"],
  ["E", 'eval("x");', "dangerous root: eval"],
  ["E", 'eval?.("x");', "dangerous root: eval"],
  ["E", "const e = eval;", "dangerous root: eval"],
  ["E", '(0, eval)("x");', "dangerous root: eval"],
  ["E", "const o = { eval };", "dangerous root: eval"],
  ["F", 'Function("x");', "dangerous root: Function"],
  ["F", 'new Function("x");', "dangerous root: Function"],
  ["F", "const F = Function;", "dangerous root: Function"],
  ["F", '(async () => {}).constructor("x");', "constructor member"],
  ["F", 'Object.getPrototypeOf(f)["constructor"];', "constructor member"],
  ["F", "fn.constructor;", "constructor member"],
  ["F", 'fn["constructor"];', "constructor member"],
  ["F", "fn[`constructor`];", "constructor member"],
  ["F", 'fn["\\u0063onstructor"];', "constructor member"],
  ["F", "fn?.constructor;", "constructor member"],
  ["H", "process;", "process bare reference"],
  ["H", "const p = process;", "process bare reference"],
  ["H", "use(process);", "process bare reference"],
  ["H", "const o = { process };", "process bare reference"],
  ["H", "[process];", "process bare reference"],
  ["H", "function f() { return process; }", "process bare reference"],
  ["H", "(0, process).env;", "process bare reference"],
  ["H", "(process as any).env;", "process bare reference"],
  ["H", 'Reflect.get(process, "binding");', "process bare reference"],
  ["H", "typeof process;", "process bare reference"],
  ["I", "process[name];", "process computed member"],
  ["I", 'process["get" + "BuiltinModule"];', "process computed member"],
  ["I", "process[`${x}`];", "process computed member"],
  ["I", 'process["env"];', "process computed member"],
  ["I", "process[`env`];", "process computed member"],
  ["J", 'process.binding("fs");', "process member: binding"],
  ["J", 'process["binding"]("fs");', "process computed member"],
  ["J", 'process.getBuiltinModule("fs");', "process member: getBuiltinModule"],
  ["J", "process.mainModule;", "process member: mainModule"],
  ["J", "process.dlopen;", "process member: dlopen"],
  ["J", "process.futureNodeCapability;", "process member: futureNodeCapability"],
  ["K", 'require("node:fs");', "dangerous root: require"],
  ["K", "require(variable);", "dangerous root: require"],
  ["K", "const r = require;", "dangerous root: require"],
  ["K", "use(require);", "dangerous root: require"],
  ["K", 'import x = require("anything");', "import-equals"],
  ["L", 'module.require("fs");', "dangerous root: module"],
  ["L", 'module["require"]("fs");', "dangerous root: module"],
  ["L", "const m = module;", "dangerous root: module"],
  ["L", "module;", "dangerous root: module"],
  ["L", "exports.x = 1;", "dangerous root: exports"],
  ["L", "exports;", "dangerous root: exports"],
  ["M", 'import { createRequire } from "node:module";', "loader module"],
  ["M", 'import { createRequire as acquire } from "module";', "loader module"],
  ["M", 'import * as m from "node:module";', "loader module"],
  ["M", 'import m from "module";', "loader module"],
  ["M", 'import x from "node:process";', "loader module"],
  ["M", 'import { getBuiltinModule } from "process";', "loader module"],
  ["M", 'export { createRequire } from "node:module";', "loader module"],
  ["M", 'import vm from "node:vm";', "loader module"],
  ["M", 'export * from "vm";', "loader module"],
  ["M", 'import { Worker } from "node:worker_threads";', "loader module"],
  ["M", 'import inspector from "node:inspector";', "loader module"],
  ["M", 'import "inspector/promises";', "loader module"],
  ["M", 'import * as repl from "repl";', "loader module"],
  ["M", 'import { WASI } from "node:wasi";', "loader module"],
  ["M", 'await import("node:module");', "dynamic acquisition"],
  ["M", 'await import("worker_threads");', "dynamic acquisition"],
  ["R", "const process = x;", "reserved binding: process"],
  ["R", "let require;", "reserved binding: require"],
  ["R", "function f(require) {}", "reserved binding: require"],
  ["R", "const g = (...global) => global;", "reserved binding: global"],
  ["R", 'import { x as globalThis } from "y";', "reserved binding: globalThis"],
  ["R", "const { a: module } = o;", "reserved binding: module"],
  ["R", "const [Function] = list;", "reserved binding: Function"],
  ["R", "class Function {}", "reserved binding: Function"],
  ["R", "try {} catch (exports) {}", "reserved binding: exports"],
];
const allowedByCategory: ReadonlyArray<readonly [string, string]> = [
  ["G", "process.env;"],
  ["G", "process.env.NAME;"],
  ["G", "process.argv[2];"],
  ["G", "process.cwd();"],
  ["G", "process.exitCode = 1;"],
  ["G", "process.pid;"],
  ["G", 'process.stdout.write("x");'],
  ["G", 'process.stderr.write("x");'],
  ["G", 'process.once("SIGINT", f);'],
  ["G", 'process.off("SIGINT", f);'],
  ["G", "process?.env;"],
  ["N", '// globalThis.eval(process); require("fs")\nconst s = "globalThis.eval(process); module.require()";'],
  ["N", "const o = { globalThis: 1, eval: 2, process: 3, require: 4 }; o.eval; o.process; o.require; o.module;"],
  ["N", "({ eval: someValue });"],
  ["N", "({ Function: 1 });"],
  ["N", "({ constructor: 1 });"],
  ["N", "class X { constructor() {} }"],
  ["N", "class A { eval() {} Function = 1; static require = 2; }"],
  ["N", "module: for (;;) { break module; }"],
  ["N", "const a = 1; export { a as require };"],
  ["N", "Reflect.ownKeys(o);"],
  ["NT", "type T = typeof process;"],
  ["NT", "const x = y as typeof globalThis;"],
  ["NT", "interface I { require(): void }"],
  ["NT", 'import type { Module } from "node:module";'],
  ["O", 'import { readFile, open, stat } from "node:fs/promises";'],
  ["O", 'import { readFile as link } from "node:fs/promises";'],
  ["O", 'import { existsSync } from "node:fs";'],
  ["O", "function link() {} link();"],
  ["O", 'import { link, promises, default as x } from "unrelated-package";'],
];
// B6B5 unsupported syntax families, parsed as .tsx: P = JSX, Q = decorators, PN = text-only negatives.
const tsxFile = "src/unregistered.tsx";
const unsupportedByCategory: ReadonlyArray<readonly [string, string, string]> = [
  ["P", "const view = <globalThis.eval />;", "unsupported JSX production syntax"],
  ["P", "const view = <global.eval />;", "unsupported JSX production syntax"],
  ["P", "const view = <Function />;", "unsupported JSX production syntax"],
  ["P", "const view = <require.Loader />;", "unsupported JSX production syntax"],
  ["P", "const view = <module.Loader />;", "unsupported JSX production syntax"],
  ["P", "const view = <exports.Loader />;", "unsupported JSX production syntax"],
  ["P", "const view = <process.binding />;", "unsupported JSX production syntax"],
  ["P", "const view = <local.constructor />;", "unsupported JSX production syntax"],
  ["P", "const view = <div />;", "unsupported JSX production syntax"],
  ["P", "const view = <></>;", "unsupported JSX production syntax"],
  ["P", "const view = <div>{safeValue}</div>;", "unsupported JSX production syntax"],
  ["P", "const view = <Component {...props} />;", "unsupported JSX production syntax"],
  ["P", 'const view = <div id="x">text</div>;', "unsupported JSX production syntax"],
  ["P", "const view = <svg:rect />;", "unsupported JSX production syntax"],
  ["Q", "@dec class Example {}", "unsupported decorator production syntax"],
  ["Q", "@dec export class Example {}", "unsupported decorator production syntax"],
  ["Q", "class Example { @dec method() {} }", "unsupported decorator production syntax"],
  ["Q", "class Example { @dec field = 1; }", "unsupported decorator production syntax"],
  ["Q", "class Example { constructor(@dec x: string) {} }", "unsupported decorator production syntax"],
  ["Q", "class Example { constructor(@dec(globalThis) x: string) {} }", "unsupported decorator production syntax"],
  ["Q", "class Example { constructor(@dec(eval) x: string) {} }", "unsupported decorator production syntax"],
  ["Q", "class Example { constructor(@dec(globalThis) public x: string) {} }", "unsupported decorator production syntax"],
  ["Q", "class Example { method(@dec(process.binding) x: string) {} }", "unsupported decorator production syntax"],
];
const unsupportedNegatives: ReadonlyArray<readonly [string, string]> = [
  ["PN", '// <globalThis.eval /> @dec class Example {}\nconst text = "<div>{safeValue}</div> @dec";'],
  ["PN", "const value = 1; export { value };"],
];

describe("central hard-link acquisition boundary", () => {
  it("I1 has one raw owner and no linkSync", () => {
    expect(production.filter(p => p.raw.length).map(p => p.file)).toEqual([owner]);
    expect(production.flatMap(p => p.raw)).toEqual(["link"]);
  });
  it("I2 bans whole-fs and bypass acquisitions", () => {
    expect(production.flatMap(p => p.violations.map(v => `${p.file}: ${v}`))).toEqual([]);
  });
  it("I3 owner exports only attemptHardLink", () => {
    expect(production.find(p => p.file === owner)?.runtimeExports).toEqual(["attemptHardLink"]);
  });
  it("I4 has exactly the four registered consumers", () => {
    expect(production.filter(p => p.consumer).map(p => p.file).sort()).toEqual(consumers);
  });
  it.each([
    'import { link } from "node:fs/promises";',
    'import { link as publish } from "fs/promises";',
    'import { linkSync } from "node:fs";',
    'import * as fs from "fs";',
    'import fs from "node:fs/promises";',
    'import fs = require("fs");',
    'export { link } from "node:fs";',
    'export * from "fs/promises";',
    'const fs = require("node:fs");',
    'await import("node:fs/promises");',
    'await import(variable);',
    'process.getBuiltinModule("fs");',
    'import { createRequire as acquire } from "node:module";',
    'process.binding("fs");',
    'module.require("fs");',
    'eval("source");',
    'new Function("source");',
    'process["getBuiltinModule"]("fs");',
    'await import(`node:fs`);',
    'import { link } from "node:\\u0066s/promises";',
    'import { attemptHardLink } from "./filesystem/hardLink.js";',
  ])("rejects acquisition: %s", source => expect(fixture(source).length).toBeGreaterThan(0));
  it.each([
    ["Q1", 'import { promises } from "node:fs";', "fs promises namespace import"],
    ["Q2", 'import { promises as fsPromises } from "fs";', "fs promises namespace import"],
    ["Q3", 'import { default as fs } from "node:fs";', "default fs import"],
    ["Q4", 'import { default as fsp } from "node:fs/promises";', "default fs import"],
    ["F1", 'Function("return 1");', "dangerous root: Function"],
    ["F2", 'globalThis.Function("return 1");', "dangerous root: globalThis"],
    ["P1", 'globalThis.process.binding("fs");', "dangerous root: globalThis"],
  ])("%s rejects named whole-module or direct bypass acquisition: %s", (_id, source, violation) => expect(fixture(source)).toEqual([violation]));
  it.each(rejectedByCategory)("%s rejects %s => %s", (_category, source, violation) => expect(fixture(source)).toContain(violation));
  it.each(allowedByCategory)("%s allows %s", (_category, source) => expect(fixture(source)).toEqual([]));
  it.each(unsupportedByCategory)("%s rejects %s => %s", (_category, source, violation) => expect(fixture(source, tsxFile)).toContain(violation));
  it.each(unsupportedNegatives)("%s allows %s", (_category, source) => expect(fixture(source, tsxFile)).toEqual([]));
  it.each([
    'export { link };', 'export default link;', 'export const extra = 1;', 'export * from "./other.js";',
  ])("rejects owner export addition: %s", addition => expect(fixture(`${ownerSource} ${addition}`, owner).length).toBeGreaterThan(0));
  it("allows the owner, a registered consumer and unrelated/local link names", () => {
    expect(fixture(ownerSource, owner)).toEqual([]);
    expect(fixture('import { attemptHardLink } from "../filesystem/hardLink.js";', consumers[0])).toEqual([]);
    expect(fixture('import { readFile } from "fs"; import { link } from "unrelated"; function local() { function link() {} link(); }')).toEqual([]);
    // Safe named imports stay allowed; a local alias named `link` does not drive classification.
    expect(fixture('import { readFile, open, stat } from "node:fs/promises"; import { readFile as link } from "node:fs/promises";')).toEqual([]);
  });
});

describe("attemptHardLink runtime contract", () => {
  beforeEach(() => { rawLink.mockReset(); });
  it("returns LINKED after exactly one raw call", async () => {
    rawLink.mockResolvedValue(undefined);
    await expect(attemptHardLink("existing", "new")).resolves.toEqual({ status: "LINKED" });
    expect(rawLink).toHaveBeenCalledExactlyOnceWith("existing", "new");
  });
  it.each(["EEXIST", "ENOENT", "EISDIR", "EPERM"])("returns FAILED with %s and the original rejection without retry or throw", async code => {
    const error = Object.assign(new Error("injected link failure"), { code });
    rawLink.mockRejectedValue(error);
    const result = await attemptHardLink("existing", "new");
    expect(result.status).toBe("FAILED");
    if (result.status !== "FAILED") throw new Error("expected FAILED");
    expect(result.code).toBe(code);
    expect(result.error).toBe(error);
    expect(rawLink).toHaveBeenCalledExactlyOnceWith("existing", "new");
  });
  it("returns synchronous throws unchanged", async () => {
    const error = { code: "EIO" };
    rawLink.mockImplementation(() => { throw error; });
    await expect(attemptHardLink("existing", "new")).resolves.toEqual({ status: "FAILED", code: "EIO", error });
    expect(rawLink).toHaveBeenCalledTimes(1);
  });
  it.each([null, "failure", { code: 5 }, Object.create({ code: "EIO" })])("bounds code extraction for opaque errors: %s", async error => {
    rawLink.mockRejectedValue(error);
    const result = await attemptHardLink("existing", "new");
    expect(result).toEqual({ status: "FAILED", code: undefined, error });
    if (result.status === "FAILED") expect(result.error).toBe(error);
    expect(rawLink).toHaveBeenCalledTimes(1);
  });
  it("does not invoke a code getter or let descriptor traps escape", async () => {
    const getter = vi.fn(() => { throw new Error("getter must not run"); });
    for (const error of [Object.defineProperty({}, "code", { get: getter }), new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("opaque"); } })]) {
      rawLink.mockRejectedValueOnce(error);
      const result = await attemptHardLink("existing", "new");
      expect(result.status).toBe("FAILED");
      if (result.status === "FAILED") { expect(result.error).toBe(error); expect(result.code).toBeUndefined(); }
    }
    expect(getter).not.toHaveBeenCalled();
    expect(rawLink).toHaveBeenCalledTimes(2);
  });
});
