import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  GetEpisodeDetailResult,
  OperatorClient,
  OperatorFailure,
} from "../api/operatorClient";

import {
  DIALOGUE_COMPOSITION_STATES,
  VISUAL_GENERATION_STATES,
  type CanonicalEpisodeId,
  type EpisodeDetail,
  type EpisodeVisualDetail,
} from "../api/episodeDetailDtos";

import {
  Button,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
} from "../design-system";

import styles from "./EpisodeDetailPage.module.css";

type DisplayedFailure =
  Exclude<
    OperatorFailure,
    "UNAUTHORIZED" | "ABORTED"
  >;

const FAILURE_MESSAGES:
  Readonly<
    Record<
      DisplayedFailure,
      string
    >
  > =
  Object.freeze({
    FORBIDDEN:
      "This console must be opened from the address printed by the operator server.",

    STATE_UNAVAILABLE:
      "Production state could not be read.",

    SERVER_ERROR:
      "The operator server reported an internal error.",

    UNEXPECTED_RESPONSE:
      "The operator server returned an unexpected response.",

    NETWORK:
      "The operator server could not be reached.",

    TIMEOUT:
      "The operator server did not respond in time.",

    UNREADABLE_RESPONSE:
      "The operator server returned an unreadable response.",

    UNRECOGNIZED_DATA:
      "The operator server returned data this console does not recognise.",
  });

type View =
  | Readonly<{
      kind: "loading";
    }>
  | Readonly<{
      kind: "data";
      episode: EpisodeDetail;
      retrievedAt: string;
    }>
  | Readonly<{
      kind: "error";
      failure: DisplayedFailure;
      code: string;
      requestId: string | undefined;
    }>;

export type EpisodeDetailPageProps =
  Readonly<{
    client: OperatorClient;
    episodeId: CanonicalEpisodeId;
    onBack: () => void;
    onLock: () => void;
    onUnauthorized:
      (
        client: OperatorClient,
      ) => void;
  }>;

const retrievedTimeFormat =
  new Intl.DateTimeFormat(
    undefined,
    {
      timeStyle:
        "medium",
    },
  );

const evaluatedTimeFormat =
  new Intl.DateTimeFormat(
    undefined,
    {
      dateStyle:
        "medium",

      timeStyle:
        "medium",
    },
  );

function displayEvaluatedAt(
  value: string,
): string {
  return evaluatedTimeFormat.format(
    new Date(
      value,
    ),
  );
}

function failureMessage(
  failure: DisplayedFailure,
  code: string,
): string {
  if (
    code ===
    "NOT_FOUND"
  ) {
    return "This episode could not be found.";
  }

  return FAILURE_MESSAGES[
    failure
  ];
}

function TextValue({
  children,
}: Readonly<{
  children: string | number;
}>) {
  return (
    <span className={styles.value}>
      {children}
    </span>
  );
}

function StateValue({
  children,
}: Readonly<{
  children: string;
}>) {
  return (
    <code className={styles.state}>
      {children}
    </code>
  );
}

function SummaryCounts<
  State extends string,
>({
  title,
  states,
  counts,
}: Readonly<{
  title: string;
  states: readonly State[];
  counts:
    Readonly<
      Record<
        State,
        number
      >
    >;
}>) {
  const active =
    states.filter(
      (state) =>
        counts[state] >
        0,
    );

  return (
    <section
      className={styles.summaryGroup}
      aria-label={title}
    >
      <h3 className={styles.summaryHeading}>
        {title}
      </h3>

      {active.length === 0 ? (
        <p className={styles.muted}>
          No active states
        </p>
      ) : (
        <dl className={styles.stateCounts}>
          {active.map(
            (state) => (
              <div
                key={state}
                className={styles.stateCount}
              >
                <dt>
                  <StateValue>
                    {state}
                  </StateValue>
                </dt>

                <dd>
                  {counts[state]}
                </dd>
              </div>
            ),
          )}
        </dl>
      )}
    </section>
  );
}

