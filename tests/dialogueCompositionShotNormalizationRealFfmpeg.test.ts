import "dotenv/config";

import {
  execFile,
} from "node:child_process";

import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import {
  buildEpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  PreparedEpisodeComposition,
} from "../src/composition/prepareEpisodeComposition.js";

import {
  materializeDialogueCompositionShotNormalization,
} from "../src/composition/materializeDialogueCompositionShotNormalization.js";

const ffmpegExecutable =
  process.env.BUSYBOOKIE_FFMPEG_PATH?.trim() ??
  "";

const ffprobeExecutable =
  process.env.BUSYBOOKIE_FFPROBE_PATH?.trim() ??
  "";

const toolchainAvailable =
  ffmpegExecutable.length >
    0 &&
  ffprobeExecutable.length >
    0;

let temporaryRoot:
  string | null =
    null;

function runMediaTool(
  executable:
    string,

  args:
    readonly string[],
): Promise<
  Readonly<{
    stdout:
      string;

    stderr:
      string;
  }>
> {
  return new Promise(
    (
      resolve,
      reject,
    ) => {
      execFile(
        executable,
        [
          ...args,
        ],
        {
          encoding:
            "utf8",

          windowsHide:
            true,

          timeout:
            30 * 60 * 1000,

          maxBuffer:
            4 * 1024 * 1024,
        },
        (
          error,
          stdout,
          stderr,
        ) => {
          if (error) {
            reject(
              Object.assign(
                error,
                {
                  stdout,
                  stderr,
                },
              ),
            );

            return;
          }

          resolve(
            Object.freeze({
              stdout,
              stderr,
            }),
          );
        },
      );
    },
  );
}

async function sha256File(
  filePath:
    string,
): Promise<string> {
  const payload =
    await readFile(
      filePath,
    );

  return createHash(
    "sha256",
  )
    .update(
      payload,
    )
    .digest(
      "hex",
    );
}

async function inspectFile(
  filePath:
    string,
): Promise<
  Readonly<{
    bytes:
      number;

    sha256:
      string;
  }>
> {
  const fileStat =
    await stat(
      filePath,
    );

  return Object.freeze({
    bytes:
      fileStat.size,

    sha256:
      await sha256File(
        filePath,
      ),
  });
}

