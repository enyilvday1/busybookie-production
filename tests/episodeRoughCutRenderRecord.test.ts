import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
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
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  EpisodeRoughCutRenderRecordSchema,
  type EpisodeRoughCutRenderRecord,
} from "../src/composition/episodeRoughCutRenderRecord.schema.js";

import {
  createEpisodeRoughCutRenderRecordPath,
} from "../src/composition/episodeRoughCutRenderRecordPath.js";

import {
  readEpisodeRoughCutRenderRecord,
} from "../src/composition/readEpisodeRoughCutRenderRecord.js";

import {
  writeEpisodeRoughCutRenderRecord,
} from "../src/composition/writeEpisodeRoughCutRenderRecord.js";

const temporaryDirectories:
  string[] =
    [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-rough-cut-record-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

function createRecord(
  outputPath:
    string,

  sourceVideoPath:
    string,
): EpisodeRoughCutRenderRecord {
  const renderKey =
    "e".repeat(
      64,
    );

  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-01T00:45:00.000Z",

    status:
      "RENDERED",

    plan: {
      schemaVersion:
        "1.0",

      profileId:
        "busybookie-episode-rough-cut-v1",

      assemblyMode:
        "STRAIGHT_CUT",

      episodeId:
        "EP02",

      title:
        "Durable rough-cut contract",

      totalShots:
        1,

      totalDurationSeconds:
        4,

      container:
        "mp4",

      video: {
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
      },

      audio: {
        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      },

      renderKey,

      outputPath,

      shots: [
        {
          sceneId:
            "SC01",

          shotId:
            "S01",

          order:
            1,

          title:
            "Shot S01",

          durationSeconds:
            4,

          sourceVideoPath,

          sourceBytes:
            123_456,

          sourceSha256:
            "c".repeat(
              64,
            ),
        },
      ],
    },

    artifact: {
      outputPath,

      bytes:
        654_321,

      sha256:
        "d".repeat(
          64,
        ),

      contentType:
        "video/mp4",

      durationSeconds:
        4,

      durationToleranceSeconds:
        1 / 25,
    },
  };
}

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(
          0,
        )
        .map(
          (
            directory,
          ) =>
            rm(
              directory,
              {
                recursive:
                  true,

                force:
                  true,
              },
            ),
        ),
    );
  },
);

describe(
  "Busybookie episode rough-cut render record schema",
  () => {
    it(
      "accepts a complete durable rough-cut record",
      () => {
        const outputPath =
          "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4";

        const parsed =
          EpisodeRoughCutRenderRecordSchema.parse(
            createRecord(
              outputPath,
              "D:/Busybookie/Production/cache/composition-normalized/EP02/S01/source.mp4",
            ),
          );

        expect(
          parsed.status,
        ).toBe(
          "RENDERED",
        );

        expect(
          parsed.plan.renderKey,
        ).toBe(
          "e".repeat(
            64,
          ),
        );

        expect(
          parsed.artifact.sha256,
        ).toBe(
          "d".repeat(
            64,
          ),
        );
      },
    );

    it(
      "fails closed when unknown durable fields are present",
      () => {
        const outputPath =
          "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4";

        expect(
          () =>
            EpisodeRoughCutRenderRecordSchema.parse({
              ...createRecord(
                outputPath,
                "D:/Busybookie/Production/cache/composition-normalized/EP02/S01/source.mp4",
              ),

              unexpected:
                true,
            }),
        ).toThrow();
      },
    );

    it(
      "fails closed when artifact output identity differs from the render plan",
      () => {
        const outputPath =
          "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4";

        const record =
          createRecord(
            outputPath,
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S01/source.mp4",
          );

        expect(
          () =>
            EpisodeRoughCutRenderRecordSchema.parse({
              ...record,

              artifact: {
                ...record.artifact,

                outputPath:
                  "D:/Busybookie/Production/exports/EP02/rough-cut/different.mp4",
              },
            }),
        ).toThrow(
          /artifact.*output.*plan|plan.*output.*artifact/i,
        );
      },
    );
  },
);

