import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";

import styles from "./Button.module.css";

// An icon-only control always carries an accessible name; the icon itself is
// decorative and hidden from assistive technology.
export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "className" | "style" | "children" | "aria-label"
> & {
  label: string;
  icon: LucideIcon;
  ref?: Ref<HTMLButtonElement>;
};

export function IconButton({ label, icon: Icon, type = "button", ref, ...rest }: IconButtonProps) {
  return (
    <button {...rest} ref={ref} type={type} aria-label={label} className={styles.iconButton}>
      <Icon aria-hidden="true" focusable="false" size={20} strokeWidth={1.75} />
    </button>
  );
}
