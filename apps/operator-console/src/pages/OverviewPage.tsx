import { useCallback, useEffect, useRef, useState } from "react";

import type { ListEpisodesResult, OperatorClient, OperatorFailure } from "../api/operatorClient";
import type { EpisodeListItem } from "../api/operatorDtos";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusIndicator,
  VisuallyHidden,
} from "../design-system";
import styles from "./OverviewPage.module.css";

// Connected Overview (Step 1018 sections 9-11). It shows exactly the D1
// episode list and never infers production status from it.

type DisplayedFailure = Exclude<OperatorFailure, "UNAUTHORIZED" | "ABORTED">;

export const FAILURE_MESSAGES: Readonly<Record<DisplayedFailure, string>> = Object.freeze({
  FORBIDDEN: "This console must be opened from the address printed by the operator server.",
  STATE_UNAVAILABLE: "Production state could not be read.",
  SERVER_ERROR: "The operator server reported an internal error.",
  UNEXPECTED_RESPONSE: "The operator server returned an unexpected response.",
  NETWORK: "The operator server could not be reached.",
  TIMEOUT: "The operator server did not respond in time.",
  UNREADABLE_RESPONSE: "The operator server returned an unreadable response.",
  UNRECOGNIZED_DATA: "The operator server returned data this console does not recognise.",
});

type View =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "data"; episodes: readonly EpisodeListItem[]; retrievedAt: string }>
  | Readonly<{ kind: "error"; failure: DisplayedFailure; code: string; requestId: string | undefined }>;

export type OverviewPageProps = Readonly<{
  client: OperatorClient;
  onLock: () => void;
  onUnauthorized: (client: OperatorClient) => void;
}>;

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "medium" });

function summaryText(episodes: readonly EpisodeListItem[]): string {
  const total = episodes.length === 1 ? "1 episode" : `${episodes.length} episodes`;
  const invalid = episodes.filter((episode) => episode.manifest === "INVALID").length;
  return invalid === 0 ? total : `${total} · ${invalid} with an invalid manifest`;
}

function NotAvailable() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <VisuallyHidden>Not available</VisuallyHidden>
    </>
  );
}

export function OverviewPage({ client, onLock, onUnauthorized }: OverviewPageProps) {
  const [view, setView] = useState<View>({ kind: "loading" });
  // Request authority: only the request whose generation is still current
  // may change state. Refresh, Lock and unmount advance the generation and
  // abort the in-flight request.
  const generation = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const revokeInFlight = useCallback(() => {
    generation.current += 1;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  const load = useCallback(() => {
    revokeInFlight();
    const controller = new AbortController();
    inFlight.current = controller;
    const requestGeneration = generation.current;
    setView({ kind: "loading" });

    void client.listEpisodes(controller.signal).then((result: ListEpisodesResult) => {
      if (requestGeneration !== generation.current) {
        return;
      }

      inFlight.current = null;

      if (result.ok) {
        setView({ kind: "data", episodes: result.episodes, retrievedAt: timeFormat.format(new Date()) });
        return;
      }

      if (result.failure === "ABORTED") {
        return;
      }

      if (result.failure === "UNAUTHORIZED") {
        revokeInFlight();
        onUnauthorized(client);
        return;
      }

      setView({
        kind: "error",
        failure: result.failure,
        code: result.code ?? result.failure,
        requestId: result.requestId,
      });
    });
  }, [client, onUnauthorized, revokeInFlight]);

  useEffect(() => {
    load();
    return revokeInFlight;
  }, [load, revokeInFlight]);

  function handleLock() {
    revokeInFlight();
    onLock();
  }

  return (
    <>
      <PageHeader title="Overview" />
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Button onClick={load}>Refresh</Button>
          <Button variant="ghost" onClick={handleLock}>
            Lock
          </Button>
        </div>
        {view.kind === "data" ? <p className={styles.retrieved}>{`Retrieved at ${view.retrievedAt}`}</p> : null}
      </div>
      <div className={styles.results} aria-busy={view.kind === "loading"}>
        {view.kind === "loading" ? <LoadingState subject="episodes" /> : null}
        {view.kind === "error" ? (
          <ErrorState
            code={view.code}
            message={FAILURE_MESSAGES[view.failure]}
            {...(view.requestId === undefined ? {} : { requestId: view.requestId })}
          />
        ) : null}
        {view.kind === "data" && view.episodes.length === 0 ? (
          <EmptyState title="No episodes" description="No episodes were found in this production." />
        ) : null}
        {view.kind === "data" && view.episodes.length > 0 ? (
          <>
            <p className={styles.summary} role="status">
              {summaryText(view.episodes)}
            </p>
            <div className={styles.tableRegion} role="region" aria-label="Episodes" tabIndex={0}>
              <table className={styles.table}>
                <caption className={styles.caption}>Episodes</caption>
                <thead>
                  <tr>
                    <th scope="col">Episode</th>
                    <th scope="col">Title</th>
                    <th scope="col" className={styles.numeric}>
                      Scenes
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Shots
                    </th>
                    <th scope="col">Manifest</th>
                  </tr>
                </thead>
                <tbody>
                  {view.episodes.map((episode, index) => (
                    <tr key={`${index}-${episode.episodeId}`}>
                      <td className={styles.mono}>{episode.episodeId}</td>
                      <td>{episode.manifest === "VALID" ? episode.title : <NotAvailable />}</td>
                      <td className={styles.numeric}>
                        {episode.manifest === "VALID" ? episode.sceneCount : <NotAvailable />}
                      </td>
                      <td className={styles.numeric}>
                        {episode.manifest === "VALID" ? episode.shotCount : <NotAvailable />}
                      </td>
                      <td>
                        {episode.manifest === "VALID" ? (
                          <StatusIndicator tone="neutral" label="Valid" />
                        ) : (
                          <StatusIndicator tone="warning" label="Invalid" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
