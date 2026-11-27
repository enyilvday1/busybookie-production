import { describe, expect, it } from "vitest";
import { F6ProtocolError, canonicalizeF6Document, strictJsonDecode } from "../src/index.js";
const bytes = (s: string) => new TextEncoder().encode(s);
const rejects = (data: Uint8Array, code = "F6_STRUCTURE_INVALID") => { try { strictJsonDecode(data); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 strict JSON decoding P06/P07", () => {
  it("rejects duplicate names at root, nested and escaped-equivalent levels", () => {
    rejects(bytes('{"a":1,"a":2}'));
    rejects(bytes('{"a":{"z":1,"z":2}}'));
    rejects(bytes('{"a":1,"\\u0061":2}'));
    rejects(bytes('{"\\u0061":1,"a":2}'));
  });
  it("accepts legitimate primitives and recursively immutable null-prototype values", () => {
    const decoded = strictJsonDecode(bytes('{"a":[true,false,null,0,-0,1.25,"hi"],"nested":{"x":"€"}}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.a)).toBe(true);
    expect(canonicalizeF6Document(decoded)).toContain('"nested":{"x":"€"}');
  });
  it("handles dangerous property names as inert data", () => {
    const decoded = strictJsonDecode(bytes('{"__proto__":{"polluted":true},"constructor":1}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(Object.hasOwn(decoded, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("rejects malformed UTF-8, BOM, lone surrogates and broken strings", () => {
    rejects(new Uint8Array([0xc3, 0x28]), "F6_VALUE_NOT_CANONICALIZABLE");
    rejects(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    rejects(bytes('"\\ud800"'), "F6_VALUE_NOT_CANONICALIZABLE");
    rejects(bytes('"\\udead"'), "F6_VALUE_NOT_CANONICALIZABLE");
    rejects(bytes('"\\ud800\\u0000"'), "F6_VALUE_NOT_CANONICALIZABLE");
    rejects(bytes('"bad\nnewline"'));
    rejects(bytes('"bad\\q"'));
    rejects(bytes('"bad\\uFFFFx'));
  });
  it("rejects trailing content, malformed numbers, unsafe integers and underflow", () => {
    for (const value of ['{"a":1,}', '[1,]', 'true false', '01', '-.1', '1.', '1e', 'Infinity', 'NaN', '1e999', '1e-999', '9007199254740993', '9007199254740992', '1e30']) rejects(bytes(value), ['1e999', '1e-999', '9007199254740993', '9007199254740992', '1e30'].includes(value) ? "F6_VALUE_NOT_CANONICALIZABLE" : "F6_STRUCTURE_INVALID");
  });
  it("agrees with direct canonicalization on the strict safe-integer policy", () => {
    expect(canonicalizeF6Document(strictJsonDecode(bytes("9007199254740991")))).toBe("9007199254740991");
    for (const text of ["9007199254740992", "-9007199254740992", "1e30"]) {
      rejects(bytes(text), "F6_VALUE_NOT_CANONICALIZABLE");
    }
  });
  it("bounds payload and depth", () => {
    rejects(new Uint8Array(65_537));
    rejects(bytes('['.repeat(35) + '0' + ']'.repeat(35)));
    rejects(bytes(''));
  });
});
