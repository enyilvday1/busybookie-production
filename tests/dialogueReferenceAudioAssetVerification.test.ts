import {
  createHash,
} from "node:crypto";

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  CharacterVoiceSchema,
  type RunwayReferenceAudioAsset,
} from "../src/schemas/character.schema.js";

import type {
  probeDialogueAudio,
} from "../src/dialogue/probeDialogueAudio.js";

import {
  verifyRunwayReferenceAudioAsset,
} from "../src/dialogue/verifyRunwayReferenceAudioAsset.js";

const temporaryDirectories:
  string[] = [];

const CANONICAL_REFERENCE_PATH =
  "references/voices/OLLIE/ollie-reference-v1.mp3";

const EXPECTED_DURATION_SECONDS =
  14.4;

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-reference-audio-verification-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
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

function createReferenceAsset(
  overrides:
    Partial<RunwayReferenceAudioAsset> =
      {},
): RunwayReferenceAudioAsset {
  const asset:
    RunwayReferenceAudioAsset =
    {
      assetId:
        "OLLIE_VOICE_REFERENCE_V1",

      mediaRootRelativePath:
        CANONICAL_REFERENCE_PATH,

      bytes:
        1,

      sha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",

      contentType:
        "audio/mpeg",

      durationSeconds:
        EXPECTED_DURATION_SECONDS,

      codecName:
        "mp3",

      sampleRateHz:
        44_100,

      channels:
        1,

      ...overrides,
    };

  return asset;
}

async function createReferenceFixture() {
  const mediaRoot =
    await makeTempDirectory();

  const absolutePath =
    resolve(
      mediaRoot,
      ...CANONICAL_REFERENCE_PATH
        .split(
          "/",
        ),
    );

  await mkdir(
    dirname(
      absolutePath,
    ),
    {
      recursive:
        true,
    },
  );

  const payload =
    Buffer.from(
      "busybookie-approved-ollie-reference-audio",
      "utf8",
    );

  await writeFile(
    absolutePath,
    payload,
  );

  const referenceAudio =
    createReferenceAsset({
      bytes:
        payload.length,

      sha256:
        sha256(
          payload,
        ),
    });

  return {
    mediaRoot,
    absolutePath,
    payload,
    referenceAudio,
  };
}

type ProbeInput =
  Parameters<
    typeof probeDialogueAudio
  >[0];

type ProbeResult =
  Awaited<
    ReturnType<
      typeof probeDialogueAudio
    >
  >;

function createProbeAudio(
  overrides:
    Readonly<{
      durationSeconds?:
        number;

      codecName?:
        string;

      sampleRateHz?:
        number;

      channels?:
        number;
    }> =
      {},
) {
  return vi.fn(
    async (
      input:
        ProbeInput,
    ): Promise<ProbeResult> =>
      Object.freeze({
        sourceAudioPath:
          input.sourceAudioPath,

        formatName:
          "mp3",

        durationSeconds:
          overrides
            .durationSeconds ??
          EXPECTED_DURATION_SECONDS,

        audio:
          Object.freeze({
            codecName:
              overrides
                .codecName ??
              "mp3",

            profile:
              null,

            sampleRateHz:
              overrides
                .sampleRateHz ??
              44_100,

            channels:
              overrides
                .channels ??
              1,

            channelLayout:
              "mono",
          }),
      }),
  );
}

