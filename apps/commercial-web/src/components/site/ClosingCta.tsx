import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { START_OPTIONS_HREF } from "../../routes";
import { ButtonLink } from "./ButtonLink";
import { CtaDecoration } from "./Illustrations";

type ClosingCtaProps = {
  id: string;
  title: string;
  children: ReactNode;
  secondary?: { href: string; label: string };
};

/** Shared deep-violet closing banner used at the end of every page. */
export function ClosingCta({ id, title, children, secondary }: ClosingCtaProps) {
  return (
    <section className="closing-cta" aria-labelledby={id}>
      <div className="closing-cta__inner">
        <div className="closing-cta__content">
          <h2 id={id} className="closing-cta__title">
            {title}
          </h2>
          <div className="closing-cta__body">{children}</div>
          <div className="button-row">
            <ButtonLink href={START_OPTIONS_HREF} variant="inverse" size="large">
              Build your first production free
              <ArrowRight aria-hidden="true" focusable="false" size={18} />
            </ButtonLink>
            {secondary === undefined ? null : (
              <ButtonLink href={secondary.href} variant="ghost-inverse" size="large">
                {secondary.label}
              </ButtonLink>
            )}
          </div>
        </div>
        <CtaDecoration />
      </div>
    </section>
  );
}
