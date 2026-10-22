import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseBootstrapVisualReferenceAssetRegistryCliArgs,
  runBootstrapVisualReferenceAssetRegistryCli,
} from "../src/execution/cli/bootstrapVisualReferenceAssetRegistry.js";

import { bootstrapVisualReferenceAssetRegistry } from "../src/execution/bootstrapVisualReferenceAssetRegistry.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 8)]);
const SHA = createHash("sha256").update(PNG).digest("hex");

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function args(overrides: Record<string, string | null> = {}): string[] {
  const values: Record<string, string | null> = {
    "--media-root": "/media/root",
    "--source-file": "/media/root/references/plate.png",
    "--asset-id": "plate-v1",
    "--expected-source-sha256": SHA,
    "--expected-source-bytes": String(PNG.length),
    ...overrides,
  };

  return Object.entries(values).flatMap(([flag, value]) => (value === null ? [] : [flag, value]));
}

describe("visual reference registry bootstrap CLI arguments", () => {
  it.each(["--media-root", "--source-file", "--asset-id", "--expected-source-sha256", "--expected-source-bytes"])(
    "requires %s",
    (flag) => {
      expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs(args({ [flag]: null }))).toThrow(new RegExp(`requires ${flag}`));
    },
  );

  it("has no default or relative media root and rejects unknown, duplicate and malformed options", () => {
    expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs([])).toThrow(/requires --media-root/);
    expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs(args({ "--media-root": "relative/root" }))).toThrow(/absolute/);
    expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs([...args(), "--content-type", "image/png"])).toThrow(/Unknown/);
    expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs([...args(), "--asset-id", "again-v1"])).toThrow(/Duplicate/);
    expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs(args({ "--expected-source-bytes": "12.5" }))).toThrow(/positive integer/);
    expect(() => parseBootstrapVisualReferenceAssetRegistryCliArgs(args({ "--expected-source-bytes": "0" }))).toThrow(/positive integer/);
    expect(parseBootstrapVisualReferenceAssetRegistryCliArgs(args())).toEqual({
      mediaRoot: "/media/root",
      sourceFile: "/media/root/references/plate.png",
      assetId: "plate-v1",
      expectedSourceSha256: SHA,
      expectedSourceBytes: PNG.length,
    });
  });
});

describe("visual reference registry bootstrap CLI", () => {
  it("bootstraps a temporary media root and prints the evidence", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-registry-bootstrap-cli-"));
    roots.push(mediaRoot);

    const sourceFile = resolve(mediaRoot, "references", "environment", "plate.png");
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, PNG);

    const log: string[] = [];
    const seen: string[] = [];

    await runBootstrapVisualReferenceAssetRegistryCli(
      args({ "--media-root": mediaRoot, "--source-file": sourceFile }),
      {
        bootstrap: (input) => {
          seen.push(input.mediaRoot);
          return bootstrapVisualReferenceAssetRegistry(input);
        },
        log: (line) => log.push(line),
      },
    );

    const registryPath = createVisualReferenceAssetRegistryPath(mediaRoot);
    const output = JSON.parse(log[0]!);

    expect(seen).toEqual([mediaRoot]);
    expect(output).toEqual({
      result: "VISUAL_REFERENCE_REGISTRY_BOOTSTRAPPED",
      registryPath,
      assetId: "plate-v1",
      mediaRootRelativePath: "references/environment/plate.png",
      bytes: PNG.length,
      sha256: SHA,
      contentType: "image/png",
      registryFileSha256: createHash("sha256").update(await readFile(registryPath)).digest("hex"),
    });
  });
});
