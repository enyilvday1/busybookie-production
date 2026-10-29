import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bindingDigest, canonicalBindingJson, parseBoundJson, rawSha256, readBoundFile } from "../src/execution/episodeInputBinding.js";

describe("binding encoding and checked buffers", () => {
  it("uses one stable sorted encoding and preserves array order", () => {
    expect(canonicalBindingJson({ z: [{ b: 2, a: 1 }], a: null })).toBe('{"a":null,"z":[{"a":1,"b":2}]}');
    expect(bindingDigest({ z: 2, a: 1 })).toBe(bindingDigest({ a: 1, z: 2 }));
    expect(bindingDigest([1, 2])).not.toBe(bindingDigest([2, 1]));
    expect(bindingDigest({ absent: null })).not.toBe(bindingDigest({}));
  });
  it.each([undefined, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, new Date(), [undefined], Array(1), { field: undefined }])(
    "rejects values JSON would lose or round", value => { expect(() => canonicalBindingJson(value)).toThrow(); },
  );
  it("hashes exact raw bytes and parses that buffer even after a later file mutation", async () => {
    const root = await mkdtemp(join(process.cwd(), ".b7-binding-"));
    try {
      const path = join(root, "policy.json");
      await writeFile(path, '{ "value": 1 }\n');
      const loaded = await readBoundFile({ root, canonicalPath: path, role: "TEST", maxBytes: 100 });
      expect(loaded.binding.rawSha256).toBe(rawSha256(await readFile(path)));
      await writeFile(path, '{"value":2}');
      expect(parseBoundJson(loaded.bytes!, value => value)).toEqual({ value: 1 });
      await expect(readBoundFile({ root, canonicalPath: path, role: "TEST", maxBytes: 100, expected: loaded.binding }))
        .rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
      await expect(readBoundFile({ root, canonicalPath: path, role: "TEST", maxBytes: 2 })).rejects.toThrow();
      const absent = await readBoundFile({ root, canonicalPath: join(root, "absent"), role: "OPTIONAL", maxBytes: 100, optional: true });
      expect(absent.binding).toMatchObject({ exists: false, rawSha256: null, bytes: 0 });
      await writeFile(join(root, "absent"), "{}");
      await expect(readBoundFile({ root, canonicalPath: join(root, "absent"), role: "OPTIONAL", maxBytes: 100,
        optional: true, expected: absent.binding })).rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
