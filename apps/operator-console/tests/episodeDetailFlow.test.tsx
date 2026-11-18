import {
  act,
  render,
  screen,
  within,
} from "@testing-library/react";

import userEvent from "@testing-library/user-event";

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
  "0123456789abcdef".repeat(
    4,
  );

const REQUEST_ID =
  "aed7ef66-15f4-48e7-8c37-6d28fa204f09";

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

    {
      episodeId:
        "EP03",

      manifest:
        "INVALID",
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

type PendingCall =
  Readonly<{
    input:
      RequestInfo | URL;

    init:
      RequestInit;

    resolve:
      (
        response: Response,
      ) => void;

    reject:
      (
        error: unknown,
      ) => void;
  }>;

function controllableFetch() {
  const calls:
    PendingCall[] =
    [];

  const fetchMock =
    vi.fn(
      (
        input:
          RequestInfo | URL,

        init?:
          RequestInit,
      ) =>
        new Promise<Response>(
          (
            resolve,
            reject,
          ) => {
            calls.push({
              input,

              init:
                init ??
                {},

              resolve,

              reject,
            });
          },
        ),
    );

  vi.stubGlobal(
    "fetch",
    fetchMock,
  );

  return {
    fetchMock,
    calls,
  };
}

function json(
  status: number,
  body: unknown,
): Response {
  return new Response(
    JSON.stringify(
      body,
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json",

        "X-Request-Id":
          REQUEST_ID,
      },
    },
  );
}

function errorEnvelope(
  code: string,
) {
  return {
    error: {
      code,

      message:
        "D:/SECRET backend detail",

      requestId:
        REQUEST_ID,
    },
  };
}

async function settle(
  call:
    PendingCall | undefined,

  response:
    Response | Error,
) {
  await act(
    async () => {
      if (
        response instanceof
        Error
      ) {
        call?.reject(
          response,
        );
      } else {
        call?.resolve(
          response,
        );
      }

      await Promise.resolve();
    },
  );

  await act(
    async () => {
      await new Promise(
        (
          resolve,
        ) =>
          setTimeout(
            resolve,
            0,
          ),
      );
    },
  );
}

async function unlock(
  user:
    ReturnType<
      typeof userEvent.setup
    >,
) {
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
}

async function reachOverview(
  user:
    ReturnType<
      typeof userEvent.setup
    >,

  calls:
    PendingCall[],
) {
  await unlock(
    user,
  );

  expect(
    calls,
  ).toHaveLength(
    1,
  );

  expect(
    calls[0]!.input,
  ).toBe(
    "/api/v1/operator/episodes",
  );

  await settle(
    calls[0],
    json(
      200,
      LIST,
    ),
  );

  expect(
    screen.getByRole(
      "heading",
      {
        level:
          1,

        name:
          "Overview",
      },
    ),
  ).toBeTruthy();

  expect(
    screen.getByRole(
      "button",
      {
        name:
          "Open EP90 details",
      },
    ),
  ).toBeTruthy();
}

async function openEp90(
  user:
    ReturnType<
      typeof userEvent.setup
    >,

  calls:
    PendingCall[],
) {
  await user.click(
    screen.getByRole(
      "button",
      {
        name:
          "Open EP90 details",
      },
    ),
  );

  expect(
    calls,
  ).toHaveLength(
    2,
  );

  expect(
    calls[1]!.input,
  ).toBe(
    "/api/v1/operator/episodes/EP90",
  );
}

function expectBearer(
  call:
    PendingCall | undefined,
) {
  expect(
    call?.init.headers,
  ).toMatchObject({
    Accept:
      "application/json",

    Authorization:
      `Bearer ${TOKEN}`,
  });

  expect(
    call?.init.method,
  ).toBe(
    "GET",
  );

  expect(
    call?.init.credentials,
  ).toBe(
    "omit",
  );

  expect(
    call?.init.cache,
  ).toBe(
    "no-store",
  );

  expect(
    call?.init.body,
  ).toBeUndefined();
}

function tokenField() {
  return screen.getByLabelText(
    "Operator token",
  ) as HTMLInputElement;
}

