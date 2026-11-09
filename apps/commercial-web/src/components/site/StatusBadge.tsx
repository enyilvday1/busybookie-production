import { CircleDashed, Info } from "lucide-react";

type StatusBadgeProps = {
  /** "provisional": undecided commercial terms. "preview": conceptual UI. */
  tone: "provisional" | "preview";
  children: string;
};

/** A text label for status. The meaning is always carried by the words, never by colour alone. */
export function StatusBadge({ tone, children }: StatusBadgeProps) {
  const Icon = tone === "preview" ? Info : CircleDashed;

  return (
    <span className={`status-badge status-badge--${tone}`}>
      <Icon aria-hidden="true" focusable="false" size={14} strokeWidth={2.25} />
      {children}
    </span>
  );
}
