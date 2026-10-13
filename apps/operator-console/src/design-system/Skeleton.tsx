import { joinClassNames } from "./Button";
import styles from "./Skeleton.module.css";

export type SkeletonWidth = "full" | "half" | "quarter";

// Decorative placeholder; the accompanying LoadingState announces progress.
export function Skeleton({ width = "full" }: Readonly<{ width?: SkeletonWidth }>) {
  return <span className={joinClassNames(styles.skeleton, styles[width])} aria-hidden="true" />;
}
