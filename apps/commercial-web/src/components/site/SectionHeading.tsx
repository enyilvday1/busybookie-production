import type { ReactNode } from "react";

type SectionHeadingProps = {
  id: string;
  eyebrow?: string;
  title: string;
  level?: 1 | 2;
  align?: "start" | "center";
  children?: ReactNode;
};

export function SectionHeading({ id, eyebrow, title, level = 2, align = "start", children }: SectionHeadingProps) {
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <div className={`section-heading section-heading--${align}`}>
      {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
      <Heading id={id} className={level === 1 ? "page-title" : "section-title"}>
        {title}
      </Heading>
      {children === undefined ? null : <div className="section-heading__body">{children}</div>}
    </div>
  );
}
