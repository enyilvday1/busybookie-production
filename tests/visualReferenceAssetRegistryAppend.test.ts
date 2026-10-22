import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

// Fault injection for the owned-lock cleanup branches only: off by default, scoped to "<registry>.lock".
const lockFaults = vi.hoisted(() => ({ closeFails: false, unlinkFails: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();

  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);

      if (String(args[0]).endsWith(".lock") && lockFaults.closeFails) {
        const close = handle.close.bind(handle);

        // The descriptor really closes, then the call reports failure.
        return Object.assign(handle, {
          close: async () => {
            await close();
            throw new Error("injected lock close failure");
          },
        });
      }

      return handle;
    },
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      if (String(path).endsWith(".lock") && lockFaults.unlinkFails) throw new Error("injected lock unlink failure");

      return actual.unlink(path);
    },
  };
});

import {
  appendVisualReferenceAssetRegistry,
  readVisualReferenceRegistrySha256,
  visualReferenceRegistryLockPath,
} from "../src/execution/appendVisualReferenceAssetRegistry.js";

import { VisualReferenceAssetRegistrySchema } from "../src/execution/visualReferenceAsset.schema.js";
import { createVisualReferenceAssetRegistryPath } from "../src/execution/visualReferenceAssetRegistryPath.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 7)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(37, 3)]);

const EXISTING = {
  assetId: "littleleaf-valley-storybook-village-v1",
  mediaRootRelativePath: "references/littleleaf-valley/littleleaf_valley_storybook_village.png",
  bytes: 123,
  sha256: "c".repeat(64),
  contentType: "image/png",
};

const ASSET_ID = "ollie-master-identity-reference-v1";
const RELATIVE = `references/characters/OLLIE/${ASSET_ID}.png`;

const roots: string[] = [];

