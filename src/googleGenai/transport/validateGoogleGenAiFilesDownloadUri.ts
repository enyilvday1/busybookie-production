import type { GoogleGenAiValidatedFileResource } from "./googleGenAiSecureOutputTransport.types.js";
import { GoogleGenAiSecureOutputTransportError } from "./googleGenAiSecureOutputTransportError.js";

/** Validate original serialization before URL can normalize any authority or path. */
export function validateGoogleGenAiFilesDownloadUri(uri: string): GoogleGenAiValidatedFileResource {
  function invalid(): never { throw new GoogleGenAiSecureOutputTransportError("DOWNLOAD_URI_INVALID"); }
  if (typeof uri !== "string") invalid();
  const match = /^https:\/\/generativelanguage[.]googleapis[.]com\/v1beta\/files\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?):download[?]alt=media$/.exec(uri);
  // JS $ also matches before a final newline; require the entire original string.
  if (!match || match[0] !== uri) invalid();
  const fileId = match[1]!;
  const pathname = `/v1beta/files/${fileId}:download`;
  let parsed: URL;
  try { parsed = new URL(uri); } catch { return invalid(); }
  const pairs = [...parsed.searchParams];
  if (parsed.protocol !== "https:" || parsed.hostname !== "generativelanguage.googleapis.com"
    || parsed.host !== "generativelanguage.googleapis.com" || parsed.port || parsed.username || parsed.password || parsed.hash
    || parsed.pathname !== pathname || parsed.search !== "?alt=media" || parsed.href !== uri
    || pairs.length !== 1 || pairs[0]?.[0] !== "alt" || pairs[0]?.[1] !== "media") invalid();
  return Object.freeze({ fileId, name: `files/${fileId}`, downloadUri: uri });
}
