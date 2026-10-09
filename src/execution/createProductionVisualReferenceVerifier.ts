import {
  readVisualReferenceAssetRegistry,
} from "./readVisualReferenceAssetRegistry.js";

import type {
  SingleShotVisualReferenceVerifier,
} from "./singleShotExecution.types.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "./verifyApprovedVisualReferenceAsset.js";

export type ProductionVisualReferenceVerifierDependencies =
  Readonly<{
    readRegistry:
      typeof readVisualReferenceAssetRegistry;

    verifyAsset:
      typeof verifyApprovedVisualReferenceAsset;
  }>;

const defaultDependencies:
  ProductionVisualReferenceVerifierDependencies =
  Object.freeze({
    readRegistry:
      readVisualReferenceAssetRegistry,

    verifyAsset:
      verifyApprovedVisualReferenceAsset,
  });

export function createProductionVisualReferenceVerifier(
  dependencies:
    ProductionVisualReferenceVerifierDependencies =
      defaultDependencies,
): SingleShotVisualReferenceVerifier {
  return async (
    input,
  ) => {
    const registry =
      await dependencies
        .readRegistry(
          input.mediaRoot,
        );

    const verifiedAsset =
      await dependencies
        .verifyAsset({
          mediaRoot:
            input.mediaRoot,

          sourceImagePath:
            input.sourceImagePath,

          approvedAssetIds:
            input.approvedAssetIds,

          registry,
        });

    return Object.freeze({
      absolutePath:
        verifiedAsset
          .absolutePath,
    });
  };
}
