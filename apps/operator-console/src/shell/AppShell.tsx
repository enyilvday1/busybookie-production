import { useRef, type ReactNode } from "react";

import { AppHeader } from "./AppHeader";
import styles from "./AppShell.module.css";
import { NavigationDrawer, useNavigationDrawer } from "./NavigationDrawer";
import { MAIN_CONTENT_ID, type NavigationItemId } from "./navigation";
import { PrimaryNav } from "./PrimaryNav";
import { SkipLink } from "./SkipLink";

export type AppShellProps = Readonly<{
  currentNavigationId: NavigationItemId;
  children: ReactNode;
}>;

// DOM order = keyboard order: skip link, banner, primary navigation, main.
// >= 64rem: persistent 15rem sidebar. < 64rem: the sidebar is not displayed
// and the same navigation opens in the modal NavigationDrawer, so only one
// primary navigation landmark is ever exposed.
export function AppShell({ currentNavigationId, children }: AppShellProps) {
  const desktopCurrentLinkRef = useRef<HTMLAnchorElement | null>(null);
  const drawer = useNavigationDrawer(desktopCurrentLinkRef);

  return (
    <div className={styles.shell}>
      <SkipLink targetId={MAIN_CONTENT_ID} />
      <div className={styles.header}>
        <AppHeader
          navigation={{
            dialogId: drawer.dialogId,
            isOpen: drawer.isOpen,
            triggerRef: drawer.triggerRef,
            onOpen: drawer.open,
          }}
        />
      </div>
      <div className={styles.sidebar}>
        <PrimaryNav currentId={currentNavigationId} currentLinkRef={desktopCurrentLinkRef} />
      </div>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className={styles.main}>
        <div className={styles.content}>{children}</div>
      </main>
      <NavigationDrawer controller={drawer}>
        <PrimaryNav currentId={currentNavigationId} onNavigate={() => drawer.requestClose("navigation")} />
      </NavigationDrawer>
    </div>
  );
}
