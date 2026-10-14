import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button, PageHeader, Panel, TextField } from "../design-system";
import styles from "./UnlockPage.module.css";

export const UNLOCK_INSTRUCTION =
  "Paste the operator token printed in the terminal where the operator server was started. The token stays in this tab's memory only and is cleared when you lock the console or reload the page.";
export const EMPTY_TOKEN_ERROR = "Enter the operator token.";
export const UNAUTHORIZED_NOTICE = "The token was not accepted. Tokens are valid only for the current server launch.";

export type UnlockPageProps = Readonly<{
  notice: "UNAUTHORIZED" | null;
  // True after Lock or a rejected token; false on first page load so the skip
  // link stays the first focus stop.
  focusField: boolean;
  onUnlock: (token: string) => void;
}>;

// LOCKED view. The token field is uncontrolled: its value is read once on
// submit, cleared immediately and handed to the caller; it is never React
// state and is never rendered back.
export function UnlockPage({ notice, focusField, onUnlock }: UnlockPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (focusField) {
      inputRef.current?.focus();
    }
  }, [focusField]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = inputRef.current;

    if (input === null) {
      return;
    }

    const token = input.value.trim();
    input.value = "";

    if (token === "") {
      setFieldError(EMPTY_TOKEN_ERROR);
      input.focus();
      return;
    }

    setFieldError(undefined);
    onUnlock(token);
  }

  return (
    <>
      <PageHeader title="Overview" />
      <Panel title="Connect to the operator server">
        <div className={styles.body}>
          {notice === "UNAUTHORIZED" ? (
            <p className={styles.notice} role="alert">
              {UNAUTHORIZED_NOTICE}
            </p>
          ) : null}
          <p className={styles.instruction}>{UNLOCK_INSTRUCTION}</p>
          <form className={styles.form} noValidate onSubmit={handleSubmit}>
            <TextField
              ref={inputRef}
              label="Operator token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              error={fieldError}
            />
            <div className={styles.actions}>
              <Button type="submit" variant="primary">
                Connect
              </Button>
            </div>
          </form>
        </div>
      </Panel>
    </>
  );
}
