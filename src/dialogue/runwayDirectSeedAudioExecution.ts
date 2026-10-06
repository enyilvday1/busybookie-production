import type RunwayML from "@runwayml/sdk";

import {
  z,
} from "zod";

import {
  DialogueGenerationDirectSeedAudioRequestRecordSchema,
} from "./dialogueGenerationRecord.schema.js";

export type RunwayDirectSeedAudioRequest =
  z.infer<
    typeof DialogueGenerationDirectSeedAudioRequestRecordSchema
  >;

export type RunwayDirectSeedAudioCreatedGeneration =
  Readonly<{
    id:
      string;

    estimatedCost:
      Readonly<{
        credits:
          number;
      }>;
  }>;

export type RunwayDirectSeedAudioExecutionResult =
  Readonly<{
    taskId:
      string;

    providerCreatedAt:
      string;

    estimatedCredits:
      number;

    finalCredits:
      number;

    outputUrls:
      readonly string[];
  }>;

export type RunwayDirectSeedAudioSubmissionAcceptance =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;
  }>;

export type RunwayDirectSeedAudioSubmissionAcceptedHandler =
  (
    acceptance:
      RunwayDirectSeedAudioSubmissionAcceptance,
  ) =>
    Promise<void>;

export type RunwayDirectSeedAudioExecutionOptions =
  Readonly<{
    waitTimeoutMs:
      number;

    onSubmissionAccepted:
      RunwayDirectSeedAudioSubmissionAcceptedHandler;
  }>;

const ProviderCreatedAtSchema =
  z.string()
    .datetime();

function requireRunwayTaskId(
  value:
    unknown,
): string {
  if (
    typeof value !==
    "string"
  ) {
    throw new Error(
      "Runway direct SeedAudio returned an invalid task ID.",
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      "Runway direct SeedAudio returned an empty task ID.",
    );
  }

  return normalized;
}

function requireProviderCredits(
  value:
    unknown,

  label:
    "estimated" | "final",
): number {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `Runway direct SeedAudio provider ${label} credits must be finite and nonnegative.`,
    );
  }

  return value;
}

function requireWaitTimeoutMs(
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
      "Runway direct SeedAudio wait timeout must be a positive safe integer.",
    );
  }

  return value;
}

function requireProviderCreatedAt(
  value:
    unknown,
): string {
  const parsed =
    ProviderCreatedAtSchema
      .safeParse(
        value,
      );

  if (!parsed.success) {
    throw new Error(
      `Runway direct SeedAudio returned an invalid createdAt timestamp: ${String(
        value,
      )}`,
    );
  }

  return parsed.data;
}

function requireSucceededObject(
  value:
    unknown,
): Record<
  string,
  unknown
> {
  if (
    typeof value !==
      "object" ||
    value ===
      null ||
    Array.isArray(
      value,
    )
  ) {
    throw new Error(
      "Runway direct SeedAudio did not return valid terminal task evidence.",
    );
  }

  const terminal =
    value as
      Record<
        string,
        unknown
      >;

  if (
    terminal.status !==
    "SUCCEEDED"
  ) {
    throw new Error(
      "Runway direct SeedAudio did not return SUCCEEDED terminal evidence.",
    );
  }

  return terminal;
}

function requireFinalCredits(
  terminal:
    Record<
      string,
      unknown
    >,
): number {
  const cost =
    terminal.cost;

  if (
    typeof cost !==
      "object" ||
    cost ===
      null ||
    Array.isArray(
      cost,
    )
  ) {
    throw new Error(
      "Runway direct SeedAudio returned invalid final cost evidence.",
    );
  }

  return requireProviderCredits(
    (
      cost as
        Record<
          string,
          unknown
        >
    ).credits,
    "final",
  );
}

function requireOutputUrls(
  value:
    unknown,
): readonly string[] {
  if (
    !Array.isArray(
      value,
    ) ||
    value.length ===
      0
  ) {
    throw new Error(
      "Runway direct SeedAudio generation succeeded but returned no output URLs.",
    );
  }

  const outputUrls:
    string[] = [];

  for (
    const outputUrl
    of value
  ) {
    if (
      typeof outputUrl !==
      "string"
    ) {
      throw new Error(
        "Runway direct SeedAudio returned an invalid output URL.",
      );
    }

    let parsed:
      URL;

    try {
      parsed =
        new URL(
          outputUrl,
        );
    } catch {
      throw new Error(
        "Runway direct SeedAudio returned an invalid output URL.",
      );
    }

    if (
      parsed.protocol !==
      "https:"
    ) {
      throw new Error(
        "Runway direct SeedAudio output URL must use HTTPS.",
      );
    }

    outputUrls.push(
      outputUrl,
    );
  }

  return Object.freeze(
    outputUrls,
  );
}

