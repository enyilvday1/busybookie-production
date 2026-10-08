import {
  posix,
} from "node:path";

import {
  z,
} from "zod";

function isCanonicalMediaRootRelativeReferencePath(
  value:
    string,
): boolean {
  if (
    value.includes(
      "\\",
    ) ||
    value.includes(
      "\0",
    ) ||
    posix.isAbsolute(
      value,
    ) ||
    !value.startsWith(
      "references/",
    ) ||
    value ===
      "references/" ||
    value.endsWith(
      "/",
    )
  ) {
    return false;
  }

  return (
    posix.normalize(
      value,
    ) ===
    value
  );
}

export const VisualReferenceAssetSchema =
  z.object({
    assetId:
      z.string()
        .trim()
        .min(
          1,
        ),

    mediaRootRelativePath:
      z.string()
        .trim()
        .min(
          1,
        )
        .refine(
          isCanonicalMediaRootRelativeReferencePath,
          {
            message:
              "Visual reference mediaRootRelativePath must be a canonical path strictly inside references/.",
          },
        ),

    bytes:
      z.number()
        .int()
        .positive()
        .max(
          Number.MAX_SAFE_INTEGER,
        ),

    sha256:
      z.string()
        .regex(
          /^[0-9a-f]{64}$/,
          "Visual reference sha256 must be a lowercase 64-character hexadecimal digest.",
        ),

    contentType:
      z.enum([
        "image/png",
        "image/jpeg",
        "image/webp",
      ]),
  })
    .strict();

export const VisualReferenceAssetRegistrySchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),

    assets:
      z.array(
        VisualReferenceAssetSchema,
      ),
  })
    .strict()
    .superRefine(
      (
        registry,
        ctx,
      ) => {
        const assetIds =
          new Set<string>();

        const canonicalPaths =
          new Set<string>();

        registry.assets.forEach(
          (
            asset,
            index,
          ) => {
            if (
              assetIds.has(
                asset.assetId,
              )
            ) {
              ctx.addIssue({
                code:
                  "custom",

                path: [
                  "assets",
                  index,
                  "assetId",
                ],

                message:
                  `Duplicate visual reference asset id: ${asset.assetId}.`,
              });
            }

            assetIds.add(
              asset.assetId,
            );

            const canonicalPathKey =
              asset
                .mediaRootRelativePath
                .toLowerCase();

            if (
              canonicalPaths.has(
                canonicalPathKey,
              )
            ) {
              ctx.addIssue({
                code:
                  "custom",

                path: [
                  "assets",
                  index,
                  "mediaRootRelativePath",
                ],

                message:
                  `Duplicate canonical visual reference path: ${asset.mediaRootRelativePath}.`,
              });
            }

            canonicalPaths.add(
              canonicalPathKey,
            );
          },
        );
      },
    );

export type VisualReferenceAsset =
  z.infer<
    typeof VisualReferenceAssetSchema
  >;

export type VisualReferenceAssetRegistry =
  z.infer<
    typeof VisualReferenceAssetRegistrySchema
  >;
