import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createOperatorClient,
  type OperatorClient,
} from "./api/operatorClient";

import type {
  CanonicalEpisodeId,
} from "./api/episodeDetailDtos";

import {
  EpisodeDetailPage,
} from "./pages/EpisodeDetailPage";

import {
  OverviewPage,
} from "./pages/OverviewPage";

import {
  UnlockPage,
} from "./pages/UnlockPage";

import {
  AppShell,
} from "./shell/AppShell";

import {
  MAIN_CONTENT_ID,
} from "./shell/navigation";

// The single owner of the operator session (Step 1018 sections 6 and 9).
// The token exists only inside the closure of the in-memory client.
//
// Episode Detail is an in-memory child view of Overview. No route, URL,
// history entry or browser storage carries session or episode state.
type OperatorView =
  | Readonly<{
      kind: "overview";
    }>
  | Readonly<{
      kind: "episode";
      episodeId: CanonicalEpisodeId;
    }>;

const OVERVIEW_VIEW:
  OperatorView =
  Object.freeze({
    kind:
      "overview",
  });

type Session =
  | Readonly<{
      status: "locked";
      reason:
        | "initial"
        | "lock"
        | "unauthorized";
    }>
  | Readonly<{
      status: "unlocked";
      client: OperatorClient;
      id: number;
      view: OperatorView;
    }>;

const INITIAL_SESSION:
  Session =
  Object.freeze({
    status:
      "locked",

    reason:
      "initial",
  });

export function App() {
  const [
    session,
    setSession,
  ] =
    useState<Session>(
      INITIAL_SESSION,
    );

  const nextSessionId =
    useRef(
      1,
    );

  const focusMainAfterTransition =
    useRef(
      false,
    );

  const unlock =
    useCallback(
      (
        token: string,
      ) => {
        focusMainAfterTransition.current =
          true;

        const id =
          nextSessionId.current;

        nextSessionId.current +=
          1;

        setSession({
          status:
            "unlocked",

          client:
            createOperatorClient(
              token,
            ),

          id,

          view:
            OVERVIEW_VIEW,
        });
      },
      [],
    );

  const lock =
    useCallback(
      () => {
        setSession({
          status:
            "locked",

          reason:
            "lock",
        });
      },
      [],
    );

  // Only the client that is still current may end the session.
  const rejectClient =
    useCallback(
      (
        client: OperatorClient,
      ) => {
        setSession(
          (
            current,
          ) =>
            current.status ===
              "unlocked" &&
            current.client ===
              client
              ? {
                  status:
                    "locked",

                  reason:
                    "unauthorized",
                }
              : current,
        );
      },
      [],
    );

  const openEpisode =
    useCallback(
      (
        client: OperatorClient,
        episodeId: CanonicalEpisodeId,
      ) => {
        setSession(
          (
            current,
          ) => {
            if (
              current.status !==
                "unlocked" ||
              current.client !==
                client
            ) {
              return current;
            }

            focusMainAfterTransition.current =
              true;

            return {
              ...current,

              view:
                Object.freeze({
                  kind:
                    "episode",

                  episodeId,
                }),
            };
          },
        );
      },
      [],
    );

  const showOverview =
    useCallback(
      (
        client: OperatorClient,
      ) => {
        setSession(
          (
            current,
          ) => {
            if (
              current.status !==
                "unlocked" ||
              current.client !==
                client ||
              current.view.kind ===
                "overview"
            ) {
              return current;
            }

            focusMainAfterTransition.current =
              true;

            return {
              ...current,

              view:
                OVERVIEW_VIEW,
            };
          },
        );
      },
      [],
    );

  useEffect(
    () => {
      if (
        session.status ===
          "unlocked" &&
        focusMainAfterTransition.current
      ) {
        focusMainAfterTransition.current =
          false;

        document
          .getElementById(
            MAIN_CONTENT_ID,
          )
          ?.focus();
      }
    },
    [
      session,
    ],
  );

  const onCurrentNavigation =
    session.status ===
      "unlocked" &&
    session.view.kind ===
      "episode"
      ? () =>
          showOverview(
            session.client,
          )
      : undefined;

  return (
    <AppShell
      currentNavigationId="overview"
      {...(
        onCurrentNavigation ===
        undefined
          ? {}
          : {
              onCurrentNavigation,
            }
      )}
    >
      {session.status ===
      "unlocked" ? (
        session.view.kind ===
        "overview" ? (
          <OverviewPage
            key={`${session.id}-overview`}
            client={session.client}
            onLock={lock}
            onUnauthorized={rejectClient}
            onOpenEpisode={
              (
                episodeId,
              ) =>
                openEpisode(
                  session.client,
                  episodeId,
                )
            }
          />
        ) : (
          <EpisodeDetailPage
            key={`${session.id}-${session.view.episodeId}`}
            client={session.client}
            episodeId={session.view.episodeId}
            onBack={
              () =>
                showOverview(
                  session.client,
                )
            }
            onLock={lock}
            onUnauthorized={rejectClient}
          />
        )
      ) : (
        <UnlockPage
          notice={
            session.reason ===
            "unauthorized"
              ? "UNAUTHORIZED"
              : null
          }
          focusField={
            session.reason !==
            "initial"
          }
          onUnlock={unlock}
        />
      )}
    </AppShell>
  );
}
