import {
  createReadStream,
} from "node:fs";

import type RunwayML from "@runwayml/sdk";

export async function uploadRunwayEphemeralAsset(
  client: RunwayML,
  filePath: string,
): Promise<string> {
  const stream =
    createReadStream(
      filePath,
    );

  const result =
    await client.uploads.createEphemeral({
      file: stream,
    });

  const uri =
    result.uri.trim();

  if (!uri.startsWith("runway://")) {
    throw new Error(
      "Runway ephemeral upload returned an unexpected URI.",
    );
  }

  return uri;
}
