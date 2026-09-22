import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";

import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";

import {
  loadEnvironment,
} from "../../validation/loadEnvironment.js";

import {
  loadEpisodeManifest,
} from "../../validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../../validation/loadProductionRules.js";

import {
  loadVeoPolicy,
} from "../../validation/loadVeoPolicy.js";

import {
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";

import {
  validateMediaRoot,
} from "../../validation/validateMediaRoot.js";

import {
  prepareVeoImageAsset,
} from "../assets/prepareVeoImageAsset.js";

import {
  writeVeoGenerationRecord,
} from "../audit/writeVeoGenerationRecord.js";

import {
  createVeoClient,
} from "../createVeoClient.js";

import {
  executeVeoGeneration,
} from "../execution/veoExecution.js";

import {
  runVeoImageToVideoTransaction,
} from "../execution/runVeoImageToVideoTransaction.js";

import {
  buildVeoGenerateRequest,
} from "../generation/buildVeoGenerateRequest.js";

import {
  persistVeoGeneratedVideo,
} from "../output/persistVeoGeneratedVideo.js";

import {
  assertVeoWithinBudget,
} from "../veoBudget.js";

import {
  assertVeoShotReady,
  findVeoEpisodeShot,
} from "./assertVeoShotReady.js";

import {
  buildVeoPrompt,
} from "./buildVeoPrompt.js";

import {
  parseVeoCliArgs,
} from "./veoCliArgs.js";

function assertImageInsideReferenceRoot(
  mediaRoot: string,
  imagePath: string,
): string {
  if (
    !isAbsolute(
      imagePath,
    )
  ) {
    throw new Error(
      "Veo reference image path must be absolute.",
    );
  }

  const absoluteImagePath =
    resolve(
      imagePath,
    );

  const referenceRoot =
    resolve(
      mediaRoot,
      "references",
    );

  const relativePath =
    relative(
      referenceRoot,
      absoluteImagePath,
    );

  if (
    relativePath === ".." ||
    relativePath.startsWith(
      `..\\`,
    ) ||
    relativePath.startsWith(
      "../",
    ) ||
    isAbsolute(
      relativePath,
    )
  ) {
    throw new Error(
      `Veo reference image must be inside ${referenceRoot}.`,
    );
  }

  return absoluteImagePath;
}

function formatCents(
  cents: number,
): string {
  return `${cents} cents ($${(
    cents / 100
  ).toFixed(2)})`;
}

export async function runVeoCli(
  args:
    readonly string[] =
      process.argv.slice(2),
): Promise<void> {
  const options =
    parseVeoCliArgs(
      args,
    );

  const env =
    loadEnvironment();

  const [
    rules,
    policy,
    bible,
    episode,
  ] = await Promise.all([
    loadProductionRules(),
    loadVeoPolicy(),
    loadCharacterBible(),
    loadEpisodeManifest(
      options.episodeId,
    ),
  ]);

  const mediaRoot =
    await validateMediaRoot(
      env,
      rules,
    );

  validateEpisodeProduction(
    episode,
    bible,
    rules,
  );

  const shot =
    findVeoEpisodeShot(
      episode,
      options.shotId,
    );

  assertVeoShotReady(
    episode,
    shot,
  );

  const sourceImagePath =
    assertImageInsideReferenceRoot(
      mediaRoot,
      options.imagePath,
    );

  const preparedImage =
    await prepareVeoImageAsset(
      sourceImagePath,
      policy.generation
        .maxImageBytes,
    );

  const promptText =
    buildVeoPrompt(
      shot,
    );

  const locallyExpectedCents =
    assertVeoWithinBudget(
      shot.durationSeconds,
      policy,
    );

  // Validate the complete SDK request shape using
  // the actual prepared image, without performing
  // any network generation.
  buildVeoGenerateRequest(
    {
      promptText,

      durationSeconds:
        shot.durationSeconds,

      image:
        preparedImage.image,
    },
    policy,
  );

  console.log("");
  console.log(
    "===== Busybookie Veo Preflight =====",
  );

  console.log(
    `Episode: ${episode.episodeId} - ${episode.title}`,
  );

  console.log(
    `Shot: ${shot.id} - ${shot.title}`,
  );

  console.log(
    "Provider: VEO",
  );

  console.log(
    `Model: ${policy.generation.model}`,
  );

  console.log(
    `Output: MP4 / ${policy.generation.resolution} / ${policy.generation.aspectRatio}`,
  );

  console.log(
    `Expected output fps: ${policy.generation.expectedOutputFps}`,
  );

  console.log(
    `Duration: ${shot.durationSeconds}s`,
  );

  console.log(
    `Native audio: ${
      policy.generation.generateAudio
        ? "YES"
        : "NO"
    }`,
  );

  console.log(
    `Local expected cost: ${formatCents(
      locallyExpectedCents,
    )}`,
  );

  console.log(
    `Local cost ceiling: ${formatCents(
      policy.generation
        .maxCentsPerGeneration,
    )}`,
  );

  console.log(
    `Reference: ${sourceImagePath}`,
  );

  console.log(
    `Reference size: ${preparedImage.sourceBytes} bytes`,
  );

  console.log(
    `Reference MIME type: ${preparedImage.image.mimeType}`,
  );

  console.log(
    "Reference strategy: INLINE_BASE64",
  );

  console.log(
    `Media root: ${mediaRoot}`,
  );

  console.log(
    `Output root: ${resolve(
      mediaRoot,
      "generated-video",
      episode.episodeId,
      shot.id,
    )}`,
  );

  console.log(
    `Prompt: ${promptText}`,
  );

  console.log(
    `Paid-generation confirmation: ${
      options.confirmPaidGeneration
        ? "YES"
        : "NO"
    }`,
  );

  console.log(
    "=====================================",
  );

  console.log("");

  if (
    !options.confirmPaidGeneration
  ) {
    console.log(
      "DRY RUN ONLY: no Gemini/Veo generation request was submitted and no paid generation was initiated.",
    );

    return;
  }

  const geminiApiKey =
    env.GEMINI_API_KEY
      ?.trim();

  if (!geminiApiKey) {
    throw new Error(
      "Paid Veo generation blocked: GEMINI_API_KEY is not configured.",
    );
  }

  console.log(
    "PAID GENERATION CONFIRMED. Submitting one Veo task...",
  );

  const client =
    createVeoClient(
      geminiApiKey,
    );

  const result =
    await runVeoImageToVideoTransaction(
      {
        episodeId:
          episode.episodeId,

        shotId:
          shot.id,

        sourceImagePath,

        promptText,

        durationSeconds:
          shot.durationSeconds,

        mediaRoot,

        policy,
      },
      {
        prepareImageAsset:
          async (
            requestedPath,
            maxBytes,
          ) => {
            const normalizedPath =
              resolve(
                requestedPath,
              );

            if (
              normalizedPath !==
              preparedImage
                .sourcePath
            ) {
              throw new Error(
                "Veo preflight image path changed before transaction execution.",
              );
            }

            if (
              preparedImage
                .sourceBytes >
              maxBytes
            ) {
              throw new Error(
                "Veo preflight image exceeds the transaction image-size ceiling.",
              );
            }

            return preparedImage;
          },

        executeGeneration:
          (
            request,
            executionOptions,
          ) =>
            executeVeoGeneration(
              client,
              {
                model:
                  request.model,

                prompt:
                  request.prompt,

                ...(
                  request.image
                    ? {
                        image:
                          request.image,
                      }
                    : {}
                ),

                config:
                  request.config,
              },
              executionOptions,
            ),

        persistGeneratedVideo:
          (
            generatedVideo,
            destinationPath,
            maxBytes,
          ) =>
            persistVeoGeneratedVideo(
              generatedVideo,
              destinationPath,
              (downloadParameters) =>
                client.files
                  .download(
                    downloadParameters,
                  ),
              maxBytes,
            ),

        writeGenerationRecord:
          writeVeoGenerationRecord,
      },
    );

  console.log("");
  console.log(
    "===== Veo Generation Complete =====",
  );

  console.log(
    `Operation: ${result.record.operationName}`,
  );

  console.log(
    `Local expected cost: ${formatCents(
      result.record
        .costPolicy
        .locallyExpectedCents,
    )}`,
  );

  console.log(
    `RAI filtered outputs: ${result.record.safety.raiMediaFilteredCount}`,
  );

  for (
    const output
    of result.record.outputs
  ) {
    console.log(
      `Output ${output.outputIndex}: ${output.destinationPath}`,
    );

    console.log(
      `  Bytes: ${output.bytes}`,
    );

    console.log(
      `  SHA-256: ${output.sha256}`,
    );
  }

  console.log(
    `Audit record: ${result.recordPath}`,
  );

  console.log(
    "===================================",
  );
}