async function measureMaxVolumeDb(
  filePath:
    string,

  startSeconds:
    number,

  durationSeconds:
    number,
): Promise<number> {
  const result =
    await runMediaTool(
      ffmpegExecutable,
      [
        "-hide_banner",
        "-nostdin",
        "-ss",
        String(
          startSeconds,
        ),
        "-t",
        String(
          durationSeconds,
        ),
        "-i",
        filePath,
        "-map",
        "0:a:0",
        "-af",
        "volumedetect",
        "-f",
        "null",
        "-",
      ],
    );

  const match =
    /max_volume:\s*(-?(?:[0-9]+(?:\.[0-9]+)?|inf))\s*dB/iu.exec(
      result.stderr,
    );

  if (!match?.[1]) {
    throw new Error(
      `Could not parse FFmpeg volumedetect output:\n${result.stderr}`,
    );
  }

  if (
    match[1].toLowerCase() ===
    "-inf"
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  return Number(
    match[1],
  );
}

afterEach(
  async () => {
    if (
      temporaryRoot !==
      null
    ) {
      await rm(
        temporaryRoot,
        {
          recursive:
            true,

          force:
            true,
        },
      );

      temporaryRoot =
        null;
    }
  },
);

describe(
  "Busybookie dialogue composition normalization real FFmpeg integration",
  () => {
    it.skipIf(
      !toolchainAvailable,
    )(
      "materializes opaque dialogue audio with real FFmpeg and replaces source native audio",
      async () => {
        temporaryRoot =
          await mkdtemp(
            join(
              tmpdir(),
              "busybookie-dialogue-v2-real-",
            ),
          );

        const sourceVideoPath =
          join(
            temporaryRoot,
            "source-with-native-audio.mp4",
          );

        const line1AudioPath =
          join(
            temporaryRoot,
            "EP02_SC01_S02_L01.audio",
          );

        const line2AudioPath =
          join(
            temporaryRoot,
            "EP02_SC01_S02_L02.audio",
          );

        const outputPath =
          join(
            temporaryRoot,
            "normalized-dialogue-v2.mp4",
          );

        /*
         * Create a six-second source MP4 containing a
         * continuous native 220 Hz tone. If v2 accidentally
         * preserves or mixes source audio, the pre-dialogue
         * output region will not be silent.
         */
        await runMediaTool(
          ffmpegExecutable,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=320x180:r=25:d=6",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=220:sample_rate=48000:duration=6",
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-profile:v",
            "high",
            "-pix_fmt",
            "yuv420p",
            "-r",
            "25",
            "-c:a",
            "aac",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-shortest",
            "-f",
            "mp4",
            sourceVideoPath,
          ],
        );

        /*
         * Write real AAC/ADTS payloads directly to files
         * whose extension is deliberately opaque ".audio".
         * Their generated lengths exceed the placement
         * durations so the production graph performs trim.
         */
        await runMediaTool(
          ffmpegExecutable,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=880:sample_rate=48000:duration=2",
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-f",
            "adts",
            line1AudioPath,
          ],
        );

        await runMediaTool(
          ffmpegExecutable,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1320:sample_rate=48000:duration=3",
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-f",
            "adts",
            line2AudioPath,
          ],
        );

        const sourceVideo =
          await inspectFile(
            sourceVideoPath,
          );

        const line1Audio =
          await inspectFile(
            line1AudioPath,
          );

        const line2Audio =
          await inspectFile(
            line2AudioPath,
          );

        const plan:
          DialogueCompositionShotNormalizationPlan =
          Object.freeze({
            schemaVersion:
              "2.0",

            profileId:
              "busybookie-master-normalization-v2-dialogue",

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            sourceVideoPath,

            sourceSha256:
              sourceVideo.sha256,

            sourceDurationSeconds:
              6,

            targetDurationSeconds:
              6,

            durationToleranceSeconds:
              1 / 24,

            durationMode:
              "MANIFEST_LOCKED",

            nativeAudio:
              true,

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
                  "DISCARD_NATIVE_AUDIO",

                dialoguePlanKey:
                  "1".repeat(
                    64,
                  ),

                audioKey:
                  "2".repeat(
                    64,
                  ),

                lines:
                  Object.freeze([
                    Object.freeze({
                      lineNumber:
                        1,

                      dialogueLineId:
                        "EP02_SC01_S02_L01",

                      sourceAudioPath:
                        line1AudioPath,

                      sourceBytes:
                        line1Audio.bytes,

                      sourceSha256:
                        line1Audio.sha256,

                      startSeconds:
                        0.5,

                      durationSeconds:
                        1.5,

                      endSeconds:
                        2,
                    }),

                    Object.freeze({
                      lineNumber:
                        2,

                      dialogueLineId:
                        "EP02_SC01_S02_L02",

                      sourceAudioPath:
                        line2AudioPath,

                      sourceBytes:
                        line2Audio.bytes,

                      sourceSha256:
                        line2Audio.sha256,

                      startSeconds:
                        2.5,

                      durationSeconds:
                        2.25,

                      endSeconds:
                        4.75,
                    }),
                  ]),

                codecName:
                  "aac",

                sampleRateHz:
                  48000,

                channels:
                  2,

                channelLayout:
                  "stereo",
              }),

            cacheKey:
              "3".repeat(
                64,
              ),

            outputPath,
          });

        const result =
          await materializeDialogueCompositionShotNormalization({
            ffmpegExecutable,
            ffprobeExecutable,
            plan,
          });

        expect(
          result.outputPath,
        ).toBe(
          outputPath,
        );

        expect(
          result.bytes,
        ).toBeGreaterThan(
          0,
        );

        expect(
          result.sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/u,
        );

        expect(
          result.contentType,
        ).toBe(
          "video/mp4",
        );

        expect(
          result.durationSeconds,
        ).toBeCloseTo(
          6,
          2,
        );

        const preparedComposition:
          PreparedEpisodeComposition =
            Object.freeze({
              episodeId:
                "EP02",

              title:
                "Dialogue v2 real FFmpeg integration",

              totalShots:
                1,

              totalDurationSeconds:
                6,

              shots:
                Object.freeze([
                  Object.freeze({
                    sceneId:
                      "SC01",

                    shotId:
                      "S02",

                    order:
                      1,

                    title:
                      "Dialogue shot",

                    durationSeconds:
                      6,

                    nativeAudio:
                      true,

                    provider:
                      "VEO",

                    providerExecutionId:
                      "operations/dialogue-v2-real",

                    sourceVideoPath,

                    sourceBytes:
                      sourceVideo.bytes,

                    sourceSha256:
                      sourceVideo.sha256,

                    sourceContentType:
                      "video/mp4",

                    normalizationPlan:
                      plan,

                    normalizationCacheStatus:
                      "MATERIALIZED",

                    normalizedArtifact:
                      result,
                  }),
                ]),
            });

        const roughCutPlan =
          buildEpisodeRoughCutRenderPlan({
            mediaRoot:
              temporaryRoot,

            preparedComposition,

            postProduction:
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
              }),
          });

        const expectedRenderIdentity =
          [
            "busybookie-episode-rough-cut-v1",
            "EP02",
            "1",
            "6",
            "1920x1080@25",
            "48000",
            "S02",
            "1",
            "6",
            result.sha256,
          ].join(
            "\n",
          );

        const expectedRenderKey =
          createHash(
            "sha256",
          )
            .update(
              expectedRenderIdentity,
              "utf8",
            )
            .digest(
              "hex",
            );

        expect(
          roughCutPlan.shots,
        ).toHaveLength(
          1,
        );

        const roughCutShot =
          roughCutPlan.shots[0];

        if (!roughCutShot) {
          throw new Error(
            "Expected one rough-cut shot.",
          );
        }

        expect(
          roughCutShot.sourceVideoPath,
        ).toBe(
          result.outputPath,
        );

        expect(
          roughCutShot.sourceBytes,
        ).toBe(
          result.bytes,
        );

        expect(
          roughCutShot.sourceSha256,
        ).toBe(
          result.sha256,
        );

        expect(
          roughCutPlan.renderKey,
        ).toBe(
          expectedRenderKey,
        );

        /*
         * 0.00–0.40 seconds precedes line 1 at 0.50s.
         * It must be effectively silent. The source MP4 has
         * a continuous native tone, so this proves native
         * source audio was discarded rather than mixed.
         */
        const preDialogueMaxVolumeDb =
          await measureMaxVolumeDb(
            outputPath,
            0,
            0.4,
          );

        expect(
          preDialogueMaxVolumeDb,
        ).toBeLessThanOrEqual(
          -60,
        );

        /*
         * 0.75–1.25 seconds lies inside line 1, proving the
         * output is not simply a silent replacement track.
         */
        const dialogueMaxVolumeDb =
          await measureMaxVolumeDb(
            outputPath,
            0.75,
            0.5,
          );

        expect(
          dialogueMaxVolumeDb,
        ).toBeGreaterThan(
          -50,
        );
      },
      120_000,
    );
  },
);