function ReadinessDetails({
  visual,
}: Readonly<{
  visual: EpisodeVisualDetail;
}>) {
  if (
    !(
      "readiness"
      in visual
    )
  ) {
    return null;
  }

  return (
    <>
      <div className={styles.definitionRow}>
        <dt>
          Readiness
        </dt>

        <dd>
          <StateValue>
            {visual.readiness.disposition}
          </StateValue>
        </dd>
      </div>

      <div className={styles.definitionRow}>
        <dt>
          Execution provider
        </dt>

        <dd>
          {visual.readiness.executionProvider ===
          null ? (
            <span className={styles.muted}>
              Not assigned
            </span>
          ) : (
            <StateValue>
              {visual.readiness.executionProvider}
            </StateValue>
          )}
        </dd>
      </div>

      {visual.readiness.blockers.length >
      0 ? (
        <div className={styles.definitionRow}>
          <dt>
            Blockers
          </dt>

          <dd>
            <ul className={styles.blockers}>
              {visual.readiness.blockers.map(
                (
                  blocker,
                  index,
                ) => (
                  <li
                    key={`${index}-${blocker}`}
                  >
                    {blocker}
                  </li>
                ),
              )}
            </ul>
          </dd>
        </div>
      ) : null}
    </>
  );
}

function VisualExtraDetails({
  visual,
}: Readonly<{
  visual: EpisodeVisualDetail;
}>) {
  return (
    <>
      {"provider" in
      visual ? (
        <div className={styles.definitionRow}>
          <dt>
            Provider
          </dt>

          <dd>
            <StateValue>
              {visual.provider}
            </StateValue>
          </dd>
        </div>
      ) : null}

      {"candidateReferenceCount" in
      visual ? (
        <div className={styles.definitionRow}>
          <dt>
            Candidate references
          </dt>

          <dd>
            <TextValue>
              {visual.candidateReferenceCount}
            </TextValue>
          </dd>
        </div>
      ) : null}

      {"referenceAssetId" in
      visual ? (
        <div className={styles.definitionRow}>
          <dt>
            Reference asset
          </dt>

          <dd>
            <StateValue>
              {visual.referenceAssetId}
            </StateValue>
          </dd>
        </div>
      ) : null}
    </>
  );
}

function EpisodeData({
  episode,
}: Readonly<{
  episode: EpisodeDetail;
}>) {
  return (
    <div className={styles.contentGrid}>
      <Panel title="Episode summary">
        <dl className={styles.definitionList}>
          <div className={styles.definitionRow}>
            <dt>
              Episode ID
            </dt>

            <dd>
              <StateValue>
                {episode.episodeId}
              </StateValue>
            </dd>
          </div>

          <div className={styles.definitionRow}>
            <dt>
              Total shots
            </dt>

            <dd>
              <TextValue>
                {episode.summary.totalShots}
              </TextValue>
            </dd>
          </div>

          <div className={styles.definitionRow}>
            <dt>
              Evaluated
            </dt>

            <dd>
              <time
                dateTime={episode.evaluatedAt}
              >
                {displayEvaluatedAt(
                  episode.evaluatedAt,
                )}
              </time>
            </dd>
          </div>
        </dl>

        <div className={styles.summaryStates}>
          <SummaryCounts
            title="Visual states"
            states={VISUAL_GENERATION_STATES}
            counts={episode.summary.visualGenerationStates}
          />

          <SummaryCounts
            title="Dialogue states"
            states={DIALOGUE_COMPOSITION_STATES}
            counts={episode.summary.dialogueCompositionStates}
          />
        </div>
      </Panel>

      <section
        className={styles.shots}
        aria-labelledby="episode-shots-heading"
      >
        <h2
          id="episode-shots-heading"
          className={styles.sectionHeading}
        >
          Shots
        </h2>

        {episode.shots.map(
          (shot) => (
            <Panel
              key={`${shot.sceneId}-${shot.shotId}`}
              title={`Shot ${shot.order} · ${shot.sceneId}/${shot.shotId}`}
              headingLevel={3}
            >
              <dl className={styles.definitionList}>
                <div className={styles.definitionRow}>
                  <dt>
                    Visual state
                  </dt>

                  <dd>
                    <StateValue>
                      {shot.visual.state}
                    </StateValue>
                  </dd>
                </div>

                <ReadinessDetails
                  visual={shot.visual}
                />

                <VisualExtraDetails
                  visual={shot.visual}
                />

                <div className={styles.definitionRow}>
                  <dt>
                    Dialogue state
                  </dt>

                  <dd>
                    <StateValue>
                      {shot.dialogue.state}
                    </StateValue>
                  </dd>
                </div>
              </dl>
            </Panel>
          ),
        )}
      </section>
    </div>
  );
}

