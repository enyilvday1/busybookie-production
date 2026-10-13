import { useId, type ReactNode } from "react";

import styles from "./Panel.module.css";

export type PanelProps = Readonly<{
  title?: string;
  headingLevel?: 2 | 3;
  children: ReactNode;
}>;

// A bordered surface. With a title it becomes a labelled region section.
export function Panel({ title, headingLevel = 2, children }: PanelProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <section className={styles.panel} aria-labelledby={title === undefined ? undefined : headingId}>
      {title === undefined ? null : (
        <div className={styles.header}>
          <Heading id={headingId} className={styles.title}>
            {title}
          </Heading>
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