export function normalizeRunwayDirectSeedAudioResult(
  created:
    RunwayDirectSeedAudioCreatedGeneration,

  terminalEvidence:
    unknown,
): RunwayDirectSeedAudioExecutionResult {
  const createdTaskId =
    requireRunwayTaskId(
      created.id,
    );

  const estimatedCredits =
    requireProviderCredits(
      created
        .estimatedCost
        .credits,
      "estimated",
    );

  const terminal =
    requireSucceededObject(
      terminalEvidence,
    );

  const completedTaskId =
    requireRunwayTaskId(
      terminal.id,
    );

  if (
    completedTaskId !==
    createdTaskId
  ) {
    throw new Error(
      `Runway direct SeedAudio task ID mismatch: accepted ${createdTaskId}, completed ${completedTaskId}.`,
    );
  }

  const providerCreatedAt =
    requireProviderCreatedAt(
      terminal.createdAt,
    );

  const finalCredits =
    requireFinalCredits(
      terminal,
    );

  const outputUrls =
    requireOutputUrls(
      terminal.output,
    );

  return Object.freeze({
    taskId:
      completedTaskId,

    providerCreatedAt,

    estimatedCredits,

    finalCredits,

    outputUrls,
  });
}

export async function executeRunwayDirectSeedAudio(
  client:
    RunwayML,

  request:
    RunwayDirectSeedAudioRequest,

  options:
    RunwayDirectSeedAudioExecutionOptions,
): Promise<
  RunwayDirectSeedAudioExecutionResult
> {
  const validatedRequest =
    DialogueGenerationDirectSeedAudioRequestRecordSchema
      .parse(
        request,
      );

  const waitTimeoutMs =
    requireWaitTimeoutMs(
      options.waitTimeoutMs,
    );

  const providerRequest:
    Parameters<
      RunwayML["textToSpeech"]["create"]
    >[0] = {
      model:
        validatedRequest.model,

      promptText:
        validatedRequest.promptText,

      voice: {
        type:
          validatedRequest
            .voice.type,

        audioUri:
          validatedRequest
            .voice.audioUri,
      },

      ...(
        validatedRequest.loudnessRate ===
        undefined
          ? {}
          : {
              loudnessRate:
                validatedRequest
                  .loudnessRate,
            }
      ),

      ...(
        validatedRequest.outputFormat ===
        undefined
          ? {}
          : {
              outputFormat:
                validatedRequest
                  .outputFormat,
            }
      ),

      ...(
        validatedRequest.pitchRate ===
        undefined
          ? {}
          : {
              pitchRate:
                validatedRequest
                  .pitchRate,
            }
      ),

      ...(
        validatedRequest.sampleRate ===
        undefined
          ? {}
          : {
              sampleRate:
                validatedRequest
                  .sampleRate,
            }
      ),

      ...(
        validatedRequest.speechRate ===
        undefined
          ? {}
          : {
              speechRate:
                validatedRequest
                  .speechRate,
            }
      ),
    };

  const task =
    client.textToSpeech
      .create(
        providerRequest,
        {
          maxRetries:
            0,
        },
      );

  const created =
    await task;

  const taskId =
    requireRunwayTaskId(
      created.id,
    );

  const providerEstimatedCredits =
    requireProviderCredits(
      created
        .estimatedCost
        .credits,
      "estimated",
    );

  try {
    await options
      .onSubmissionAccepted({
        taskId,

        providerEstimatedCredits,
      });
  } catch (error) {
    throw new Error(
      `Runway accepted paid direct SeedAudio dialogue task ${taskId}, but Busybookie could not durably record the submission. Do not resubmit automatically.`,
      {
        cause:
          error,
      },
    );
  }

  const terminalEvidence =
    await task
      .waitForTaskOutput({
        timeout:
          waitTimeoutMs,
      });

  return normalizeRunwayDirectSeedAudioResult(
    created,
    terminalEvidence,
  );
}
