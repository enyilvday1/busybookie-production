import {
  ExecutionReservationEpisodeIdSchema,
} from "../execution/executionReservation.schema.js";

import {
  loadCharacterBible,
} from "../validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../validation/loadEpisodeManifest.js";

import {
  buildEpisodeCompositionPlan,
} from "./buildEpisodeCompositionPlan.js";

import {
  composeEpisodeRoughCut,
  type ComposedEpisodeRoughCut,
} from "./composeEpisodeRoughCut.js";

import {
  createEpisodeRoughCutRenderRecordPath,
} from "./episodeRoughCutRenderRecordPath.js";

import type {
  runCompositionPreflight,
} from "./runCompositionPreflight.js";

// C8: the single confirmed production entry for one canonical episode rough
// cut. Every admission, plan, normalization, render and record decision is
// delegated to the existing C5 authorities. There is no retry, recovery,
// reconciliation, repair, provider call or C6/C7 involvement. A successful
// result describes only the scoped rough-cut artifact, never an episode,
// production, final master, publication or delivery state.

export type RunProductionEpisodeRoughCutInput =
  Readonly<{
    episodeId:
      string;

    // Authorizes local probes, normalization, rough-cut rendering and
    // durable cache/render-record creation for this episode only. It is not
    // a paid-generation or reconciliation confirmation.
    confirmLocalComposition:
      true;
  }>;

export type RunProductionEpisodeRoughCutResult =
  Readonly<{
    episodeId:
      string;

    roughCut:
      ComposedEpisodeRoughCut;

    renderRecordPath:
      string;
  }>;

export type RunProductionEpisodeRoughCutDependencies =
  Readonly<{
    loadEpisodeManifest:
      typeof loadEpisodeManifest;

    loadCharacterBible:
      typeof loadCharacterBible;

    runCompositionPreflight:
      typeof runCompositionPreflight;

    buildEpisodeCompositionPlan:
      typeof buildEpisodeCompositionPlan;

    composeEpisodeRoughCut:
      typeof composeEpisodeRoughCut;
  }>;

const ALLOWED_INPUT_KEYS:
  ReadonlySet<PropertyKey> =
    new Set<PropertyKey>([
      "episodeId",
      "confirmLocalComposition",
    ]);

const defaultDependencies:
  RunProductionEpisodeRoughCutDependencies =
    Object.freeze({
      loadEpisodeManifest,

      loadCharacterBible,

      // Fixed lazy import: the preflight module statically loads
      // dotenv/config, which must not run before the confirmation gate.
      runCompositionPreflight:
        async () => {
          const preflight =
            await import(
              "./runCompositionPreflight.js"
            );

          return preflight
            .runCompositionPreflight();
        },

      buildEpisodeCompositionPlan,

      composeEpisodeRoughCut,
    });

// Synchronous: completes before the first await, so a caller mutating its
// input object later cannot change the selected episode. Rejected values
// are never echoed.
function validateInput(
  input:
    unknown,
): string {
  if (
    input ===
      null ||
    typeof input !==
      "object" ||
    Array.isArray(
      input,
    )
  ) {
    throw new Error(
      "Episode rough-cut input must be an object.",
    );
  }

  const record =
    input as Record<
      string,
      unknown
    >;

  if (
    record.confirmLocalComposition !==
    true
  ) {
    throw new Error(
      "Episode rough-cut requires explicit local composition confirmation (confirmLocalComposition: true).",
    );
  }

  if (
    Reflect.ownKeys(
      record,
    ).some(
      (key) =>
        !ALLOWED_INPUT_KEYS.has(
          key,
        ),
    )
  ) {
    throw new Error(
      "Episode rough-cut input contains an unsupported field.",
    );
  }

  const episodeId =
    ExecutionReservationEpisodeIdSchema.safeParse(
      record.episodeId,
    );

  if (
    !episodeId.success
  ) {
    throw new Error(
      "Episode rough-cut requires a canonical episode ID (EP## or EP###).",
    );
  }

  return episodeId.data;
}

export async function runProductionEpisodeRoughCut(
  input:
    RunProductionEpisodeRoughCutInput,

  dependencies:
    RunProductionEpisodeRoughCutDependencies =
      defaultDependencies,
): Promise<RunProductionEpisodeRoughCutResult> {
  // 1. Confirmation and canonical identity before any dependency call.
  const episodeId =
    validateInput(
      input,
    );

  // 2. Canonical inputs only; no caller-supplied plan, path, tool or profile.
  const episode =
    await dependencies
      .loadEpisodeManifest(
        episodeId,
      );

  if (
    episode.episodeId !==
    episodeId
  ) {
    throw new Error(
      `Episode rough-cut canonical manifest identity does not match ${episodeId}.`,
    );
  }

  const bible =
    await dependencies
      .loadCharacterBible();

  // 3. Environment, rules, pure media-root resolution and tool versions.
  const preflight =
    await dependencies
      .runCompositionPreflight();

  // 4. Full-episode completed-visual admission; never a subset plan.
  const compositionPlan =
    await dependencies
      .buildEpisodeCompositionPlan({
        mediaRoot:
          preflight.mediaRoot,

        episode,
      });

  // 5. Exactly one C5 composition: dialogue admission, normalization,
  // render plan and verified render reuse or materialization.
  const roughCut =
    await dependencies
      .composeEpisodeRoughCut({
        compositionPlan,

        episode,

        bible,

        mediaRoot:
          preflight.mediaRoot,

        postProduction:
          preflight.rules
            .postProduction,

        ffmpegExecutable:
          preflight.mediaToolchain
            .ffmpegExecutable,

        ffprobeExecutable:
          preflight.mediaToolchain
            .ffprobeExecutable,
      });

  return Object.freeze({
    episodeId,

    roughCut,

    renderRecordPath:
      createEpisodeRoughCutRenderRecordPath(
        roughCut.artifact
          .outputPath,
      ),
  });
}
