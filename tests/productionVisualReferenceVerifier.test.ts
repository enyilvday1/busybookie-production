import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createProductionVisualReferenceVerifier,
} from "../src/execution/createProductionVisualReferenceVerifier.js";

import {
  readVisualReferenceAssetRegistry,
} from "../src/execution/readVisualReferenceAssetRegistry.js";

import type {
  VisualReferenceAssetRegistry,
} from "../src/execution/visualReferenceAsset.schema.js";

import {
  verifyApprovedVisualReferenceAsset,
} from "../src/execution/verifyApprovedVisualReferenceAsset.js";

function makeRegistry():
VisualReferenceAssetRegistry {
  return {
    schemaVersion:
      "1.0",

    assets: [
      {
        assetId:
          "OLLIE_CHARACTER_MASTER_REFERENCE_V1",

        mediaRootRelativePath:
          "references/ollie-master-character-reference-v1.png",

        bytes:
          2_048,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "image/png",
      },
    ],
  };
}

describe(
  "Busybookie production visual-reference verifier adapter",
  () => {
    it(
      "loads the authoritative registry before verifying the approved source asset",
      async () => {
        const events:
          string[] = [];

        const mediaRoot =
          "D:/Busybookie/Production";

        const sourceImagePath =
          "D:/Busybookie/Production/references/ollie-master-character-reference-v1.png";

        const canonicalPhysicalPath =
          "D:/Busybookie/Production/references/ollie-master-character-reference-v1.png";

        const registry =
          makeRegistry();

        const registeredAsset =
          registry.assets[0];

        if (!registeredAsset) {
          throw new Error(
            "Expected the production visual-reference verifier test registry to contain one asset.",
          );
        }

        const readRegistry =
          vi.fn<
            typeof readVisualReferenceAssetRegistry
          >(
            async (
              receivedMediaRoot,
            ) => {
              events.push(
                "registry-read",
              );

              expect(
                receivedMediaRoot,
              ).toBe(
                mediaRoot,
              );

              return registry;
            },
          );

        const verifyAsset =
          vi.fn<
            typeof verifyApprovedVisualReferenceAsset
          >(
            async (
              input,
            ) => {
              events.push(
                "asset-verification",
              );

              expect(
                input,
              ).toEqual({
                mediaRoot,
                sourceImagePath,

                approvedAssetIds: [
                  "OLLIE_CHARACTER_MASTER_REFERENCE_V1",
                ],

                registry,
              });

              return Object.freeze({
                ...registeredAsset,

                absolutePath:
                  canonicalPhysicalPath,
              });
            },
          );

        const verifyVisualReference =
          createProductionVisualReferenceVerifier({
            readRegistry,
            verifyAsset,
          });

        const result =
          await verifyVisualReference({
            mediaRoot,
            sourceImagePath,

            approvedAssetIds: [
              "OLLIE_CHARACTER_MASTER_REFERENCE_V1",
            ],
          });

        expect(
          result,
        ).toEqual({
          absolutePath:
            canonicalPhysicalPath,
        });

        expect(
          events,
        ).toEqual([
          "registry-read",
          "asset-verification",
        ]);

        expect(
          readRegistry,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          verifyAsset,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "fails closed without invoking asset verification when the registry cannot be loaded",
      async () => {
        const readRegistry =
          vi.fn<
            typeof readVisualReferenceAssetRegistry
          >(
            async () => {
              throw new Error(
                "AUTHORITATIVE_REGISTRY_UNAVAILABLE",
              );
            },
          );

        const verifyAsset =
          vi.fn<
            typeof verifyApprovedVisualReferenceAsset
          >(
            async () => {
              throw new Error(
                "Asset verification must not run without the authoritative registry.",
              );
            },
          );

        const verifyVisualReference =
          createProductionVisualReferenceVerifier({
            readRegistry,
            verifyAsset,
          });

        await expect(
          verifyVisualReference({
            mediaRoot:
              "D:/Busybookie/Production",

            sourceImagePath:
              "D:/Busybookie/Production/references/ollie-master-character-reference-v1.png",

            approvedAssetIds: [
              "OLLIE_CHARACTER_MASTER_REFERENCE_V1",
            ],
          }),
        ).rejects.toThrow(
          "AUTHORITATIVE_REGISTRY_UNAVAILABLE",
        );

        expect(
          verifyAsset,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
