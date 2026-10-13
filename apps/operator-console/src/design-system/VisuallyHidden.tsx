import type { ReactNode } from "react";

import styles from "./VisuallyHidden.module.css";

// Text available to assistive technology but not rendered visually.
export function VisuallyHidden({ children }: Readonly<{ children: ReactNode }>) {
  return <span className={styles.visuallyHidden}>{children}</span>;
}
