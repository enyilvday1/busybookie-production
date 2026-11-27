import { fail, wellFormed } from "./errors.js";

// Restricted I-JSON decoder for external bytes. No JSON.parse of whole objects:
// JSON.parse would erase duplicate names before a reviver could detect them.
// Independently specified raw-token tests are mandatory; parser review is a
// separate release gate. No external effects, arbitrary code or getters.
const MAX_BYTES = 65_536;
const MAX_DEPTH = 32;
const MAX_ITEMS = 4096;
const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

class Parser {
  private pos = 0;
  private elements = 0;
  constructor(private readonly text: string) {}

  private spaces(): void {
    while (this.pos < this.text.length && /[\x20\t\r\n]/.test(this.text[this.pos]!)) this.pos += 1;
  }
  private char(ch: string): boolean {
    if (this.text[this.pos] !== ch) return false;
    this.pos += 1;
    return true;
  }
  private expect(ch: string): void {
    if (!this.char(ch)) fail("F6_STRUCTURE_INVALID");
  }
  private counted(): void {
    this.elements += 1;
    if (this.elements > MAX_ITEMS) fail("F6_STRUCTURE_INVALID");
  }
  private string(): string {
    const start = this.pos;
    this.expect('"');
    let complete = false;
    while (this.pos < this.text.length) {
      const ch = this.text.charCodeAt(this.pos++);
      if (ch === 0x22) { complete = true; break; }
      if (ch < 0x20) fail("F6_STRUCTURE_INVALID");
      if (ch !== 0x5c) continue;
      const escaped = this.text[this.pos++];
      if (escaped === "u") {
        for (let k = 0; k < 4; k += 1) {
          const code = this.text.charCodeAt(this.pos++);
          if (!((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102))) fail("F6_STRUCTURE_INVALID");
        }
      } else if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail("F6_STRUCTURE_INVALID");
    }
    if (!complete) fail("F6_STRUCTURE_INVALID");
    let decoded: unknown;
    try { decoded = JSON.parse(this.text.slice(start, this.pos)); }
    catch { return fail("F6_STRUCTURE_INVALID"); }
    if (typeof decoded !== "string" || !wellFormed(decoded)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
    return decoded;
  }
  private value(depth: number): unknown {
    if (depth > MAX_DEPTH) return fail("F6_STRUCTURE_INVALID");
    this.spaces();
    if (this.char("{")) {
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      const keys = new Set<string>();
      this.spaces();
      if (this.char("}")) return Object.freeze(out);
      do {
        this.spaces();
        if (this.text[this.pos] !== '"') return fail("F6_STRUCTURE_INVALID");
        const name = this.string();
        if (keys.has(name)) return fail("F6_STRUCTURE_INVALID");
        keys.add(name);
        this.counted();
        this.spaces();
        this.expect(":");
        const value = this.value(depth + 1);
        Object.defineProperty(out, name, { value, enumerable: true, writable: false, configurable: false });
        this.spaces();
        if (this.char("}")) return Object.freeze(out);
        this.expect(",");
      } while (true);
    }
    if (this.char("[")) {
      const items: unknown[] = [];
      this.spaces();
      if (this.char("]")) return Object.freeze(items);
      do {
        this.counted();
        items.push(this.value(depth + 1));
        this.spaces();
        if (this.char("]")) return Object.freeze(items);
        this.expect(",");
      } while (true);
    }
    if (this.text[this.pos] === '"') return this.string();
    for (const [word, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (this.text.startsWith(word, this.pos)) { this.pos += word.length; return value; }
    }
    NUMBER.lastIndex = this.pos;
    const match = NUMBER.exec(this.text);
    if (!match) return fail("F6_STRUCTURE_INVALID");
    this.pos = NUMBER.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return fail("F6_VALUE_NOT_CANONICALIZABLE");
    // Reject positive/negative underflow silently rounded to zero.
    if (value === 0 && /[1-9]/.test(match[0].split(/[eE]/)[0]!)) return fail("F6_VALUE_NOT_CANONICALIZABLE");
    return value;
  }
  parse(): unknown {
    this.spaces();
    const value = this.value(0);
    this.spaces();
    if (this.pos !== this.text.length) return fail("F6_STRUCTURE_INVALID");
    return value;
  }
}

export function strictJsonDecode(bytes: Uint8Array): unknown {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return fail("F6_STRUCTURE_INVALID");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { return fail("F6_VALUE_NOT_CANONICALIZABLE"); }
  return new Parser(text).parse();
}