export function EpisodeDetailPage({
  client,
  episodeId,
  onBack,
  onLock,
  onUnauthorized,
}: EpisodeDetailPageProps) {
  const [
    view,
    setView,
  ] =
    useState<View>({
      kind:
        "loading",
    });

  // Only the newest request may update this page. Refresh, Back, Lock and
  // unmount revoke the current generation and abort its request.
  const generation =
    useRef(
      0,
    );

  const inFlight =
    useRef<AbortController | null>(
      null,
    );

  const revokeInFlight =
    useCallback(
      () => {
        generation.current +=
          1;

        inFlight.current?.abort();

        inFlight.current =
          null;
      },
      [],
    );

  const load =
    useCallback(
      () => {
        revokeInFlight();

        const controller =
          new AbortController();

        inFlight.current =
          controller;

        const requestGeneration =
          generation.current;

        setView({
          kind:
            "loading",
        });

        void client
          .getEpisodeDetail(
            episodeId,
            controller.signal,
          )
          .then(
            (
              result:
                GetEpisodeDetailResult,
            ) => {
              if (
                requestGeneration !==
                generation.current
              ) {
                return;
              }

              inFlight.current =
                null;

              if (
                result.ok
              ) {
                setView({
                  kind:
                    "data",

                  episode:
                    result.episode,

                  retrievedAt:
                    retrievedTimeFormat.format(
                      new Date(),
                    ),
                });

                return;
              }

              if (
                result.failure ===
                "ABORTED"
              ) {
                return;
              }

              if (
                result.failure ===
                "UNAUTHORIZED"
              ) {
                revokeInFlight();

                onUnauthorized(
                  client,
                );

                return;
              }

              setView({
                kind:
                  "error",

                failure:
                  result.failure,

                code:
                  result.code ??
                  result.failure,

                requestId:
                  result.requestId,
              });
            },
          );
      },
      [
        client,
        episodeId,
        onUnauthorized,
        revokeInFlight,
      ],
    );

  useEffect(
    () => {
      load();

      return revokeInFlight;
    },
    [
      load,
      revokeInFlight,
    ],
  );

  function handleBack() {
    revokeInFlight();
    onBack();
  }

  function handleLock() {
    revokeInFlight();
    onLock();
  }

  const title =
    view.kind ===
    "data"
      ? `${view.episode.episodeId} — ${view.episode.title}`
      : `Episode ${episodeId}`;

  return (
    <>
      <PageHeader
        title={title}
        description="Read-only durable production state"
      />

      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Button
            variant="ghost"
            onClick={handleBack}
          >
            Back to Overview
          </Button>

          <Button
            onClick={load}
          >
            Refresh
          </Button>

          <Button
            variant="ghost"
            onClick={handleLock}
          >
            Lock
          </Button>
        </div>

        {view.kind ===
        "data" ? (
          <p className={styles.retrieved}>
            {`Retrieved at ${view.retrievedAt}`}
          </p>
        ) : null}
      </div>

      <div
        className={styles.results}
        aria-busy={
          view.kind ===
          "loading"
        }
      >
        {view.kind ===
        "loading" ? (
          <LoadingState subject="episode detail" />
        ) : null}

        {view.kind ===
        "error" ? (
          <ErrorState
            code={view.code}
            message={failureMessage(
              view.failure,
              view.code,
            )}
            {...(
              view.requestId ===
              undefined
                ? {}
                : {
                    requestId:
                      view.requestId,
                  }
            )}
          />
        ) : null}

        {view.kind ===
        "data" ? (
          <EpisodeData
            episode={view.episode}
          />
        ) : null}
      </div>
    </>
  );
}
