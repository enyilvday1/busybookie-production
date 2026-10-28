import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAst } from "rolldown/parseAst";

const root = process.cwd();
const directory = "src/googleGenai/transport";
const materializer = "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts";
const reconciler = "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts";
const factory = "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts";
// B4X: the only approved runtime consumers of the factory and of the closed transport error codes.
const operatorComposition = "src/execution/createGoogleGenAiOperatorProductionDependencies.ts";
const operatorCli = "src/execution/cli/runGoogleGenAiOperatorCli.ts";
const expected: Readonly<Record<string, readonly string[]>> = {
  "googleGenAiSecureOutputTransport.types.ts": ["../googleGenAiInteractionContract.js"],
  "googleGenAiSecureOutputTransportError.ts": [],
  "parseGoogleGenAiInteractionSse.ts": ["../googleGenAiInteractionContract.js", "./googleGenAiSecureOutputTransport.types.js", "./googleGenAiSecureOutputTransportError.js"],
  "replayGoogleGenAiInteraction.ts": ["./googleGenAiSecureOutputTransport.types.js", "./googleGenAiSecureOutputTransportError.js", "./parseGoogleGenAiInteractionSse.js"],
  "validateGoogleGenAiFilesDownloadUri.ts": ["./googleGenAiSecureOutputTransport.types.js", "./googleGenAiSecureOutputTransportError.js"],
  "getGoogleGenAiFilesMetadata.ts": ["./googleGenAiSecureOutputTransport.types.js", "./googleGenAiSecureOutputTransportError.js", "./validateGoogleGenAiFilesDownloadUri.js", "./parseGoogleGenAiInteractionSse.js"],
  "downloadGoogleGenAiFile.ts": ["node:crypto", "./googleGenAiSecureOutputTransport.types.js", "./googleGenAiSecureOutputTransportError.js", "./validateGoogleGenAiFilesDownloadUri.js"],
};
type Dependency = Readonly<{ specifier: string; category: "import" | "re-export"; typeOnly: boolean; sideEffect: boolean }>;
const dependency = (specifier: string, typeOnly = false): Dependency => ({ specifier, category: "import", typeOnly, sideEffect: false });

// The installed TypeScript 7 root export has no createSourceFile API. Rolldown,
// already installed for Vitest, parses TypeScript without executing the source.
function dependencies(source: string, file = "boundary.ts"): Dependency[] {
  const ast = parseAst(source, { lang: /\.[jt]sx$/.test(file) ? "tsx" : "ts" }, file);
  const records: Dependency[] = [];
  for (const node of ast.body) {
    if (node.type === "ImportDeclaration") {
      records.push({
        specifier: node.source.value, category: "import", sideEffect: node.specifiers.length === 0,
        typeOnly: node.importKind === "type" || (node.specifiers.length > 0 && node.specifiers.every((binding) => binding.type === "ImportSpecifier" && binding.importKind === "type")),
      });
    } else if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) {
      records.push({
        specifier: node.source.value, category: "re-export", sideEffect: false,
        typeOnly: node.exportKind === "type" || (node.type === "ExportNamedDeclaration" && node.specifiers.length > 0 && node.specifiers.every((binding) => binding.exportKind === "type")),
      });
    }
  }
  return records;
}
function posix(path: string) { return path.split(sep).join("/"); }
function approvedDependencies(name: string): Dependency[] {
  return expected[name]!.map((specifier) => dependency(specifier,
    name === "googleGenAiSecureOutputTransport.types.ts" || specifier === "./googleGenAiSecureOutputTransport.types.js"));
}
function assertDependencies(source: string, name: string): void {
  const bySpecifier = (a: Dependency, b: Dependency) => a.specifier.localeCompare(b.specifier);
  expect(dependencies(source, name).sort(bySpecifier), name).toEqual(approvedDependencies(name).sort(bySpecifier));
}
function transportDependencies(source: string, file: string) {
  return dependencies(source, file).flatMap((record) => {
    if (!record.specifier.startsWith(".")) return [];
    const target = posix(relative(join(root, directory), resolve(dirname(file), record.specifier.replace(/\.js$/, ".ts"))));
    return Object.hasOwn(expected, target) ? [{ target, record }] : [];
  });
}

