import { describe, expect, it } from "vitest";

import {
  isDisplayableRequestId,
  isOperatorErrorCode,
  OPERATOR_ERROR_CODES,
  parseEpisodeList,
  parseErrorEnvelope,
} from "../src/api/operatorDtos";

const VALID = { episodeId: "EP02", manifest: "VALID", title: "Ollie finds a shell", sceneCount: 2, shotCount: 7 };
const INVALID = { episodeId: "EP03", manifest: "INVALID" };

describe("episode-list guard", () => {
  it("accepts VALID and INVALID items and preserves received order", () => {
    const list = parseEpisodeList({ apiVersion: "v1", episodes: [INVALID, VALID] });
    expect(list).toEqual([INVALID, VALID]);
  });

  it("accepts an empty list", () => {
    expect(parseEpisodeList({ apiVersion: "v1", episodes: [] })).toEqual([]);
  });

  it("drops unknown fields and freezes the result", () => {
    const list = parseEpisodeList({
      apiVersion: "v1",
      extra: "ignored",
      episodes: [
        { ...VALID, path: "D:/SECRET/x.json", readiness: "READY" },
        { ...INVALID, title: "not part of an INVALID item", sceneCount: 3 },
      ],
    });
    expect(list).toEqual([VALID, INVALID]);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list?.[0])).toBe(true);
    expect(JSON.stringify(list)).not.toMatch(/SECRET|readiness|ignored/);
  });

  it.each([
    ["a non-object document", "nope"],
    ["null", null],
    ["a wrong apiVersion", { apiVersion: "v2", episodes: [] }],
    ["a missing apiVersion", { episodes: [] }],
    ["episodes that are not an array", { apiVersion: "v1", episodes: {} }],
    ["an empty episodeId", { apiVersion: "v1", episodes: [{ ...VALID, episodeId: "" }] }],
    ["a non-string episodeId", { apiVersion: "v1", episodes: [{ ...VALID, episodeId: 2 }] }],
    ["an unknown manifest value", { apiVersion: "v1", episodes: [{ ...VALID, manifest: "PARTIAL" }] }],
    ["a VALID item without a title", { apiVersion: "v1", episodes: [{ ...VALID, title: undefined }] }],
    ["a negative count", { apiVersion: "v1", episodes: [{ ...VALID, sceneCount: -1 }] }],
    ["a fractional count", { apiVersion: "v1", episodes: [{ ...VALID, shotCount: 1.5 }] }],
    ["a string count", { apiVersion: "v1", episodes: [{ ...VALID, shotCount: "7" }] }],
    ["an array item", { apiVersion: "v1", episodes: [[]] }],
  ])("rejects %s", (_label, document) => {
    expect(parseEpisodeList(document)).toBeNull();
  });
});

describe("error-envelope guard", () => {
  it("keeps only code and requestId, never the backend message", () => {
    const envelope = parseErrorEnvelope({
      error: { code: "STATE_UNAVAILABLE", message: "D:/SECRET path detail", requestId: "abc" },
    });
    expect(envelope).toEqual({ code: "STATE_UNAVAILABLE", requestId: "abc" });
    expect(JSON.stringify(envelope)).not.toContain("SECRET");
  });

  it.each([
    ["no error object", { code: "X" }],
    ["a missing message", { error: { code: "X", requestId: "r" } }],
    ["a non-string code", { error: { code: 1, message: "m", requestId: "r" } }],
    ["a missing requestId", { error: { code: "X", message: "m" } }],
    ["a non-object", "text"],
  ])("rejects %s", (_label, document) => {
    expect(parseErrorEnvelope(document)).toBeNull();
  });
});

describe("error-code allowlist and request-ID rule", () => {
  it("contains exactly the seven D1 codes", () => {
    expect([...OPERATOR_ERROR_CODES]).toEqual([
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "METHOD_NOT_ALLOWED",
      "STATE_UNAVAILABLE",
      "INTERNAL_ERROR",
    ]);
    expect(isOperatorErrorCode("STATE_UNAVAILABLE")).toBe(true);
    expect(isOperatorErrorCode("state_unavailable")).toBe(false);
    expect(isOperatorErrorCode("PROVIDER_FAILED")).toBe(false);
    expect(isOperatorErrorCode(undefined)).toBe(false);
  });

  it.each([
    ["aed7ef66-15f4-48e7-8c37-6d28fa204f09", true],
    ["AED7EF66-15F4-48E7-8C37-6D28FA204F09", true],
    ["00000000-0000-0000-0000-000000000000", true],
    [" aed7ef66-15f4-48e7-8c37-6d28fa204f09", false],
    ["aed7ef66-15f4-48e7-8c37-6d28fa204f09x", false],
    ["id: aed7ef66-15f4-48e7-8c37-6d28fa204f09", false],
    ["aed7ef6615f448e78c376d28fa204f09", false],
    ["req-1", false],
    ["<script>alert(1)</script>", false],
    ["", false],
  ])("isDisplayableRequestId(%j) is %s", (value, expected) => {
    expect(isDisplayableRequestId(value)).toBe(expected);
  });
});
