import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DIALOGUE_COMPOSITION_STATES,
  VISUAL_GENERATION_STATES,
  isCanonicalEpisodeId,
  parseEpisodeDetail,
} from "../src/api/episodeDetailDtos";

const VISUAL_COUNTS = {
  RESERVED_ONLY_INTERVENTION_REQUIRED: 0,
  SUBMITTED_RECONCILIATION_REQUIRED: 0,
  LIFECYCLE_COMPLETED: 1,
  CANONICAL_NOT_EXECUTABLE: 0,
  VISUAL_AUTHORIZATION_REQUIRED: 0,
  REFERENCE_UNAVAILABLE: 0,
  REFERENCE_SELECTION_REQUIRED: 0,
  READY_FOR_GENERATION: 0,
};

const DIALOGUE_COUNTS = {
  NO_DIALOGUE: 1,
  DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED: 0,
  DIALOGUE_PLANNING_BLOCKED: 0,
  DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED: 0,
  DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED: 0,
  DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED: 0,
  DIALOGUE_RECONCILIATION_REQUIRED: 0,
  DIALOGUE_AUDIO_REQUIRED: 0,
  PLACEMENT_REQUIRED: 0,
  COMPOSITION_AUDIO_RESOLVED: 0,
};

const DETAIL = {
  apiVersion: "v1",
  episodeId: "EP90",
  title: "Runway Connectivity Test",
  evaluatedAt: "2026-11-18T20:00:00.000Z",

  summary: {
    totalShots: 1,

    visualGenerationStates:
      VISUAL_COUNTS,

    dialogueCompositionStates:
      DIALOGUE_COUNTS,
  },

  shots: [
    {
      order: 1,
      sceneId: "SC01",
      shotId: "S01",

      visual: {
        state: "LIFECYCLE_COMPLETED",
      },

      dialogue: {
        state: "NO_DIALOGUE",
      },
    },
  ],
};

describe(
  "canonical episode identity guard",
  () => {
    it.each([
      ["EP01", true],
      ["EP90", true],
      ["EP999", true],
      ["EP1", false],
      ["EP0000", false],
      ["ep90", false],
      ["EP90/../EP91", false],
      ["EP90?x=1", false],
      [" EP90", false],
      ["EP90 ", false],
      ["", false],
      [null, false],
      [90, false],
    ])(
      "classifies %j as %s",
      (
        value,
        expected,
      ) => {
        expect(
          isCanonicalEpisodeId(
            value,
          ),
        ).toBe(
          expected,
        );
      },
    );
  },
);

