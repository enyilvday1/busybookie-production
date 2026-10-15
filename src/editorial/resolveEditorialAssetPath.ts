import { sep, posix, win32 } from "node:path";
import { EditorialAssetSchema, type EditorialAsset } from "./editorialPlan.schema.js";
import { assertEditorial } from "./validateEditorialPlan.js";

// sep is the path runtime's flavor; never consult cwd/environment or touch the filesystem.
export function editorialRoot(mediaRoot: string): { root: string; windows: boolean } {
  assertEditorial(typeof mediaRoot === "string", "requires a media root");
  const root = mediaRoot.trim();
  const windows = /^[A-Za-z]:[\\/]/.test(root);
  const separator = root.includes("\\") ? "\\" : "/";
  assertEditorial(windows || (sep === "/" && root.startsWith("/") && !root.startsWith("//")), "unsupported or ambiguous media root");
  assertEditorial(!(root.includes("\\") && root.includes("/")), "mixed root separators");
  const tail = (windows ? root.slice(3) : root.slice(1)).replace(/[\\/]+$/, "");
  assertEditorial(tail.length > 0 && tail.split(separator).every((s) => s.length > 0 && s !== "." && s !== ".." &&
    !/[\x00-\x1f<>:"|?*]/.test(s)), "invalid root directory segments");
  return { root, windows };
}

export function resolveEditorialAssetPath(mediaRoot: string, input: EditorialAsset): string {
  const { root, windows } = editorialRoot(mediaRoot);
  const parsed = EditorialAssetSchema.safeParse(input);
  assertEditorial(parsed.success, "invalid asset locator/schema");
  const asset = parsed.data;
  const [, episodeId, shotId] = asset.assetId.split(":");
  const locator = `cache/composition-normalized/${episodeId}/${shotId}/${episodeId}_${shotId}_${asset.normalization.cacheKey}.mp4`;
  assertEditorial(asset.mediaRootRelativePath === locator, "locator does not match asset identity");
  const flavor = windows ? win32 : posix;
  const resolved = flavor.resolve(root, ...locator.split("/"));
  const relative = flavor.relative(root, resolved);
  assertEditorial(relative.split(flavor.sep).join("/") === locator, "asset escapes media root");
  if (asset.normalization.schemaVersion === "1.0") return resolved;
  const trimmed = root.replace(/[\\/]+$/, "");
  const separator = trimmed.lastIndexOf("\\") > trimmed.lastIndexOf("/") ? "\\" : "/";
  return [trimmed, ...locator.split("/")].join(separator);
}
