import type {
  DialogueCompositionAudioPlan,
} from "../dialogue/buildDialogueCompositionAudioPlan.js";

import type {
  EpisodeCompositionPlan,
} from "./buildEpisodeCompositionPlan.js";

import {
  buildEpisodeRoughCutRenderPlan,
  type EpisodeRoughCutRenderPlan,
} from "./buildEpisodeRoughCutRenderPlan.js";

import {
  ensureEpisodeRoughCutRender,
  type EpisodeRoughCutRenderStatus,
} from "./ensureEpisodeRoughCutRender.js";

import type {
  MaterializedEpisodeRoughCut,
} from "./materializeEpisodeRoughCut.js";

import {
  prepareEpisodeComposition,
  type PreparedEpisodeComposition,
} from "./prepareEpisodeComposition.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

export type ComposeEpisodeRoughCutInput =
  Readonly<{
    compositionPlan:
      EpisodeCompositionPlan;

    dialogueAudioPlans?:
      readonly DialogueCompositionAudioPlan[];

    mediaRoot:
      string;

    postProduction:
      ProductionRules["postProduction"];

    ffmpegExecutable:
      string;

    ffprobeExecutable:
      string;
  }>;

export type ComposeEpisodeRoughCutDependencies =
  Readonly<{
    prepareComposition:
      typeof prepareEpisodeComposition;

    buildRenderPlan:
      typeof buildEpisodeRoughCutRenderPlan;

    ensureRender:
      typeof ensureEpisodeRoughCutRender;
  }>;

export type ComposedEpisodeRoughCut =
  Readonly<{
    preparedComposition:
      PreparedEpisodeComposition;

    renderPlan:
      EpisodeRoughCutRenderPlan;

    renderStatus:
      EpisodeRoughCutRenderStatus;

    artifact:
      MaterializedEpisodeRoughCut;
  }>;

const defaultDependencies:
  ComposeEpisodeRoughCutDependencies =
    Object.freeze({
      prepareComposition:
        prepareEpisodeComposition,

      buildRenderPlan:
        buildEpisodeRoughCutRenderPlan,

      ensureRender:
        ensureEpisodeRoughCutRender,
    });

export async function composeEpisodeRoughCut(
  input:
    ComposeEpisodeRoughCutInput,

  dependencies:
    ComposeEpisodeRoughCutDependencies =
      defaultDependencies,
): Promise<ComposedEpisodeRoughCut> {
  const preparedComposition =
    await dependencies
      .prepareComposition({
        compositionPlan:
          input.compositionPlan,

        ...(
          input.dialogueAudioPlans ===
            undefined
            ? {}
            : {
                dialogueAudioPlans:
                  input.dialogueAudioPlans,
              }
        ),

        mediaRoot:
          input.mediaRoot,

        postProduction:
          input.postProduction,

        ffmpegExecutable:
          input.ffmpegExecutable,

        ffprobeExecutable:
          input.ffprobeExecutable,
      });

  const renderPlan =
    dependencies
      .buildRenderPlan({
        mediaRoot:
          input.mediaRoot,

        preparedComposition,

        postProduction:
          input.postProduction,
      });

  const ensuredRender =
    await dependencies
      .ensureRender({
        ffmpegExecutable:
          input.ffmpegExecutable,

        ffprobeExecutable:
          input.ffprobeExecutable,

        plan:
          renderPlan,
      });

  return Object.freeze({
    preparedComposition,

    renderPlan,

    renderStatus:
      ensuredRender.renderStatus,

    artifact:
      ensuredRender.artifact,
  });
}
