import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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

import {
  CompositionNormalizationOutputAlreadyExistsError,
  materializeCompositionShotNormalization,
} from "../src/composition/materializeCompositionShotNormalization.js";

import type {
  CompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
  CompositionSourceMediaProbeInput,
} from "../src/composition/probeCompositionSourceMedia.js";

const VALID_SOURCE_PAYLOAD =
  Buffer.from(
    "provider-source",
    "utf8",
  );

const VALID_SOURCE_SHA256 =
  createHash(
    "sha256",
  )
    .update(
      VALID_SOURCE_PAYLOAD,
    )
    .digest(
      "hex",
    );
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

async function createTestRoot():
  Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      "busybookie-composition-normalization-",
    ),
  );
}

function createPlan(
  root:
    string,
): CompositionShotNormalizationPlan {
  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-master-normalization-v1",

    episodeId:
      "EP90",

    shotId:
      "S01",

    sourceVideoPath:
      join(
        root,
        "generated-video",
        "EP90",
        "S01",
        "source.mp4",
      ),

    sourceSha256:
      VALID_SOURCE_SHA256,

    sourceDurationSeconds:
      5.041667,

    targetDurationSeconds:
      5,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      false,

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
          "SYNTHETIC_SILENCE",

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
      "b".repeat(
        64,
      ),

    outputPath:
      join(
        root,
        "cache",
        "composition-normalized",
        "EP90",
        "S01",
        "EP90_S01_cache.mp4",
      ),
  });
}

