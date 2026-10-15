import { posix, win32 } from "node:path";
import { editorialRoot } from "./resolveEditorialAssetPath.js";
import { assertEditorial } from "./validateEditorialPlan.js";
import { validateExternalAudioAsset } from "./validateEditorialPlanV3.js";

// Pure: never consults cwd/environment or touches the filesystem; the locator must stay inside the media root.
export function resolveExternalAudioAssetPath(mediaRoot: string, input: unknown): string {
  const { root, windows } = editorialRoot(mediaRoot);
  const asset = validateExternalAudioAsset(input);
  const locator = asset.mediaRootRelativePath;
  const flavor = windows ? win32 : posix;
  const resolved = flavor.resolve(root, ...locator.split("/"));
  assertEditorial(flavor.relative(root, resolved).split(flavor.sep).join("/") === locator, "external audio asset escapes media root");
  const trimmed = root.replace(/[\\/]+$/, "");
  const separator = trimmed.lastIndexOf("\\") > trimmed.lastIndexOf("/") ? "\\" : "/";
  return [trimmed, ...locator.split("/")].join(separator);
}