// B4V7C dormancy scanner. Decisions use ONLY the parser's decoded module
// specifiers (escapes such as c, \x63 or \u{63} are already decoded), never
// raw source text, and every nested node is visited so dynamic import() and
// require() inside functions or expressions are found. Only statically resolvable
// specifiers exist: string literals and expression-free template literals.
const DORMANT_GUARDED_MODULES = Object.freeze([
  "createGoogleGenAiSingleShotSecureProductionRecovery",
  "createGoogleGenAiSingleShotProductionInteractionGetter",
  "createGoogleGenAiSingleShotProductionOutputRetriever",
] as const);
type DormantGuardedModule = typeof DORMANT_GUARDED_MODULES[number];
type ModuleReference = Readonly<{
  specifier: string;
  via: "import" | "re-export" | "dynamic-import" | "require" | "import-equals";
  typeOnly: boolean;
}>;
type AstNode = Readonly<Record<string, unknown>> & { readonly type?: unknown };

function literalModuleSpecifier(node: unknown): string | undefined {
  if (node === null || typeof node !== "object") return undefined;
  const value = node as AstNode;
  if (value.type === "Literal" && typeof value.value === "string") return value.value;
  if (value.type === "TemplateLiteral" && Array.isArray(value.expressions) && value.expressions.length === 0
    && Array.isArray(value.quasis) && value.quasis.length === 1) {
    const cooked = ((value.quasis[0] as AstNode).value as AstNode | undefined)?.cooked;
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
}

function moduleReferences(source: string, file: string): ModuleReference[] {
  const ast = parseAst(source, { lang: /\.[jt]sx$/.test(file) ? "tsx" : "ts" }, file) as unknown;
  const references: ModuleReference[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    const value = node as AstNode;
    switch (value.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        const specifier = literalModuleSpecifier(value.source);
        if (specifier !== undefined) {
          const bindings = (Array.isArray(value.specifiers) ? value.specifiers : []) as AstNode[];
          const typeOnly = value.type === "ImportDeclaration"
            ? value.importKind === "type" || (bindings.length > 0 && bindings.every((binding) => binding.type === "ImportSpecifier" && binding.importKind === "type"))
            : value.exportKind === "type" || (value.type === "ExportNamedDeclaration" && bindings.length > 0 && bindings.every((binding) => binding.exportKind === "type"));
          references.push({ specifier, via: value.type === "ImportDeclaration" ? "import" : "re-export", typeOnly });
        }
        break;
      }
      case "ImportExpression": {
        const specifier = literalModuleSpecifier(value.source);
        if (specifier !== undefined) references.push({ specifier, via: "dynamic-import", typeOnly: false });
        break;
      }
      case "CallExpression": {
        const callee = value.callee as AstNode | undefined;
        const firstArgument = Array.isArray(value.arguments) ? value.arguments[0] : undefined;
        const specifier = callee?.type === "Identifier" && callee.name === "require" ? literalModuleSpecifier(firstArgument) : undefined;
        if (specifier !== undefined) references.push({ specifier, via: "require", typeOnly: false });
        break;
      }
      case "TSImportEqualsDeclaration": {
        const reference = value.moduleReference as AstNode | undefined;
        const specifier = reference?.type === "TSExternalModuleReference" ? literalModuleSpecifier(reference.expression) : undefined;
        if (specifier !== undefined) references.push({ specifier, via: "import-equals", typeOnly: value.importKind === "type" });
        break;
      }
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(ast);
  return references;
}

/**
 * The single per-file dormancy decision used by both the repository scan and its
 * regressions: which guarded modules does this file reference in ANY module form?
 * Type-only references are also rejected (stricter than runtime-only, unchanged).
 */
function guardedModuleConsumers(source: string, file: string): DormantGuardedModule[] {
  const found = new Set<DormantGuardedModule>();
  for (const reference of moduleReferences(source, file)) {
    for (const name of DORMANT_GUARDED_MODULES) {
      if (reference.specifier.includes(name)) found.add(name);
    }
  }
  return [...found].sort();
}

/** One walk of src+scripts, one parse per file, all guarded targets from one reference set. */
async function scanDormancyConsumers(): Promise<Readonly<{ fileCount: number; consumers: Record<DormantGuardedModule, string[]> }>> {
  const consumers = Object.fromEntries(DORMANT_GUARDED_MODULES.map((name) => [name, [] as string[]])) as Record<DormantGuardedModule, string[]>;
  let fileCount = 0;
  for (const base of ["src", "scripts"]) {
    const entries = await readdir(join(root, base), { recursive: true, withFileTypes: true });
    for (const entry of entries.filter((e) => e.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(e.name))) {
      const file = join(entry.parentPath, entry.name);
      fileCount += 1;
      for (const name of guardedModuleConsumers(await readFile(file, "utf8"), file)) consumers[name].push(posix(relative(root, file)));
    }
  }
  return { fileCount, consumers };
}

describe("syntax-aware boundary scanner regressions", () => {
  it("detects a side-effect dependency exactly once and rejects it against the frozen imports", () => {
    const source = 'import "./undeclared-side-effect.js";';
    expect(dependencies(source)).toEqual([{ specifier: "./undeclared-side-effect.js", category: "import", typeOnly: false, sideEffect: true }]);
    expect(() => assertDependencies(source, "googleGenAiSecureOutputTransportError.ts")).toThrow();
  });

  it("detects a side-effect reverse consumer with the same graph helper used in production scans", () => {
    const records = transportDependencies('import "../googleGenai/transport/replayGoogleGenAiInteraction.js";', join(root, "src/execution/consumer.ts"));
    expect(records).toEqual([{ target: "replayGoogleGenAiInteraction.ts", record: { specifier: "../googleGenai/transport/replayGoogleGenAiInteraction.js", category: "import", typeOnly: false, sideEffect: true } }]);
  });

  it.each([
    '// import { fake } from "./approved.js";',
    '/* import "./approved.js"; */',
    '\'import "./approved.js";\';',
    '`import "./approved.js";`;',
  ])("ignores comment/string/template decoy %s", (source) => {
    expect(dependencies(source)).toEqual([]);
    expect(transportDependencies(source, join(root, "src/execution/consumer.ts"))).toEqual([]);
  });

  it.each([
    ['import type { X } from "./x.js";', true],
    ['import { type X } from "./x.js";', true],
    ['import { type X, y } from "./x.js";', false],
    ['import X, { type Y } from "./x.js";', false],
    ['import * as X from "./x.js";', false],
    ['import type * as X from "./x.js";', true],
  ] as const)("classifies binding syntax in %s", (source, typeOnly) => {
    expect(dependencies(source)).toEqual([dependency("./x.js", typeOnly)]);
  });

  it.each([
    ['export type { X } from "./x.js";', true],
    ['export { type X } from "./x.js";', true],
    ['export { type X, y } from "./x.js";', false],
    ['export * from "./x.js";', false],
    ['export type * from "./x.js";', true],
  ] as const)("classifies re-export syntax in %s", (source, typeOnly) => {
    expect(dependencies(source)).toEqual([{ specifier: "./x.js", category: "re-export", typeOnly, sideEffect: false }]);
  });

  it("cannot substitute side-effect/runtime imports or re-exports for the required type-only import", () => {
    const name = "googleGenAiSecureOutputTransport.types.ts";
    for (const source of [
      'import "../googleGenAiInteractionContract.js";',
      'import { GoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";',
      'export type { GoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";',
      '// import type { GoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";',
    ]) expect(() => assertDependencies(source, name)).toThrow();
    expect(() => assertDependencies('import type { GoogleGenAiInteractionStatus } from "../googleGenAiInteractionContract.js";', name)).not.toThrow();
  });

  it("includes re-export consumers and ignores a consumer decoy", () => {
    const file = join(root, "src/execution/consumer.ts");
    expect(transportDependencies('export * from "../googleGenai/transport/replayGoogleGenAiInteraction.js";', file).map(({ target }) => target)).toEqual(["replayGoogleGenAiInteraction.ts"]);
    expect(transportDependencies('// import "../googleGenai/transport/replayGoogleGenAiInteraction.js";', file)).toEqual([]);
  });
});

describe("B4V7 exact secure transport boundary", () => {
  it("contains precisely the seven current modules with exact imports and no future placeholders", async () => {
    const entries = await readdir(join(root, directory), { withFileTypes: true });
    expect(entries.every((entry) => entry.isFile())).toBe(true);
    expect(entries.map((entry) => entry.name).sort()).toEqual(Object.keys(expected).sort());
    for (const [name, imports] of Object.entries(expected)) {
      const source = await readFile(join(root, directory, name), "utf8");
      assertDependencies(source, name);
      // An added side-effect dependency must fail even beside all approved imports.
      expect(() => assertDependencies(source + '\nimport "./undeclared-side-effect.js";', name)).toThrow();
      expect(source, name).not.toMatch(/@google\/genai|process\.env|loadEnvironment|dotenv|node:fs|node:path|node:https?|node:net|child_process|\brequire\s*\(|\bimport\s*\(/);
      expect(source, name).not.toMatch(/googleGenAiActivationLimits|ActivationPolicy|newSubmissionsEnabled|submitGoogleGenAi|createGoogleGenAiSingleShot|interactions\.create|reconcileExecutionLifecycle|persistGoogleGenAi|\/routing\//);
      expect(source, name).not.toMatch(/\.text\s*\(|\.json\s*\(|\.arrayBuffer\s*\(|\.blob\s*\(|\.bytes\s*\(/);
      if (name === "validateGoogleGenAiFilesDownloadUri.ts") expect(source, name).not.toMatch(/\bfetch\b|\bapiKey\b|x-goog-api-key/);
      else if (name !== "replayGoogleGenAiInteraction.ts" && name !== "getGoogleGenAiFilesMetadata.ts" && name !== "downloadGoogleGenAiFile.ts") expect(source, name).not.toMatch(/\bfetch\b|https?:\/\/|\bapiKey\b|x-goog-api-key/);
    }
    const download = await readFile(join(root, directory, "downloadGoogleGenAiFile.ts"), "utf8");
    const cryptoImports = parseAst(download, { lang: "ts" }).body.filter((node) => node.type === "ImportDeclaration" && node.source.value === "node:crypto");
    expect(cryptoImports.flatMap((node) => node.type === "ImportDeclaration" ? node.specifiers.map((binding) => binding.type === "ImportSpecifier" && binding.imported.type === "Identifier" ? binding.imported.name : null) : [])).toEqual(["createHash", "timingSafeEqual"]);
    expect(download).toContain('new URL(`https://generativelanguage.googleapis.com${pathname}?alt=media`)');
    expect(download).toContain('headers: { "x-goog-api-key": key, Accept: "video/mp4", "Accept-Encoding": "identity" }');
    expect(download).toContain('redirect: "manual"');
    expect(download).toContain("await sink.writeChunk(chunk.value)");
    expect(download).toContain("timingSafeEqual(digest, expected)");
    expect(download.indexOf("url.protocol !==")).toBeLessThan(download.indexOf('headers: { "x-goog-api-key"'));
    // Single attempt: one fetch site, one deadline timer, no resume, sleep or retry machinery.
    expect(download.match(/\(dependencies\.fetchImpl \?\? fetch\)\(/g)).toHaveLength(1);
    expect(download.match(/\bsetTimeout\(/g)).toHaveLength(1);
    expect(download).not.toMatch(/[?&](?:key|api_key|access_token)=|redirect:\s*["']follow|\bRange\b|bytes=|setInterval|filesDownloadRetryDelayMs|maxFilesDownloadAttemptsPerReconciliation|\bretry\s*\(|\bsleep\b|\bconsole\b|\beval\b|ftyp/);
    const metadata = await readFile(join(root, directory, "getGoogleGenAiFilesMetadata.ts"), "utf8");
    const parserImports = parseAst(metadata, { lang: "ts" }).body.filter((node) => node.type === "ImportDeclaration" && node.source.value === "./parseGoogleGenAiInteractionSse.js");
    expect(parserImports.flatMap((node) => node.type === "ImportDeclaration" ? node.specifiers.map((binding) => binding.type === "ImportSpecifier" && binding.imported.type === "Identifier" ? binding.imported.name : null) : [])).toEqual(["rejectDuplicateGoogleGenAiJsonKeys"]);
    expect(metadata).toContain('new URL(`https://generativelanguage.googleapis.com${pathname}`)');
    expect(metadata).toContain('headers: { "x-goog-api-key": key, Accept: "application/json" }');
    expect(metadata).toContain('redirect: "manual"');
    expect(metadata.indexOf('url.protocol !==')).toBeLessThan(metadata.indexOf('headers: { "x-goog-api-key"'));
    expect(metadata).not.toMatch(/[?&](?:key|api_key|access_token)=|redirect:\s*["']follow/);
    const replay = await readFile(join(root, directory, "replayGoogleGenAiInteraction.ts"), "utf8");
    expect(replay).toContain('new URL(`https://generativelanguage.googleapis.com${path}?stream=true&include_input=false`)');
    expect(replay).toContain('redirect: "manual"');
    expect(replay).toContain('headers: { "x-goog-api-key": key, Accept: "text/event-stream" }');
    expect(replay).not.toMatch(/[?&](?:key|api_key|access_token)=|last_event_id|redirect:\s*["']follow/);
    expect(replay.indexOf('url.origin !==')).toBeLessThan(replay.indexOf('headers: { "x-goog-api-key"'));
  });

  it("allows only the exact internal production importer graph; no runtime wiring", async () => {
    const importers: Record<string, string[]> = Object.fromEntries(Object.keys(expected).map((name) => [name, []]));
    for (const base of ["src", "scripts"]) {
      const entries = await readdir(join(root, base), { recursive: true, withFileTypes: true });
      for (const entry of entries.filter((e) => e.isFile() && /\.(?:[cm]?[jt]s|[jt]sx)$/.test(e.name))) {
        const file = join(entry.parentPath, entry.name);
        const source = await readFile(file, "utf8");
        for (const { target } of transportDependencies(source, file)) {
          importers[target]!.push(posix(relative(root, file)));
        }
      }
    }
    // B4V6: the materializer and Google reconciler consume only the pure type/error contracts.
    expect(Object.fromEntries(Object.entries(importers).map(([name, paths]) => [name, paths.sort()]))).toEqual({
      "googleGenAiSecureOutputTransport.types.ts": [factory, materializer, reconciler, directory + "/downloadGoogleGenAiFile.ts", directory + "/getGoogleGenAiFilesMetadata.ts", directory + "/parseGoogleGenAiInteractionSse.ts", directory + "/replayGoogleGenAiInteraction.ts", directory + "/validateGoogleGenAiFilesDownloadUri.ts"],
      "googleGenAiSecureOutputTransportError.ts": [operatorCli, materializer, reconciler, directory + "/downloadGoogleGenAiFile.ts", directory + "/getGoogleGenAiFilesMetadata.ts", directory + "/parseGoogleGenAiInteractionSse.ts", directory + "/replayGoogleGenAiInteraction.ts", directory + "/validateGoogleGenAiFilesDownloadUri.ts"],
      "parseGoogleGenAiInteractionSse.ts": [directory + "/getGoogleGenAiFilesMetadata.ts", directory + "/replayGoogleGenAiInteraction.ts"],
      "replayGoogleGenAiInteraction.ts": [factory],
      "validateGoogleGenAiFilesDownloadUri.ts": [directory + "/downloadGoogleGenAiFile.ts", directory + "/getGoogleGenAiFilesMetadata.ts"],
      "getGoogleGenAiFilesMetadata.ts": [factory],
      "downloadGoogleGenAiFile.ts": [factory],
    });
  });

  it("keeps the B4V6 consumers type-only/error-only, network-free and credential-free with hard-link-only publication", async () => {
    for (const [file, typesSpecifier, errorSpecifier] of [
      [materializer, "../../googleGenai/transport/googleGenAiSecureOutputTransport.types.js", "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js"],
      [reconciler, "../googleGenai/transport/googleGenAiSecureOutputTransport.types.js", "../googleGenai/transport/googleGenAiSecureOutputTransportError.js"],
    ] as const) {
      const source = await readFile(join(root, file), "utf8");
      const transport = dependencies(source, file).filter((record) => record.specifier.includes("/transport/"));
      expect(transport.sort((a, b) => a.specifier.localeCompare(b.specifier)), file).toEqual([dependency(typesSpecifier, true), dependency(errorSpecifier)].sort((a, b) => a.specifier.localeCompare(b.specifier)));
      expect(source, file).not.toMatch(/@google\/genai|process\.env|loadEnvironment|\bfetch\s*\(|x-goog-api-key|Authorization|\bapiKey\b|interactions\.create|node:https?|node:net|\bimport\s*\(|\brequire\s*\(/);
      expect(source, file).not.toMatch(/replayGoogleGenAiInteraction|getGoogleGenAiFilesMetadata|downloadGoogleGenAiFile|validateGoogleGenAiFilesDownloadUri|googleGenAiActivationLimits|ActivationPolicy|\/routing\//);
      expect(source, file).not.toMatch(/\brename\s*\(|\bcopyFile\s*\(|\bRange\b|bytes=|createWriteStream|["']a\+?["']/);
    }
    const materializerSource = await readFile(join(root, materializer), "utf8");
    // The pre-existing generic URI shape check is the only URL parse; no URL is built for a request.
    expect(materializerSource.match(/new URL\(/g)).toHaveLength(1);
    expect(materializerSource.match(/fileSystem\.link\(/g)).toHaveLength(2);
    expect(materializerSource).toContain("await handle.write(");
    expect(materializerSource).toContain("timingSafeEqual(");
    const reconcilerSource = await readFile(join(root, reconciler), "utf8");
    expect(reconcilerSource).not.toMatch(/new URL\(/);
    expect(reconcilerSource.match(/\.replayInteraction\(/g)).toHaveLength(1);
  });

  it("keeps the B4V7 secure factory a pure dormant composition of the protected transports", async () => {
    const source = await readFile(join(root, factory), "utf8");
    const bySpecifier = (a: Dependency, b: Dependency) => a.specifier.localeCompare(b.specifier);
    // Exact B4V2R Decision 29 import map; type-only where only contracts are needed.
    expect(dependencies(source, factory).sort(bySpecifier)).toEqual([
      dependency("../../googleGenai/googleGenAiActivationLimits.js"),
      dependency("../../googleGenai/transport/googleGenAiSecureOutputTransport.types.js", true),
      dependency("../../googleGenai/transport/replayGoogleGenAiInteraction.js"),
      dependency("../../googleGenai/transport/getGoogleGenAiFilesMetadata.js"),
      dependency("../../googleGenai/transport/downloadGoogleGenAiFile.js"),
      dependency("../reconcileGoogleGenAiExecutionLifecycle.js", true),
    ].sort(bySpecifier));
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // No own network, URL, header, credential-source, SDK, timer, deadline, cache or persistence authority.
    expect(code).not.toMatch(/\bfetch\s*\(|https?:\/\/|new URL\(|x-goog-api-key|Authorization|headers\s*:|@google\/genai|process\.env|loadEnvironment|loadGoogleGenAiActivationPolicy|readFile|node:|setTimeout|setInterval|AbortController|new Map|WeakMap|interactions\.|validateGoogleGenAiFilesDownloadUri|parseGoogleGenAiInteractionSse|persistGoogleGenAi|verifyGoogleGenAi|materializeGoogleGenAi|submitGoogleGenAi|ProductionInteractionGetter|ProductionOutputRetriever|newSubmissionsEnabled|\bimport\s*\(|\brequire\s*\(/);
    // Exactly one forwarding call per protected transport.
    for (const transport of ["replayGoogleGenAiInteraction", "getGoogleGenAiFilesMetadata", "downloadGoogleGenAiFile"]) {
      expect(code.match(new RegExp(`\\b${transport}\\(`, "g")), transport).toHaveLength(1);
    }
  });

  it("allows only the B4X operator composition to consume the factory and keeps both retired adapters unconsumed in any module form", async () => {
    // Every TS/JS-family file is parsed (no raw-text prefilter); static, re-export,
    // dynamic import, require and import-equals references are all checked.
    // B4X replaced the B4V zero-consumer invariant with this exact approved consumer.
    const { fileCount, consumers } = await scanDormancyConsumers();
    expect(fileCount).toBeGreaterThan(0);
    expect(consumers).toEqual({
      // B5C-R1: shared reconcile dependencies recover EXISTING Google submissions only.
      createGoogleGenAiSingleShotSecureProductionRecovery: [operatorComposition, "src/execution/createProductionExecutionReconcileDependencies.ts"].sort(),
      createGoogleGenAiSingleShotProductionInteractionGetter: [],
      createGoogleGenAiSingleShotProductionOutputRetriever: [],
    });
    // Sanity: the same scanner sees the factory's own real transport references.
    const factoryReferences = moduleReferences(await readFile(join(root, factory), "utf8"), factory).map((reference) => reference.specifier);
    expect(factoryReferences).toEqual(expect.arrayContaining([
      "../../googleGenai/transport/replayGoogleGenAiInteraction.js",
      "../../googleGenai/transport/getGoogleGenAiFilesMetadata.js",
      "../../googleGenai/transport/downloadGoogleGenAiFile.js",
    ]));
  });
});

describe("B4V7C dormancy scanner regressions (decoded specifiers, nested dynamic import, require)", () => {
  const consumerFile = join(root, "src/execution/b4v7cScannerProbe.ts");
  // Encodes the leading "c" so the raw source never contains the complete guarded name.
  const escapes = {
    unicode: (name: string) => `\\u0063${name.slice(1)}`,
    hex: (name: string) => `\\x63${name.slice(1)}`,
    codePoint: (name: string) => `\\u{63}${name.slice(1)}`,
  } as const;
  const forms: ReadonlyArray<readonly [string, (name: string) => string, boolean]> = [
    ["escaped static side-effect import", (name) => `import "./providers/${escapes.unicode(name)}.js";`, true],
    ["escaped re-export all", (name) => `export * from "./providers/${escapes.hex(name)}.js";`, true],
    ["escaped named re-export", (name) => `export { ${name} as aliased } from "./providers/${escapes.codePoint(name)}.js";`, false],
    ["escaped default-binding import", (name) => `import anything from "./providers/${escapes.unicode(name)}.js"; void anything;`, true],
    ["literal dynamic import", (name) => `export async function load() { return await import("./providers/${name}.js"); }`, false],
    ["escaped dynamic import nested in an expression", (name) => `const loaded = (async () => (await import("./providers/${escapes.codePoint(name)}.js")).default)(); void loaded;`, true],
    ["template dynamic import", (name) => `const loaded = import(\`./providers/${name}.js\`); void loaded;`, false],
    ["literal require", (name) => `const recovery = require("./providers/${name}.js"); void recovery;`, false],
    ["escaped require nested in a function", (name) => `export function lazy() { return require("./providers/${escapes.hex(name)}.js"); }`, true],
    ["TS import-equals require", (name) => `import recovery = require("./providers/${escapes.unicode(name)}.js"); void recovery;`, true],
    ["aliased named import (static non-regression)", (name) => `import { ${name} as renamed } from "./providers/${name}.js"; void renamed;`, false],
    ["type-only import (still a forbidden reference)", (name) => `import type { ${name} } from "./providers/${name}.js";`, false],
  ];

  for (const name of DORMANT_GUARDED_MODULES) {
    it.each(forms)(`detects ${name} through %s using the decoded specifier`, (_label, build, rawNameAbsent) => {
      const source = build(name);
      if (rawNameAbsent) expect(source.includes(name)).toBe(false);
      expect(guardedModuleConsumers(source, consumerFile)).toEqual([name]);
    });
  }

  it("decodes escapes exactly as the parser does and reports each module form", () => {
    const name = DORMANT_GUARDED_MODULES[0];
    const source = [
      `import "./${escapes.unicode(name)}.js";`,
      `export * from "./${escapes.hex(name)}.js";`,
      `void import("./${escapes.codePoint(name)}.js");`,
      `void require("./${name}.js");`,
    ].join("\n");
    expect(moduleReferences(source, consumerFile)).toEqual([
      { specifier: `./${name}.js`, via: "import", typeOnly: false },
      { specifier: `./${name}.js`, via: "re-export", typeOnly: false },
      { specifier: `./${name}.js`, via: "dynamic-import", typeOnly: false },
      { specifier: `./${name}.js`, via: "require", typeOnly: false },
    ]);
  });

  it.each([
    ["line comment", (name: string) => `// import "./${name}.js";`],
    ["block comment", (name: string) => `/* await import("./${name}.js") */`],
    ["plain string", (name: string) => `const text = "./${name}.js"; void text;`],
    ["template text", (name: string) => `const text = \`require("./${name}.js")\`; void text;`],
    ["non-require call", (name: string) => `declare function load(path: string): unknown; void load("./${name}.js");`],
    ["member require call", (name: string) => `declare const loader: { require(path: string): unknown }; void loader.require("./${name}.js");`],
  ])("ignores a %s that only mentions a guarded name", (_label, build) => {
    for (const name of DORMANT_GUARDED_MODULES) expect(guardedModuleConsumers(build(name), consumerFile)).toEqual([]);
  });
});