afterEach(async () => {
  lockFaults.closeFails = false;
  lockFaults.unlinkFails = false;

  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function sha(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixture(options: { registry?: unknown; registryText?: string; image?: Buffer } = {}) {
  const mediaRoot = await mkdtemp(join(tmpdir(), "busybookie-registry-append-"));
  roots.push(mediaRoot);

  const imagePath = resolve(mediaRoot, ...RELATIVE.split("/"));
  await mkdir(dirname(imagePath), { recursive: true });
  await writeFile(imagePath, options.image ?? PNG);

  const registryPath = createVisualReferenceAssetRegistryPath(mediaRoot);

  if (options.registry !== null) {
    await writeFile(
      registryPath,
      options.registryText ?? `${JSON.stringify(options.registry ?? { schemaVersion: "1.0", assets: [EXISTING] }, null, 2)}\n`,
    );
  }

  return { mediaRoot, imagePath, registryPath };
}

async function append(f: Awaited<ReturnType<typeof fixture>>, extra: Record<string, unknown> = {}, dependencies = {}) {
  return appendVisualReferenceAssetRegistry({
    mediaRoot: f.mediaRoot,
    sourceImagePath: f.imagePath,
    assetId: ASSET_ID,
    expectedRegistrySha256: "expectedRegistrySha256" in extra
      ? extra.expectedRegistrySha256 as string
      : sha(await readFile(f.registryPath)),
    ...extra,
  }, dependencies);
}

async function leftovers(directory: string): Promise<string[]> {
  return (await readdir(directory)).filter((name) => name.includes(".lock") || name.includes(".part-"));
}

describe("appendVisualReferenceAssetRegistry", () => {
  it("appends one verified asset and preserves every previous entry", async () => {
    const f = await fixture();
    const before = await readFile(f.registryPath);
    const result = await append(f);

    const stored = VisualReferenceAssetRegistrySchema.parse(JSON.parse(await readFile(f.registryPath, "utf8")));

    expect(stored.assets).toHaveLength(2);
    expect(stored.assets[0]).toEqual(EXISTING);
    expect(stored.assets[1]).toEqual({
      assetId: ASSET_ID,
      mediaRootRelativePath: RELATIVE,
      bytes: PNG.length,
      sha256: sha(PNG),
      contentType: "image/png",
    });
    expect(result.entry).toEqual(stored.assets[1]);
    expect(result.previousRegistrySha256).toBe(sha(before));
    expect(result.registrySha256).toBe(sha(await readFile(f.registryPath)));
    expect(result.registrySha256).toBe(await readVisualReferenceRegistrySha256(f.mediaRoot));
    expect(await leftovers(dirname(f.registryPath))).toEqual([]);
  });

  it("appends to an existing empty registry", async () => {
    const f = await fixture({ registry: { schemaVersion: "1.0", assets: [] } });
    expect((await append(f)).registry.assets).toHaveLength(1);
  });

  it("fails on a missing registry and never creates one", async () => {
    const f = await fixture({ registry: null });

    await expect(append({ ...f }, { expectedRegistrySha256: "0".repeat(64) })).rejects.toThrow(/does not exist/);
    await expect(readFile(f.registryPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await leftovers(dirname(f.registryPath))).toEqual([]);
  });

  it("fails on a malformed or invalid registry and leaves it unchanged", async () => {
    for (const registryText of ["{not json", JSON.stringify({ schemaVersion: "2.0", assets: [] })]) {
      const f = await fixture({ registryText });

      await expect(append(f)).rejects.toThrow(/malformed JSON|invalid/);
      expect(await readFile(f.registryPath, "utf8")).toBe(registryText);
    }
  });

  it("rejects a duplicate asset id and a duplicate canonical path", async () => {
    const duplicateId = await fixture({ registry: { schemaVersion: "1.0", assets: [{ ...EXISTING, assetId: ASSET_ID }] } });
    await expect(append(duplicateId)).rejects.toThrow(/already registered/);

    const duplicatePath = await fixture({
      registry: { schemaVersion: "1.0", assets: [{ ...EXISTING, mediaRootRelativePath: RELATIVE.toUpperCase().replace("REFERENCES", "references") }] },
    });
    await expect(append(duplicatePath)).rejects.toThrow(/path is already registered/);
  });

  it("requires the exact expected registry byte digest", async () => {
    const f = await fixture();
    const before = await readFile(f.registryPath);

    await expect(append(f, { expectedRegistrySha256: "0".repeat(64) })).rejects.toThrow(/registry changed/);
    await expect(append(f, { expectedRegistrySha256: "NOT-HEX" })).rejects.toThrow(/expectedRegistrySha256/);
    // A semantically identical registry with different bytes is still a different precondition.
    await expect(append(f, { expectedRegistrySha256: sha(JSON.stringify(JSON.parse(before.toString()))) }))
      .rejects.toThrow(/registry changed/);
    expect(await readFile(f.registryPath)).toEqual(before);
  });

  it("checks the expected digest after acquiring the lock and re-reading", async () => {
    const f = await fixture();
    const expected = sha(await readFile(f.registryPath));
    const concurrent = `${JSON.stringify({ schemaVersion: "1.0", assets: [] }, null, 2)}\n`;

    await expect(append(f, { expectedRegistrySha256: expected }, {
      afterLockAcquired: async () => {
        await writeFile(f.registryPath, concurrent);
      },
    })).rejects.toThrow(/registry changed/);

    expect(await readFile(f.registryPath, "utf8")).toBe(concurrent);
    expect(await leftovers(dirname(f.registryPath))).toEqual([]);
  });

  it("fails closed on an existing lock and never deletes it", async () => {
    const f = await fixture();
    const lockPath = visualReferenceRegistryLockPath(f.registryPath);
    const before = await readFile(f.registryPath);

    await writeFile(lockPath, "held by another writer\n");

    await expect(append(f)).rejects.toThrow(/is locked/);
    expect(await readFile(lockPath, "utf8")).toBe("held by another writer\n");
    expect(await readFile(f.registryPath)).toEqual(before);
  });

  it("derives bytes, SHA-256 and content type from the physical file", async () => {
    const jpeg = await fixture({ image: JPEG });
    const result = await append(jpeg);

    expect(result.entry).toMatchObject({ bytes: JPEG.length, sha256: sha(JPEG), contentType: "image/jpeg" });

    const mismatch = await fixture({ image: JPEG });
    await expect(append(mismatch, { expectedContentType: "image/png" })).rejects.toThrow(/does not match the expected/);

    const notImage = await fixture({ image: Buffer.from("plain text, not an image") });
    await expect(append(notImage)).rejects.toThrow(/could not be verified/);
  });

  it("rejects sources outside the trusted references tree", async () => {
    const f = await fixture();
    const outside = join(f.mediaRoot, "generated-images", "ollie.png");
    await mkdir(dirname(outside), { recursive: true });
    await writeFile(outside, PNG);

    await expect(append(f, { sourceImagePath: outside })).rejects.toThrow(/inside references/);
    await expect(append(f, { sourceImagePath: join(tmpdir(), "elsewhere.png") })).rejects.toThrow(/inside the media root/);
  });

  it("rejects a realpath escape through the shared verifier", async () => {
    const f = await fixture();
    const before = await readFile(f.registryPath);

    await expect(append(f, {}, {
      realpath: async (path: string) => (path === resolve(f.imagePath) ? join(tmpdir(), "escaped.png") : resolve(path)),
    })).rejects.toThrow(/outside the trusted references root/);

    expect(await readFile(f.registryPath)).toEqual(before);
    expect(await leftovers(dirname(f.registryPath))).toEqual([]);
  });

  it("refuses to rewrite a registry whose stored form schema parsing would change", async () => {
    const f = await fixture({ registry: { schemaVersion: "1.0", assets: [{ ...EXISTING, assetId: ` ${EXISTING.assetId}` }] } });
    const before = await readFile(f.registryPath);

    await expect(append(f)).rejects.toThrow(/canonical stored form/);
    expect(await readFile(f.registryPath)).toEqual(before);
  });

  it("is generic: no character or asset id enumeration and no E9 runtime import", () => {
    const text = readFileSync(new URL("../src/execution/appendVisualReferenceAssetRegistry.ts", import.meta.url), "utf8");

    expect(text).not.toMatch(/OLLIE|KACEY|MONT|ollie|kacey|master-identity|characters\//);
    expect(text).not.toMatch(/from\s+["'][^"']*characterIdentity/);
  });

  it("still preserves entries whose stored key order differs from the schema order", async () => {
    const reordered = {
      contentType: EXISTING.contentType,
      sha256: EXISTING.sha256,
      bytes: EXISTING.bytes,
      mediaRootRelativePath: EXISTING.mediaRootRelativePath,
      assetId: EXISTING.assetId,
    };
    const f = await fixture({ registry: { assets: [reordered], schemaVersion: "1.0" } });

    expect((await append(f)).registry.assets[0]).toEqual(EXISTING);
  });
});

describe("owned registry lock cleanup", () => {
  it("removes its own lock even when closing the lock handle fails after a successful append", async () => {
    const f = await fixture();
    lockFaults.closeFails = true;

    await expect(append(f)).resolves.toMatchObject({ entry: { assetId: ASSET_ID } });
    expect(await leftovers(dirname(f.registryPath))).toEqual([]);
  });

  it("removes its own lock and keeps the primary error when closing fails after a failed append", async () => {
    const f = await fixture();
    lockFaults.closeFails = true;

    await expect(append(f, { expectedRegistrySha256: "0".repeat(64) })).rejects.toThrow(/registry changed/);
    expect(await leftovers(dirname(f.registryPath))).toEqual([]);
  });

  it("does not let a lock unlink failure hide the primary error", async () => {
    const f = await fixture();
    lockFaults.unlinkFails = true;

    await expect(append(f, { expectedRegistrySha256: "0".repeat(64) })).rejects.toThrow(/registry changed/);
  });

  it("leaves a lock it could not remove in place, so later appends fail closed instead of guessing", async () => {
    const f = await fixture();
    lockFaults.unlinkFails = true;

    await expect(append(f)).resolves.toBeDefined();
    lockFaults.unlinkFails = false;

    expect(await leftovers(dirname(f.registryPath))).toEqual([basename(visualReferenceRegistryLockPath(f.registryPath))]);
    await expect(append(f, { assetId: "ollie-master-identity-reference-v2" })).rejects.toThrow(/is locked/);
    expect(await leftovers(dirname(f.registryPath))).toEqual([basename(visualReferenceRegistryLockPath(f.registryPath))]);
  });
});