afterEach(
  () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  },
);

describe(
  "Episode Detail application flow",
  () => {
    it(
      "unlocks, opens EP90, renders durable detail and returns to a fresh Overview without changing the URL",
      async () => {
        const {
          fetchMock,
          calls,
        } =
          controllableFetch();

        const user =
          userEvent.setup();

        const originalUrl =
          window.location.href;

        render(
          <App />,
        );

        await reachOverview(
          user,
          calls,
        );

        expectBearer(
          calls[0],
        );

        await openEp90(
          user,
          calls,
        );

        expectBearer(
          calls[1],
        );

        await settle(
          calls[1],
          json(
            200,
            DETAIL,
          ),
        );

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                1,

              name:
                "EP90 — Runway Connectivity Test",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                3,

              name:
                "Shot 1 · SC01/S01",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.getAllByText(
            "LIFECYCLE_COMPLETED",
          ).length,
        ).toBeGreaterThanOrEqual(
          1,
        );

        expect(
          screen.getAllByText(
            "NO_DIALOGUE",
          ).length,
        ).toBeGreaterThanOrEqual(
          1,
        );

        expect(
          document.activeElement,
        ).toBe(
          screen.getByRole(
            "main",
          ),
        );

        expect(
          window.location.href,
        ).toBe(
          originalUrl,
        );

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Back to Overview",
            },
          ),
        );

        expect(
          calls,
        ).toHaveLength(
          3,
        );

        expect(
          calls[2]!.input,
        ).toBe(
          "/api/v1/operator/episodes",
        );

        expectBearer(
          calls[2],
        );

        await settle(
          calls[2],
          json(
            200,
            LIST,
          ),
        );

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                1,

              name:
                "Overview",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByText(
            "LIFECYCLE_COMPLETED",
          ),
        ).toBeNull();

        expect(
          document.activeElement,
        ).toBe(
          screen.getByRole(
            "main",
          ),
        );

        expect(
          window.location.href,
        ).toBe(
          originalUrl,
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          3,
        );

        expect(
          document.documentElement.outerHTML,
        ).not.toContain(
          TOKEN,
        );
      },
    );

    it(
      "uses the existing Overview navigation item to return from detail in-memory without a browser navigation",
      async () => {
        const {
          calls,
        } =
          controllableFetch();

        const user =
          userEvent.setup();

        const originalUrl =
          window.location.href;

        render(
          <App />,
        );

        await reachOverview(
          user,
          calls,
        );

        await openEp90(
          user,
          calls,
        );

        await settle(
          calls[1],
          json(
            200,
            DETAIL,
          ),
        );

        const overviewLink =
          screen.getAllByRole(
            "link",
            {
              name:
                "Overview",

              hidden:
                true,
            },
          )[0];

        expect(
          overviewLink,
        ).toBeDefined();

        const click =
          new MouseEvent(
            "click",
            {
              bubbles:
                true,

              cancelable:
                true,
            },
          );

        await act(
          async () => {
            overviewLink!.dispatchEvent(
              click,
            );

            await Promise.resolve();
          },
        );

        expect(
          click.defaultPrevented,
        ).toBe(
          true,
        );

        expect(
          calls,
        ).toHaveLength(
          3,
        );

        expect(
          calls[2]!.input,
        ).toBe(
          "/api/v1/operator/episodes",
        );

        expect(
          window.location.href,
        ).toBe(
          originalUrl,
        );

        await settle(
          calls[2],
          json(
            200,
            LIST,
          ),
        );

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                1,

              name:
                "Overview",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByRole(
            "heading",
            {
              level:
                1,

              name:
                "EP90 — Runway Connectivity Test",
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "destroys the session on a current detail 401",
      async () => {
        const {
          calls,
        } =
          controllableFetch();

        const user =
          userEvent.setup();

        render(
          <App />,
        );

        await reachOverview(
          user,
          calls,
        );

        await openEp90(
          user,
          calls,
        );

        await settle(
          calls[1],
          json(
            401,
            errorEnvelope(
              "UNAUTHORIZED",
            ),
          ),
        );

        expect(
          tokenField(),
        ).toBeTruthy();

        expect(
          screen.getByRole(
            "alert",
          ).textContent,
        ).toBe(
          "The token was not accepted. Tokens are valid only for the current server launch.",
        );

        expect(
          document.activeElement,
        ).toBe(
          tokenField(),
        );

        expect(
          screen.queryByText(
            "EP90 — Runway Connectivity Test",
          ),
        ).toBeNull();
      },
    );

    it(
      "Lock during an in-flight detail request aborts the request and a late success cannot repopulate the UI",
      async () => {
        const {
          calls,
        } =
          controllableFetch();

        const user =
          userEvent.setup();

        render(
          <App />,
        );

        await reachOverview(
          user,
          calls,
        );

        await openEp90(
          user,
          calls,
        );

        expect(
          calls[1]!.init.signal?.aborted,
        ).toBe(
          false,
        );

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Lock",
            },
          ),
        );

        expect(
          calls[1]!.init.signal?.aborted,
        ).toBe(
          true,
        );

        expect(
          tokenField(),
        ).toBeTruthy();

        await settle(
          calls[1],
          json(
            200,
            DETAIL,
          ),
        );

        expect(
          tokenField(),
        ).toBeTruthy();

        expect(
          screen.queryByText(
            "LIFECYCLE_COMPLETED",
          ),
        ).toBeNull();

        expect(
          screen.queryByRole(
            "heading",
            {
              level:
                1,

              name:
                "EP90 — Runway Connectivity Test",
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "Back during an in-flight detail request aborts it and ignores a stale late completion",
      async () => {
        const {
          calls,
        } =
          controllableFetch();

        const user =
          userEvent.setup();

        render(
          <App />,
        );

        await reachOverview(
          user,
          calls,
        );

        await openEp90(
          user,
          calls,
        );

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                1,

              name:
                "Episode EP90",
            },
          ),
        ).toBeTruthy();

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Back to Overview",
            },
          ),
        );

        expect(
          calls[1]!.init.signal?.aborted,
        ).toBe(
          true,
        );

        expect(
          calls,
        ).toHaveLength(
          3,
        );

        expect(
          calls[2]!.input,
        ).toBe(
          "/api/v1/operator/episodes",
        );

        await settle(
          calls[1],
          json(
            200,
            DETAIL,
          ),
        );

        expect(
          screen.queryByText(
            "LIFECYCLE_COMPLETED",
          ),
        ).toBeNull();

        await settle(
          calls[2],
          json(
            200,
            LIST,
          ),
        );

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                1,

              name:
                "Overview",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByText(
            "LIFECYCLE_COMPLETED",
          ),
        ).toBeNull();
      },
    );

    it(
      "keeps the authenticated session on a detail 404 and permits Back to Overview",
      async () => {
        const {
          calls,
        } =
          controllableFetch();

        const user =
          userEvent.setup();

        render(
          <App />,
        );

        await reachOverview(
          user,
          calls,
        );

        await openEp90(
          user,
          calls,
        );

        await settle(
          calls[1],
          json(
            404,
            errorEnvelope(
              "NOT_FOUND",
            ),
          ),
        );

        expect(
          screen.queryByLabelText(
            "Operator token",
          ),
        ).toBeNull();

        const alert =
          screen.getByRole(
            "alert",
          );

        expect(
          within(
            alert,
          ).getByText(
            "This episode could not be found.",
          ),
        ).toBeTruthy();

        expect(
          within(
            alert,
          ).getByText(
            "NOT_FOUND",
          ),
        ).toBeTruthy();

        await user.click(
          screen.getByRole(
            "button",
            {
              name:
                "Back to Overview",
            },
          ),
        );

        expect(
          calls,
        ).toHaveLength(
          3,
        );

        await settle(
          calls[2],
          json(
            200,
            LIST,
          ),
        );

        expect(
          screen.getByRole(
            "heading",
            {
              level:
                1,

              name:
                "Overview",
            },
          ),
        ).toBeTruthy();

        expect(
          screen.queryByLabelText(
            "Operator token",
          ),
        ).toBeNull();
      },
    );
  },
);
