import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// Fault injection limited to owned-lock close and registry publication; off by default.
const faults = vi.hoisted(() => ({ lockCloseFails: false, publishFails: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);

      if (String(args[0]).endsWith(".lock") && faults.lockCloseFails) {
        const close = handle.close.bind(handle);

        return Object.assign(handle, {
          close: async () => {
            await close();
            throw new Error("injected lock close failure");
          },
        });
      }

      return handle;
    },
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      if (faults.publishFails && String(args[1]).endsWith("visual-reference-asset-registry.json")) {
        throw Object.assign(new Error("injected publication failure"), { code: "EIO" });
      }

      return actual.copyFile(...args);
    },
  };
});

import { appendVisualReferenceAssetRegistry, visualReferenceRegistryLockPath } from "../src/execution/appendVisualReferenceAssetRegistry.js";
import { bootstrapVisualReferenceAssetRegistry } from "../src/execution/bootstrapVisualReferenceAssetRegistry.js";
import { readVisualReferenceAssetRegistry } from "../src/execution/readVisualReferenceAssetRegistry.js";
import { verifyApprovedVisualReferenceAsset } from "../src/execution/verifyApprovedVisualReferenceAsset.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 5)]);
const ASSET_ID = "test-environment-plate-v1";
const RELATIVE = "references/environment/test-environment-plate.png";

const roots: string[] = [];

afterEach(async () => {
  faults.lockCloseFails = false;
  faults.publishFails = false;

  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function sha(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixture(options: { references?: boolean; image?: Buffer } = {}) {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-registry-bootstrap-"));
  roots.push(mediaRoot);

  const sourceFile = resolve(mediaRoot, ...RELATIVE.split("/"));

  if (options.references !== false) {
    await mkdir(dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, options.image ?? PNG);
    // A second file the bootstrap must never discover.
    await writeFile(join(dirname(sourceFile), "other-plate.png"), PNG);
  }

  return { mediaRoot, sourceFile, registryPath: createVisualReferenceAssetRegistryPath(mediaRoot) };
}

function input(f: { mediaRoot: string; sourceFile: string }, overrides: Record<string, unknown> = {}) {
  const image = overrides.image as Buffer | undefined;

  return {
    mediaRoot: f.mediaRoot,
    sourceFile: f.sourceFile,
    assetId: ASSET_ID,
    expectedSourceSha256: sha(image ?? PNG),
    expectedSourceBytes: (image ?? PNG).length,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "image")),
  } as Parameters<typeof bootstrapVisualReferenceAssetRegistry>[0];
}

async function residue(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory)).filter((name) => name.includes(".lock") || name.includes(".part-"));
  } catch {
    return [];
  }
}

