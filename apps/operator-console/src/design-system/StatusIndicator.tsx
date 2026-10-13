import { Circle, CircleCheck, Info, OctagonAlert, TriangleAlert, type LucideIcon } from "lucide-react";

import styles from "./StatusIndicator.module.css";

// Exactly five presentational tones. There is no accent tone: the accent is
// interaction-only. The component never derives meaning; callers pass an
// explicit label that reflects backend DTO semantics, and the label is always
// rendered as text so status never depends on color or icon alone.
export const STATUS_TONES = ["neutral", "info", "success", "warning", "danger"] as const;

export type StatusTone = (typeof STATUS_TONES)[number];

const TONE_ICONS: Readonly<Record<StatusTone, LucideIcon>> = Object.freeze({
  neutral: Circle,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: OctagonAlert,
});

export type StatusIndicatorProps = Readonly<{
  tone: StatusTone;
  label: string;
}>;

export function StatusIndicator({ tone, label }: StatusIndicatorProps) {
  const Icon = TONE_ICONS[tone];

  return (
    <span className={styles.status} data-tone={tone}>
      <Icon aria-hidden="true" focusable="false" size={16} strokeWidth={1.75} />
      <span className={styles.label}>{label}</span>
    </span>
  );
}