async function writeValidSource(
  plan:
    CompositionShotNormalizationPlan,
): Promise<void> {
  await mkdir(
    dirname(
      plan.sourceVideoPath,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    plan.sourceVideoPath,
    VALID_SOURCE_PAYLOAD,
    {
      flag:
        "wx",
    },
  );
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
      5,

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
  "Busybookie composition shot normalization materialization",
  () => {
    it(
      "renders to a temporary path, verifies audio-bearing normalized media, hashes it, promotes it exclusively, and cleans the temporary artifact",
      async () => {
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await writeValidSource(
            plan,
          );

          const payload =
            Buffer.from(
              "normalized-output",
              "utf8",
            );

          const expectedSha256 =
            createHash(
              "sha256",
            )
              .update(
                payload,
              )
              .digest(
                "hex",
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
                  plan.outputPath,
                );

                expect(
                  outputPath.startsWith(
                    `${plan.outputPath}.part-`,
                  ),
                ).toBe(
                  true,
                );

                await writeFile(
                  outputPath,
                  payload,
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

                /*
                 * Normalized media always has an
                 * audio stream. For source shots
                 * without native audio, FFmpeg
                 * synthesizes stereo silence.
                 */
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
            await materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
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
              plan.outputPath,

            bytes:
              payload.length,

            sha256:
              expectedSha256,

            contentType:
              "video/mp4",

            durationSeconds:
              5,

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
              plan.outputPath,
            ),
          ).toEqual(
            payload,
          );

          if (!temporaryPath) {
            throw new Error(
              "Test did not capture the temporary normalization path.",
            );
          }

          expect(
            await pathExists(
              temporaryPath,
            ),
          ).toBe(
            false,
          );

          const destinationEntries =
            await readdir(
              dirname(
                plan.outputPath,
              ),
            );

          expect(
            destinationEntries.some(
              (entry) =>
                entry.includes(
                  ".part-",
                ),
            ),
          ).toBe(
            false,
          );
        } finally {
          await rm(
            root,
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
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await writeValidSource(
            plan,
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
                  "partial",
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
            materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
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
              plan.outputPath,
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
            root,
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
      "fails verification before promotion and removes the temporary artifact",
      async () => {
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await writeValidSource(
            plan,
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
                  "invalid-normalized-output",
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
              ) =>
                Object.freeze({
                  ...createValidNormalizedMedia(
                    input.sourceVideoPath,
                  ),

                  audio:
                    null,
                }),
            );

          await expect(
            materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toThrow(
            /audio stream/i,
          );

          expect(
            await pathExists(
              plan.outputPath,
            ),
          ).toBe(
            false,
          );

          if (!temporaryPath) {
            throw new Error(
              "Test did not capture the invalid temporary path.",
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
            root,
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
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await writeValidSource(
            plan,
          );

          await mkdir(
            dirname(
              plan.outputPath,
            ),
            {
              recursive:
                true,
            },
          );

          await writeFile(
            plan.outputPath,
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
            materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
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
              plan.outputPath,
              "utf8",
            ),
          ).toBe(
            "existing-normalized-cache",
          );
        } finally {
          await rm(
            root,
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
      "uses exclusive promotion so a destination created during rendering is preserved rather than overwritten",
      async () => {
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await writeValidSource(
            plan,
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
                  "rendered-output",
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
                /*
                 * Simulate another process winning
                 * the final-path race after our
                 * initial existence check.
                 */
                await writeFile(
                  plan.outputPath,
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
            materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
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
              plan.outputPath,
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
            root,
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

describe(
  "Busybookie composition normalization source integrity",
  () => {
    it(
      "fails closed before FFmpeg when the source file SHA-256 no longer matches the normalization plan",
      async () => {
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await mkdir(
            dirname(
              plan.sourceVideoPath,
            ),
            {
              recursive:
                true,
            },
          );

          /*
           * createPlan deliberately carries a
           * different durable source SHA-256.
           * The bytes on disk therefore no longer
           * represent the source identified by
           * this normalization plan/cache key.
           */
          await writeFile(
            plan.sourceVideoPath,
            "mutated-provider-source",
            {
              flag:
                "wx",
            },
          );

          const runFfmpeg =
            vi.fn(
              async () => {
                throw new Error(
                  "FFmpeg must not run for a source-integrity mismatch.",
                );
              },
            );

          const probeOutput =
            vi.fn(
              async () => {
                throw new Error(
                  "Output probing must not run for a source-integrity mismatch.",
                );
              },
            );

          await expect(
            materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
              },
              {
                runFfmpeg,
                probeOutput,
              },
            ),
          ).rejects.toThrow(
            /source.*sha|source.*hash|source.*integrity/i,
          );

          expect(
            runFfmpeg,
          ).not.toHaveBeenCalled();

          expect(
            probeOutput,
          ).not.toHaveBeenCalled();

          expect(
            await pathExists(
              plan.outputPath,
            ),
          ).toBe(
            false,
          );
        } finally {
          await rm(
            root,
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

describe(
  "Busybookie composition normalization temporary cleanup",
  () => {
    it(
      "does not report success when temporary cleanup fails after successful promotion",
      async () => {
        const root =
          await createTestRoot();

        try {
          const plan =
            createPlan(
              root,
            );

          await writeValidSource(
            plan,
          );

          const payload =
            Buffer.from(
              "normalized-output",
              "utf8",
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
                  payload,
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
              ) =>
                createValidNormalizedMedia(
                  input.sourceVideoPath,
                ),
            );

          const removeTemporaryFile =
            vi.fn(
              async () => {
                const error =
                  new Error(
                    "synthetic temporary cleanup failure",
                  ) as
                    NodeJS.ErrnoException;

                error.code =
                  "EACCES";

                throw error;
              },
            );

          await expect(
            materializeCompositionShotNormalization(
              {
                ffmpegExecutable:
                  "D:/Tools/ffmpeg/bin/ffmpeg.exe",

                ffprobeExecutable:
                  "D:/Tools/ffmpeg/bin/ffprobe.exe",

                plan,
              },
              {
                runFfmpeg,
                probeOutput,
                removeTemporaryFile,
              },
            ),
          ).rejects.toThrow(
            /temporary.*cleanup|cleanup.*temporary/i,
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
            removeTemporaryFile,
          ).toHaveBeenCalled();

          /*
           * Promotion completed before cleanup
           * failed. The valid destination must
           * remain intact and must never be
           * rolled back or overwritten.
           */
          expect(
            await readFile(
              plan.outputPath,
            ),
          ).toEqual(
            payload,
          );

          if (!temporaryPath) {
            throw new Error(
              "Test did not capture the temporary normalization path.",
            );
          }
        } finally {
          await rm(
            root,
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
