import { useId, type ReactNode } from "react";

import { StatusBadge } from "./StatusBadge";

type ProductDemoFrameProps = {
  /** Window title shown in the frame's top bar. */
  windowTitle: string;
  /** Visible caption: the text alternative for the whole preview. */
  caption: string;
  className?: string;
  children: ReactNode;
};

/**
 * Application-window frame for HTML/CSS product previews. Every preview is
 * labelled conceptual: it illustrates the intended workflow with a fictional
 * project and is not a screenshot of shipped software or real customer work.
 *
 * The simulated interface is hidden from assistive technology because its
 * labels are illustrative; the visible caption describes it instead.
 */
export function ProductDemoFrame({ windowTitle, caption, className, children }: ProductDemoFrameProps) {
  const captionId = useId();

  return (
    <figure className={["demo-frame", className].filter(Boolean).join(" ")} aria-labelledby={captionId}>
      <div className="demo-frame__bar">
        <span className="demo-frame__dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="demo-frame__title" aria-hidden="true">
          {windowTitle}
        </span>
        <StatusBadge tone="preview">Conceptual product preview</StatusBadge>
      </div>
      <div className="demo-frame__body" aria-hidden="true">
        {children}
      </div>
      <figcaption id={captionId} className="demo-frame__caption">
        {caption}
      </figcaption>
    </figure>
  );
}

export type DemoStatus = "ready" | "progress" | "planned";

const STATUS_TEXT: Record<DemoStatus, string> = {
  ready: "Ready",
  progress: "In progress",
  planned: "Planned",
};

/** Status chip with a distinct shape per state, so colour is never the only signal. */
export function DemoStatusChip({ status }: { status: DemoStatus }) {
  return (
    <span className={`demo-status demo-status--${status}`}>
      <span className="demo-status__shape" />
      {STATUS_TEXT[status]}
    </span>
  );
}
