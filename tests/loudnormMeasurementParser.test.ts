import { describe, expect, it } from "vitest";
import {
  LOUDNORM_PARSE_FAILURE_CODES, loudnormFailureClass, parseCentiText, parseLoudnormMeasurement, type LoudnormParseFailureCode,
} from "../src/editorial/parseLoudnormMeasurement.js";

// Local, in-memory fixtures only (repeated per E5 test file; no shared helper path is authorized).
type Fields = Partial<Record<"input_i" | "input_tp" | "input_lra" | "input_thresh", string>>;
const HEADER = "[Parsed_loudnorm_2 @ 0000020a5c8b1d40] ";
function blockLines(fields: Fields = {}): string[] {
  const v = { input_i: "-23.45", input_tp: "-4.10", input_lra: "5.20", input_thresh: "-33.71", ...fields };
  return ["{", `\t"input_i" : "${v.input_i}",`, `\t"input_tp" : "${v.input_tp}",`, `\t"input_lra" : "${v.input_lra}",`,
    `\t"input_thresh" : "${v.input_thresh}",`, "\t\"output_i\" : \"-24.02\",", "\t\"output_tp\" : \"-5.92\",", "\t\"output_lra\" : \"4.30\",",
    "\t\"output_thresh\" : \"-34.20\",", "\t\"normalization_type\" : \"dynamic\",", "\t\"target_offset\" : \"0.02\"", "}"];
}
function stderrLines(fields: Fields = {}): string[] {
  return ["Input #0, lavfi, from 'x':", "  Duration: N/A", HEADER, ...blockLines(fields), "[out#0/null @ 0000020a] video:0KiB audio:0KiB"];
}
const bytes = (text: string) => new TextEncoder().encode(text);
const lf = (lines: readonly string[]) => bytes(`${lines.join("\n")}\n`);
const crlf = (lines: readonly string[]) => bytes(`${lines.join("\r\n")}\r\n`);
function code(input: Uint8Array): LoudnormParseFailureCode | "OK" {
  const result = parseLoudnormMeasurement(input);
  return result.ok ? "OK" : result.code;
}

describe("E5 loudnorm parser: line model (Step 1082 R8)", () => {
  it("T5-08 LF, CRLF and mixed LF/CRLF parse to the identical measurement", () => {
    const lines = stderrLines();
    const expected = parseLoudnormMeasurement(lf(lines));
    expect(expected).toStrictEqual({ ok: true, measurement: {
      class: "MEASURABLE", integratedCentiLufs: -2345, truePeakCentiDbtp: -410, loudnessRangeCentiLu: 520, thresholdCentiLufs: -3371 } });
    expect(parseLoudnormMeasurement(crlf(lines))).toStrictEqual(expected);
    const mixed = bytes(lines.map((line, index) => `${line}${index % 2 === 0 ? "\r\n" : "\n"}`).join(""));
    expect(parseLoudnormMeasurement(mixed)).toStrictEqual(expected);
    expect(parseLoudnormMeasurement(bytes(lines.join("\n")))).toStrictEqual(expected);
  });

  it("T5-09 a terminal CR after { and after } is accepted; bare-CR separators and embedded CR are INVALID_LINE_ENDING", () => {
    const lines = stderrLines();
    const withBraceCr = lines.map((line) => (line === "{" || line === "}" ? `${line}\r` : line));
    expect(code(lf(withBraceCr))).toBe("OK");
    expect(code(bytes(lines.join("\r")))).toBe("INVALID_LINE_ENDING");
    expect(code(lf(lines.map((line) => (line === "}" ? "}\r\r" : line))))).toBe("INVALID_LINE_ENDING");
    expect(code(lf(["x\ry", ...lines]))).toBe("INVALID_LINE_ENDING");
    expect(loudnormFailureClass("INVALID_LINE_ENDING")).toBe("INVALID_LINE_ENDING");
  });

  it("T5-10 strict UTF-8: invalid byte sequences are INVALID_UTF8; non-byte input throws", () => {
    const valid = lf(stderrLines());
    const invalid = new Uint8Array([...valid.slice(0, 10), 0xff, 0xfe, ...valid.slice(10)]);
    expect(code(invalid)).toBe("INVALID_UTF8");
    expect(() => parseLoudnormMeasurement("text" as unknown as Uint8Array)).toThrow();
  });

  it("T5-11 delimiters tolerate ASCII SPACE/TAB only; other whitespace makes the block missing", () => {
    const lines = stderrLines();
    expect(code(lf(lines.map((line) => (line === "{" ? " \t{\t " : line))))).toBe("OK");
    expect(code(lf(lines.map((line) => (line === "{" ? " {" : line))))).toBe("RESULT_BLOCK_MISSING");
    expect(code(lf(lines.map((line) => (line === HEADER ? `\t${HEADER}\t` : line))))).toBe("OK");
  });
});