async function absent(path: string): Promise<void> {
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("bootstrapVisualReferenceAssetRegistry", () => {
  it("creates a registry with exactly the one verified asset and returns the exact file digest", async () => {
    const f = await fixture();
    const result = await bootstrapVisualReferenceAssetRegistry(input(f));

    const expectedEntry = { assetId: ASSET_ID, mediaRootRelativePath: RELATIVE, bytes: PNG.length, sha256: sha(PNG), contentType: "image/png" };

    expect(result.registryPath).toBe(f.registryPath);
    expect(result.entry).toEqual(expectedEntry);
    expect(result.registry).toEqual({ schemaVersion: "1.0", assets: [expectedEntry] });

    const persisted = await readVisualReferenceAssetRegistry(f.mediaRoot);
    expect(persisted).toEqual(result.registry);
    expect(persisted.assets).toHaveLength(1);
    expect(result.registrySha256).toBe(sha(await readFile(f.registryPath)));
    expect(await readFile(f.registryPath, "utf8")).toBe(`${JSON.stringify(result.registry, null, 2)}\n`);

    await expect(verifyApprovedVisualReferenceAsset({
      mediaRoot: f.mediaRoot, sourceImagePath: f.sourceFile, approvedAssetIds: [ASSET_ID], registry: persisted,
    })).resolves.toMatchObject({ assetId: ASSET_ID });

    expect(await residue(dirname(f.registryPath))).toEqual([]);
  });

  it("fails for a missing or relative media root", async () => {
    const f = await fixture();

    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { mediaRoot: join(f.mediaRoot, "missing") })))
      .rejects.toThrow(/media root does not exist/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { mediaRoot: "relative/root" })))
      .rejects.toThrow(/media root must be absolute/);
  });

  it("fails without a references root and never creates it", async () => {
    const f = await fixture({ references: false });

    await expect(bootstrapVisualReferenceAssetRegistry(input(f))).rejects.toThrow(/trusted references root does not exist/);
    expect(readdirSync(f.mediaRoot)).toEqual([]);
  });

  it("never overwrites an existing registry", async () => {
    const f = await fixture();
    const existing = `${JSON.stringify({ schemaVersion: "1.0", assets: [] }, null, 2)}\n`;
    await writeFile(f.registryPath, existing);

    await expect(bootstrapVisualReferenceAssetRegistry(input(f))).rejects.toThrow(/already exists and is never overwritten/);
    expect(await readFile(f.registryPath, "utf8")).toBe(existing);
    expect(await residue(dirname(f.registryPath))).toEqual([]);
  });

  it("rejects missing, outside, traversing and non-regular sources", async () => {
    const f = await fixture();
    const outside = join(f.mediaRoot, "generated-images", "plate.png");
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, PNG);
    await mkdir(join(f.mediaRoot, "references", "a-directory.png"));

    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: join(f.mediaRoot, "references", "missing.png") })))
      .rejects.toThrow(/source file does not exist/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: outside })))
      .rejects.toThrow(/strictly inside/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: `${f.mediaRoot}/references/../generated-images/plate.png` })))
      .rejects.toThrow(/strictly inside/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: join(f.mediaRoot, "references") })))
      .rejects.toThrow(/strictly inside/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: join(f.mediaRoot, "references", "a-directory.png") })))
      .rejects.toThrow(/not a regular file/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: "references/environment/test-environment-plate.png" })))
      .rejects.toThrow(/source file must be absolute/);

    await absent(f.registryPath);
  });

  it("rejects a realpath escape through the shared verifier", async () => {
    const f = await fixture();

    await expect(bootstrapVisualReferenceAssetRegistry(input(f), {
      realpath: async (path: string) => (path === resolve(f.sourceFile) ? join(tmpdir(), "escaped.png") : resolve(path)),
    })).rejects.toThrow(/outside the trusted references root/);

    await absent(f.registryPath);
    expect(await residue(dirname(f.registryPath))).toEqual([]);
  });

  it("rejects a real symlink escaping the references root where the platform allows symlinks", async ({ skip }) => {
    const f = await fixture();
    const outside = join(f.mediaRoot, "outside.png");
    const link = join(f.mediaRoot, "references", "environment", "linked.png");
    await writeFile(outside, PNG);

    try {
      await symlink(outside, link, "file");
    } catch {
      skip();
    }

    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { sourceFile: link })))
      .rejects.toThrow(/outside the trusted references root/);
    await absent(f.registryPath);
  });

  it("rejects malformed asset ids, expectations and caller-supplied authoritative fields", async () => {
    const f = await fixture();

    for (const overrides of [
      { assetId: "" },
      { assetId: " padded-id-v1" },
      { expectedSourceSha256: "NOT-A-SHA" },
      { expectedSourceSha256: sha(PNG).toUpperCase() },
      { expectedSourceBytes: 0 },
      { expectedSourceBytes: 1.5 },
      { contentType: "image/png" },
      { entry: { assetId: ASSET_ID } },
      { registryPath: join(f.mediaRoot, "elsewhere.json") },
    ]) {
      await expect(bootstrapVisualReferenceAssetRegistry(input(f, overrides)), JSON.stringify(overrides)).rejects.toThrow(/blocked/);
    }

    await absent(f.registryPath);
  });

  it("requires the physical bytes and SHA-256 to equal the operator expectations", async () => {
    const f = await fixture();

    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { expectedSourceBytes: PNG.length + 1 })))
      .rejects.toThrow(/byte count/);
    await expect(bootstrapVisualReferenceAssetRegistry(input(f, { expectedSourceSha256: "a".repeat(64) })))
      .rejects.toThrow(/SHA-256/);
    await absent(f.registryPath);
    expect(await residue(dirname(f.registryPath))).toEqual([]);
  });

  it("derives the content type from the signature and rejects unsupported content", async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40, 2)]);
    const f = await fixture({ image: jpeg });
    expect((await bootstrapVisualReferenceAssetRegistry(input(f, { image: jpeg }))).entry.contentType).toBe("image/jpeg");

    const text = Buffer.from("this is not an image at all");
    const g = await fixture({ image: text });
    await expect(bootstrapVisualReferenceAssetRegistry(input(g, { image: text }))).rejects.toThrow(/could not be verified/);
    await absent(g.registryPath);
  });

  it("fails closed on an existing lock and never deletes it", async () => {
    const f = await fixture();
    const lockPath = visualReferenceRegistryLockPath(f.registryPath);
    await writeFile(lockPath, "held\n");

    await expect(bootstrapVisualReferenceAssetRegistry(input(f))).rejects.toThrow(/is locked/);
    expect(await readFile(lockPath, "utf8")).toBe("held\n");
    await absent(f.registryPath);
  });

  it("removes its own lock even when closing it fails, on success and on failure", async () => {
    faults.lockCloseFails = true;

    const ok = await fixture();
    await expect(bootstrapVisualReferenceAssetRegistry(input(ok))).resolves.toBeDefined();
    expect(await residue(dirname(ok.registryPath))).toEqual([]);

    const failing = await fixture();
    await expect(bootstrapVisualReferenceAssetRegistry(input(failing, { expectedSourceBytes: 1 }))).rejects.toThrow(/byte count/);
    expect(await residue(dirname(failing.registryPath))).toEqual([]);
  });

  it("fails closed when another registry appears before publication and leaves it untouched", async () => {
    const f = await fixture();
    const racing = `${JSON.stringify({ schemaVersion: "1.0", assets: [] }, null, 2)}\n`;

    await expect(bootstrapVisualReferenceAssetRegistry(input(f), {
      beforePublish: async () => {
        await writeFile(f.registryPath, racing);
      },
    })).rejects.toThrow(/appeared during bootstrap and was not overwritten/);

    expect(await readFile(f.registryPath, "utf8")).toBe(racing);
    expect(await residue(dirname(f.registryPath))).toEqual([]);
  });

  it("leaves no registry and no temporary file when publication fails", async () => {
    const f = await fixture();
    faults.publishFails = true;

    await expect(bootstrapVisualReferenceAssetRegistry(input(f))).rejects.toThrow(/publication failed/);
    await absent(f.registryPath);
    expect(await residue(dirname(f.registryPath))).toEqual([]);
  });

  it("does not auto-discover other files under references", async () => {
    const f = await fixture();
    const result = await bootstrapVisualReferenceAssetRegistry(input(f));

    expect(statSync(join(dirname(f.sourceFile), "other-plate.png")).isFile()).toBe(true);
    expect(result.registry.assets.map((asset) => asset.assetId)).toEqual([ASSET_ID]);
  });
});

