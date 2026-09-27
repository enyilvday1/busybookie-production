import {
  GenerateVideosOperation,
  type GenerateVideosOperation as GenerateVideosOperationType,
} from "@google/genai";

import {
  normalizeCompletedVeoOperation,
  type VeoExecutionClient,
  type VeoExecutionResult,
} from "./veoExecution.js";

export type VeoOperationLookupClient =
  Readonly<{
    operations:
      Readonly<
        Pick<
          VeoExecutionClient["operations"],
          "getVideosOperation"
        >
      >;
  }>;

export type ResumeVeoOperationInput =
  Readonly<{
    operationName:
      string;

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

function requireDurableOperationName(
  value:
    string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      "Veo resume requires a non-empty operation name.",
    );
  }

  return normalized;
}

function requireProviderOperationName(
  operation:
    GenerateVideosOperationType,
): string {
  const name =
    operation
      .name
      ?.trim();

  if (!name) {
    throw new Error(
      "Veo resume lookup returned an operation without a name.",
    );
  }

  return name;
}

function requirePollIntervalMs(
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      "Veo resume polling interval must be a positive safe integer.",
    );
  }

  return value;
}

function requireTimeoutMs(
  value:
    number,

  pollIntervalMs:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <=
      pollIntervalMs
  ) {
    throw new Error(
      "Veo resume timeout must be a positive safe integer greater than the polling interval.",
    );
  }

  return value;
}

function assertSameOperationName(
  durableOperationName:
    string,

  operation:
    GenerateVideosOperationType,
): void {
  const returnedOperationName =
    requireProviderOperationName(
      operation,
    );

  if (
    returnedOperationName !==
    durableOperationName
  ) {
    throw new Error(
      "Veo retrieved operation name " +
        returnedOperationName +
        " does not match durable operation name " +
        durableOperationName +
        ".",
    );
  }
}

export async function resumeVeoOperation(
  client:
    VeoOperationLookupClient,

  input:
    ResumeVeoOperationInput,
): Promise<VeoExecutionResult> {
  const operationName =
    requireDurableOperationName(
      input.operationName,
    );

  const pollIntervalMs =
    requirePollIntervalMs(
      input.pollIntervalMs,
    );

  const timeoutMs =
    requireTimeoutMs(
      input.timeoutMs,
      pollIntervalMs,
    );

  const sleep =
    input.sleep ??
    defaultSleep;

  const nowMs =
    input.nowMs ??
    Date.now;

  const durableOperation =
    new GenerateVideosOperation();

  durableOperation.name =
    operationName;

  const startedAt =
    nowMs();

  let operation =
    await client
      .operations
      .getVideosOperation({
        operation:
          durableOperation,
      });

  assertSameOperationName(
    operationName,
    operation,
  );

  while (
    !operation.done
  ) {
    const elapsed =
      nowMs() -
      startedAt;

    if (
      elapsed >=
      timeoutMs
    ) {
      throw new Error(
        "Veo resume polling timed out after " +
          timeoutMs +
          "ms for " +
          operationName +
          ". The server-side operation may still be running.",
      );
    }

    const remaining =
      timeoutMs -
      elapsed;

    await sleep(
      Math.min(
        pollIntervalMs,
        remaining,
      ),
    );

    const updated =
      await client
        .operations
        .getVideosOperation({
          operation,
        });

    assertSameOperationName(
      operationName,
      updated,
    );

    operation =
      updated;
  }

  return normalizeCompletedVeoOperation(
    operation,
  );
}
