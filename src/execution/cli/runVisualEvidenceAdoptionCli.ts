import {
  loadVisualEvidenceAdoptionEnvironment,
  type VisualEvidenceAdoptionEnvironment,
} from "../visualEvidenceAdoptionEnvironment.js";

import {
  BoundEpisodeError,
} from "../boundEpisodeProduction.types.js";

import {
  VisualEvidenceAdoptionExistsError,
} from "../createVisualEvidenceAdoption.js";

import {
  adoptCompletedVisualEvidence,
  VisualEvidenceAdoptionError,
  type AdoptCompletedVisualEvidenceResult,
} from "../adoptCompletedVisualEvidence.js";

import {
  parseVisualEvidenceAdoptionCliArgs,
} from "./visualEvidenceAdoptionCliArgs.js";

export type RunVisualEvidenceAdoptionCliDependencies =
  Readonly<{
    // Least privilege: media root and optional FFprobe only; never .env and
    // never a provider credential.
    loadAdoptionEnvironment:
      () => VisualEvidenceAdoptionEnvironment;

    adopt:
      typeof adoptCompletedVisualEvidence;

    currentDirectory:
      () => string;

    writeStdout:
      (text: string) => void;
  }>;

const defaultDependencies:
  RunVisualEvidenceAdoptionCliDependencies =
    Object.freeze({
      loadAdoptionEnvironment:
        () =>
          loadVisualEvidenceAdoptionEnvironment(),

      adopt:
        adoptCompletedVisualEvidence,

      currentDirectory:
        () =>
          process.cwd(),

      writeStdout:
        (text: string) => {
          process.stdout.write(
            text,
          );
        },
    });

// Bounded, non-secret fields only: no provider identity, credential, task
// URL, provider response or generation record content.
export function formatVisualEvidenceAdoptionSummary(
  result:
    AdoptCompletedVisualEvidenceResult,
): string {
  const after =
    result.postAdoptionPreflight;

  const shot =
    after.shots.find(
      (row) =>
        row.shotId ===
        result.target.shotId,
    );

  return [
    "",
    "===== Busybookie Visual Evidence Adoption =====",
    `Episode: ${result.target.episodeId}`,
    `Scene: ${result.target.sceneId}`,
    `Shot: ${result.target.shotId}`,
    `Receipt SHA-256: ${result.adoptionSha256}`,
    `Receipt path: ${result.adoptionPath}`,
    `Post-adoption shot intent alignment: ${shot?.intentAlignment ?? "UNKNOWN"}`,
    `Post-adoption episode intent alignment: ${after.intentAlignment}`,
    `Post-adoption episode completion: ${after.completion}`,
    `Next action: ${after.nextActionCandidate?.kind ?? "NONE"}`,
    "Evidence only (NONE_EVIDENCE_ONLY): this command made no provider call and executed no generation, reconciliation, or plan. Any later provider action requires a fresh reviewed plan and the existing confirmation, guard, and admission controls.",
    "",
  ].join(
    "\n",
  );
}

export async function runVisualEvidenceAdoptionCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),

  dependencies:
    RunVisualEvidenceAdoptionCliDependencies =
      defaultDependencies,
): Promise<void> {
  // 1-2. Every argument error, including a missing --confirm-adoption,
  //      before any environment, durable read or write.
  const options =
    parseVisualEvidenceAdoptionCliArgs(
      args,
    );

  // 3. Only then the least-privilege environment: media root and optional
  //    FFprobe, read directly from the process environment.
  const environment =
    dependencies.loadAdoptionEnvironment();

  // 4. The single application boundary: fresh preflight, exact checks,
  //    create-once receipt, fresh post-adoption preflight.
  const result =
    await dependencies.adopt({
      episodeId:
        options.episodeId,

      shotId:
        options.shotId,

      expectedManifestRawSha256:
        options.expectedManifestRawSha256,

      expectedObservationSha256:
        options.expectedObservationSha256,

      repositoryRoot:
        dependencies.currentDirectory(),

      mediaRoot:
        environment.BUSYBOOKIE_MEDIA_ROOT,

      ...(environment.BUSYBOOKIE_FFPROBE_PATH
        ? {
            ffprobeExecutable:
              environment.BUSYBOOKIE_FFPROBE_PATH,
          }
        : {}),
    });

  dependencies.writeStdout(
    formatVisualEvidenceAdoptionSummary(
      result,
    ),
  );
}

function boundedFirstLine(
  error:
    Error,
): string {
  const first =
    error.message.split(
      /\r?\n/,
    )[0] ??
    "";

  return first.length >
    300
    ? `${first.slice(0, 300)}...`
    : first;
}

// Typed classification only; never a stack, cause chain or raw payload.
export function formatVisualEvidenceAdoptionCliError(
  error:
    unknown,
): string {
  if (
    error instanceof
      VisualEvidenceAdoptionError ||
    error instanceof
      VisualEvidenceAdoptionExistsError
  ) {
    return `\n${error.message}`;
  }

  if (
    error instanceof
    BoundEpisodeError
  ) {
    return `\nVisual evidence adoption stopped (${error.code}); no receipt was written.`;
  }

  if (
    error instanceof
      Error &&
    error.name ===
      "ZodError"
  ) {
    return "\nVisual evidence adoption input is invalid; no receipt was written.";
  }

  if (
    error instanceof
    Error
  ) {
    return `\nVisual evidence adoption failed: ${boundedFirstLine(error) || "unknown error"}`;
  }

  return "\nVisual evidence adoption failed with a non-error value.";
}
