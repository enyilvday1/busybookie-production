import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import {
  CompositionNormalizationOutputAlreadyExistsError,
} from "../src/composition/materializeCompositionShotNormalization.js";

import type {
  CompositionSourceMediaMetadata,
  CompositionSourceMediaProbeInput,
} from "../src/composition/probeCompositionSourceMedia.js";

import {
  materializeDialogueCompositionShotNormalization,
} from "../src/composition/materializeDialogueCompositionShotNormalization.js";

function sha256(
  value:
    Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

async function pathExists(
  filePath:
    string,
): Promise<boolean> {
  try {
    await stat(
      filePath,
    );

    return true;
  } catch (
    error
  ) {
    if (
      (
        error as
          NodeJS.ErrnoException
      ).code ===
      "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

type Fixture =
  Readonly<{
    root:
      string;

    plan:
      DialogueCompositionShotNormalizationPlan;

    line1Path:
      string;

    line2Path:
      string;
  }>;

async function createFixture():
Promise<Fixture> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-normalization-",
      ),
    );

  const sourceVideoPath =
    join(
      root,
      "generated-video",
      "EP02",
      "S02",
      "source.mp4",
    );

  const line1Path =
    join(
      root,
      "voices",
      "EP02",
      "S02",
      "EP02_SC01_S02_L01",
      "line1.audio",
    );

  const line2Path =
    join(
      root,
      "voices",
      "EP02",
      "S02",
      "EP02_SC01_S02_L02",
      "line2.audio",
    );

  const outputPath =
    join(
      root,
      "cache",
      "composition-normalized",
      "EP02",
      "S02",
      "output.mp4",
    );

  const sourcePayload =
    Buffer.from(
      "provider-video-source",
      "utf8",
    );

  const line1Payload =
    Buffer.from(
      "dialogue-one",
      "utf8",
    );

  const line2Payload =
    Buffer.from(
      "dialogue-two",
      "utf8",
    );

  await mkdir(
    dirname(
      sourceVideoPath,
    ),
    {
      recursive:
        true,
    },
  );

  await mkdir(
    dirname(
      line1Path,
    ),
    {
      recursive:
        true,
    },
  );

  await mkdir(
    dirname(
      line2Path,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    sourceVideoPath,
    sourcePayload,
    {
      flag:
        "wx",
    },
  );

  await writeFile(
    line1Path,
    line1Payload,
    {
      flag:
        "wx",
    },
  );

  await writeFile(
    line2Path,
    line2Payload,
    {
      flag:
        "wx",
    },
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
          sha256(
            sourcePayload,
          ),

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
              "b".repeat(
                64,
              ),

            audioKey:
              "c".repeat(
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
                    line1Path,

                  sourceBytes:
                    line1Payload.length,

                  sourceSha256:
                    sha256(
                      line1Payload,
                    ),

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
                    line2Path,

                  sourceBytes:
                    line2Payload.length,

                  sourceSha256:
                    sha256(
                      line2Payload,
                    ),

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
          "d".repeat(
            64,
          ),

        outputPath,
      });

  return Object.freeze({
    root,
    plan,
    line1Path,
    line2Path,
  });
}

function createValidNormalizedMedia(
  sourceVideoPath:
    string,
): CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath,

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      6,

    video:
      Object.freeze({
        codecName:
          "h264",

        profile:
          "High",

        width:
          1920,

        height:
          1080,

        pixelFormat:
          "yuv420p",

        frameRate:
          25,
      }),

    audio:
      Object.freeze({
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
      }),
  });
}

