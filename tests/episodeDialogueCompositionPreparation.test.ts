import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import type {
  CompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

import type {
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import type {
  MaterializedCompositionShotNormalization,
} from "../src/composition/materializeCompositionShotNormalization.js";

import {
  prepareEpisodeComposition,
} from "../src/composition/prepareEpisodeComposition.js";

import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  CharacterBible,
} from "../src/schemas/character.schema.js";

import type {
  EpisodeManifest,
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

async function loadCanonical(): Promise<
  Readonly<{
    episode:
      EpisodeManifest;

    bible:
      CharacterBible;
  }>
> {
  const [
    episode,
    bible,
  ] =
    await Promise.all([
      loadEpisodeManifest(
        "EP02",
      ),

      loadCharacterBible(),
    ]);

  return Object.freeze({
    episode,
    bible,
  });
}

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const FFMPEG_EXECUTABLE =
  "D:/Tools/ffmpeg/bin/ffmpeg.exe";

const FFPROBE_EXECUTABLE =
  "D:/Tools/ffmpeg/bin/ffprobe.exe";

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

function makeShot(
  input:
    Readonly<{
      shotId:
        "S01" | "S02";

      order:
        1 | 2;

      nativeAudio:
        boolean;

      provider:
        "RUNWAY" | "VEO";

      shaCharacter:
        string;
    }>,
): EpisodeCompositionPlanShot {
  return Object.freeze({
    sceneId:
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
      input.provider,

    providerExecutionId:
      input.provider ===
        "RUNWAY"
        ? `task-${input.shotId}`
        : `operations/${input.shotId}`,

    sourceVideoPath:
      `${MEDIA_ROOT}/generated-video/EP02/${input.shotId}/${input.shotId}_01.mp4`,

    sourceBytes:
      1_000 +
      input.order,

    sourceSha256:
      input.shaCharacter.repeat(
        64,
      ),

    sourceContentType:
      "video/mp4",
  });
}

function makeSourceMedia(
  shot:
    EpisodeCompositionPlanShot,
): CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      shot.sourceVideoPath,

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      shot.durationSeconds,

    video:
      Object.freeze({
        codecName:
          "h264",

        profile:
          "High",

        width:
          1280,

        height:
          720,

        pixelFormat:
          "yuv420p",

        frameRate:
          24,
      }),

    audio:
      shot.nativeAudio
        ? Object.freeze({
            codecName:
              "aac",

            profile:
              "LC",

            sampleRateHz:
              48000,

            channels:
              2,

            channelLayout:
              "stereo",
          })
        : null,
  });
}

function makeV1Plan(
  shot:
    EpisodeCompositionPlanShot,
): CompositionShotNormalizationPlan {
  const cacheKey =
    "a".repeat(
      64,
    );

  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-master-normalization-v1",

    episodeId:
      "EP02",

    shotId:
      shot.shotId,

    sourceVideoPath:
      shot.sourceVideoPath,

    sourceSha256:
      shot.sourceSha256,

    sourceDurationSeconds:
      4,

    targetDurationSeconds:
      4,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      shot.nativeAudio,

    container:
      "mp4",

    video:
      Object.freeze({
        codecName:
          "h264",

        width:
          1920,

        height:
          1080,

        frameRate:
          25,

        pixelFormat:
          "yuv420p",

        scaleMode:
          "FIT_PAD",
      }),

    audio:
      Object.freeze({
        mode:
          shot.nativeAudio
            ? "PRESERVE_NATIVE"
            : "SYNTHETIC_SILENCE",

        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    cacheKey,

    outputPath:
      `${MEDIA_ROOT}/cache/composition-normalized/EP02/${shot.shotId}/EP02_${shot.shotId}_${cacheKey}.mp4`,
  });
}

