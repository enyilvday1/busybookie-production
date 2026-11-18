import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createOperatorClient,
  EPISODE_DETAIL_PATH_PREFIX,
} from "../src/api/operatorClient";

import {
  isCanonicalEpisodeId,
  type CanonicalEpisodeId,
} from "../src/api/episodeDetailDtos";

const TOKEN =
  "f".repeat(
    64,
  );

const REQUEST_ID =
  "aed7ef66-15f4-48e7-8c37-6d28fa204f09";

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

function canonicalEpisodeId(
  value: string,
): CanonicalEpisodeId {
  if (
    !isCanonicalEpisodeId(
      value,
    )
  ) {
    throw new Error(
      `Test episode id is not canonical: ${value}`,
    );
  }

  return value;
}

const EP90 =
  canonicalEpisodeId(
    "EP90",
  );

function json(
  status: number,
  body: unknown,

  headers:
    Record<string, string> =
    {},
): Response {
  return new Response(
    JSON.stringify(
      body,
    ),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        ...headers,
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

function stubFetch(
  implementation:
    (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>,
) {
  const fetchMock =
    vi.fn(
      implementation,
    );

  vi.stubGlobal(
    "fetch",
    fetchMock,
  );

  return fetchMock;
}

afterEach(
  () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  },
);

describe(
  "episode-detail client",
  () => {
    it(
      "issues exactly one authenticated same-origin GET for EP90",
      async () => {
        const fetchMock =
          stubFetch(
            async () =>
              json(
                200,
                DETAIL,
              ),
          );

        const result =
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            EP90,
            new AbortController().signal,
          );

        expect(
          result,
        ).toMatchObject({
          ok:
            true,

          episode: {
            episodeId:
              "EP90",

            title:
              "Runway Connectivity Test",
          },
        });

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );

        const [
          input,
          init,
        ] =
          fetchMock.mock.calls[0]!;

        expect(
          EPISODE_DETAIL_PATH_PREFIX,
        ).toBe(
          "/api/v1/operator/episodes",
        );

        expect(
          input,
        ).toBe(
          "/api/v1/operator/episodes/EP90",
        );

        expect(
          init,
        ).toMatchObject({
          method:
            "GET",

          mode:
            "same-origin",

          credentials:
            "omit",

          cache:
            "no-store",

          redirect:
            "error",

          referrerPolicy:
            "no-referrer",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Bearer ${TOKEN}`,
          },
        });

        expect(
          init?.body,
        ).toBeUndefined();

        expect(
          init?.signal,
        ).toBeInstanceOf(
          AbortSignal,
        );
      },
    );

    it(
      "refuses a runtime non-canonical id before any fetch",
      async () => {
        const fetchMock =
          stubFetch(
            async () =>
              json(
                200,
                DETAIL,
              ),
          );

        const unsafe =
          "EP90/../../SECRET" as CanonicalEpisodeId;

        const result =
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            unsafe,
            new AbortController().signal,
          );

        expect(
          result,
        ).toEqual({
          ok:
            false,

          failure:
            "UNEXPECTED_RESPONSE",
        });

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a detail document whose episode identity differs from the request",
      async () => {
        stubFetch(
          async () =>
            json(
              200,
              {
                ...DETAIL,

                episodeId:
                  "EP91",
              },
              {
                "X-Request-Id":
                  REQUEST_ID,
              },
            ),
        );

        expect(
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            EP90,
            new AbortController().signal,
          ),
        ).toEqual({
          ok:
            false,

          failure:
            "UNRECOGNIZED_DATA",

          requestId:
            REQUEST_ID,
        });
      },
    );

    it(
      "classifies a current 401 without exposing the backend message",
      async () => {
        const fetchMock =
          stubFetch(
            async () =>
              json(
                401,
                errorEnvelope(
                  "UNAUTHORIZED",
                ),
                {
                  "X-Request-Id":
                    REQUEST_ID,
                },
              ),
          );

        const result =
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            EP90,
            new AbortController().signal,
          );

        expect(
          result,
        ).toEqual({
          ok:
            false,

          failure:
            "UNAUTHORIZED",

          code:
            "UNAUTHORIZED",

          requestId:
            REQUEST_ID,
        });

        expect(
          JSON.stringify(
            result,
          ),
        ).not.toContain(
          "SECRET",
        );

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "makes no retry after a detail 404",
      async () => {
        const fetchMock =
          stubFetch(
            async () =>
              json(
                404,
                errorEnvelope(
                  "NOT_FOUND",
                ),
              ),
          );

        expect(
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            EP90,
            new AbortController().signal,
          ),
        ).toEqual({
          ok:
            false,

          failure:
            "UNEXPECTED_RESPONSE",

          code:
            "NOT_FOUND",

          requestId:
            REQUEST_ID,
        });

        expect(
          fetchMock,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "does not fetch for an already-aborted detail request",
      async () => {
        const fetchMock =
          stubFetch(
            async () =>
              json(
                200,
                DETAIL,
              ),
          );

        const controller =
          new AbortController();

        controller.abort();

        expect(
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            EP90,
            controller.signal,
          ),
        ).toEqual({
          ok:
            false,

          failure:
            "ABORTED",
        });

        expect(
          fetchMock,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "treats an unrecognized successful detail body as fail-closed",
      async () => {
        stubFetch(
          async () =>
            json(
              200,
              {
                apiVersion:
                  "v1",

                episodeId:
                  "EP90",

                title:
                  "Malformed detail",
              },
              {
                "X-Request-Id":
                  REQUEST_ID,
              },
            ),
        );

        expect(
          await createOperatorClient(
            TOKEN,
          ).getEpisodeDetail(
            EP90,
            new AbortController().signal,
          ),
        ).toEqual({
          ok:
            false,

          failure:
            "UNRECOGNIZED_DATA",

          requestId:
            REQUEST_ID,
        });
      },
    );
  },
);