describe("registry authority boundaries", () => {
  it("leaves appendVisualReferenceAssetRegistry strict about a missing registry", async () => {
    const f = await fixture();

    await expect(appendVisualReferenceAssetRegistry({
      mediaRoot: f.mediaRoot, sourceImagePath: f.sourceFile, assetId: ASSET_ID, expectedRegistrySha256: "0".repeat(64),
    })).rejects.toThrow(/does not exist/);
    await absent(f.registryPath);
  });

  it("keeps generic execution code free of characterIdentity imports and production-root defaults", () => {
    const directory = new URL("../src/execution/", import.meta.url);
    const files = readdirSync(directory, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => join(entry.parentPath, entry.name));

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      expect(readFileSync(file, "utf8"), basename(file)).not.toMatch(/from\s+["'][^"']*characterIdentity/);
    }

    for (const file of ["bootstrapVisualReferenceAssetRegistry.ts", "cli/bootstrapVisualReferenceAssetRegistry.ts"]) {
      const text = readFileSync(new URL(file, directory), "utf8");

      expect(text, file).not.toMatch(/D:[\\/]|Busybookie[\\/]Production|BUSYBOOKIE_MEDIA_ROOT|process\.env|dotenv|littleleaf|ed47ab4c|2967785/i);
    }
  });

  it("leaves config/characters.json untouched", () => {
    expect(sha(readFileSync(new URL("../config/characters.json", import.meta.url))))
      .toBe("cbb68ce6e5ad758636cdd3adeeae340f890f5745df4e8e7cbd9ec2e88352c96f");
  });
});
