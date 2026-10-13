import { Skeleton } from "./Skeleton";
import styles from "./StateBlock.module.css";

export type LoadingStateProps = Readonly<{
  subject: string;
  lines?: 1 | 2 | 3;
}>;

// Skeleton placeholders reserve layout; one polite status sentence is
// announced. No fake progress percentage and no spinner-only page.
export function LoadingState({ subject, lines = 3 }: LoadingStateProps) {
  return (
    <div className={styles.stateBlock} aria-busy="true">
      <p role="status" className={styles.description}>
        {`Loading ${subject}`}
      </p>
      <div className={styles.skeletonGroup}>
        {Array.from({ length: lines }, (_unused, index) => (
          <Skeleton key={index} width={index === lines - 1 && lines > 1 ? "half" : "full"} />
        ))}
      </div>
    </div>
  );
}
