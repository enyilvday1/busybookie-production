import { CircleAlert } from "lucide-react";

import { joinClassNames } from "./Button";
import styles from "./StateBlock.module.css";

export type ErrorStateProps = Readonly<{
  title?: string;
  code: string;
  message: string;
  requestId?: string;
}>;

// Renders only a safe API error code, its fixed message and the request ID,
// as plain text. No raw exception, stack or object is ever accepted.
export function ErrorState({ title = "The request could not be completed", code, message, requestId }: ErrorStateProps) {
  return (
    <div className={joinClassNames(styles.stateBlock, styles.error)} role="alert">
      <CircleAlert className={styles.icon} aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.description}>{message}</p>
      <dl className={styles.detailList}>
        <dt>Error code</dt>
        <dd className={styles.mono}>{code}</dd>
        {requestId === undefined ? null : (
          <>
            <dt>Request ID</dt>
            <dd className={styles.mono}>{requestId}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