describe(
  "episode-detail guard",
  () => {
    it(
      "accepts the D1 detail contract and preserves server shot order",
      () => {
        const detail =
          parseEpisodeDetail(
            DETAIL,
          );

        expect(
          detail,
        ).not.toBeNull();

        expect(
          detail?.episodeId,
        ).toBe(
          "EP90",
        );

        expect(
          detail?.title,
        ).toBe(
          "Runway Connectivity Test",
        );

        expect(
          detail?.shots.map(
            (shot) =>
              [
                shot.order,
                shot.sceneId,
                shot.shotId,
                shot.visual.state,
                shot.dialogue.state,
              ],
          ),
        ).toEqual([
          [
            1,
            "SC01",
            "S01",
            "LIFECYCLE_COMPLETED",
            "NO_DIALOGUE",
          ],
        ]);
      },
    );

    it(
      "copies allowlisted fields only and freezes the accepted boundary",
      () => {
        const detail =
          parseEpisodeDetail({
            ...DETAIL,

            absolutePath:
              "D:/SECRET/media",

            providerCredential:
              "SECRET",

            summary: {
              ...DETAIL.summary,

              hidden:
                "SECRET",
            },

            shots: [
              {
                ...DETAIL.shots[0],

                absolutePath:
                  "D:/SECRET/output.mp4",

                visual: {
                  ...DETAIL.shots[0]!.visual,

                  lifecycle:
                    "SECRET",
                },

                dialogue: {
                  ...DETAIL.shots[0]!.dialogue,

                  planKey:
                    "SECRET",
                },
              },
            ],
          });

        expect(
          detail,
        ).not.toBeNull();

        expect(
          JSON.stringify(
            detail,
          ),
        ).not.toMatch(
          /SECRET|absolutePath|providerCredential|lifecycle|planKey|hidden/,
        );

        expect(
          Object.isFrozen(
            detail,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.summary,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.summary.visualGenerationStates,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.summary.dialogueCompositionStates,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.shots,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.shots[0],
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.shots[0]?.visual,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            detail?.shots[0]?.dialogue,
          ),
        ).toBe(
          true,
        );
      },
    );

    it.each([
      [
        "wrong API version",
        {
          ...DETAIL,
          apiVersion:
            "v2",
        },
      ],

      [
        "non-canonical episode id",
        {
          ...DETAIL,
          episodeId:
            "../EP90",
        },
      ],

      [
        "non-canonical evaluatedAt",
        {
          ...DETAIL,
          evaluatedAt:
            "2026-11-18 20:00:00",
        },
      ],

      [
        "wrong total shot count",
        {
          ...DETAIL,

          summary: {
            ...DETAIL.summary,

            totalShots:
              2,
          },
        },
      ],

      [
        "visual summary total mismatch",
        {
          ...DETAIL,

          summary: {
            ...DETAIL.summary,

            visualGenerationStates: {
              ...VISUAL_COUNTS,

              LIFECYCLE_COMPLETED:
                0,
            },
          },
        },
      ],

      [
        "dialogue summary total mismatch",
        {
          ...DETAIL,

          summary: {
            ...DETAIL.summary,

            dialogueCompositionStates: {
              ...DIALOGUE_COUNTS,

              NO_DIALOGUE:
                0,
            },
          },
        },
      ],

      [
        "unknown visual state",
        {
          ...DETAIL,

          shots: [
            {
              ...DETAIL.shots[0],

              visual: {
                state:
                  "PROVIDER_MAGIC",
              },
            },
          ],
        },
      ],

      [
        "unknown dialogue state",
        {
          ...DETAIL,

          shots: [
            {
              ...DETAIL.shots[0],

              dialogue: {
                state:
                  "AUDIO_MAGIC",
              },
            },
          ],
        },
      ],
    ])(
      "rejects %s",
      (
        _label,
        document,
      ) => {
        expect(
          parseEpisodeDetail(
            document,
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects duplicate global shot order",
      () => {
        const document = {
          ...DETAIL,

          summary: {
            totalShots:
              2,

            visualGenerationStates: {
              ...VISUAL_COUNTS,

              LIFECYCLE_COMPLETED:
                2,
            },

            dialogueCompositionStates: {
              ...DIALOGUE_COUNTS,

              NO_DIALOGUE:
                2,
            },
          },

          shots: [
            DETAIL.shots[0],

            {
              ...DETAIL.shots[0],

              sceneId:
                "SC02",

              shotId:
                "S02",

              order:
                1,
            },
          ],
        };

        expect(
          parseEpisodeDetail(
            document,
          ),
        ).toBeNull();
      },
    );

    it(
      "exports exactly the backend visual and dialogue state sets",
      () => {
        expect(
          VISUAL_GENERATION_STATES,
        ).toHaveLength(
          8,
        );

        expect(
          DIALOGUE_COMPOSITION_STATES,
        ).toHaveLength(
          10,
        );

        expect(
          VISUAL_GENERATION_STATES,
        ).toContain(
          "LIFECYCLE_COMPLETED",
        );

        expect(
          DIALOGUE_COMPOSITION_STATES,
        ).toContain(
          "NO_DIALOGUE",
        );
      },
    );
  },
);
