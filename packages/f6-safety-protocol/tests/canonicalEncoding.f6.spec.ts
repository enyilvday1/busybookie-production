import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { F6ProtocolError, canonicalizeF6Document, sha256F6Document } from "../src/index.js";
const rejected = (run: () => unknown, code: string) => { try { run(); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 canonical JSON and domain separation P06/P08/P09/P10", () => {
  it("uses recursive UTF-16 key ordering and preserves array order", () => {
    expect(canonicalizeF6Document({ b: [{ z: 0, a: 1 }], a: "yes" })).toBe('{"a":"yes","b":[{"a":1,"z":0}]}');
    expect(canonicalizeF6Document({ "\ud83d\ude00": 1, "\ufb33": 2, "\u20ac": 3 })).toBe('{"€":3,"😀":1,"דּ":2}');
  });
  it("matches RFC 8785 section 3.2 string and supported-number serialization", () => {
    const input = { numbers: [333333333.33333329, 4.50, 2e-3, 1e-27], string: "\u20ac$\u000f\nA'B\"\\\"/", literals: [null, true, false] };
    const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\\"\\\\\\\"/"}';
    expect(canonicalizeF6Document(input)).toBe(expected);
  });
  it("produces identical hashes for insertion-order permutations and separates domains", () => {
    const a = { z: 1, x: 2 };
    const b = { x: 2, z: 1 };
    expect(sha256F6Document(a, "RUN_MANIFEST")).toBe(sha256F6Document(b, "RUN_MANIFEST"));
    expect(sha256F6Document(a, "RUN_MANIFEST")).not.toBe(sha256F6Document(a, "LEASE"));
    expect(sha256F6Document(a, "RUN_MANIFEST")).not.toBe(sha256F6Document({ ...a, z: 2 }, "RUN_MANIFEST"));
    const preimage = "busybookie.r44b11g.f6.v1\0RUN_MANIFEST\0" + canonicalizeF6Document(a);
    expect(sha256F6Document(a, "RUN_MANIFEST")).toBe(createHash("sha256").update(preimage).digest("hex"));
  });
  it("rejects unsafe JS shapes and does not call getter or toJSON", () => {
    let invoked = false;
    const obj: Record<string, unknown> = {};
    Object.defineProperty(obj, "x", { enumerable: true, get() { invoked = true; return 1; } });
    rejected(() => canonicalizeF6Document(obj), "F6_VALUE_NOT_CANONICALIZABLE");
    expect(invoked).toBe(false);
    rejected(() => canonicalizeF6Document({ toJSON() { invoked = true; } }), "F6_VALUE_NOT_CANONICALIZABLE");
    expect(invoked).toBe(false);
    rejected(() => canonicalizeF6Document([, 2]), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document(new Date()), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document({ [Symbol("k")]: 1 }), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document(NaN), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document("\ud800"), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document({ x: 2n }), "F6_VALUE_NOT_CANONICALIZABLE");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    rejected(() => canonicalizeF6Document(cycle), "F6_VALUE_NOT_CANONICALIZABLE");
  });
  it("keeps JCS ECMAScript number formatting", () => {
    expect(canonicalizeF6Document([-0, 0.000001, 1e-27])).toBe("[0,0.000001,1e-27]");
    rejected(() => sha256F6Document({}, "FORGED" as never), "F6_STRUCTURE_INVALID");
    expect(canonicalizeF6Document(Number.MAX_SAFE_INTEGER)).toBe("9007199254740991");
    rejected(() => canonicalizeF6Document(2 ** 53), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document(1e30), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document(-(2 ** 53)), "F6_VALUE_NOT_CANONICALIZABLE");
  });
  it("enforces aggregate UTF-8 byte limits BEFORE oversized output is constructed", () => {
    expect(Buffer.byteLength(canonicalizeF6Document("a".repeat(65_534)), "utf8")).toBe(65_536);
    rejected(() => canonicalizeF6Document("a".repeat(65_535)), "F6_VALUE_NOT_CANONICALIZABLE");
    expect(Buffer.byteLength(canonicalizeF6Document("é".repeat(32_767)), "utf8")).toBe(65_536);
    rejected(() => canonicalizeF6Document("é".repeat(32_768)), "F6_VALUE_NOT_CANONICALIZABLE");
    expect(Buffer.byteLength(canonicalizeF6Document("\u0000".repeat(10_922)), "utf8")).toBe(65_534);
    rejected(() => canonicalizeF6Document("\u0000".repeat(10_923)), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document(Array(120).fill("x".repeat(32_768))), "F6_VALUE_NOT_CANONICALIZABLE");
    rejected(() => canonicalizeF6Document({ ["\u0000".repeat(11_000)]: 1 }), "F6_VALUE_NOT_CANONICALIZABLE");
  });
});
