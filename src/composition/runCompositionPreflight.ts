import {
  loadEnvironment,
} from "../validation/loadEnvironment.js";

import {
  loadProductionRules,
} from "../validation/loadProductionRules.js";

import {
  resolveAndValidateMediaRootPath,
} from "../validation/validateMediaRoot.js";

import {
  validateCompositionMediaToolchain,
  type CompositionMediaToolchain,
} from "./validateCompositionMediaToolchain.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

export type CompositionPreflightResult =
  Readonly<{
    mediaRoot:
      string;

    rules:
      ProductionRules;

    mediaToolchain:
      CompositionMediaToolchain;
  }>;

export type RunCompositionPreflightDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    validateMediaToolchain:
      typeof validateCompositionMediaToolchain;
  }>;

const defaultDependencies:
  RunCompositionPreflightDependencies =
  Object.freeze({
    loadEnvironment,
    loadProductionRules,

    resolveMediaRoot:
      resolveAndValidateMediaRootPath,

    validateMediaToolchain:
      validateCompositionMediaToolchain,
  });

export async function runCompositionPreflight(
  dependencies:
    RunCompositionPreflightDependencies =
      defaultDependencies,
): Promise<CompositionPreflightResult> {
  const env =
    dependencies.loadEnvironment();

  const rules =
    await dependencies
      .loadProductionRules();

  const mediaRoot =
    dependencies.resolveMediaRoot(
      env,
      rules,
    );

  const mediaToolchain =
    await dependencies
      .validateMediaToolchain(
        env,
      );

  return Object.freeze({
    mediaRoot,
    rules,
    mediaToolchain,
  });
}