function makeDialogueAudioPlan():
  DialogueCompositionAudioPlan {
  return Object.freeze({
    schemaVersion:
      "1.0",

    audioMode:
      "REPLACE_SOURCE_WITH_DIALOGUE",

    mixNativeAudio:
      false,

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialoguePlanKey:
      "b".repeat(
        64,
      ),

    shotDurationSeconds:
      4,

    sourceNativeAudio:
      true,

    sourceAudioDisposition:
      "DISCARD_NATIVE_AUDIO",

    lines:
      Object.freeze([
        Object.freeze({
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",

          sourceAudioPath:
            `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/line.audio`,

          sourceBytes:
            12_345,

          sourceSha256:
            "c".repeat(
              64,
            ),

          startSeconds:
            0.5,

          durationSeconds:
            1.5,

          endSeconds:
            2,
        }),
      ]),

    audioKey:
      "d".repeat(
        64,
      ),
  });
}

function makeV2Plan(
  shot:
    EpisodeCompositionPlanShot,

  dialogueAudio:
    DialogueCompositionAudioPlan,
): DialogueCompositionShotNormalizationPlan {
  const cacheKey =
    "e".repeat(
      64,
    );

  return Object.freeze({
    schemaVersion:
      "2.0",

    profileId:
      "busybookie-master-normalization-v2-dialogue",

    episodeId:
      "EP02",

    sceneId:
      shot.sceneId,

    shotId:
      shot.shotId,

    sourceVideoPath:
      shot.sourceVideoPath,

    sourceSha256:
      shot.sourceSha256,

    sourceDurationSeconds:
      4,

    targetDurationSeconds:
      4,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      shot.nativeAudio,

    container:
      "mp4",

    video:
      Object.freeze({
        codecName:
          "h264",

        width:
          1920,

        height:
          1080,

        frameRate:
          25,

        pixelFormat:
          "yuv420p",

        scaleMode:
          "FIT_PAD",
      }),

    audio:
      Object.freeze({
        mode:
          "REPLACE_SOURCE_WITH_DIALOGUE",

        mixNativeAudio:
          false,

        sourceAudioDisposition:
          dialogueAudio.sourceAudioDisposition,

        dialoguePlanKey:
          dialogueAudio.dialoguePlanKey,

        audioKey:
          dialogueAudio.audioKey,

        lines:
          dialogueAudio.lines,

        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    cacheKey,

    outputPath:
      `${MEDIA_ROOT}/cache/composition-normalized/EP02/${shot.shotId}/EP02_${shot.shotId}_${cacheKey}.mp4`,
  });
}

function makeArtifact(
  plan:
    CompositionShotNormalizationPlan |
    DialogueCompositionShotNormalizationPlan,
): MaterializedCompositionShotNormalization {
  return Object.freeze({
    outputPath:
      plan.outputPath,

    bytes:
      plan.schemaVersion ===
        "1.0"
        ? 2_001
        : 2_002,

    sha256:
      plan.schemaVersion ===
        "1.0"
        ? "f".repeat(
            64,
          )
        : "1".repeat(
            64,
          ),

    contentType:
      "video/mp4",

    durationSeconds:
      plan.targetDurationSeconds,

    durationToleranceSeconds:
      1 /
      plan.video.frameRate,
  });
}

describe(
  "Busybookie dialogue-aware episode composition preparation",
  () => {
    it(
      "keeps non-dialogue shots on v1 and routes canonical dialogue shots through v2 using durable composition audio",
      async () => {
        const shot1 =
          makeShot({
            shotId:
              "S01",

            order:
              1,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            shaCharacter:
              "2",
          });

        const shot2 =
          makeShot({
            shotId:
              "S02",

            order:
              2,

            nativeAudio:
              true,

            provider:
              "VEO",

            shaCharacter:
              "3",
          });

        const compositionPlan:
          EpisodeCompositionPlan =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Mixed normalization episode",

              totalShots:
                2,

              totalDurationSeconds:
                8,

              shots:
                Object.freeze([
                  shot1,
                  shot2,
                ]),
            });

        const dialogueAudio =
          makeDialogueAudioPlan();

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
              const shot =
                compositionPlan.shots.find(
                  (
                    candidate,
                  ) =>
                    candidate.sourceVideoPath ===
                    input.sourceVideoPath,
                );

              if (!shot) {
                throw new Error(
                  `Unexpected source path ${input.sourceVideoPath}.`,
                );
              }

              events.push(
                `probe:${shot.shotId}`,
              );

              return makeSourceMedia(
                shot,
              );
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

              return makeV1Plan(
                input.shot,
              );
            },
          );

        const ensureNormalizationCache =
          vi.fn(
            async (
              input:
                Readonly<{
                  plan:
                    CompositionShotNormalizationPlan;
                }>,
            ) => {
              events.push(
                `ensure-v1:${input.plan.shotId}`,
              );

              return Object.freeze({
                cacheStatus:
                  "HIT" as const,

                artifact:
                  makeArtifact(
                    input.plan,
                  ),
              });
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

              return makeV2Plan(
                input.shot,
                input.dialogueAudio,
              );
            },
          );

        const ensureDialogueNormalizationCache =
          vi.fn(
            async (
              input:
                Readonly<{
                  plan:
                    DialogueCompositionShotNormalizationPlan;
                }>,
            ) => {
              events.push(
                `ensure-v2:${input.plan.shotId}`,
              );

              return Object.freeze({
                cacheStatus:
                  "MATERIALIZED" as const,

                artifact:
                  makeArtifact(
                    input.plan,
                  ),
              });
            },
          );

        const {
          episode,
          bible,
        } =
          await loadCanonical();

        const buildDialoguePlan =
          vi.fn(
            buildShotDialoguePlan,
          );

        const resolveDialogueAudioPlan =
          vi.fn(
            async (
              input:
                Readonly<{
                  dialoguePlan:
                    Readonly<{
                      shotId:
                        string;
                    }>;
                }>,
            ) => {
              events.push(
                `resolve:${input.dialoguePlan.shotId}`,
              );

              return dialogueAudio;
            },
          );

        await prepareEpisodeComposition(
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
            probeSource,
            buildNormalizationPlan,
            ensureNormalizationCache,
            buildDialoguePlan,
            resolveDialogueAudioPlan,
            buildDialogueNormalizationPlan,
            ensureDialogueNormalizationCache,
          } as unknown as
            Parameters<
              typeof prepareEpisodeComposition
            >[1],
        );

        const canonicalShot =
          episode.scenes[0]!
            .shots.find(
              (
                candidate,
              ) =>
                candidate.id ===
                "S02",
            )!;

        expect(
          buildDialoguePlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          buildDialoguePlan,
        ).toHaveBeenCalledWith({
          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shot:
            canonicalShot,

          bible,
        });

        expect(
          resolveDialogueAudioPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resolveDialogueAudioPlan,
        ).toHaveBeenCalledWith({
          mediaRoot:
            MEDIA_ROOT,

          ffprobeExecutable:
            FFPROBE_EXECUTABLE,

          dialoguePlan:
            buildDialoguePlan.mock.results[0]!
              .value,
        });

        expect(
          events,
        ).toEqual([
          "resolve:S02",
          "probe:S01",
          "plan-v1:S01",
          "ensure-v1:S01",
          "probe:S02",
          "plan-v2:S02",
          "ensure-v2:S02",
        ]);

        expect(
          buildNormalizationPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          ensureNormalizationCache,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          buildDialogueNormalizationPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          ensureDialogueNormalizationCache,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          buildDialogueNormalizationPlan,
        ).toHaveBeenCalledWith({
          mediaRoot:
            MEDIA_ROOT,

          episodeId:
            "EP02",

          shot:
            shot2,

          sourceMedia:
            makeSourceMedia(
              shot2,
            ),

          postProduction,

          dialogueAudio,
        });
      },
    );
    it(
      "rejects resolved dialogue audio for a different episode before probing media",
      async () => {
        const shot =
          makeShot({
            shotId:
              "S02",

            order:
              2,

            nativeAudio:
              true,

            provider:
              "VEO",

            shaCharacter:
              "3",
          });

        const compositionPlan:
          EpisodeCompositionPlan =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Fail closed episode",

              totalShots:
                1,

              totalDurationSeconds:
                4,

              shots:
                Object.freeze([
                  shot,
                ]),
            });

        const dialogueAudio =
          Object.freeze({
            ...makeDialogueAudioPlan(),

            episodeId:
              "EP99",
          }) as DialogueCompositionAudioPlan;

        const {
          episode,
          bible,
        } =
          await loadCanonical();

        const probeSource =
          vi.fn();

        await expect(
          prepareEpisodeComposition(
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
              probeSource:
                probeSource as never,

              buildNormalizationPlan:
                vi.fn() as never,

              ensureNormalizationCache:
                vi.fn() as never,

              buildDialoguePlan:
                buildShotDialoguePlan,

              resolveDialogueAudioPlan:
                vi.fn(
                  async () =>
                    dialogueAudio,
                ),

              buildDialogueNormalizationPlan:
                vi.fn() as never,

              ensureDialogueNormalizationCache:
                vi.fn() as never,
            },
          ),
        ).rejects.toThrow(
          /resolved dialogue audio identity EP99\/SC01\/S02 does not match EP02\/SC01\/S02/i,
        );

        expect(
          probeSource,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a composition shot without a canonical episode shot before probing media",
      async () => {
        const shot =
          Object.freeze({
            ...makeShot({
              shotId:
                "S01",

              order:
                1,

              nativeAudio:
                false,

              provider:
                "RUNWAY",

              shaCharacter:
                "2",
            }),

            shotId:
              "S09",
          });

        const compositionPlan:
          EpisodeCompositionPlan =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Fail closed episode",

              totalShots:
                1,

              totalDurationSeconds:
                4,

              shots:
                Object.freeze([
                  shot,
                ]),
            });

        const {
          episode,
          bible,
        } =
          await loadCanonical();

        const probeSource =
          vi.fn();

        const resolveDialogueAudioPlan =
          vi.fn();

        await expect(
          prepareEpisodeComposition(
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
              probeSource:
                probeSource as never,

              buildNormalizationPlan:
                vi.fn() as never,

              ensureNormalizationCache:
                vi.fn() as never,

              buildDialoguePlan:
                vi.fn() as never,

              resolveDialogueAudioPlan:
                resolveDialogueAudioPlan as never,
            },
          ),
        ).rejects.toThrow(
          /EP02\/SC01\/S09 has no canonical episode shot/i,
        );

        expect(
          probeSource,
        ).not.toHaveBeenCalled();

        expect(
          resolveDialogueAudioPlan,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a duplicate composition shot before resolving dialogue audio or probing media",
      async () => {
        const shot =
          makeShot({
            shotId:
              "S02",

            order:
              2,

            nativeAudio:
              true,

            provider:
              "VEO",

            shaCharacter:
              "3",
          });

        const compositionPlan:
          EpisodeCompositionPlan =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Fail closed episode",

              totalShots:
                2,

              totalDurationSeconds:
                8,

              shots:
                Object.freeze([
                  shot,
                  shot,
                ]),
            });

        const {
          episode,
          bible,
        } =
          await loadCanonical();

        const probeSource =
          vi.fn();

        const resolveDialogueAudioPlan =
          vi.fn(
            async () =>
              makeDialogueAudioPlan(),
          );

        await expect(
          prepareEpisodeComposition(
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
              probeSource:
                probeSource as never,

              buildNormalizationPlan:
                vi.fn() as never,

              ensureNormalizationCache:
                vi.fn() as never,

              buildDialoguePlan:
                buildShotDialoguePlan,

              resolveDialogueAudioPlan,

              buildDialogueNormalizationPlan:
                vi.fn() as never,

              ensureDialogueNormalizationCache:
                vi.fn() as never,
            },
          ),
        ).rejects.toThrow(
          /duplicate shot EP02\/SC01\/S02/i,
        );

        expect(
          resolveDialogueAudioPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeSource,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
