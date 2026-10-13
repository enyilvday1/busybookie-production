import type { MouseEvent } from "react";

import styles from "./SkipLink.module.css";

// First focusable element. Moves focus to the main landmark explicitly so the
// behavior does not depend on fragment-navigation focus quirks.
export function SkipLink({ targetId }: Readonly<{ targetId: string }>) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById(targetId);

    if (target !== null) {
      event.preventDefault();
      target.focus();
    }
  }

  return (
    <a className={styles.skipLink} href={`#${targetId}`} onClick={handleClick}>
      Skip to main content
    </a>
  );
}
