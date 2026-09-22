import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";

import {
  writeRunwayGenerationRecord,
} from "../audit/writeRunwayGenerationRecord.js";

import {
  classifyRunwayImageAsset,
} from "../assets/runwayImageAsset.js";

import {
  resolveRunwayImageAsset,
} from "../assets/resolveRunwayImageAsset.js";

import {
  uploadRunwayEphemeralAsset,
} from "../assets/uploadRunwayEphemeralAsset.js";

import {
  createRunwayClient,
} from "../createRunwayClient.js";

import {
  executeRunwayGen45,
} from "../execution/runwayGen45Execution.js";

import {
  runRunwayGen45Transaction,
} from "../execution/runRunwayGen45Transaction.js";

import {
  buildGen45Request,
} from "../gen45/buildGen45Request.js";

import {
  downloadRunwayOutput,
} from "../output/downloadRunwayOutput.js";

import {
  assertGen45WithinBudget,
} from "../runwayBudget.js";

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
  loadRunwayPolicy,
} from "../../validation/loadRunwayPolicy.js";

import {
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";

import {
  validateMediaRoot,
} from "../../validation/validateMediaRoot.js";

import {
  assertRunwayGen45ShotReady,
  findEpisodeShot,
} from "./assertRunwayGen45ShotReady.js";

import {
  buildRunwayGen45Prompt,
} from "./buildRunwayGen45Prompt.js";

import {
  parseRunwayGen45CliArgs,
} from "./runwayGen45CliArgs.js";

function assertImageInsideReferenceRoot(
  mediaRoot: string,
  imagePath: string,
): string {
  const absoluteImagePath =
    resolve(
      imagePath,
    );

  if (
    !isAbsolute(
      absoluteImagePath,
    )
  ) {
    throw new Error(
      "Runway reference image path must be absolute.",
    );
  }

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
      `Runway reference image must be inside ${referenceRoot}.`,
    );
  }

  return absoluteImagePath;
}

export async function runRunwayGen45Cli(
  args:
    readonly string[] =
      process.argv.slice(2),
): Promise<void> {
  const options =
    parseRunwayGen45CliArgs(
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
    loadRunwayPolicy(),
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
    findEpisodeShot(
      episode,
      options.shotId,
    );

  assertRunwayGen45ShotReady(
    episode,
    shot,
  );

  const sourceImagePath =
    assertImageInsideReferenceRoot(
      mediaRoot,
      options.imagePath,
    );

  const asset =
    await classifyRunwayImageAsset(
      sourceImagePath,
    );

  const promptText =
    buildRunwayGen45Prompt(
      shot,
    );

  const locallyExpectedCredits =
    assertGen45WithinBudget(
      shot.durationSeconds,
      policy,
    );

  // Validate the final Gen-4.5 request shape
  // without performing any network operation.
  buildGen45Request({
    promptImage:
      "runway://busybookie-preflight-placeholder",

    promptText,

    durationSeconds:
      shot.durationSeconds,
  });

  console.log("");
  console.log(
    "===== Busybookie Runway Gen-4.5 Preflight =====",
  );

  console.log(
    `Episode: ${episode.episodeId} - ${episode.title}`,
  );

  console.log(
    `Shot: ${shot.id} - ${shot.title}`,
  );

  console.log(
    "Provider: RUNWAY",
  );

  console.log(
    "Model: gen4.5",
  );

  console.log(
    "Output: MP4 / 1280x720",
  );

  console.log(
    `Duration: ${shot.durationSeconds}s`,
  );

  console.log(
    `Local expected cost: ${locallyExpectedCredits} credits`,
  );

  console.log(
    `Local credit ceiling: ${policy.gen45.maxCreditsPerGeneration} credits`,
  );

  console.log(
    `Reference: ${sourceImagePath}`,
  );

  console.log(
    `Reference size: ${asset.sourceBytes} bytes`,
  );

  console.log(
    `Reference strategy: ${asset.strategy}`,
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
    "===============================================",
  );

  console.log("");

  if (
    !options.confirmPaidGeneration
  ) {
    console.log(
      "DRY RUN ONLY: no Runway API request was submitted and no credits were used.",
    );

    return;
  }

  console.log(
    "PAID GENERATION CONFIRMED. Submitting one Runway task...",
  );

  const runwayApiSecret =
    env.RUNWAYML_API_SECRET?.trim();

  if (!runwayApiSecret) {
    throw new Error(
      "Paid Runway generation blocked: RUNWAYML_API_SECRET is not configured.",
    );
  }

  const client =
    createRunwayClient({
      RUNWAYML_API_SECRET:
        runwayApiSecret,
    });

  const result =
    await runRunwayGen45Transaction(
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
        resolveImageAsset:
          (filePath) =>
            resolveRunwayImageAsset(
              filePath,
              (uploadPath) =>
                uploadRunwayEphemeralAsset(
                  client,
                  uploadPath,
                ),
            ),

        executeGeneration:
          (
            request,
            waitTimeoutMs,
          ) =>
            executeRunwayGen45(
              client,
              request,
              waitTimeoutMs,
            ),

        downloadOutput:
          (
            sourceUrl,
            destinationPath,
          ) =>
            downloadRunwayOutput(
              sourceUrl,
              destinationPath,
            ),

        writeGenerationRecord:
          writeRunwayGenerationRecord,
      },
    );

  console.log("");
  console.log(
    "===== Runway Generation Complete =====",
  );

  console.log(
    `Task ID: ${result.record.taskId}`,
  );

  console.log(
    `Local expected credits: ${result.record.credits.locallyExpected}`,
  );

  console.log(
    `Runway estimated credits: ${result.record.credits.providerEstimated}`,
  );

  console.log(
    `Runway final credits: ${result.record.credits.providerFinal}`,
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
    "======================================",
  );
}
