import type {
  GoogleGenAI,
} from "@google/genai";

import {
  createVeoClient,
} from "../createVeoClient.js";

export type VeoFileDownloadClient =
  Readonly<{
    files:
      Readonly<
        Pick<
          GoogleGenAI["files"],
          "download"
        >
      >;
  }>;

export function createVeoFileDownloadClient(
  apiKey:
    string,
): VeoFileDownloadClient {
  const client =
    createVeoClient(
      apiKey,
    );

  return Object.freeze({
    files:
      Object.freeze({
        download:
          client.files
            .download
            .bind(
              client.files,
            ),
      }),
  });
}
