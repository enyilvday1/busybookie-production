import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

// Style props are intentionally excluded: all styling comes from tokens and
// CSS Modules so the console stays compatible with a strict style-src CSP.
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style" | "children"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  ref?: Ref<HTMLButtonElement>;
};

export function joinClassNames(...names: ReadonlyArray<string | false | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function Button({ children, variant = "secondary", size = "md", type = "button", ref, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={joinClassNames(styles.button, styles[variant], styles[size])}
    >
      {children}
    </button>
  );
}
