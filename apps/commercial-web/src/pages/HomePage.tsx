import { ArrowRight, FolderOpen, Layers, Receipt, Share2, Workflow } from "lucide-react";

import { AudienceGrid } from "../components/site/AudienceGrid";
import { ButtonLink } from "../components/site/ButtonLink";
import { ClosingCta } from "../components/site/ClosingCta";
import { ContentFamilyGrid, FamilyStrip } from "../components/site/ContentFamilyGrid";
import { EntryModelCards } from "../components/site/EntryModelCards";
import { HeroStudioPreview } from "../components/site/ProductDemos";
import { SectionHeading } from "../components/site/SectionHeading";
import { WorkflowPath } from "../components/site/WorkflowPath";
import { productIdentity } from "../productIdentity";
import { START_OPTIONS_HREF } from "../routes";

const VALUE_POINTS = [
  { icon: Workflow, title: "One connected production workflow", body: "Brief, planning, assets and outputs in one project." },
  { icon: Layers, title: "Reuse story and character context", body: "Characters, style and audience notes stay with the work." },
  { icon: Share2, title: "Create across multiple media formats", body: "Video, books, printables, audio and social from one production." },
] as const;

const PRINCIPLES = [
  {
    icon: Layers,
    title: "One shared context",
    body: "Characters, visual style and audience notes are stored with the project, so each new output starts from the same references instead of a blank prompt.",
  },
  {
    icon: FolderOpen,
    title: "Assets you can reuse",
    body: "Scripts, storyboards, references and narration stay in the project as editable production assets, ready for the next episode, book or worksheet.",
  },
  {
    icon: Receipt,
    title: "Clear about cost",
    body: "Generation billed by your own provider is kept separate from platform access, so you always know who charges for what.",
  },
] as const;

export function HomePage() {
  return (
    <>
      <section className="hero hero--home" aria-labelledby="home-title">
        <div className="hero__inner">
          <div className="hero__copy">
            <p className="hero__eyebrow">{productIdentity.compactDescription}</p>
            <h1 id="home-title" className="hero__title">
              Create children's, educational and family media in one production platform.
            </h1>
            <p className="hero__lead">
              Develop stories and characters, plan every scene, and produce video, audio, printables and branded
              content — together with the production assets behind them — from one shared project.
            </p>
            <div className="button-row hero__actions">
              <ButtonLink href={START_OPTIONS_HREF} size="large">
                Build your first production free
                <ArrowRight aria-hidden="true" focusable="false" size={18} />
              </ButtonLink>
              <ButtonLink href="#workflow" variant="secondary" size="large">
                See how the workflow works
              </ButtonLink>
            </div>
          </div>
          <div className="hero__visual">
            <HeroStudioPreview />
          </div>
        </div>
        <ul className="value-row" aria-label="What the platform brings together">
          {VALUE_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <li key={point.title} className="value-row__item">
                <span className="icon-tile" aria-hidden="true">
                  <Icon focusable="false" size={20} strokeWidth={1.9} />
                </span>
                <span>
                  <strong className="value-row__title">{point.title}</strong>
                  <span className="value-row__body">{point.body}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="strip-band">
        <div className="section__inner">
          <FamilyStrip />
        </div>
      </div>

      <section className="section section--tight-top" aria-labelledby="families-title">
        <div className="section__inner">
          <SectionHeading id="families-title" eyebrow="Six content families" title="One platform for the media families love" align="center">
            <p>
              Stories, video, learning resources, characters, audio and marketing — and the production assets behind
              them — are produced side by side in one project. Activities and printables run through both publishing
              and learning.
            </p>
          </SectionHeading>
          <ContentFamilyGrid />
        </div>
      </section>

      <section className="section section--lavender" aria-labelledby="audiences-title">
        <div className="section__inner">
          <SectionHeading id="audiences-title" eyebrow="Creativity at your fingertips" title="Built for you, your ideas and your creativity" align="center">
            <p>Designed for adults and teams producing for children and families — from a single creator to a studio.</p>
          </SectionHeading>
          <AudienceGrid media="image" />
        </div>
      </section>

      <section id="workflow" className="section section--flow-bottom" aria-labelledby="workflow-title">
        <div className="section__inner">
          <SectionHeading id="workflow-title" eyebrow="Integrated workflow" title="From a single brief to every format you need" align="center">
            <p>
              Each step builds on the last, inside one project. Exports are prepared for your own channels and tools;
              publishing stays in your hands.
            </p>
          </SectionHeading>
          <WorkflowPath labelledBy="workflow-title" />
        </div>
      </section>

      <section id="start-options" className="section section--lavender section--flow-top section--flow-bottom" aria-labelledby="start-title">
        <div className="section__inner">
          <SectionHeading id="start-title" eyebrow="Free entry" title="Two ways to get started" align="center">
            <p>
              One platform, two complementary entry options. They differ in who pays for generation, so the distinction
              is stated clearly on each.
            </p>
          </SectionHeading>
          <EntryModelCards />
          <p className="section-note">
            Accounts are not open yet; this section explains how each free entry is intended to work.{" "}
            <a href="/pricing#billing" className="text-link">
              Read how billing works
            </a>
          </p>
        </div>
      </section>

      <section className="section section--flow-top" aria-labelledby="principles-title">
        <div className="section__inner">
          <SectionHeading id="principles-title" eyebrow="Production-first" title="Built around productions, not one-off prompts" align="center" />
          <ul className="principle-grid">
            {PRINCIPLES.map((principle, index) => {
              const Icon = principle.icon;
              return (
                <li key={principle.title} className={`principle principle--${index + 1}`}>
                  <span className="icon-tile icon-tile--large" aria-hidden="true">
                    <Icon focusable="false" size={22} strokeWidth={1.9} />
                  </span>
                  <h3 className="principle__title">{principle.title}</h3>
                  <p>{principle.body}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <ClosingCta
        id="home-closing-title"
        title="Start your first production"
        secondary={{ href: "/pricing", label: "See how pricing will work" }}
      >
        <p>Bring your own provider and build your first production free, or try the bounded hosted experience where available.</p>
      </ClosingCta>
    </>
  );
}
