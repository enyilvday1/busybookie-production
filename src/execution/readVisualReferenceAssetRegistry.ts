import {
  readFile,
} from "node:fs/promises";

import {
  VisualReferenceAssetRegistrySchema,
  type VisualReferenceAssetRegistry,
} from "./visualReferenceAsset.schema.js";

import {
  createVisualReferenceAssetRegistryPath,
} from "./visualReferenceAssetRegistryPath.js";

export async function readVisualReferenceAssetRegistry(
  mediaRoot:
    string,
): Promise<VisualReferenceAssetRegistry> {
  const registryPath =
    createVisualReferenceAssetRegistryPath(
      mediaRoot,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        registryPath,
        "utf8",
      );
  } catch (error) {
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code ===
      "ENOENT"
    ) {
      throw new Error(
        `Visual reference asset registry is required but does not exist: ${registryPath}`,
        {
          cause:
            error,
        },
      );
    }

    throw new Error(
      `Could not read visual reference asset registry: ${registryPath}`,
      {
        cause:
          error,
      },
    );
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Visual reference asset registry contains malformed JSON: ${registryPath}`,
      {
        cause:
          error,
      },
    );
  }

  const validated =
    VisualReferenceAssetRegistrySchema
      .safeParse(
        parsed,
      );

  if (!validated.success) {
    throw new Error(
      `Visual reference asset registry is invalid: ${registryPath}`,
      {
        cause:
          validated.error,
      },
    );
  }

  return validated.data;
}
