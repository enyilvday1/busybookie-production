import { describe, expect, it } from "vitest";
import { validateGoogleGenAiFilesDownloadUri as validate } from "../src/googleGenai/transport/validateGoogleGenAiFilesDownloadUri.js";

const prefix = "https://generativelanguage.googleapis.com/v1beta/files/";
const suffix = ":download?alt=media";
const valid = prefix + "abc-123" + suffix;
describe("strict original Google Files URI authority", () => {
  it.each(["a", "0", "ab", "a-b", "a".repeat(40)])("binds legal ID %s without normalization", (fileId) => {
    const uri = prefix + fileId + suffix;
    const result = validate(uri);
    expect(result).toEqual({ fileId, name: `files/${fileId}`, downloadUri: uri });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it.each([
    valid.replace("https:", "http:"), valid.replace("generativelanguage", "storage"),
    valid.replace("googleapis.com", "googleapis.com.evil.test"), valid.replace("generativelanguage", "evil.generativelanguage"),
    valid.replace("generativelanguage", "evilgenerativelanguage"), valid.replace("generativelanguage", "GenerativeLanguage"),
    valid.replace("googleapis.com/", "googleapis.com./"), valid.replace("https://", "https://user:secret@"),
    valid.replace("googleapis.com/", "googleapis.com:443/"), valid.replace("googleapis.com/", "googleapis.com:8443/"),
    valid + "#fragment", " " + valid, valid + " ", valid + "\n", valid + "\r\n", "\t" + valid,
    valid.replace("googleapis", "góogleapis"), valid.replace("googleapis", "xn--googleapis"), valid.replace("abc-123", "ab c"),
    valid.replace("abc-123", "ab\0c"), valid.replace("abc-123", "%61bc"), valid.replace("abc-123", "a%2fb"),
    valid.replace("abc-123", "a%5cb"), valid.replace("abc-123", "%2e%2e"), valid.replace("abc-123", "%252f"),
    valid.replace("/files/", "\\files\\"), valid.replace("v1beta", "v1"), valid.replace("/files/", "/"),
    valid.replace("/files/", "/files/extra/"), valid.replace("abc-123", "../abc"), valid.replace("abc-123", ".."),
    valid.replace(":download", ":get"), valid.replace(":download", ""), valid.replace(":download?", ":download/?"),
    ...["", "-a", "a-", "A", "a_b", "a".repeat(41), "a.b", "a!b"].map((id) => prefix + id + suffix),
    ...["", "?", "?other=media", "?alt=", "?alt=json", "?alt=media&key=SECRET", "?alt=media&alt=media",
      "?%61lt=media", "?alt=%6dedia", "?alt=me+dia", "?alt=media&", "?x=1&alt=media", "?alt=media;", "?alt=media&&"].map((query) => prefix + "abc:download" + query),
  ])("rejects noncanonical source %# without echoing it", (uri) => {
    let error: unknown;
    try { validate(uri); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: "DOWNLOAD_URI_INVALID", retryable: false });
    expect(String(error) + (error as Error).stack + JSON.stringify(error)).not.toContain(uri);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
  });
});
