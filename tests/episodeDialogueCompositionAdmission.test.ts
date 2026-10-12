import {
  readFile,
} from "node:fs/promises";

import {
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

vi.mock(
  "../src/dialogue/buildShotDialoguePlan.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("../src/dialogue/buildShotDialoguePlan.js")
      >();

    return {
      ...actual,

      buildShotDialoguePlan:
        vi.fn(
          actual.buildShotDialoguePlan,
        ),
    };
  },
);

vi.mock(
  "../src/dialogue/resolveDurableDialogueCompositionAudioPlan.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("../src/dialogue/resolveDurableDialogueCompositionAudioPlan.js")
      >();

    return {
      ...actual,

      resolveDurableDialogueCompositionAudioPlan:
        vi.fn(
          actual.resolveDurableDialogueCompositionAudioPlan,
        ),
    };
  },
);

import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import {
  composeEpisodeRoughCut,
  type ComposeEpisodeRoughCutInput,
} from "../src/composition/composeEpisodeRoughCut.js";

import {
  prepareEpisodeComposition,
  type PrepareEpisodeCompositionDependencies,
  type PrepareEpisodeCompositionInput,
} from "../src/composition/prepareEpisodeComposition.js";

import type {
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import {
  buildShotDialoguePlan,
  type ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  resolveDurableDialogueCompositionAudioPlan,
} from "../src/dialogue/resolveDurableDialogueCompositionAudioPlan.js";

import type {
  CharacterBible,
} from "../src/schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

const MEDIA_ROOT =
  "C:/c5-admission-test/media-root";

const FFMPEG_EXECUTABLE =
  "C:/c5-admission-test/ffmpeg.exe";

const FFPROBE_EXECUTABLE =
  "C:/c5-admission-test/ffprobe.exe";

const postProduction:
  ProductionRules["postProduction"] =
    Object.freeze({
      aspectRatio:
        "16:9",

      width:
        1920,

      height:
        1080,

      timelineFps:
        25,

      audioSampleRateHz:
        48000,
    });

const mockedBuildShotDialoguePlan =
  vi.mocked(
    buildShotDialoguePlan,
  );

const mockedResolveDurableDialogueCompositionAudioPlan =
  vi.mocked(
    resolveDurableDialogueCompositionAudioPlan,
  );

beforeEach(
  () => {
    mockedBuildShotDialoguePlan
      .mockClear();

    mockedResolveDurableDialogueCompositionAudioPlan
      .mockClear();
  },
);

/*
 * EP02 canonical shape: SC01/S01 has no dialogue, SC01/S02 has one
 * line. Extra dialogue shots are cloned from S02 for multi-shot cases.
 */
async function loadCanonical(
  extraDialogueShotIds:
    readonly string[] =
      [],
): Promise<
  Readonly<{
    episode:
      EpisodeManifest;

    bible:
      CharacterBible;
  }>
> {
  const [
    loaded,
    bible,
  ] =
    await Promise.all([
      loadEpisodeManifest(
        "EP02",
      ),

      loadCharacterBible(),
    ]);

  const episode =
    structuredClone(
      loaded,
    );

  const scene =
    episode.scenes[0]!;

  const dialogueShot =
    scene.shots.find(
      (
        shot,
      ) =>
        shot.id ===
        "S02",
    )!;

  for (
    const [
      index,
      shotId,
    ]
    of extraDialogueShotIds.entries()
  ) {
    scene.shots.push({
      ...structuredClone(
        dialogueShot,
      ),

      id:
        shotId,

      order:
        dialogueShot.order +
        index +
        1,
    });
  }

  return Object.freeze({
    episode,
    bible,
  });
}

function makeCompositionShot(
  input:
    Readonly<{
      sceneId?:
        string;

      shotId:
        string;

      order:
        number;

      nativeAudio:
        boolean;
    }>,
): EpisodeCompositionPlanShot {
  return Object.freeze({
    sceneId:
      input.sceneId ??
      "SC01",

    shotId:
      input.shotId,

    order:
      input.order,

    title:
      `Shot ${input.shotId}`,

    durationSeconds:
      4,

    nativeAudio:
      input.nativeAudio,

    provider:
      "VEO" as const,

    providerExecutionId:
      `operations/${input.shotId}`,

    sourceVideoPath:
      `${MEDIA_ROOT}/generated-video/EP02/${input.shotId}/${input.shotId}_01.mp4`,

    sourceBytes:
      1_000 +
      input.order,

    sourceSha256:
      "e".repeat(
        64,
      ),

    sourceContentType:
      "video/mp4",
  });
}

function makeCompositionPlan(
  shots:
    readonly EpisodeCompositionPlanShot[],

  episodeId =
    "EP02",
): EpisodeCompositionPlan {
  return Object.freeze({
    episodeId,

    title:
      "C5 admission episode",

    totalShots:
      shots.length,

    totalDurationSeconds:
      shots.length *
      4,

    shots:
      Object.freeze([
        ...shots,
      ]),
  });
}

function makeDialogueAudio(
  dialoguePlan:
    ShotDialoguePlan,
): DialogueCompositionAudioPlan {
  return Object.freeze({
    schemaVersion:
      "1.0",

    audioMode:
      "REPLACE_SOURCE_WITH_DIALOGUE",

    mixNativeAudio:
      false,

    episodeId:
      dialoguePlan.episodeId,

    sceneId:
      dialoguePlan.sceneId,

    shotId:
      dialoguePlan.shotId,

    dialoguePlanKey:
      dialoguePlan.planKey,

    shotDurationSeconds:
      dialoguePlan.shotDurationSeconds,

    sourceNativeAudio:
      true,

    sourceAudioDisposition:
      "DISCARD_NATIVE_AUDIO",

    lines:
      Object.freeze([]),

    audioKey:
      "f".repeat(
        64,
      ),
  }) as unknown as DialogueCompositionAudioPlan;
}

type Harness =
  Readonly<{
    events:
      string[];

    dependencies:
      PrepareEpisodeCompositionDependencies;

    probeSource:
      ReturnType<typeof vi.fn>;

    buildNormalizationPlan:
      ReturnType<typeof vi.fn>;

    ensureNormalizationCache:
      ReturnType<typeof vi.fn>;

    buildDialoguePlan:
      ReturnType<typeof vi.fn>;

    resolveDialogueAudioPlan:
      ReturnType<typeof vi.fn>;

    buildDialogueNormalizationPlan:
      ReturnType<typeof vi.fn>;

    ensureDialogueNormalizationCache:
      ReturnType<typeof vi.fn>;
  }>;

function createHarness(
  resolveImplementation?:
    (
      input:
        Readonly<{
          dialoguePlan:
            ShotDialoguePlan;
        }>,
    ) => Promise<DialogueCompositionAudioPlan>,
): Harness {
  const events:
    string[] =
      [];

  const probeSource =
    vi.fn(
      async (
        input:
          Readonly<{
            sourceVideoPath:
              string;
          }>,
      ) => {
        events.push(
          `probe:${input.sourceVideoPath}`,
        );

        return Object.freeze({
          probed:
            input.sourceVideoPath,
        });
      },
    );

  const buildNormalizationPlan =
    vi.fn(
      (
        input:
          Readonly<{
            shot:
              EpisodeCompositionPlanShot;
          }>,
      ) => {
        events.push(
          `plan-v1:${input.shot.shotId}`,
        );

        return Object.freeze({
          schemaVersion:
            "1.0",

          shotId:
            input.shot.shotId,
        });
      },
    );

  const ensureNormalizationCache =
    vi.fn(
      async (
        input:
          Readonly<{
            plan:
              Readonly<{
                shotId:
                  string;
              }>;
          }>,
      ) => {
        events.push(
          `ensure-v1:${input.plan.shotId}`,
        );

        return Object.freeze({
          cacheStatus:
            "HIT" as const,

          artifact:
            Object.freeze({
              shotId:
                input.plan.shotId,
            }),
        });
      },
    );

  const buildDialoguePlan =
    vi.fn(
      (
        input:
          Parameters<
            typeof buildShotDialoguePlan
          >[0],
      ) => {
        events.push(
          `dialogue-plan:${input.shot.id}`,
        );

        return buildShotDialoguePlan(
          input,
        );
      },
    );

  const resolveDialogueAudioPlan =
    vi.fn(
      async (
        input:
          Readonly<{
            dialoguePlan:
              ShotDialoguePlan;
          }>,
      ) => {
        events.push(
          `resolve:${input.dialoguePlan.shotId}`,
        );

        return resolveImplementation
          ? resolveImplementation(
              input,
            )
          : makeDialogueAudio(
              input.dialoguePlan,
            );
      },
    );

  const buildDialogueNormalizationPlan =
    vi.fn(
      (
        input:
          Readonly<{
            shot:
              EpisodeCompositionPlanShot;

            dialogueAudio:
              DialogueCompositionAudioPlan;
          }>,
      ) => {
        events.push(
          `plan-v2:${input.shot.shotId}`,
        );

        return Object.freeze({
          schemaVersion:
            "2.0",

          shotId:
            input.shot.shotId,

          dialogueAudio:
            input.dialogueAudio,
        });
      },
    );

  const ensureDialogueNormalizationCache =
    vi.fn(
      async (
        input:
          Readonly<{
            plan:
              Readonly<{
                shotId:
                  string;
              }>;
          }>,
      ) => {
        events.push(
          `ensure-v2:${input.plan.shotId}`,
        );

        return Object.freeze({
          cacheStatus:
            "MATERIALIZED" as const,

          artifact:
            Object.freeze({
              shotId:
                input.plan.shotId,
            }),
        });
      },
    );

  return Object.freeze({
    events,

    dependencies:
      {
        probeSource,
        buildNormalizationPlan,
        ensureNormalizationCache,
        buildDialoguePlan,
        resolveDialogueAudioPlan,
        buildDialogueNormalizationPlan,
        ensureDialogueNormalizationCache,
      } as unknown as
        PrepareEpisodeCompositionDependencies,

    probeSource,
    buildNormalizationPlan,
    ensureNormalizationCache,
    buildDialoguePlan,
    resolveDialogueAudioPlan,
    buildDialogueNormalizationPlan,
    ensureDialogueNormalizationCache,
  });
}

function prepareInput(
  compositionPlan:
    EpisodeCompositionPlan,

  episode:
    EpisodeManifest,

  bible:
    CharacterBible,
): PrepareEpisodeCompositionInput {
  return Object.freeze({
    compositionPlan,
    episode,
    bible,

    mediaRoot:
      MEDIA_ROOT,

    postProduction,

    ffmpegExecutable:
      FFMPEG_EXECUTABLE,

    ffprobeExecutable:
      FFPROBE_EXECUTABLE,
  });
}

function expectNoNormalizationWork(
  harness:
    Harness,
): void {
  expect(
    harness.probeSource,
  ).not.toHaveBeenCalled();

  expect(
    harness.buildNormalizationPlan,
  ).not.toHaveBeenCalled();

  expect(
    harness.ensureNormalizationCache,
  ).not.toHaveBeenCalled();

  expect(
    harness.buildDialogueNormalizationPlan,
  ).not.toHaveBeenCalled();

  expect(
    harness.ensureDialogueNormalizationCache,
  ).not.toHaveBeenCalled();
}

function stripComments(
  source:
    string,
): string {
  return source
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(
      /^\s*\/\/.*$/gm,
      "",
    );
}

function importSpecifiers(
  source:
    string,
): string[] {
  return [
    ...stripComments(
      source,
    ).matchAll(
      /from\s+"([^"]+)"/g,
    ),
  ].map(
    (
      match,
    ) =>
      match[1]!,
  );
}

