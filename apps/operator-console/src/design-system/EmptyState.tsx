import { Inbox } from "lucide-react";

import styles from "./StateBlock.module.css";

export type EmptyStateProps = Readonly<{
  title: string;
  description: string;
  headingLevel?: 2 | 3;
}>;

// "Nothing to show here" - never used to mask a failed request (ErrorState).
export function EmptyState({ title, description, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className={styles.stateBlock}>
      <Inbox className={styles.icon} aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
      <Heading className={styles.title}>{title}</Heading>
      <p className={styles.description}>{description}</p>
    </div>
  );
}