describe(
  "Busybookie dialogue composition normalization materialization",
  () => {
    it(
      "verifies all immutable inputs, renders temporarily, verifies output, promotes exclusively, and removes the temporary artifact",
      async () => {
        const fixture =
          await createFixture();

        try {
          const outputPayload =
            Buffer.from(
              "dialogue-normalized-output",
              "utf8",
            );

          const expectedSha256 =
            sha256(
              outputPayload,
            );

          let temporaryPath:
            string | undefined;

          const runFfmpeg =
            vi.fn(
              async (
                executable:
                  string,

                args:
                  readonly string[],
              ) => {
                expect(
                  executable,
                ).toBe(
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",
                );

                const outputPath =
                  args.at(
                    -1,
                  );

                if (!outputPath) {
                  throw new Error(
                    "Test FFmpeg command did not contain an output path.",
                  );
                }

                temporaryPath =
                  outputPath;

                expect(
                  outputPath,
                ).not.toBe(
                  fixture.plan.outputPath,
                );

                expect(
                  outputPath.startsWith(
                    `${fixture.plan.outputPath}.part-`,
                  ),
                ).toBe(
                  true,
                );

                await writeFile(
                  outputPath,
                  outputPayload,
                  {
                    flag:
                      "wx",
                  },
                );

                return Object.freeze({
                  executable,

                  args:
                    Object.freeze([
                      ...args,
                    ]),

                  stdout:
                    "",

                  stderr:
                    "",
                });
              },
            );

          const probeOutput =
            vi.fn(
              async (
                input:
                  CompositionSourceMediaProbeInput,
              ) => {
                expect(
                  input.ffprobeExecutable,
                ).toBe(
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",
                );

                expect(
                  input.sourceVideoPath,
                ).toBe(
                  temporaryPath,
                );

                expect(
                  input.nativeAudio,
                ).toBe(
                  true,
                );

                return createValidNormalizedMedia(
                  input.sourceVideoPath,
                );
              },
            );

          const result =
            await materializeDialogueCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan:
                  fixture.plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            );

          expect(
            runFfmpeg,
          ).toHaveBeenCalledTimes(
            1,
          );

          expect(
            probeOutput,
          ).toHaveBeenCalledTimes(
            1,
          );

          expect(
            result,
          ).toEqual({
            outputPath:
              fixture.plan.outputPath,

            bytes:
              outputPayload.length,

            sha256:
              expectedSha256,

            contentType:
              "video/mp4",

            durationSeconds:
              6,

            durationToleranceSeconds:
              1 / 25,
          });

          expect(
            Object.isFrozen(
              result,
            ),
          ).toBe(
            true,
          );

          expect(
            await readFile(
              fixture.plan.outputPath,
            ),
          ).toEqual(
            outputPayload,
          );

          if (!temporaryPath) {
            throw new Error(
              "Test did not capture the temporary dialogue normalization path.",
            );
          }

          expect(
            await pathExists(
              temporaryPath,
            ),
          ).toBe(
            false,
          );
        } finally {
          await rm(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      "fails closed before FFmpeg when a dialogue audio SHA changes after admission",
      async () => {
        const fixture =
          await createFixture();

        try {
          /*
           * Same byte length as "dialogue-one", but
           * different content. This proves SHA-256,
           * not merely byte count, is revalidated.
           */
          await writeFile(
            fixture.line1Path,
            Buffer.from(
              "dialogue-xxx",
              "utf8",
            ),
          );

          const runFfmpeg =
            vi.fn();

          const probeOutput =
            vi.fn();

          await expect(
            materializeDialogueCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan:
                  fixture.plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toThrow(
            /dialogue.*sha|dialogue.*hash|dialogue.*integrity/i,
          );

          expect(
            runFfmpeg,
          ).not.toHaveBeenCalled();

          expect(
            probeOutput,
          ).not.toHaveBeenCalled();

          expect(
            await pathExists(
              fixture.plan.outputPath,
            ),
          ).toBe(
            false,
          );
        } finally {
          await rm(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      "fails closed before FFmpeg when a dialogue audio byte count does not match the plan",
      async () => {
        const fixture =
          await createFixture();

        try {
          const firstLine =
            fixture.plan.audio.lines[0];

          if (!firstLine) {
            throw new Error(
              "Test fixture did not contain dialogue line one.",
            );
          }

          const forgedPlan =
            Object.freeze({
              ...fixture.plan,

              audio:
                Object.freeze({
                  ...fixture.plan.audio,

                  lines:
                    Object.freeze([
                      Object.freeze({
                        ...firstLine,

                        sourceBytes:
                          firstLine.sourceBytes +
                          1,
                      }),

                      fixture.plan.audio.lines[1]!,
                    ]),
                }),
            }) as
              DialogueCompositionShotNormalizationPlan;

          const runFfmpeg =
            vi.fn();

          const probeOutput =
            vi.fn();

          await expect(
            materializeDialogueCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan:
                  forgedPlan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toThrow(
            /dialogue.*byte|byte.*dialogue|byte count/i,
          );

          expect(
            runFfmpeg,
          ).not.toHaveBeenCalled();

          expect(
            probeOutput,
          ).not.toHaveBeenCalled();
        } finally {
          await rm(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      "removes a partial temporary artifact when FFmpeg fails and never creates the final output",
      async () => {
        const fixture =
          await createFixture();

        try {
          let temporaryPath:
            string | undefined;

          const runFfmpeg =
            vi.fn(
              async (
                _executable:
                  string,

                args:
                  readonly string[],
              ) => {
                const outputPath =
                  args.at(
                    -1,
                  );

                if (!outputPath) {
                  throw new Error(
                    "Test FFmpeg command did not contain an output path.",
                  );
                }

                temporaryPath =
                  outputPath;

                await writeFile(
                  outputPath,
                  "partial-dialogue-output",
                  {
                    flag:
                      "wx",
                  },
                );

                throw new Error(
                  "synthetic FFmpeg failure",
                );
              },
            );

          const probeOutput =
            vi.fn();

          await expect(
            materializeDialogueCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan:
                  fixture.plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toThrow(
            /ffmpeg.*failed/i,
          );

          expect(
            probeOutput,
          ).not.toHaveBeenCalled();

          expect(
            await pathExists(
              fixture.plan.outputPath,
            ),
          ).toBe(
            false,
          );

          if (!temporaryPath) {
            throw new Error(
              "Test did not capture the partial temporary path.",
            );
          }

          expect(
            await pathExists(
              temporaryPath,
            ),
          ).toBe(
            false,
          );
        } finally {
          await rm(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      "fails closed without running FFmpeg when the deterministic destination already exists",
      async () => {
        const fixture =
          await createFixture();

        try {
          await mkdir(
            dirname(
              fixture.plan.outputPath,
            ),
            {
              recursive:
                true,
            },
          );

          await writeFile(
            fixture.plan.outputPath,
            "existing-normalized-cache",
            {
              flag:
                "wx",
            },
          );

          const runFfmpeg =
            vi.fn();

          const probeOutput =
            vi.fn();

          await expect(
            materializeDialogueCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan:
                  fixture.plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toBeInstanceOf(
            CompositionNormalizationOutputAlreadyExistsError,
          );

          expect(
            runFfmpeg,
          ).not.toHaveBeenCalled();

          expect(
            probeOutput,
          ).not.toHaveBeenCalled();

          expect(
            await readFile(
              fixture.plan.outputPath,
              "utf8",
            ),
          ).toBe(
            "existing-normalized-cache",
          );
        } finally {
          await rm(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );

    it(
      "uses exclusive promotion so a racing destination is preserved rather than overwritten",
      async () => {
        const fixture =
          await createFixture();

        try {
          let temporaryPath:
            string | undefined;

          const runFfmpeg =
            vi.fn(
              async (
                executable:
                  string,

                args:
                  readonly string[],
              ) => {
                const outputPath =
                  args.at(
                    -1,
                  );

                if (!outputPath) {
                  throw new Error(
                    "Test FFmpeg command did not contain an output path.",
                  );
                }

                temporaryPath =
                  outputPath;

                await writeFile(
                  outputPath,
                  "rendered-dialogue-output",
                  {
                    flag:
                      "wx",
                  },
                );

                return Object.freeze({
                  executable,

                  args:
                    Object.freeze([
                      ...args,
                    ]),

                  stdout:
                    "",

                  stderr:
                    "",
                });
              },
            );

          const probeOutput =
            vi.fn(
              async (
                input:
                  CompositionSourceMediaProbeInput,
              ) => {
                await writeFile(
                  fixture.plan.outputPath,
                  "racing-existing-output",
                  {
                    flag:
                      "wx",
                  },
                );

                return createValidNormalizedMedia(
                  input.sourceVideoPath,
                );
              },
            );

          await expect(
            materializeDialogueCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan:
                  fixture.plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toBeInstanceOf(
            CompositionNormalizationOutputAlreadyExistsError,
          );

          expect(
            await readFile(
              fixture.plan.outputPath,
              "utf8",
            ),
          ).toBe(
            "racing-existing-output",
          );

          if (!temporaryPath) {
            throw new Error(
              "Test did not capture the raced temporary path.",
            );
          }

          expect(
            await pathExists(
              temporaryPath,
            ),
          ).toBe(
            false,
          );
        } finally {
          await rm(
            fixture.root,
            {
              recursive:
                true,

              force:
                true,
            },
          );
        }
      },
    );
  },
);
