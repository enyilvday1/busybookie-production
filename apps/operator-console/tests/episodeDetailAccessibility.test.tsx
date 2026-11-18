import {
  act,
  render,
  screen,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import axe from "axe-core";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  App,
} from "../src/App";

const TOKEN =
  "ab".repeat(
    32,
  );

const LIST = {
  apiVersion:
    "v1",

  episodes: [
    {
      episodeId:
        "EP90",

      manifest:
        "VALID",

      title:
        "Runway Connectivity Test",

      sceneCount:
        1,

      shotCount:
        1,
    },
  ],
};

const DETAIL = {
  apiVersion:
    "v1",

  episodeId:
    "EP90",

  title:
    "Runway Connectivity Test",

  evaluatedAt:
    "2026-11-18T20:00:00.000Z",

  summary: {
    totalShots:
      1,

    visualGenerationStates: {
      RESERVED_ONLY_INTERVENTION_REQUIRED:
        0,

      SUBMITTED_RECONCILIATION_REQUIRED:
        0,

      LIFECYCLE_COMPLETED:
        1,

      CANONICAL_NOT_EXECUTABLE:
        0,

      VISUAL_AUTHORIZATION_REQUIRED:
        0,

      REFERENCE_UNAVAILABLE:
        0,

      REFERENCE_SELECTION_REQUIRED:
        0,

      READY_FOR_GENERATION:
        0,
    },

    dialogueCompositionStates: {
      NO_DIALOGUE:
        1,

      DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED:
        0,

      DIALOGUE_PLANNING_BLOCKED:
        0,

      DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED:
        0,

      DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED:
        0,

      DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED:
        0,

      DIALOGUE_RECONCILIATION_REQUIRED:
        0,

      DIALOGUE_AUDIO_REQUIRED:
        0,

      PLACEMENT_REQUIRED:
        0,

      COMPOSITION_AUDIO_RESOLVED:
        0,
    },
  },

  shots: [
    {
      order:
        1,

      sceneId:
        "SC01",

      shotId:
        "S01",

      visual: {
        state:
          "LIFECYCLE_COMPLETED",
      },

      dialogue: {
        state:
          "NO_DIALOGUE",
      },
    },
  ],
};

const LAYOUT_DEPENDENT_RULES = {
  "color-contrast": {
    enabled:
      false,
  },

  "target-size": {
    enabled:
      false,
  },
} as const;

function response(
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(
      body,
    ),
    {
      status:
        200,

      headers: {
        "Content-Type":
          "application/json",

        "X-Request-Id":
          "aed7ef66-15f4-48e7-8c37-6d28fa204f09",
      },
    },
  );
}

afterEach(
  () => {
    vi.unstubAllGlobals();
  },
);

describe(
  "Episode Detail accessibility",
  () => {
    it(
      "has no axe-core violations in the connected EP90 detail view",
      async () => {
        const fetchMock =
          vi.fn(
            async (
              input:
                RequestInfo | URL,
            ) => {
              if (
                input ===
                "/api/v1/operator/episodes"
              ) {
                return response(
                  LIST,
                );
              }

              if (
                input ===
                "/api/v1/operator/episodes/EP90"
              ) {
                return response(
                  DETAIL,
                );
              }

              throw new Error(
                `Unexpected operator request: ${String(input)}`,
              );
            },
          );

        vi.stubGlobal(
          "fetch",
          fetchMock,
        );

        const user =
          userEvent.setup();

        const {
          container,
        } =
          render(
            <App />,
          );

        await user.type(
          screen.getByLabelText(
            "Operator token",
          ),
          TOKEN,
        );

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Connect",
            },
          ),
        );

        await screen.findByRole(
          "button",
          {
            name:
              "Open EP90 details",
          },
        );

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Open EP90 details",
            },
          ),
        );

        await screen.findByRole(
          "heading",
          {
            level:
              1,

            name:
              "EP90 — Runway Connectivity Test",
          },
        );

        await act(
          async () => {
            await Promise.resolve();
          },
        );

        const result =
          await axe.run(
            container,
            {
              rules:
                LAYOUT_DEPENDENT_RULES,
            },
          );

        expect(
          result.violations.map(
            (
              violation,
            ) =>
              `${violation.id}: ${violation.help}`,
          ),
        ).toEqual(
          [],
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          2,
        );
      },
    );
  },
);
