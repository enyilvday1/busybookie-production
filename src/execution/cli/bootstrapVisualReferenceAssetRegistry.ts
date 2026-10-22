import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  pathToFileURL,
} from "node:url";

import {
  bootstrapVisualReferenceAssetRegistry,
} from "../bootstrapVisualReferenceAssetRegistry.js";

// One-time maintenance CLI. Run with:
//   npx tsx src/execution/cli/bootstrapVisualReferenceAssetRegistry.ts --media-root <abs>
//     --source-file <abs under references/> --asset-id <id> --expected-source-sha256 <hex>
//     --expected-source-bytes <n>
// Every option is required; there is no default media root and the environment is never read.

const FLAGS = [
  "--media-root",
  "--source-file",
  "--asset-id",
  "--expected-source-sha256",
  "--expected-source-bytes",
] as const;

export type BootstrapVisualReferenceAssetRegistryCliOptions =
  Readonly<{
    mediaRoot: string;
    sourceFile: string;
    assetId: string;
    expectedSourceSha256: string;
    expectedSourceBytes: number;
  }>;

export function parseBootstrapVisualReferenceAssetRegistryCliArgs(
  args: readonly string[],
): BootstrapVisualReferenceAssetRegistryCliOptions {
  const allowed: readonly string[] = FLAGS;
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index]!;

    if (!allowed.includes(flag)) {
      throw new Error(`Unknown visual reference registry bootstrap argument: ${flag}`);
    }

    if (values.has(flag)) {
      throw new Error(`Duplicate visual reference registry bootstrap argument: ${flag}`);
    }

    const value = args[index + 1]?.trim();

    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }

    values.set(flag, value);
  }

  const required = (flag: string): string => {
    const value = values.get(flag);

    if (!value) {
      throw new Error(`Visual reference registry bootstrap requires ${flag}.`);
    }

    return value;
  };

  const mediaRoot = required("--media-root");

  if (!isAbsolute(mediaRoot)) {
    throw new Error("--media-root must be an absolute path.");
  }

  const bytesText = required("--expected-source-bytes");

  if (!/^[1-9][0-9]*$/.test(bytesText) || !Number.isSafeInteger(Number(bytesText))) {
    throw new Error("--expected-source-bytes must be a positive integer.");
  }

  return Object.freeze({
    mediaRoot,
    sourceFile: required("--source-file"),
    assetId: required("--asset-id"),
    expectedSourceSha256: required("--expected-source-sha256"),
    expectedSourceBytes: Number(bytesText),
  });
}

export type RunBootstrapVisualReferenceAssetRegistryCliDependencies =
  Readonly<{
    bootstrap: typeof bootstrapVisualReferenceAssetRegistry;
    log: (line: string) => void;
  }>;

const defaultDependencies: RunBootstrapVisualReferenceAssetRegistryCliDependencies = Object.freeze({
  bootstrap: bootstrapVisualReferenceAssetRegistry,
  log: (line: string) => console.log(line),
});

export async function runBootstrapVisualReferenceAssetRegistryCli(
  args: readonly string[],
  dependencies: RunBootstrapVisualReferenceAssetRegistryCliDependencies = defaultDependencies,
): Promise<void> {
  const options = parseBootstrapVisualReferenceAssetRegistryCliArgs(args);
  const result = await dependencies.bootstrap(options);

  dependencies.log(JSON.stringify({
    result: "VISUAL_REFERENCE_REGISTRY_BOOTSTRAPPED",
    registryPath: result.registryPath,
    assetId: result.entry.assetId,
    mediaRootRelativePath: result.entry.mediaRootRelativePath,
    bytes: result.entry.bytes,
    sha256: result.entry.sha256,
    contentType: result.entry.contentType,
    registryFileSha256: result.registrySha256,
  }, null, 2));
}

const invokedPath = process.argv[1];

if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runBootstrapVisualReferenceAssetRegistryCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
