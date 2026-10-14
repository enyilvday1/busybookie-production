import { useId, type InputHTMLAttributes, type Ref } from "react";

import { joinClassNames } from "./Button";
import styles from "./TextField.module.css";

// A labelled single-line input. The label is always visible and associated;
// the optional description and error are linked through aria-describedby, and
// an error marks the input aria-invalid. Works controlled or uncontrolled.
export type TextFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "style" | "id" | "type" | "aria-describedby" | "aria-invalid"
> & {
  label: string;
  type?: "text" | "password";
  description?: string | undefined;
  error?: string | undefined;
  ref?: Ref<HTMLInputElement>;
};

export function TextField({ label, type = "text", description, error, ref, ...rest }: TextFieldProps) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const errorId = `${inputId}-error`;
  const describedBy = [description === undefined ? null : descriptionId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(" ");

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {description === undefined ? null : (
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      )}
      <input
        {...rest}
        ref={ref}
        id={inputId}
        type={type}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        aria-invalid={error === undefined ? undefined : true}
        className={joinClassNames(styles.input, error !== undefined && styles.invalid)}
      />
      {error === undefined ? null : (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