describe(
  "C5 durable dialogue composition admission",
  () => {
    describe(
      "A. public contract",
      () => {
        it(
          "requires canonical episode and bible and removes caller-supplied dialogue audio plans",
          () => {
            expectTypeOf<
              PrepareEpisodeCompositionInput["episode"]
            >().toEqualTypeOf<
              EpisodeManifest
            >();

            expectTypeOf<
              PrepareEpisodeCompositionInput["bible"]
            >().toEqualTypeOf<
              CharacterBible
            >();

            expectTypeOf<
              ComposeEpisodeRoughCutInput["episode"]
            >().toEqualTypeOf<
              EpisodeManifest
            >();

            expectTypeOf<
              ComposeEpisodeRoughCutInput["bible"]
            >().toEqualTypeOf<
              CharacterBible
            >();

            // Exact key sets: no dialogueAudioPlans and no caller-supplied
            // ShotDialoguePlan[] (or any other dialogue authority) input.
            expectTypeOf<
              keyof PrepareEpisodeCompositionInput
            >().toEqualTypeOf<
              | "compositionPlan"
              | "episode"
              | "bible"
              | "mediaRoot"
              | "postProduction"
              | "ffmpegExecutable"
              | "ffprobeExecutable"
            >();

            expectTypeOf<
              keyof ComposeEpisodeRoughCutInput
            >().toEqualTypeOf<
              | "compositionPlan"
              | "episode"
              | "bible"
              | "mediaRoot"
              | "postProduction"
              | "ffmpegExecutable"
              | "ffprobeExecutable"
            >();

            expectTypeOf<
              "dialogueAudioPlans" extends keyof PrepareEpisodeCompositionInput
                ? true
                : false
            >().toEqualTypeOf<
              false
            >();

            expectTypeOf<
              "dialogueAudioPlans" extends keyof ComposeEpisodeRoughCutInput
                ? true
                : false
            >().toEqualTypeOf<
              false
            >();

            expectTypeOf<
              Pick<
                PrepareEpisodeCompositionInput,
                "episode" | "bible"
              >
            >().toEqualTypeOf<
              Readonly<{
                episode:
                  EpisodeManifest;

                bible:
                  CharacterBible;
              }>
            >();

            expectTypeOf<
              PrepareEpisodeCompositionDependencies["buildDialoguePlan"]
            >().toEqualTypeOf<
              typeof buildShotDialoguePlan
            >();

            expectTypeOf<
              PrepareEpisodeCompositionDependencies["resolveDialogueAudioPlan"]
            >().toEqualTypeOf<
              typeof resolveDurableDialogueCompositionAudioPlan
            >();
          },
        );

        it(
          "uses the real canonical plan builder and B2d resolver as default dependencies",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const sentinel =
              new Error(
                "c5-default-b2d-sentinel",
              );

            mockedResolveDurableDialogueCompositionAudioPlan
              .mockRejectedValueOnce(
                sentinel,
              );

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S02",

                      order:
                        2,

                      nativeAudio:
                        true,
                    }),
                  ]),
                  episode,
                  bible,
                ),
              ),
            ).rejects.toBe(
              sentinel,
            );

            expect(
              mockedBuildShotDialoguePlan,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              mockedResolveDurableDialogueCompositionAudioPlan,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              mockedResolveDurableDialogueCompositionAudioPlan
                .mock.calls[0]![0],
            ).toStrictEqual({
              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                FFPROBE_EXECUTABLE,

              dialoguePlan:
                mockedBuildShotDialoguePlan
                  .mock.results[0]!
                  .value,
            });
          },
        );

        it(
          "keeps C3, C4, writers, providers, and coordination out of composition admission",
          async () => {
            const prepareSource =
              await readFile(
                new URL(
                  "../src/composition/prepareEpisodeComposition.ts",
                  import.meta.url,
                ),
                "utf8",
              );

            const composeSource =
              await readFile(
                new URL(
                  "../src/composition/composeEpisodeRoughCut.ts",
                  import.meta.url,
                ),
                "utf8",
              );

            const forbidden =
              /resolveDurableShotDialogueCompositionState|resolveDurableEpisodeProductionState|resolveDurableShotVisualGenerationState|resolveDurableShotExecutionReadiness|coordination|providers?\/|runway|veo|write[A-Z]|reserve|submit|reconcile/i;

            for (
              const specifier
              of [
                ...importSpecifiers(
                  prepareSource,
                ),
                ...importSpecifiers(
                  composeSource,
                ),
              ]
            ) {
              expect(
                specifier,
              ).not.toMatch(
                forbidden,
              );
            }

            expect(
              importSpecifiers(
                prepareSource,
              ),
            ).toEqual(
              expect.arrayContaining([
                "../dialogue/buildShotDialoguePlan.js",
                "../dialogue/resolveDurableDialogueCompositionAudioPlan.js",
              ]),
            );

            // Composition forwards canonical inputs; it never plans or
            // resolves dialogue audio itself.
            expect(
              importSpecifiers(
                composeSource,
              ),
            ).not.toEqual(
              expect.arrayContaining([
                "../dialogue/buildShotDialoguePlan.js",
              ]),
            );

            expect(
              importSpecifiers(
                composeSource,
              ),
            ).not.toEqual(
              expect.arrayContaining([
                "../dialogue/resolveDurableDialogueCompositionAudioPlan.js",
              ]),
            );

            expect(
              stripComments(
                prepareSource,
              ),
            ).not.toMatch(
              /Promise\.all/,
            );

            expect(
              stripComments(
                prepareSource,
              ),
            ).not.toMatch(
              /dialogueAudioPlans/,
            );

            expect(
              stripComments(
                composeSource,
              ),
            ).not.toMatch(
              /dialogueAudioPlans/,
            );
          },
        );
      },
    );

    describe(
      "B. canonical identity",
      () => {
        it(
          "rejects a canonical episode whose identity differs from the composition plan",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const otherEpisode =
              {
                ...episode,

                episodeId:
                  "EP03",
              };

            const harness =
              createHarness();

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S01",

                      order:
                        1,

                      nativeAudio:
                        false,
                    }),
                  ]),
                  otherEpisode,
                  bible,
                ),
                harness.dependencies,
              ),
            ).rejects.toThrow(
              "Episode composition canonical episode identity does not match EP02; received EP03.",
            );

            expect(
              harness.buildDialoguePlan,
            ).not.toHaveBeenCalled();

            expect(
              harness.resolveDialogueAudioPlan,
            ).not.toHaveBeenCalled();

            expectNoNormalizationWork(
              harness,
            );
          },
        );

        it(
          "rejects a composition shot whose scene does not match the canonical shot",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const harness =
              createHarness();

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      sceneId:
                        "SC02",

                      shotId:
                        "S02",

                      order:
                        2,

                      nativeAudio:
                        true,
                    }),
                  ]),
                  episode,
                  bible,
                ),
                harness.dependencies,
              ),
            ).rejects.toThrow(
              "Episode composition shot EP02/SC02/S02 has no canonical episode shot.",
            );

            expect(
              harness.resolveDialogueAudioPlan,
            ).not.toHaveBeenCalled();

            expectNoNormalizationWork(
              harness,
            );
          },
        );

        it(
          "rejects an ambiguous canonical match",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const ambiguousEpisode =
              {
                ...episode,

                scenes:
                  [
                    ...episode.scenes,
                    structuredClone(
                      episode.scenes[0]!,
                    ),
                  ],
              } as EpisodeManifest;

            const harness =
              createHarness();

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S01",

                      order:
                        1,

                      nativeAudio:
                        false,
                    }),
                  ]),
                  ambiguousEpisode,
                  bible,
                ),
                harness.dependencies,
              ),
            ).rejects.toThrow(
              "Episode composition shot EP02/SC01/S01 matches 2 canonical episode shots.",
            );

            expect(
              harness.buildDialoguePlan,
            ).not.toHaveBeenCalled();

            expectNoNormalizationWork(
              harness,
            );
          },
        );
      },
    );

    describe(
      "C. non-dialogue shots",
      () => {
        it(
          "keeps canonical non-dialogue shots on v1 without planning or resolving dialogue, even with native audio",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const shot =
              makeCompositionShot({
                shotId:
                  "S01",

                order:
                  1,

                nativeAudio:
                  true,
              });

            const harness =
              createHarness();

            const result =
              await prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    shot,
                  ]),
                  episode,
                  bible,
                ),
                harness.dependencies,
              );

            expect(
              harness.events,
            ).toEqual([
              `probe:${shot.sourceVideoPath}`,
              "plan-v1:S01",
              "ensure-v1:S01",
            ]);

            expect(
              harness.buildDialoguePlan,
            ).not.toHaveBeenCalled();

            expect(
              harness.resolveDialogueAudioPlan,
            ).not.toHaveBeenCalled();

            expect(
              result.shots[0]!
                .normalizationPlan
                .schemaVersion,
            ).toBe(
              "1.0",
            );
          },
        );
      },
    );

    describe(
      "D. dialogue shots",
      () => {
        it(
          "builds the canonical plan, resolves durable B2d audio, and routes it unchanged through dialogue v2",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const shot =
              makeCompositionShot({
                shotId:
                  "S02",

                order:
                  2,

                nativeAudio:
                  true,
              });

            const harness =
              createHarness();

            const result =
              await prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    shot,
                  ]),
                  episode,
                  bible,
                ),
                harness.dependencies,
              );

            const canonicalShot =
              episode.scenes[0]!
                .shots.find(
                  (
                    candidate:
                      Shot,
                  ) =>
                    candidate.id ===
                    "S02",
                )!;

            expect(
              harness.buildDialoguePlan,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              harness.buildDialoguePlan
                .mock.calls[0]![0],
            ).toStrictEqual({
              episodeId:
                "EP02",

              sceneId:
                "SC01",

              shot:
                canonicalShot,

              bible,
            });

            expect(
              (
                harness.buildDialoguePlan
                  .mock.calls[0]![0] as {
                  shot: Shot;
                  bible: CharacterBible;
                }
              ).shot,
            ).toBe(
              canonicalShot,
            );

            const dialoguePlan =
              harness.buildDialoguePlan
                .mock.results[0]!
                .value as ShotDialoguePlan;

            expect(
              harness.resolveDialogueAudioPlan
                .mock.calls[0]![0],
            ).toStrictEqual({
              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                FFPROBE_EXECUTABLE,

              dialoguePlan,
            });

            expect(
              (
                harness.resolveDialogueAudioPlan
                  .mock.calls[0]![0] as {
                  dialoguePlan: ShotDialoguePlan;
                }
              ).dialoguePlan,
            ).toBe(
              dialoguePlan,
            );

            const dialogueAudio =
              await harness.resolveDialogueAudioPlan
                .mock.results[0]!
                .value as DialogueCompositionAudioPlan;

            expect(
              (
                harness.buildDialogueNormalizationPlan
                  .mock.calls[0]![0] as {
                  dialogueAudio: DialogueCompositionAudioPlan;
                }
              ).dialogueAudio,
            ).toBe(
              dialogueAudio,
            );

            expect(
              harness.events,
            ).toEqual([
              "dialogue-plan:S02",
              "resolve:S02",
              `probe:${shot.sourceVideoPath}`,
              "plan-v2:S02",
              "ensure-v2:S02",
            ]);

            expect(
              harness.buildNormalizationPlan,
            ).not.toHaveBeenCalled();

            expect(
              harness.ensureNormalizationCache,
            ).not.toHaveBeenCalled();

            expect(
              result.shots[0]!
                .normalizationPlan
                .schemaVersion,
            ).toBe(
              "2.0",
            );
          },
        );
      },
    );

    describe(
      "E. fail closed on durable admission failure",
      () => {
        for (
          const message
          of [
            "Dialogue placement decision for EP02/SC01/S02 is missing.",
            "Dialogue placement decision for EP02/SC01/S02 is stale: dialoguePlanKey a does not match current canonical plan key b.",
            "Dialogue placement timing for EP02/SC01/S02 line 1 does not fit the shot duration.",
          ]
        ) {
          it(
            `propagates the B2d failure unchanged with zero normalization work: ${message}`,
            async () => {
              const {
                episode,
                bible,
              } =
                await loadCanonical();

              const failure =
                new Error(
                  message,
                );

              const harness =
                createHarness(
                  async () => {
                    throw failure;
                  },
                );

              await expect(
                prepareEpisodeComposition(
                  prepareInput(
                    makeCompositionPlan([
                      makeCompositionShot({
                        shotId:
                          "S01",

                        order:
                          1,

                        nativeAudio:
                          false,
                      }),

                      makeCompositionShot({
                        shotId:
                          "S02",

                        order:
                          2,

                        nativeAudio:
                          true,
                      }),
                    ]),
                    episode,
                    bible,
                  ),
                  harness.dependencies,
                ),
              ).rejects.toBe(
                failure,
              );

              expectNoNormalizationWork(
                harness,
              );
            },
          );
        }

        it(
          "fails closed when the canonical dialogue plan cannot be built",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const harness =
              createHarness();

            const failure =
              new Error(
                "Character voice is not LOCKED.",
              );

            harness.buildDialoguePlan
              .mockImplementationOnce(
                () => {
                  throw failure;
                },
              );

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S02",

                      order:
                        2,

                      nativeAudio:
                        true,
                    }),
                  ]),
                  episode,
                  bible,
                ),
                harness.dependencies,
              ),
            ).rejects.toBe(
              failure,
            );

            expect(
              harness.resolveDialogueAudioPlan,
            ).not.toHaveBeenCalled();

            expectNoNormalizationWork(
              harness,
            );
          },
        );

        it(
          "fails closed before resolving when dialogue normalization dependencies are absent",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const harness =
              createHarness();

            const {
              buildDialogueNormalizationPlan: _plan,
              ensureDialogueNormalizationCache: _cache,
              ...v1OnlyDependencies
            } =
              harness.dependencies;

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S02",

                      order:
                        2,

                      nativeAudio:
                        true,
                    }),
                  ]),
                  episode,
                  bible,
                ),
                v1OnlyDependencies,
              ),
            ).rejects.toThrow(
              "Episode composition dialogue normalization dependencies are unavailable for EP02/SC01/S02.",
            );

            expect(
              harness.resolveDialogueAudioPlan,
            ).not.toHaveBeenCalled();

            expectNoNormalizationWork(
              harness,
            );
          },
        );
      },
    );

    describe(
      "F. episode-wide preflight",
      () => {
        it(
          "resolves dialogue shots sequentially and does no normalization when a later shot fails",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical([
                "S03",
              ]);

            const failure =
              new Error(
                "Dialogue placement decision for EP02/SC01/S03 is missing.",
              );

            let releaseFirst:
              (() => void) | undefined;

            const firstGate =
              new Promise<void>(
                (
                  resolve,
                ) => {
                  releaseFirst =
                    resolve;
                },
              );

            const harness =
              createHarness(
                async (
                  input,
                ) => {
                  if (
                    input.dialoguePlan.shotId ===
                    "S02"
                  ) {
                    await firstGate;

                    return makeDialogueAudio(
                      input.dialoguePlan,
                    );
                  }

                  throw failure;
                },
              );

            const pending =
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S01",

                      order:
                        1,

                      nativeAudio:
                        false,
                    }),

                    makeCompositionShot({
                      shotId:
                        "S02",

                      order:
                        2,

                      nativeAudio:
                        true,
                    }),

                    makeCompositionShot({
                      shotId:
                        "S03",

                      order:
                        3,

                      nativeAudio:
                        true,
                    }),
                  ]),
                  episode,
                  bible,
                ),
                harness.dependencies,
              );

            const settled =
              pending.then(
                () => null,
                (
                  error: unknown,
                ) => error,
              );

            await new Promise(
              (
                resolve,
              ) => {
                setTimeout(
                  resolve,
                  0,
                );
              },
            );

            // S03 is not admitted while S02 is still resolving.
            expect(
              harness.events,
            ).toEqual([
              "dialogue-plan:S02",
              "resolve:S02",
            ]);

            releaseFirst!();

            expect(
              await settled,
            ).toBe(
              failure,
            );

            expect(
              harness.events,
            ).toEqual([
              "dialogue-plan:S02",
              "resolve:S02",
              "dialogue-plan:S03",
              "resolve:S03",
            ]);

            expectNoNormalizationWork(
              harness,
            );
          },
        );

        it(
          "normalizes only after every dialogue shot resolved, in composition order",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical([
                "S03",
              ]);

            const shots =
              [
                makeCompositionShot({
                  shotId:
                    "S02",

                  order:
                    2,

                  nativeAudio:
                    true,
                }),

                makeCompositionShot({
                  shotId:
                    "S01",

                  order:
                    1,

                  nativeAudio:
                    false,
                }),

                makeCompositionShot({
                  shotId:
                    "S03",

                  order:
                    3,

                  nativeAudio:
                    true,
                }),
              ];

            const harness =
              createHarness();

            await prepareEpisodeComposition(
              prepareInput(
                makeCompositionPlan(
                  shots,
                ),
                episode,
                bible,
              ),
              harness.dependencies,
            );

            expect(
              harness.events,
            ).toEqual([
              "dialogue-plan:S02",
              "resolve:S02",
              "dialogue-plan:S03",
              "resolve:S03",
              `probe:${shots[0]!.sourceVideoPath}`,
              "plan-v2:S02",
              "ensure-v2:S02",
              `probe:${shots[1]!.sourceVideoPath}`,
              "plan-v1:S01",
              "ensure-v1:S01",
              `probe:${shots[2]!.sourceVideoPath}`,
              "plan-v2:S03",
              "ensure-v2:S03",
            ]);
          },
        );
      },
    );

    describe(
      "G. no fallback",
      () => {
        for (
          const nativeAudio
          of [
            true,
            false,
          ]
        ) {
          it(
            `never falls back to v1 or native audio for a dialogue shot (nativeAudio=${String(nativeAudio)})`,
            async () => {
              const {
                episode,
                bible,
              } =
                await loadCanonical();

              const failure =
                new Error(
                  "Dialogue placement decision for EP02/SC01/S02 is missing.",
                );

              const harness =
                createHarness(
                  async () => {
                    throw failure;
                  },
                );

              await expect(
                prepareEpisodeComposition(
                  prepareInput(
                    makeCompositionPlan([
                      makeCompositionShot({
                        shotId:
                          "S02",

                        order:
                          2,

                        nativeAudio,
                      }),
                    ]),
                    episode,
                    bible,
                  ),
                  harness.dependencies,
                ),
              ).rejects.toBe(
                failure,
              );

              expect(
                harness.buildNormalizationPlan,
              ).not.toHaveBeenCalled();

              expect(
                harness.ensureNormalizationCache,
              ).not.toHaveBeenCalled();

              expectNoNormalizationWork(
                harness,
              );
            },
          );
        }

        it(
          "rejects resolved audio whose identity does not match the composition shot",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const harness =
              createHarness(
                async (
                  input,
                ) =>
                  Object.freeze({
                    ...makeDialogueAudio(
                      input.dialoguePlan,
                    ),

                    shotId:
                      "S01",
                  }) as DialogueCompositionAudioPlan,
              );

            await expect(
              prepareEpisodeComposition(
                prepareInput(
                  makeCompositionPlan([
                    makeCompositionShot({
                      shotId:
                        "S02",

                      order:
                        2,

                      nativeAudio:
                        true,
                    }),
                  ]),
                  episode,
                  bible,
                ),
                harness.dependencies,
              ),
            ).rejects.toThrow(
              "Episode composition resolved dialogue audio identity EP02/SC01/S01 does not match EP02/SC01/S02.",
            );

            expectNoNormalizationWork(
              harness,
            );
          },
        );
      },
    );

    describe(
      "H. compose forwarding",
      () => {
        it(
          "forwards canonical episode and bible by reference and never plans or resolves dialogue itself",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical();

            const compositionPlan =
              makeCompositionPlan([
                makeCompositionShot({
                  shotId:
                    "S02",

                  order:
                    2,

                  nativeAudio:
                    true,
                }),
              ]);

            const failure =
              new Error(
                "Dialogue placement decision for EP02/SC01/S02 is missing.",
              );

            const prepareComposition =
              vi.fn(
                async () => {
                  throw failure;
                },
              );

            const buildRenderPlan =
              vi.fn();

            const ensureRender =
              vi.fn();

            await expect(
              composeEpisodeRoughCut(
                {
                  compositionPlan,
                  episode,
                  bible,

                  mediaRoot:
                    MEDIA_ROOT,

                  postProduction,

                  ffmpegExecutable:
                    FFMPEG_EXECUTABLE,

                  ffprobeExecutable:
                    FFPROBE_EXECUTABLE,
                },
                {
                  prepareComposition:
                    prepareComposition as never,

                  buildRenderPlan:
                    buildRenderPlan as never,

                  ensureRender:
                    ensureRender as never,
                },
              ),
            ).rejects.toBe(
              failure,
            );

            const forwarded =
              (
                prepareComposition
                  .mock.calls as unknown as [
                    PrepareEpisodeCompositionInput,
                  ][]
              )[0]![0];

            expect(
              forwarded.episode,
            ).toBe(
              episode,
            );

            expect(
              forwarded.bible,
            ).toBe(
              bible,
            );

            expect(
              forwarded.compositionPlan,
            ).toBe(
              compositionPlan,
            );

            expect(
              Object.keys(
                forwarded,
              ).sort(),
            ).toEqual([
              "bible",
              "compositionPlan",
              "episode",
              "ffmpegExecutable",
              "ffprobeExecutable",
              "mediaRoot",
              "postProduction",
            ]);

            expect(
              mockedBuildShotDialoguePlan,
            ).not.toHaveBeenCalled();

            expect(
              mockedResolveDurableDialogueCompositionAudioPlan,
            ).not.toHaveBeenCalled();

            expect(
              buildRenderPlan,
            ).not.toHaveBeenCalled();

            expect(
              ensureRender,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    describe(
      "I. authority immutability",
      () => {
        it(
          "does not mutate the canonical episode, bible, composition plan, or resolved B2d plan",
          async () => {
            const {
              episode,
              bible,
            } =
              await loadCanonical([
                "S03",
              ]);

            const compositionPlan =
              makeCompositionPlan([
                makeCompositionShot({
                  shotId:
                    "S01",

                  order:
                    1,

                  nativeAudio:
                    false,
                }),

                makeCompositionShot({
                  shotId:
                    "S02",

                  order:
                    2,

                  nativeAudio:
                    true,
                }),

                makeCompositionShot({
                  shotId:
                    "S03",

                  order:
                    3,

                  nativeAudio:
                    true,
                }),
              ]);

            const episodeBefore =
              structuredClone(
                episode,
              );

            const bibleBefore =
              structuredClone(
                bible,
              );

            const compositionPlanBefore =
              structuredClone(
                compositionPlan,
              );

            const harness =
              createHarness();

            await prepareEpisodeComposition(
              prepareInput(
                compositionPlan,
                episode,
                bible,
              ),
              harness.dependencies,
            );

            expect(
              episode,
            ).toStrictEqual(
              episodeBefore,
            );

            expect(
              bible,
            ).toStrictEqual(
              bibleBefore,
            );

            expect(
              compositionPlan,
            ).toStrictEqual(
              compositionPlanBefore,
            );

            for (
              const [
                index,
                result,
              ]
              of harness.resolveDialogueAudioPlan
                .mock.results.entries()
            ) {
              const resolved =
                await result.value as DialogueCompositionAudioPlan;

              const routed =
                (
                  harness.buildDialogueNormalizationPlan
                    .mock.calls[index]![0] as {
                    dialogueAudio: DialogueCompositionAudioPlan;
                  }
                ).dialogueAudio;

              expect(
                routed,
              ).toBe(
                resolved,
              );

              expect(
                Object.isFrozen(
                  routed,
                ),
              ).toBe(
                true,
              );
            }

            expect(
              harness.resolveDialogueAudioPlan,
            ).toHaveBeenCalledTimes(
              2,
            );
          },
        );
      },
    );
  },
);
