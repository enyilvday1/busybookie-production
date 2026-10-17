import { isAbsolute, join, resolve } from "node:path";

// Bytes-only path infrastructure for E7 interchange artifacts. It understands safe primitive names only (EP episode ids
// and lowercase SHA-256 hex); no caller text or editorial data ever becomes a path component.
//   <mediaRoot>/exports/<episodeId>/interchange/<episodeId>_interchange_<exportIdentitySha256>.otio
const EPISODE_ID = /^EP[0-9]{2,3}$/;
const SHA = /^[a-f0-9]{64}$/;
const RANDOM_HEX = /^[0-9a-f]{32}$/;
const TEMP_SUFFIX = /\.tmp-[0-9a-f]{32}$/;
const ARTIFACT_NAME = /^(EP[0-9]{2,3})_interchange_[a-f0-9]{64}\.otio$/;

export function assertInterchangeEpisodeId(value: unknown): string {
  if (typeof value !== "string" || !EPISODE_ID.test(value)) throw new Error("Editorial interchange episodeId must use the form EP01.");
  return value;
}

export function assertInterchangeSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(`Editorial interchange ${label} must be a lowercase SHA-256.`);
  return value;
}

export function interchangeArtifactFileName(episodeId: unknown, exportIdentitySha256: unknown): string {
  return `${assertInterchangeEpisodeId(episodeId)}_interchange_${assertInterchangeSha256(exportIdentitySha256, "exportIdentitySha256")}.otio`;
}

export function isCanonicalInterchangeFileName(name: string): boolean {
  return ARTIFACT_NAME.test(name);
}

// Media-root-relative POSIX form; this is the only path form that may ever be reported or recorded.
export function interchangeArtifactRelativePath(episodeId: unknown, exportIdentitySha256: unknown): string {
  const ep = assertInterchangeEpisodeId(episodeId);
  return `exports/${ep}/interchange/${interchangeArtifactFileName(ep, exportIdentitySha256)}`;
}

export function reservedInterchangeTempName(finalName: string, randomHex: string): string {
  if (!isCanonicalInterchangeFileName(finalName)) throw new Error("Editorial interchange temp requires a canonical final name.");
  if (!RANDOM_HEX.test(randomHex)) throw new Error("Editorial interchange temp suffix must be 32 lowercase hex.");
  return `.${finalName}.tmp-${randomHex}`;
}

export function isReservedInterchangeTempName(name: string): boolean {
  if (!name.startsWith(".") || !TEMP_SUFFIX.test(name)) return false;
  return isCanonicalInterchangeFileName(name.slice(1, name.length - ".tmp-".length - 32));
}

// Operational input only: an absolute media root, never recorded in interchange data, identity or bytes.
function interchangeMediaRoot(mediaRoot: unknown): string {
  if (typeof mediaRoot !== "string" || mediaRoot.length === 0 || !isAbsolute(mediaRoot)) {
    throw new Error("Editorial interchange mediaRoot must be an absolute path.");
  }
  return resolve(mediaRoot);
}

export function interchangeDirectoryPath(mediaRoot: unknown, episodeId: unknown): string {
  return join(interchangeMediaRoot(mediaRoot), "exports", assertInterchangeEpisodeId(episodeId), "interchange");
}

export function interchangeArtifactPath(mediaRoot: unknown, episodeId: unknown, exportIdentitySha256: unknown): string {
  return join(interchangeDirectoryPath(mediaRoot, episodeId), interchangeArtifactFileName(episodeId, exportIdentitySha256));
}
