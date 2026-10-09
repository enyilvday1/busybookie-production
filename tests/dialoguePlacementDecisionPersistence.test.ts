import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  basename,
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialoguePlacementDecision,
} from "../src/dialogue/createDialoguePlacementDecision.js";

import {
  DialoguePlacementDecisionSchema,
} from "../src/dialogue/dialoguePlacementDecision.schema.js";

import {
  createDialoguePlacementDecisionDirectory,
  createDialoguePlacementDecisionPath,
} from "../src/dialogue/dialoguePlacementDecisionPath.js";

import {
  readLatestDialoguePlacementDecision,
} from "../src/dialogue/readDialoguePlacementDecision.js";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  VerifiedShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";

const roots:
  string[] =
    [];

async function createMediaRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-dialogue-placement-",
      ),
    );

  roots.push(
    root,
  );

  return root;
}

afterEach(
  async () => {
    await Promise.all(
      roots.splice(
        0,
      ).map(
        (
          root,
        ) =>
          rm(
            root,
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

const PLAN_KEY =
  "a".repeat(
    64,
  );

const LINE_ONE_SHA =
  "b".repeat(
    64,
  );

const LINE_TWO_SHA =
  "c".repeat(
    64,
  );

function dialoguePlan(): ShotDialoguePlan {
  return Object.freeze({
    schemaVersion:
      "1.0",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    shotDurationSeconds:
      6,

    videoGeneration:
      Object.freeze({
        provider:
          "VEO",

        nativeAudio:
          true,
      }),

    lines:
      Object.freeze([
        Object.freeze({
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",
        }),

        Object.freeze({
          lineNumber:
            2,

          dialogueLineId:
            "EP02_SC01_S02_L02",
        }),
      ]),

    planKey:
      PLAN_KEY,
  }) as unknown as
    ShotDialoguePlan;
}

function timing(
  planKey:
    string =
      PLAN_KEY,
): VerifiedShotDialogueTiming {
  return Object.freeze({
    schemaVersion:
      "1.0",

    timingMode:
      "AGGREGATE_ONLY",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    planKey,

    shotDurationSeconds:
      6,

    durationToleranceSeconds:
      0.000001,

    totalSpeechDurationSeconds:
      3.75,

    remainingDurationSeconds:
      2.25,

    lines:
      Object.freeze([
        Object.freeze({
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",

          sourceAudioPath:
            "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/line1.audio",

          sourceBytes:
            1001,

          sourceSha256:
            LINE_ONE_SHA,

          durationSeconds:
            1.5,
        }),

        Object.freeze({
          lineNumber:
            2,

          dialogueLineId:
            "EP02_SC01_S02_L02",

          sourceAudioPath:
            "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio",

          sourceBytes:
            1002,

          sourceSha256:
            LINE_TWO_SHA,

          durationSeconds:
            2.25,
        }),
      ]),
  }) as
    VerifiedShotDialogueTiming;
}

function placements(
  firstStart:
    number =
      0.5,

  secondStart:
    number =
      2.5,
) {
  return [
    {
      dialogueLineId:
        "EP02_SC01_S02_L01",

      startSeconds:
        firstStart,
    },

    {
      dialogueLineId:
        "EP02_SC01_S02_L02",

      startSeconds:
        secondStart,
    },
  ] as const;
}

describe(
  "Busybookie dialogue placement decision persistence",
  () => {
    it(
      "creates revision one using only human placement plus canonical plan and verified audio bindings",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const result =
          await createDialoguePlacementDecision(
            mediaRoot,
            {
              dialoguePlan:
                dialoguePlan(),

              timing:
                timing(),

              placements:
                placements(),
            },
            {
              now:
                () =>
                  "2026-10-09T20:00:00.000Z",
            },
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          revision:
            1,

          recordedAt:
            "2026-10-09T20:00:00.000Z",

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialoguePlanKey:
            PLAN_KEY,

          placements: [
            {
              dialogueLineId:
                "EP02_SC01_S02_L01",

              sourceSha256:
                LINE_ONE_SHA,

              startSeconds:
                0.5,
            },

            {
              dialogueLineId:
                "EP02_SC01_S02_L02",

              sourceSha256:
                LINE_TWO_SHA,

              startSeconds:
                2.5,
            },
          ],
        });

        expect(
          result.decisionPath,
        ).toBe(
          createDialoguePlacementDecisionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            1,
          ),
        );

        const persisted =
          DialoguePlacementDecisionSchema
            .parse(
              JSON.parse(
                await readFile(
                  result.decisionPath,
                  "utf8",
                ),
              ),
            );

        expect(
          persisted,
        ).toEqual(
          result.record,
        );

        for (
          const placement
          of persisted.placements
        ) {
          expect(
            placement,
          ).not.toHaveProperty(
            "sourceAudioPath",
          );

          expect(
            placement,
          ).not.toHaveProperty(
            "sourceBytes",
          );

          expect(
            placement,
          ).not.toHaveProperty(
            "durationSeconds",
          );

          expect(
            placement,
          ).not.toHaveProperty(
            "endSeconds",
          );
        }
      },
    );

    it(
      "creates an append-only second revision without overwriting revision one",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const first =
          await createDialoguePlacementDecision(
            mediaRoot,
            {
              dialoguePlan:
                dialoguePlan(),

              timing:
                timing(),

              placements:
                placements(),
            },
            {
              now:
                () =>
                  "2026-10-09T20:00:00.000Z",
            },
          );

        const firstBytes =
          await readFile(
            first.decisionPath,
            "utf8",
          );

        const second =
          await createDialoguePlacementDecision(
            mediaRoot,
            {
              dialoguePlan:
                dialoguePlan(),

              timing:
                timing(),

              placements:
                placements(
                  0.75,
                  2.75,
                ),
            },
            {
              now:
                () =>
                  "2026-10-09T20:05:00.000Z",
            },
          );

        expect(
          second.record.revision,
        ).toBe(
          2,
        );

        expect(
          second.record
            .placements[0]
            ?.startSeconds,
        ).toBe(
          0.75,
        );

        expect(
          await readFile(
            first.decisionPath,
            "utf8",
          ),
        ).toBe(
          firstBytes,
        );

        const latest =
          await readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          );

        expect(
          latest,
        ).toEqual(
          second.record,
        );
      },
    );

    it(
      "allows exactly one durable winner when concurrent writers target the same revision",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const forcedEmptyLatest =
          async () =>
            null;

        const attempts =
          await Promise.allSettled([
            createDialoguePlacementDecision(
              mediaRoot,
              {
                dialoguePlan:
                  dialoguePlan(),

                timing:
                  timing(),

                placements:
                  placements(),
              },
              {
                now:
                  () =>
                    "2026-10-09T20:00:00.000Z",

                readLatest:
                  forcedEmptyLatest,
              },
            ),

            createDialoguePlacementDecision(
              mediaRoot,
              {
                dialoguePlan:
                  dialoguePlan(),

                timing:
                  timing(),

                placements:
                  placements(
                    0.75,
                    2.75,
                  ),
              },
              {
                now:
                  () =>
                    "2026-10-09T20:00:01.000Z",

                readLatest:
                  forcedEmptyLatest,
              },
            ),
          ]);

        const fulfilled =
          attempts.filter(
            (
              attempt,
            ) =>
              attempt.status ===
              "fulfilled",
          );

        const rejected =
          attempts.filter(
            (
              attempt,
            ) =>
              attempt.status ===
              "rejected",
          );

        expect(
          fulfilled,
        ).toHaveLength(
          1,
        );

        expect(
          rejected,
        ).toHaveLength(
          1,
        );

        const rejection =
          rejected[0];

        if (
          !rejection ||
          rejection.status !==
            "rejected"
        ) {
          throw new Error(
            "Expected exactly one rejected concurrent placement writer.",
          );
        }

        expect(
          String(
            rejection.reason,
          ),
        ).toMatch(
          /revision already exists/i,
        );

        const latest =
          await readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          );

        expect(
          latest?.revision,
        ).toBe(
          1,
        );
      },
    );

    it(
      "ignores only canonical in-progress temporary decision files",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const directory =
          createDialoguePlacementDecisionDirectory(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          );

        await mkdir(
          directory,
          {
            recursive:
              true,
          },
        );

        const canonicalRevisionPath =
          createDialoguePlacementDecisionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            1,
          );

        const canonicalTemporaryName =
          `${basename(
            canonicalRevisionPath,
          )}.part-1234-123e4567-e89b-42d3-a456-426614174000`;

        await writeFile(
          join(
            directory,
            canonicalTemporaryName,
          ),
          "in-progress temporary bytes",
          "utf8",
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).resolves.toBeNull();

        await writeFile(
          join(
            directory,
            "unexpected.part-not-a-busybookie-temp",
          ),
          "{}\n",
          "utf8",
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).rejects.toThrow(
          /unexpected file/i,
        );
      },
    );

    it(
      "returns null when no placement decision exists",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "rejects invalid editorial overlap before durable state is written",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        await expect(
          createDialoguePlacementDecision(
            mediaRoot,
            {
              dialoguePlan:
                dialoguePlan(),

              timing:
                timing(),

              placements:
                placements(
                  0.5,
                  1.9,
                ),
            },
          ),
        ).rejects.toThrow(
          /overlap/i,
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "rejects timing bound to a different dialogue plan before writing",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        await expect(
          createDialoguePlacementDecision(
            mediaRoot,
            {
              dialoguePlan:
                dialoguePlan(),

              timing:
                timing(
                  "d".repeat(
                    64,
                  ),
                ),

              placements:
                placements(),
            },
          ),
        ).rejects.toThrow(
          /planKey|plan key/i,
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "rejects placements supplied outside canonical dialogue order",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        await expect(
          createDialoguePlacementDecision(
            mediaRoot,
            {
              dialoguePlan:
                dialoguePlan(),

              timing:
                timing(),

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    2.5,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0.5,
                },
              ],
            },
          ),
        ).rejects.toThrow(
          /order|identity|line/i,
        );
      },
    );

    it(
      "fails closed when the durable revision sequence has a gap",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const directory =
          createDialoguePlacementDecisionDirectory(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          );

        await mkdir(
          directory,
          {
            recursive:
              true,
          },
        );

        const baseRecord = {
          schemaVersion:
            "1.0" as const,

          recordedAt:
            "2026-10-09T20:00:00.000Z",

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialoguePlanKey:
            PLAN_KEY,

          placements: [
            {
              dialogueLineId:
                "EP02_SC01_S02_L01",

              sourceSha256:
                LINE_ONE_SHA,

              startSeconds:
                0.5,
            },

            {
              dialogueLineId:
                "EP02_SC01_S02_L02",

              sourceSha256:
                LINE_TWO_SHA,

              startSeconds:
                2.5,
            },
          ],
        };

        await writeFile(
          createDialoguePlacementDecisionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            1,
          ),
          `${JSON.stringify({
            ...baseRecord,
            revision:
              1,
          })}\n`,
          "utf8",
        );

        await writeFile(
          createDialoguePlacementDecisionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            3,
          ),
          `${JSON.stringify({
            ...baseRecord,
            revision:
              3,
          })}\n`,
          "utf8",
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).rejects.toThrow(
          /contiguous|revision.*2/i,
        );
      },
    );

    it(
      "fails closed on malformed durable JSON",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const decisionPath =
          createDialoguePlacementDecisionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            1,
          );

        await mkdir(
          createDialoguePlacementDecisionDirectory(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          decisionPath,
          "{not-json}\n",
          "utf8",
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).rejects.toThrow(
          /malformed JSON/i,
        );
      },
    );

    it(
      "fails closed when record identity does not match its deterministic path",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const decisionPath =
          createDialoguePlacementDecisionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            1,
          );

        await mkdir(
          createDialoguePlacementDecisionDirectory(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
          {
            recursive:
              true,
          },
        );

        const record =
          DialoguePlacementDecisionSchema
            .parse({
              schemaVersion:
                "1.0",

              revision:
                1,

              recordedAt:
                "2026-10-09T20:00:00.000Z",

              episodeId:
                "EP03",

              sceneId:
                "SC01",

              shotId:
                "S02",

              dialoguePlanKey:
                PLAN_KEY,

              placements: [
                {
                  dialogueLineId:
                    "EP03_SC01_S02_L01",

                  sourceSha256:
                    LINE_ONE_SHA,

                  startSeconds:
                    0.5,
                },
              ],
            });

        await writeFile(
          decisionPath,
          `${JSON.stringify(
            record,
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).rejects.toThrow(
          /identity.*deterministic path/i,
        );
      },
    );

    it(
      "fails closed on unexpected files in the dedicated revision directory",
      async () => {
        const mediaRoot =
          await createMediaRoot();

        const directory =
          createDialoguePlacementDecisionDirectory(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          );

        await mkdir(
          directory,
          {
            recursive:
              true,
          },
        );

        await writeFile(
          join(
            directory,
            "unexpected.json",
          ),
          "{}\n",
          "utf8",
        );

        await expect(
          readLatestDialoguePlacementDecision(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
          ),
        ).rejects.toThrow(
          /unexpected file/i,
        );
      },
    );
  },
);
