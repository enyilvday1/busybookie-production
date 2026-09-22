import {
  prepareRunwayImageAsset,
  type RunwayImageAssetStrategy,
} from "./runwayImageAsset.js";

export type EphemeralAssetUploader =
  (
    filePath: string,
  ) => Promise<string>;

export type ResolvedRunwayImageAsset =
  Readonly<{
    sourcePath: string;
    strategy:
      RunwayImageAssetStrategy;
    uri: string;
  }>;

export async function resolveRunwayImageAsset(
  filePath: string,
  uploadEphemeral:
    EphemeralAssetUploader,
): Promise<ResolvedRunwayImageAsset> {
  const prepared =
    await prepareRunwayImageAsset(
      filePath,
    );

  if (
    prepared.strategy ===
    "DATA_URI"
  ) {
    return Object.freeze({
      sourcePath:
        prepared.sourcePath,
      strategy:
        "DATA_URI",
      uri:
        prepared.uri,
    });
  }

  const uri =
    (
      await uploadEphemeral(
        prepared.sourcePath,
      )
    ).trim();

  if (
    !uri.startsWith(
      "runway://",
    )
  ) {
    throw new Error(
      "Runway ephemeral uploader returned an invalid URI.",
    );
  }

  return Object.freeze({
    sourcePath:
      prepared.sourcePath,
    strategy:
      "EPHEMERAL_UPLOAD",
    uri,
  });
}
