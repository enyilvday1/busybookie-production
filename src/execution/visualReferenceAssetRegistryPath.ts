import {
  isAbsolute,
  resolve,
} from "node:path";

export function createVisualReferenceAssetRegistryPath(
  mediaRoot:
    string,
): string {
  const normalizedMediaRoot =
    mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Visual reference asset registry media root is required.",
    );
  }

  if (
    !isAbsolute(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Visual reference asset registry media root must be absolute.",
    );
  }

  return resolve(
    normalizedMediaRoot,
    "references",
    "visual-reference-asset-registry.json",
  );
}
