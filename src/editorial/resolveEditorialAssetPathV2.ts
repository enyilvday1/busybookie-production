import type { EditorialAsset } from "./editorialPlan.schema.js";
import { EditorialAssetV2Schema } from "./editorialPlanV2.schema.js";
import { resolveEditorialAssetPath } from "./resolveEditorialAssetPath.js";
import { assertEditorial } from "./validateEditorialPlan.js";

// Exact 1.0 asset shape (no 2.0-only fields) so the unchanged strict 1.0 resolver can be reused.
export function projectEditorialAssetV2ToV1(input: unknown): EditorialAsset {
  const parsed = EditorialAssetV2Schema.safeParse(input);
  assertEditorial(parsed.success, "2.0 asset locator/schema is invalid");
  const asset = parsed.data;
  return {
    assetId: asset.assetId, kind: asset.kind, sha256: asset.sha256, bytes: asset.bytes, contentType: asset.contentType,
    mediaRootRelativePath: asset.mediaRootRelativePath, normalization: asset.normalization, generatedSource: asset.generatedSource,
  };
}

export function resolveEditorialAssetPathV2(mediaRoot: string, asset: unknown): string {
  return resolveEditorialAssetPath(mediaRoot, projectEditorialAssetV2ToV1(asset));
}
