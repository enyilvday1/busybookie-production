import type {
  GenerateVideosOperation,
  GenerateVideosParameters,
  GeneratedVideo,
} from "@google/genai";

export type VeoExecutionClient =
  Readonly<{
    models:
      Readonly<{
        generateVideos:
          (
            params:
              GenerateVideosParameters,
          ) =>
            Promise<
              GenerateVideosOperation
            >;
      }>;

    operations:
      Readonly<{
        getVideosOperation:
          (
            params:
              Readonly<{
                operation:
                  GenerateVideosOperation;
              }>,
          ) =>
            Promise<
              GenerateVideosOperation
            >;
      }>;
  }>;

export type VeoExecutionOptions =
  Readonly<{
    pollIntervalMs:
      number;

    timeoutMs:
      number;

    sleep?:
      (
        milliseconds:
          number,
      ) =>
        Promise<void>;

    nowMs?:
      () => number;
  }>;

export type VeoExecutionResult =
  Readonly<{
    operationName:
      string;

    generatedVideos:
      readonly GeneratedVideo[];

    raiMediaFilteredCount:
      number;

    raiMediaFilteredReasons:
      readonly string[];
  }>;

function defaultSleep(
  milliseconds:
    number,
): Promise<void> {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds,
      );
    },
  );
}

function requireOperationName(
  operation:
    GenerateVideosOperation,
): string {
  const name =
    operation.name
      ?.trim();

  if (!name) {
    throw new Error(
      "Veo returned an operation without a name.",
    );
  }

  return name;
}

export function normalizeCompletedVeoOperation(
  operation:
    GenerateVideosOperation,
): VeoExecutionResult {
  const operationName =
    requireOperationName(
      operation,
    );

  if (!operation.done) {
    throw new Error(
      `Veo operation ${operationName} is not complete.`,
    );
  }

  if (operation.error) {
    throw new Error(
      `Veo operation ${operationName} completed with an error.`,
    );
  }

  const response =
    operation.response;

  if (!response) {
    throw new Error(
      `Veo operation ${operationName} completed without a response.`,
    );
  }

  const generatedVideos =
    response.generatedVideos;

  if (
    !generatedVideos ||
    generatedVideos.length === 0
  ) {
    const reasons =
      response
        .raiMediaFilteredReasons
        ?.join(
          "; ",
        );

    throw new Error(
      reasons
        ? `Veo operation ${operationName} returned no generated videos. Filter reasons: ${reasons}`
        : `Veo operation ${operationName} returned no generated videos.`,
    );
  }

  for (
    const [
      index,
      generatedVideo,
    ]
    of generatedVideos.entries()
  ) {
    const video =
      generatedVideo.video;

    if (!video) {
      throw new Error(
        `Veo generated video ${index + 1} contains no video payload.`,
      );
    }

    if (
      !video.uri &&
      !video.videoBytes
    ) {
      throw new Error(
        `Veo generated video ${index + 1} contains neither a URI nor video bytes.`,
      );
    }
  }

  return Object.freeze({
    operationName,

    generatedVideos:
      Object.freeze([
        ...generatedVideos,
      ]),

    raiMediaFilteredCount:
      response
        .raiMediaFilteredCount ??
      0,

    raiMediaFilteredReasons:
      Object.freeze([
        ...(
          response
            .raiMediaFilteredReasons ??
          []
        ),
      ]),
  });
}

export async function executeVeoGeneration(
  client:
    VeoExecutionClient,

  request:
    GenerateVideosParameters,

  options:
    VeoExecutionOptions,
): Promise<VeoExecutionResult> {
  if (
    !Number.isSafeInteger(
      options.pollIntervalMs,
    ) ||
    options.pollIntervalMs <= 0
  ) {
    throw new Error(
      "Veo polling interval must be a positive safe integer.",
    );
  }

  if (
    !Number.isSafeInteger(
      options.timeoutMs,
    ) ||
    options.timeoutMs <=
      options.pollIntervalMs
  ) {
    throw new Error(
      "Veo timeout must be a positive safe integer greater than the polling interval.",
    );
  }

  const sleep =
    options.sleep ??
    defaultSleep;

  const nowMs =
    options.nowMs ??
    Date.now;

  let operation =
    await client.models
      .generateVideos(
        request,
      );

  const operationName =
    requireOperationName(
      operation,
    );

  const startedAt =
    nowMs();

  while (
    !operation.done
  ) {
    const elapsed =
      nowMs() -
      startedAt;

    if (
      elapsed >=
      options.timeoutMs
    ) {
      throw new Error(
        `Veo polling timed out after ${options.timeoutMs}ms for ${operationName}. The server-side operation may still be running.`,
      );
    }

    const remaining =
      options.timeoutMs -
      elapsed;

    await sleep(
      Math.min(
        options.pollIntervalMs,
        remaining,
      ),
    );

    const updated =
      await client.operations
        .getVideosOperation({
          operation,
        });

    const updatedName =
      requireOperationName(
        updated,
      );

    if (
      updatedName !==
      operationName
    ) {
      throw new Error(
        `Veo operation name changed from ${operationName} to ${updatedName}.`,
      );
    }

    operation =
      updated;
  }

  return normalizeCompletedVeoOperation(
    operation,
  );
}
