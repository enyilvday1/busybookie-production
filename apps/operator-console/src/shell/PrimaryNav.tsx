import type { MouseEvent, Ref } from "react";

import { PRIMARY_NAVIGATION, type NavigationItemId } from "./navigation";
import styles from "./PrimaryNav.module.css";

export type PrimaryNavProps = Readonly<{
  currentId: NavigationItemId;
  // Called when a destination is activated (the drawer closes itself).
  onNavigate?: () => void;
  // Ref to the current-page link (desktop focus fallback target).
  currentLinkRef?: Ref<HTMLAnchorElement>;
}>;

export function PrimaryNav({ currentId, onNavigate, currentLinkRef }: PrimaryNavProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>, isCurrent: boolean) {
    // The current view is already displayed: no reload, no navigation.
    if (isCurrent) {
      event.preventDefault();
    }

    onNavigate?.();
  }

  return (
    <nav aria-label="Primary" className={styles.nav}>
      <ul className={styles.list}>
        {PRIMARY_NAVIGATION.map((item) => {
          const isCurrent = item.id === currentId;
          const Icon = item.icon;

          return (
            <li key={item.id}>
              <a
                ref={isCurrent ? currentLinkRef : undefined}
                className={styles.link}
                href={item.href}
                aria-current={isCurrent ? "page" : undefined}
                onClick={(event) => handleClick(event, isCurrent)}
              >
                <Icon aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
                <span>{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
