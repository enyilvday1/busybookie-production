import { useCallback, useEffect, useRef, useState } from "react";

import { createOperatorClient, type OperatorClient } from "./api/operatorClient";
import { OverviewPage } from "./pages/OverviewPage";
import { UnlockPage } from "./pages/UnlockPage";
import { AppShell } from "./shell/AppShell";
import { MAIN_CONTENT_ID } from "./shell/navigation";

// The single owner of the operator session (Step 1018 sections 6 and 9). The
// token exists only inside the closure of the in-memory client; the session
// ends only on Lock, on a current-request 401, or when the page goes away.
type Session =
  | Readonly<{ status: "locked"; reason: "initial" | "lock" | "unauthorized" }>
  | Readonly<{ status: "unlocked"; client: OperatorClient; id: number }>;

const INITIAL_SESSION: Session = Object.freeze({ status: "locked", reason: "initial" });

export function App() {
  const [session, setSession] = useState<Session>(INITIAL_SESSION);
  const nextSessionId = useRef(1);
  const focusMainAfterUnlock = useRef(false);

  const unlock = useCallback((token: string) => {
    focusMainAfterUnlock.current = true;
    const id = nextSessionId.current;
    nextSessionId.current += 1;
    setSession({ status: "unlocked", client: createOperatorClient(token), id });
  }, []);

  const lock = useCallback(() => {
    setSession({ status: "locked", reason: "lock" });
  }, []);

  // Only the client that is still current may end the session.
  const rejectClient = useCallback((client: OperatorClient) => {
    setSession((current) =>
      current.status === "unlocked" && current.client === client ? { status: "locked", reason: "unauthorized" } : current,
    );
  }, []);

  useEffect(() => {
    if (session.status === "unlocked" && focusMainAfterUnlock.current) {
      focusMainAfterUnlock.current = false;
      document.getElementById(MAIN_CONTENT_ID)?.focus();
    }
  }, [session]);

  return (
    <AppShell currentNavigationId="overview">
      {session.status === "unlocked" ? (
        <OverviewPage key={session.id} client={session.client} onLock={lock} onUnauthorized={rejectClient} />
      ) : (
        <UnlockPage
          notice={session.reason === "unauthorized" ? "UNAUTHORIZED" : null}
          focusField={session.reason !== "initial"}
          onUnlock={unlock}
        />
      )}
    </AppShell>
  );
}
