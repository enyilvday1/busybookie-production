import { ArrowRight, Send } from "lucide-react";

import { AudienceGrid } from "../components/site/AudienceGrid";
import { ButtonLink } from "../components/site/ButtonLink";
import { ClosingCta } from "../components/site/ClosingCta";
import { ContentFamilyGrid } from "../components/site/ContentFamilyGrid";
import { WorkflowPreview } from "../components/site/ProductDemos";
import { SectionHeading } from "../components/site/SectionHeading";
import { StatusBadge } from "../components/site/StatusBadge";
import { WorkflowPath } from "../components/site/WorkflowPath";
import { PRODUCTION_ASSETS } from "../content/siteContent";
import { START_OPTIONS_HREF } from "../routes";

export function SolutionsPage() {
  return (
    <>
      <section className="hero hero--page" aria-labelledby="solutions-title">
        <div className="hero__inner">
          <div className="hero__copy">
            <p className="eyebrow">Solutions</p>
            <h1 id="solutions-title" className="hero__title hero__title--page">
              One production environment for every format your audience experiences
            </h1>
            <p className="hero__lead">
              Plan once, then produce stories, video, learning resources, characters, audio and marketing from the same
              project — with the scripts, storyboards and references behind them kept in one place.
            </p>
            <div className="button-row hero__actions">
              <ButtonLink href={START_OPTIONS_HREF} size="large">
                Build your first production free
                <ArrowRight aria-hidden="true" focusable="false" size={18} />
              </ButtonLink>
              <ButtonLink href="#journey" variant="secondary" size="large">
                Follow the production journey
              </ButtonLink>
            </div>
          </div>
          <div className="hero__visual">
            <WorkflowPreview />
          </div>
        </div>
      </section>

      <section className="section section--lavender" aria-labelledby="audiences-title">
        <div className="section__inner">
          <SectionHeading id="audiences-title" eyebrow="Built for creative work" title="Built for creators and teams making family media" align="center">
            <p>Primary users are adults: creators, educators and commercial teams producing for children and families.</p>
          </SectionHeading>
          <AudienceGrid />
        </div>
      </section>

      <section id="journey" className="section section--tight-bottom" aria-labelledby="journey-title">
        <div className="section__inner">
          <SectionHeading id="journey-title" eyebrow="Connected journey" title="A connected production journey" align="center">
            <p>From a creative idea to publish-ready assets, every step works from the same brief and shared context.</p>
          </SectionHeading>
          <WorkflowPath labelledBy="journey-title" />
        </div>
      </section>

      <section className="section section--lavender section--tight-top" aria-labelledby="infrastructure-title">
        <div className="section__inner">
          <SectionHeading id="infrastructure-title" eyebrow="Production infrastructure" title="The production assets behind every output" align="center">
            <p>Outputs are only as good as what sits behind them. These assets stay in the project and are reused across formats.</p>
          </SectionHeading>
          <ul className="asset-grid">
            {PRODUCTION_ASSETS.map((asset) => {
              const Icon = asset.icon;
              return (
                <li key={asset.title} className={`asset-card accent-${asset.accent}`}>
                  <span className="icon-tile icon-tile--large" aria-hidden="true">
                    <Icon focusable="false" size={22} strokeWidth={1.9} />
                  </span>
                  <div className="asset-card__text">
                    <h3 className="asset-card__title">{asset.title}</h3>
                    <p className="asset-card__body">{asset.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Roadmap note only: no integration, account connection or scheduling exists. */}
          <article className="roadmap-note" aria-labelledby="automated-publishing-title">
            <span className="icon-tile accent-indigo" aria-hidden="true">
              <Send focusable="false" size={18} strokeWidth={1.9} />
            </span>
            <div className="roadmap-note__text">
              <div className="roadmap-note__heading">
                <h3 id="automated-publishing-title" className="roadmap-note__title">
                  Automated social publishing
                </h3>
                <StatusBadge tone="provisional">Planned</StatusBadge>
              </div>
              <p>
                Future integrations may allow approved content to be scheduled or published directly to supported social
                channels. Platforms, availability and timing are not yet confirmed.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="section" aria-labelledby="solutions-families-title">
        <div className="section__inner">
          <SectionHeading id="solutions-families-title" eyebrow="Output families" title="Six content families, one production model" align="center">
            <p>Representative formats across every family, each built from the same production assets.</p>
          </SectionHeading>
          <ContentFamilyGrid detail="detailed" />
        </div>
      </section>

      <ClosingCta
        id="solutions-closing-title"
        title="Bring your next production into one place"
        secondary={{ href: "/pricing", label: "Compare free entry options" }}
      >
        <p>Start with your own provider account, or try the bounded hosted experience where available.</p>
      </ClosingCta>
    </>
  );
}