describe(
  "Busybookie Runway reference-audio asset verification",
  () => {
    it(
      "requires reference-audio configuration to use the canonical references/voices root",
      () => {
        const candidate =
          {
            selectionStatus:
              "LOCKED",

            provider:
              "RUNWAY",

            voiceName:
              "Ollie",

            deliveryTraits: [
              "young",
              "warm",
              "natural",
            ],

            executionMode:
              "RUNWAY_REFERENCE_AUDIO",

            referenceAudio:
              createReferenceAsset({
                mediaRootRelativePath:
                  "voice-references/OLLIE/ollie-reference-v1.mp3",
              }),
          };

        expect(
          () =>
            CharacterVoiceSchema
              .parse(
                candidate,
              ),
        ).toThrow(
          /references\/voices|reference audio path/i,
        );
      },
    );

    it(
      "returns frozen verified identity for the exact canonical local reference asset",
      async () => {
        const fixture =
          await createReferenceFixture();

        const probeAudio =
          createProbeAudio();

        const result =
          await verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio,
            },
          );

        expect(
          result,
        ).toEqual({
          ...fixture.referenceAudio,

          absolutePath:
            fixture.absolutePath,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );

        expect(
          probeAudio,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "rejects a relative Busybookie media root",
      async () => {
        const referenceAudio =
          createReferenceAsset({
            bytes:
              1,
          });

        await expect(
          verifyRunwayReferenceAudioAsset({
            mediaRoot:
              "relative/media-root",

            referenceAudio,

            ffprobeExecutable:
              "ffprobe",
          }),
        ).rejects.toThrow(
          /media root.*absolute|absolute.*media root/i,
        );
      },
    );

    it(
      "rejects a configured reference path outside references/voices",
      async () => {
        const fixture =
          await createReferenceFixture();

        await expect(
          verifyRunwayReferenceAudioAsset({
            mediaRoot:
              fixture.mediaRoot,

            referenceAudio:
              {
                ...fixture.referenceAudio,

                mediaRootRelativePath:
                  "references/images/not-a-voice.mp3",
              },

            ffprobeExecutable:
              "ffprobe",
          }),
        ).rejects.toThrow(
          /references\/voices|reference audio path/i,
        );
      },
    );

    it(
      "rejects physical realpath escape outside the trusted references/voices root before probing",
      async () => {
        const fixture =
          await createReferenceFixture();

        const trustedVoiceRoot =
          resolve(
            fixture.mediaRoot,
            "references",
            "voices",
          );

        const escapedRealPath =
          resolve(
            fixture.mediaRoot,
            "..",
            "escaped-reference",
            "ollie-reference-v1.mp3",
          );

        const probeAudio =
          createProbeAudio();

        const realpath =
          vi.fn(
            async (
              candidate:
                string,
            ) => {
              const normalized =
                resolve(
                  candidate,
                );

              if (
                normalized ===
                resolve(
                  fixture.absolutePath,
                )
              ) {
                return escapedRealPath;
              }

              if (
                normalized ===
                resolve(
                  trustedVoiceRoot,
                )
              ) {
                return trustedVoiceRoot;
              }

              return normalized;
            },
          );

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio,
              realpath,
            },
          ),
        ).rejects.toThrow(
          /outside.*references\/voices|references\/voices.*outside|physical.*contain/i,
        );

        expect(
          probeAudio,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a physical references root that collapses onto the media root",
      async () => {
        const fixture =
          await createReferenceFixture();

        const physicalMediaRoot =
          resolve(
            fixture.mediaRoot,
          );

        const trustedVoiceRoot =
          resolve(
            fixture.mediaRoot,
            "references",
            "voices",
          );

        const probeAudio =
          createProbeAudio();

        const realpath =
          vi.fn(
            async (
              candidate:
                string,
            ) => {
              const normalized =
                resolve(
                  candidate,
                );

              if (
                normalized ===
                resolve(
                  fixture.mediaRoot,
                  "references",
                )
              ) {
                return physicalMediaRoot;
              }

              if (
                normalized ===
                resolve(
                  trustedVoiceRoot,
                )
              ) {
                return resolve(
                  physicalMediaRoot,
                  "voices",
                );
              }

              if (
                normalized ===
                resolve(
                  fixture.absolutePath,
                )
              ) {
                return resolve(
                  physicalMediaRoot,
                  "voices",
                  "OLLIE",
                  "ollie-reference-v1.mp3",
                );
              }

              return normalized;
            },
          );

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio,
              realpath,
            },
          ),
        ).rejects.toThrow(
          /references root.*outside|physical references root|trust.*boundary/i,
        );

        expect(
          probeAudio,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a physical references/voices root that collapses onto the references root",
      async () => {
        const fixture =
          await createReferenceFixture();

        const physicalMediaRoot =
          resolve(
            fixture.mediaRoot,
          );

        const physicalReferenceRoot =
          resolve(
            fixture.mediaRoot,
            "references",
          );

        const probeAudio =
          createProbeAudio();

        const realpath =
          vi.fn(
            async (
              candidate:
                string,
            ) => {
              const normalized =
                resolve(
                  candidate,
                );

              if (
                normalized ===
                resolve(
                  fixture.mediaRoot,
                  "references",
                  "voices",
                )
              ) {
                return physicalReferenceRoot;
              }

              if (
                normalized ===
                resolve(
                  fixture.absolutePath,
                )
              ) {
                return resolve(
                  physicalReferenceRoot,
                  "OLLIE",
                  "ollie-reference-v1.mp3",
                );
              }

              if (
                normalized ===
                resolve(
                  fixture.mediaRoot,
                )
              ) {
                return physicalMediaRoot;
              }

              if (
                normalized ===
                resolve(
                  fixture.mediaRoot,
                  "references",
                )
              ) {
                return physicalReferenceRoot;
              }

              return normalized;
            },
          );

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio,
              realpath,
            },
          ),
        ).rejects.toThrow(
          /references\/voices root.*outside|physical references\/voices root|trust.*boundary/i,
        );

        expect(
          probeAudio,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires the canonical target to resolve to a regular file",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const absolutePath =
          resolve(
            mediaRoot,
            ...CANONICAL_REFERENCE_PATH
              .split(
                "/",
              ),
          );

        await mkdir(
          absolutePath,
          {
            recursive:
              true,
          },
        );

        await expect(
          verifyRunwayReferenceAudioAsset({
            mediaRoot,

            referenceAudio:
              createReferenceAsset({
                bytes:
                  1,
              }),

            ffprobeExecutable:
              "ffprobe",
          }),
        ).rejects.toThrow(
          /not a file|regular file/i,
        );
      },
    );

    it(
      "fails closed on exact byte-count mismatch before ffprobe",
      async () => {
        const fixture =
          await createReferenceFixture();

        const probeAudio =
          createProbeAudio();

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                {
                  ...fixture.referenceAudio,

                  bytes:
                    fixture.referenceAudio
                      .bytes +
                    1,
                },

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio,
            },
          ),
        ).rejects.toThrow(
          /byte.*mismatch|bytes.*match|expected.*bytes/i,
        );

        expect(
          probeAudio,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed on SHA-256 mismatch before ffprobe",
      async () => {
        const fixture =
          await createReferenceFixture();

        const probeAudio =
          createProbeAudio();

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                {
                  ...fixture.referenceAudio,

                  sha256:
                    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                },

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio,
            },
          ),
        ).rejects.toThrow(
          /sha-?256.*mismatch|sha-?256.*match/i,
        );

        expect(
          probeAudio,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when the probed codec does not match the immutable reference identity",
      async () => {
        const fixture =
          await createReferenceFixture();

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio:
                createProbeAudio({
                  codecName:
                    "aac",
                }),
            },
          ),
        ).rejects.toThrow(
          /codec.*mismatch|codec.*match/i,
        );
      },
    );

    it(
      "fails closed when the probed sample rate does not match the immutable reference identity",
      async () => {
        const fixture =
          await createReferenceFixture();

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio:
                createProbeAudio({
                  sampleRateHz:
                    48_000,
                }),
            },
          ),
        ).rejects.toThrow(
          /sample rate.*mismatch|sample rate.*match/i,
        );
      },
    );

    it(
      "fails closed when the probed channel count does not match the immutable reference identity",
      async () => {
        const fixture =
          await createReferenceFixture();

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio:
                createProbeAudio({
                  channels:
                    2,
                }),
            },
          ),
        ).rejects.toThrow(
          /channel.*mismatch|channel.*match/i,
        );
      },
    );

    it(
      "admits a small ffprobe duration variance within an explicit 50 ms tolerance",
      async () => {
        const fixture =
          await createReferenceFixture();

        const result =
          await verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio:
                createProbeAudio({
                  durationSeconds:
                    14.44,
                }),
            },
          );

        expect(
          result.durationSeconds,
        ).toBe(
          EXPECTED_DURATION_SECONDS,
        );
      },
    );

    it(
      "fails closed when ffprobe duration exceeds the explicit 50 ms tolerance",
      async () => {
        const fixture =
          await createReferenceFixture();

        await expect(
          verifyRunwayReferenceAudioAsset(
            {
              mediaRoot:
                fixture.mediaRoot,

              referenceAudio:
                fixture.referenceAudio,

              ffprobeExecutable:
                "ffprobe",
            },
            {
              probeAudio:
                createProbeAudio({
                  durationSeconds:
                    14.46,
                }),
            },
          ),
        ).rejects.toThrow(
          /duration.*mismatch|duration.*tolerance|duration.*match/i,
        );
      },
    );
  },
);