describe("E5 loudnorm parser: block location, shape and values", () => {
  it("T5-12 block location failure codes", () => {
    const lines = stderrLines();
    expect(code(lf(lines.filter((line) => line !== "{")))).toBe("RESULT_BLOCK_MISSING");
    expect(code(lf([...lines, HEADER, ...blockLines()]))).toBe("RESULT_BLOCK_MULTIPLE");
    expect(code(lf(lines.filter((line) => line !== HEADER)))).toBe("RESULT_BLOCK_HEADER_MISSING");
    expect(code(lf(blockLines()))).toBe("RESULT_BLOCK_HEADER_MISSING");
    expect(code(lf(lines.map((line) => (line === HEADER ? "[Parsed_ebur128_0 @ 0x1] " : line))))).toBe("RESULT_BLOCK_HEADER_MISSING");
    expect(code(lf(lines.filter((line) => line !== "}")))).toBe("RESULT_BLOCK_UNTERMINATED");
    expect(code(lf([...lines, "}"]))).toBe("STRAY_BLOCK_DELIMITER");
    expect(code(lf(["}", ...lines]))).toBe("STRAY_BLOCK_DELIMITER");
  });

  it("T5-13 shape failure codes: malformed JSON, duplicate key, key set, non-string value", () => {
    const replace = (from: string, to: string) => lf(stderrLines().map((line) => (line === from ? to : line)));
    expect(code(replace("\t\"target_offset\" : \"0.02\"", "\t\"target_offset\" : \"0.02\","))).toBe("MALFORMED_JSON");
    expect(code(replace("\t\"output_lra\" : \"4.30\",", "\t\"input_i\" : \"-20.00\","))).toBe("DUPLICATE_KEY");
    expect(code(replace("\t\"output_lra\" : \"4.30\",", "\t\"extra\" : \"4.30\","))).toBe("KEY_SET_MISMATCH");
    expect(code(replace("\t\"output_lra\" : \"4.30\",", ""))).toBe("KEY_SET_MISMATCH");
    expect(code(replace("\t\"output_lra\" : \"4.30\",", "\t\"output_lra\" \"4.30\","))).toBe("MALFORMED_JSON");
    expect(code(replace("\t\"output_lra\" : \"4.30\",", "\t\"output_lra\" : 4.30,"))).toBe("NON_STRING_VALUE");
    expect(code(replace("\t\"input_i\" : \"-23.45\",", "\t\"input_i\" : -23.45,"))).toBe("NON_STRING_VALUE");
  });

  it("T5-14 exact two-fraction-digit grammar; no exponent, plus sign, comma, whitespace or locale forms", () => {
    for (const bad of ["-23.4", "-23.456", "-23", "+23.45", "-2.345e1", "-23,45", " -23.45", "-023.45", "--23.45", "23.45 ", "-.45"]) {
      expect(code(lf(stderrLines({ input_i: bad }))), bad).toBe("INVALID_FIELD_VALUE");
    }
    expect(parseCentiText("-0.00")).toBe(0);
    expect(Object.is(parseCentiText("-0.00"), -0)).toBe(false);
    expect(parseCentiText("0.07")).toBe(7);
    expect(parseCentiText("-120.37")).toBe(-12037);
  });

  it("T5-15 the universal 99.99 cap is removed: finite values below -99.99 parse; int32 bounds and lra >= 0 hold", () => {
    expect(parseLoudnormMeasurement(lf(stderrLines({ input_tp: "-120.37", input_thresh: "-130.01" })))).toMatchObject({
      ok: true, measurement: { truePeakCentiDbtp: -12037, thresholdCentiLufs: -13001 } });
    expect(code(lf(stderrLines({ input_i: "-21474836.48" })))).toBe("OK");
    expect(code(lf(stderrLines({ input_i: "-21474836.49" })))).toBe("INVALID_FIELD_VALUE");
    expect(code(lf(stderrLines({ input_tp: "21474836.48" })))).toBe("INVALID_FIELD_VALUE");
    expect(code(lf(stderrLines({ input_lra: "-0.01" })))).toBe("INVALID_FIELD_VALUE");
    expect(code(lf(stderrLines({ input_lra: "0.00" })))).toBe("OK");
  });

  it("T5-16 silence: input_i -inf is BELOW_ABSOLUTE_GATE with nulls exactly where -inf; a finite low value is never silence", () => {
    expect(parseLoudnormMeasurement(lf(stderrLines({ input_i: "-inf", input_tp: "-inf", input_thresh: "-inf", input_lra: "0.00" }))))
      .toStrictEqual({ ok: true, measurement: { class: "BELOW_ABSOLUTE_GATE", integratedCentiLufs: null, truePeakCentiDbtp: null,
        loudnessRangeCentiLu: 0, thresholdCentiLufs: null } });
    expect(parseLoudnormMeasurement(lf(stderrLines({ input_i: "-inf", input_tp: "-91.20" })))).toMatchObject({
      ok: true, measurement: { class: "BELOW_ABSOLUTE_GATE", truePeakCentiDbtp: -9120, thresholdCentiLufs: -3371 } });
    expect(parseLoudnormMeasurement(lf(stderrLines({ input_i: "-150.00" })))).toMatchObject({ ok: true, measurement: { class: "MEASURABLE" } });
  });

  it("T5-17 non-finite and inconsistent special values", () => {
    for (const value of ["inf", "+inf", "nan", "-nan"]) {
      for (const field of ["input_i", "input_tp", "input_lra", "input_thresh"] as const) {
        expect(code(lf(stderrLines({ [field]: value }))), `${field}=${value}`).toBe("NON_FINITE_MEASUREMENT");
      }
    }
    expect(code(lf(stderrLines({ input_tp: "-inf" })))).toBe("MEASUREMENT_INCONSISTENT");
    expect(code(lf(stderrLines({ input_thresh: "-inf" })))).toBe("MEASUREMENT_INCONSISTENT");
    expect(code(lf(stderrLines({ input_lra: "-inf" })))).toBe("INVALID_FIELD_VALUE");
    expect(code(lf(stderrLines({ input_i: "-inf", input_lra: "-inf" })))).toBe("INVALID_FIELD_VALUE");
  });

  it("T5-18 output_* and the other non-evidence fields are presence/type-checked only and never influence evidence", () => {
    const changed = stderrLines().map((line) => line.replace("\"-24.02\"", "\"not a number\"").replace("\"dynamic\"", "\"linear\""));
    expect(parseLoudnormMeasurement(lf(changed))).toStrictEqual(parseLoudnormMeasurement(lf(stderrLines())));
  });

  it("T5-19 every frozen parser failure code is reachable and maps to its frozen class", () => {
    expect([...LOUDNORM_PARSE_FAILURE_CODES].sort()).toStrictEqual([
      "DUPLICATE_KEY", "INVALID_FIELD_VALUE", "INVALID_LINE_ENDING", "INVALID_UTF8", "KEY_SET_MISMATCH", "MALFORMED_JSON",
      "MEASUREMENT_INCONSISTENT", "NON_FINITE_MEASUREMENT", "NON_STRING_VALUE", "RESULT_BLOCK_HEADER_MISSING", "RESULT_BLOCK_MISSING",
      "RESULT_BLOCK_MULTIPLE", "RESULT_BLOCK_UNTERMINATED", "STRAY_BLOCK_DELIMITER"]);
    for (const failure of LOUDNORM_PARSE_FAILURE_CODES) {
      const expected = ["INVALID_LINE_ENDING", "NON_FINITE_MEASUREMENT", "MEASUREMENT_INCONSISTENT"].includes(failure)
        ? failure : "MEASUREMENT_PARSE_FAILURE";
      expect(loudnormFailureClass(failure)).toBe(expected);
    }
  });

  it("T5-20 the parser source uses no float conversion of field text and no regex exec", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(fileURLToPath(new URL("../src/editorial/parseLoudnormMeasurement.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/parseFloat\(|Number\(\s*(text|value|match)|\.exec\(/);
    expect(source).toMatch(/BigInt\(/);
  });
});

describe("E5 loudnorm parser: Step 1088 ratification (m1087-1)", () => {
  it("T5-88 overlapping invalid authoritative values classify by NON_FINITE > INVALID_FIELD_VALUE > INCONSISTENT", () => {
    const cases: [Fields, LoudnormParseFailureCode][] = [
      [{ input_i: "nan", input_tp: "-1.0" }, "NON_FINITE_MEASUREMENT"], [{ input_i: "-1.0", input_tp: "nan" }, "NON_FINITE_MEASUREMENT"],
      [{ input_i: "+inf", input_tp: "-inf" }, "NON_FINITE_MEASUREMENT"], [{ input_i: "-inf", input_lra: "inf" }, "NON_FINITE_MEASUREMENT"],
      [{ input_tp: "-inf", input_lra: "-1.00" }, "INVALID_FIELD_VALUE"], [{ input_tp: "-inf", input_thresh: "x" }, "INVALID_FIELD_VALUE"],
      [{ input_lra: "-inf", input_tp: "-inf" }, "INVALID_FIELD_VALUE"], [{ input_i: "1e2", input_tp: "-inf" }, "INVALID_FIELD_VALUE"],
      [{ input_i: "-inf", input_thresh: "99999999999.00" }, "INVALID_FIELD_VALUE"], [{ input_tp: "-inf", input_thresh: "-inf" }, "MEASUREMENT_INCONSISTENT"],
    ];
    for (const [fields, expected] of cases) {
      const first = code(lf(stderrLines(fields)));
      expect(first, JSON.stringify(fields)).toBe(expected);
      expect(code(crlf(stderrLines(fields))), JSON.stringify(fields)).toBe(first);
    }
  });

  it("T5-89 non-authoritative output_*/target_offset non-finite text never changes the authoritative classification; silence preserved", () => {
    const nonAuthoritative = (lines: string[]) => lines.map((line) => line.replace("\"0.02\"", "\"inf\"").replace("\"-24.02\"", "\"-inf\"")
      .replace("\"-5.92\"", "\"nan\"").replace("\"4.30\"", "\"-nan\"").replace("\"-34.20\"", "\"+inf\""));
    const silence = { input_i: "-inf", input_tp: "-inf", input_thresh: "-inf", input_lra: "0.00" };
    expect(parseLoudnormMeasurement(lf(nonAuthoritative(stderrLines(silence))))).toStrictEqual(parseLoudnormMeasurement(lf(stderrLines(silence))));
    expect(parseLoudnormMeasurement(lf(nonAuthoritative(stderrLines(silence))))).toMatchObject({ ok: true, measurement: { class: "BELOW_ABSOLUTE_GATE" } });
    expect(parseLoudnormMeasurement(lf(nonAuthoritative(stderrLines())))).toStrictEqual(parseLoudnormMeasurement(lf(stderrLines())));
    expect(code(lf(nonAuthoritative(stderrLines({ input_tp: "-inf" }))))).toBe("MEASUREMENT_INCONSISTENT");
  });
});
