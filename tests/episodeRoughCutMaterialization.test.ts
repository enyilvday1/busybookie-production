import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  materializeEpisodeRoughCut,
  EpisodeRoughCutOutputAlreadyExistsError,
} from "../src/composition/materializeEpisodeRoughCut.js";

import type {
  EpisodeRoughCutRenderPlan,
  EpisodeRoughCutRenderPlanShot,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  CompositionSourceMediaMetadata,
  CompositionSourceMediaProbeInput,
} from "../src/composition/probeCompositionSourceMedia.js";

let testRoot =
  "";

beforeEach(
  async () => {
    testRoot =
      await mkdtemp(
        join(
          tmpdir(),
          "busybookie-rough-cut-",
        ),
      );
  },
);

afterEach(
  async () => {
    await rm(
      testRoot,
      {
        recursive:
          true,

        force:
          true,
      },
    );
  },
);

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

async function createPlan():
  Promise<EpisodeRoughCutRenderPlan> {
  const source1 =
    Buffer.from(
      "normalized-shot-one",
      "utf8",
    );

  const source2 =
    Buffer.from(
      "normalized-shot-two",
      "utf8",
    );

  const sourcePath1 =
    join(
      testRoot,
      "S01.mp4",
    );

  const sourcePath2 =
    join(
      testRoot,
      "S02.mp4",
    );

  await writeFile(
    sourcePath1,
    source1,
  );

  await writeFile(
    sourcePath2,
    source2,
  );

  const makeShot =
    (
      input:
        Readonly<{
          shotId:
            "S01" | "S02";

          order:
            1 | 2;

          path:
            string;

          bytes:
            Buffer;
        }>,
    ): EpisodeRoughCutRenderPlanShot =>
      Object.freeze({
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

        sourceVideoPath:
          input.path,

        sourceBytes:
          input.bytes.length,

        sourceSha256:
          sha256(
            input.bytes,
          ),
      });

  const renderKey =
    "e".repeat(
      64,
    );

  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-episode-rough-cut-v1",

    assemblyMode:
      "STRAIGHT_CUT",

    episodeId:
      "EP02",

    title:
      "Materialization contract episode",

    totalShots:
      2,

    totalDurationSeconds:
      8,

    container:
      "mp4",

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

        frameRate:
          25,

        pixelFormat:
          "yuv420p",
      }),

    audio:
      Object.freeze({
        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    renderKey,

    outputPath:
      join(
        testRoot,
        "exports",
        "EP02",
        "rough-cut",
        `EP02_rough-cut_${renderKey}.mp4`,
      ),

    shots:
      Object.freeze([
        makeShot({
          shotId:
            "S01",

          order:
            1,

          path:
            sourcePath1,

          bytes:
            source1,
        }),

        makeShot({
          shotId:
            "S02",

          order:
            2,

          path:
            sourcePath2,

          bytes:
            source2,
        }),
      ]),
  });
}

function createValidProbeResult(
  sourceVideoPath:
    string,
): CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath,

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      8,

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
  "Busybookie episode rough-cut materialization",
  () => {
    it(
      "renders to a temporary file, verifies it, hashes it, promotes it exclusively, and returns durable artifact metadata",
      async () => {
        const plan =
          await createPlan();

        const renderedBytes =
          Buffer.from(
            "verified-rough-cut-output",
            "utf8",
          );

        let temporaryPath =
          "";

        const runFfmpeg =
          vi.fn(
            async (
              executable:
                string,

              args:
                readonly string[],
            ) => {
              temporaryPath =
                args[
                  args.length -
                  1
                ]!;

              await writeFile(
                temporaryPath,
                renderedBytes,
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
              createValidProbeResult(
                input.sourceVideoPath,
              ),
          );

        const result =
          await materializeEpisodeRoughCut(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

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
        ).toHaveBeenCalledWith({
          ffprobeExecutable:
            "C:/Tools/ffprobe.exe",

          sourceVideoPath:
            temporaryPath,

          nativeAudio:
            true,
        });

        expect(
          temporaryPath,
        ).toMatch(
          /\.part-\d+-[0-9a-f-]+$/i,
        );

        expect(
          await readFile(
            plan.outputPath,
          ),
        ).toEqual(
          renderedBytes,
        );

        await expect(
          readFile(
            temporaryPath,
          ),
        ).rejects.toMatchObject({
          code:
            "ENOENT",
        });

        expect(
          result,
        ).toEqual({
          outputPath:
            plan.outputPath,

          bytes:
            renderedBytes.length,

          sha256:
            sha256(
              renderedBytes,
            ),

          contentType:
            "video/mp4",

          durationSeconds:
            8,

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
      },
    );

    it(
      "fails before FFmpeg when a normalized source SHA-256 no longer matches the render plan",
      async () => {
        const plan =
          await createPlan();

        await writeFile(
          plan.shots[0]!
            .sourceVideoPath,
          Buffer.from(
            "tampered-source",
            "utf8",
          ),
        );

        const runFfmpeg =
          vi.fn();

        await expect(
          materializeEpisodeRoughCut(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              runFfmpeg,

              probeOutput:
                vi.fn(),
            },
          ),
        ).rejects.toThrow(
          /source.*sha-256.*does not match/i,
        );

        expect(
          runFfmpeg,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed without invoking FFmpeg when the destination already exists",
      async () => {
        const plan =
          await createPlan();

        await writeFile(
          plan.outputPath,
          Buffer.from(
            "existing-destination",
            "utf8",
          ),
        ).catch(
          async (
            error,
          ) => {
            if (
              (
                error as
                  NodeJS.ErrnoException
              ).code !==
              "ENOENT"
            ) {
              throw error;
            }

            const {
              mkdir,
            } =
              await import(
                "node:fs/promises"
              );

            const {
              dirname,
            } =
              await import(
                "node:path"
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
              Buffer.from(
                "existing-destination",
                "utf8",
              ),
            );
          },
        );

        const runFfmpeg =
          vi.fn();

        await expect(
          materializeEpisodeRoughCut(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              runFfmpeg,

              probeOutput:
                vi.fn(),
            },
          ),
        ).rejects.toBeInstanceOf(
          EpisodeRoughCutOutputAlreadyExistsError,
        );

        expect(
          runFfmpeg,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "removes the temporary file and leaves no final output when verification fails",
      async () => {
        const plan =
          await createPlan();

        let temporaryPath =
          "";

        const runFfmpeg =
          vi.fn(
            async (
              executable:
                string,

              args:
                readonly string[],
            ) => {
              temporaryPath =
                args[
                  args.length -
                  1
                ]!;

              await writeFile(
                temporaryPath,
                Buffer.from(
                  "invalid-render",
                  "utf8",
                ),
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
                ...createValidProbeResult(
                  input.sourceVideoPath,
                ),

                video:
                  Object.freeze({
                    ...createValidProbeResult(
                      input.sourceVideoPath,
                    ).video,

                    frameRate:
                      24,
                  }),
              }),
          );

        await expect(
          materializeEpisodeRoughCut(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              runFfmpeg,

              probeOutput,
            },
          ),
        ).rejects.toThrow(
          /frame rate/i,
        );

        await expect(
          readFile(
            temporaryPath,
          ),
        ).rejects.toMatchObject({
          code:
            "ENOENT",
        });

        await expect(
          readFile(
            plan.outputPath,
          ),
        ).rejects.toMatchObject({
          code:
            "ENOENT",
        });
      },
    );
  },
);