describe(
  "Busybookie episode rough-cut render record path",
  () => {
    it(
      "derives the durable sidecar from a canonical Windows rough-cut MP4",
      () => {
        const renderKey =
          "a".repeat(
            64,
          );

        const outputPath =
          `D:/Busybookie/Production/exports/EP02/rough-cut/EP02_rough-cut_${renderKey}.mp4`;

        expect(
          createEpisodeRoughCutRenderRecordPath(
            outputPath,
          ),
        ).toBe(
          `D:/Busybookie/Production/exports/EP02/rough-cut/EP02_rough-cut_${renderKey}.composition-rough-cut.json`,
        );
      },
    );

    it(
      "fails closed for a non-MP4 rough-cut path",
      () => {
        expect(
          () =>
            createEpisodeRoughCutRenderRecordPath(
              "D:/Busybookie/Production/exports/EP02/rough-cut/output.mov",
            ),
        ).toThrow(
          /rough-cut.*mp4|mp4.*rough-cut/i,
        );
      },
    );
  },
);

describe(
  "Busybookie episode rough-cut durable record IO",
  () => {
    it(
      "returns null when no durable record exists",
      async () => {
        const root =
          await makeTempDirectory();

        const outputPath =
          join(
            root,
            "exports",
            "EP02",
            "rough-cut",
            "output.mp4",
          );

        await expect(
          readEpisodeRoughCutRenderRecord(
            outputPath,
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "writes atomically and reads the exact durable rough-cut identity",
      async () => {
        const root =
          await makeTempDirectory();

        const outputPath =
          join(
            root,
            "exports",
            "EP02",
            "rough-cut",
            "output.mp4",
          );

        const sourceVideoPath =
          join(
            root,
            "cache",
            "composition-normalized",
            "EP02",
            "S01",
            "source.mp4",
          );

        const record =
          createRecord(
            outputPath,
            sourceVideoPath,
          );

        const recordPath =
          createEpisodeRoughCutRenderRecordPath(
            outputPath,
          );

        await expect(
          writeEpisodeRoughCutRenderRecord(
            record,
          ),
        ).resolves.toBe(
          recordPath,
        );

        await expect(
          readEpisodeRoughCutRenderRecord(
            outputPath,
          ),
        ).resolves.toEqual(
          record,
        );

        expect(
          JSON.parse(
            await readFile(
              recordPath,
              "utf8",
            ),
          ),
        ).toEqual(
          record,
        );
      },
    );

    it(
      "fails closed rather than overwriting an existing durable record",
      async () => {
        const root =
          await makeTempDirectory();

        const outputPath =
          join(
            root,
            "exports",
            "EP02",
            "rough-cut",
            "output.mp4",
          );

        const record =
          createRecord(
            outputPath,
            join(
              root,
              "source.mp4",
            ),
          );

        await writeEpisodeRoughCutRenderRecord(
          record,
        );

        await expect(
          writeEpisodeRoughCutRenderRecord(
            record,
          ),
        ).rejects.toThrow(
          /rough-cut.*record.*already exists/i,
        );
      },
    );

    it(
      "fails closed when the durable record is malformed JSON",
      async () => {
        const root =
          await makeTempDirectory();

        const outputPath =
          join(
            root,
            "exports",
            "EP02",
            "rough-cut",
            "output.mp4",
          );

        const recordPath =
          createEpisodeRoughCutRenderRecordPath(
            outputPath,
          );

        await mkdir(
          dirname(
            recordPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          recordPath,
          "{damaged",
          "utf8",
        );

        await expect(
          readEpisodeRoughCutRenderRecord(
            outputPath,
          ),
        ).rejects.toThrow(
          /rough-cut.*record.*not valid JSON/i,
        );
      },
    );
  },
);
