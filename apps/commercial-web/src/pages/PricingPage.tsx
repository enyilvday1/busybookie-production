import { ArrowRight, Building2, Cloud, Gauge, KeyRound, Package, Receipt, Users, Workflow } from "lucide-react";

import { ButtonLink } from "../components/site/ButtonLink";
import { ClosingCta } from "../components/site/ClosingCta";
import { EntryModelCards } from "../components/site/EntryModelCards";
import { FaqList, type FaqItem } from "../components/site/FaqList";
import { SectionHeading } from "../components/site/SectionHeading";
import { StatusBadge } from "../components/site/StatusBadge";
import { START_OPTIONS_HREF } from "../routes";

const PROFESSIONAL_CATEGORIES = [
  {
    icon: Gauge,
    title: "Greater scale",
    body: "More productions and projects than a first free production.",
  },
  {
    icon: Package,
    title: "Professional output & delivery",
    body: "Delivery-oriented exports and output options for commercial work.",
  },
  {
    icon: Workflow,
    title: "Deeper workflow capability",
    body: "Richer planning, asset management and reuse across productions.",
  },
] as const;

const FAQ: readonly FaqItem[] = [
  {
    question: "Are provider generation costs included?",
    answer:
      "With Free BYO Provider, generation is billed by your provider directly to you. Future paid platform access is separate from provider charges. A Hosted Trial, where offered, may cover generation for a tightly bounded trial; final eligibility and limits are to be confirmed.",
  },
  {
    question: "What does Free BYO Provider mean?",
    answer:
      "You connect a supported generation provider account of your own and use the platform's production workflow free to build your first production. Your provider bills you for the generation you run.",
  },
  {
    question: "What does Hosted Trial mean?",
    answer:
      "One tightly bounded hosted experience, offered where available, that does not require your own provider account. Its scope and eligibility are still to be confirmed.",
  },
  {
    question: "Is unlimited hosted generation included?",
    answer:
      "No. The Hosted Trial is a single bounded experience. It is not unlimited, not a recurring monthly allowance and not guaranteed for every account.",
  },
  {
    question: "Is final paid pricing available?",
    answer:
      "Not yet. Paid plan names, prices and what each includes are to be confirmed. Nothing on this page is a price commitment.",
  },
];

const TBC = "To be confirmed";

// Every cell is descriptive or explicitly unresolved: no prices, quotas,
// counts or checkmarks for capabilities that do not exist.
const COMPARISON_COLUMNS = ["Free BYO Provider", "Hosted Trial", "Professional access"] as const;

const COMPARISON_ROWS: readonly { label: string; values: readonly [string, string, string] }[] = [
  { label: "Platform charge", values: ["No platform charge for your first production", "None", TBC] },
  {
    label: "Who bills generation",
    values: ["Your provider, directly", "Platform-covered generation may be available in a tightly bounded trial", TBC],
  },
  { label: "Your own provider account", values: ["Required", "Not needed for the single hosted experience", TBC] },
  { label: "Scope", values: ["Your first production, through the production workflow", "One tightly bounded experience", TBC] },
  { label: "Recurring allowance", values: ["Not applicable", "No — not recurring", TBC] },
  { label: "Availability", values: ["Supported providers to be confirmed", "Where available; not guaranteed", TBC] },
];

/** Decorative summary of the billing split; the sections below state it in full. */
function BillingVisual() {
  return (
    <div className="billing-visual" aria-hidden="true">
      <div className="billing-visual__row billing-visual__row--provider">
        <span className="icon-tile icon-tile--large accent-violet">
          <KeyRound size={22} focusable="false" />
        </span>
        <span className="billing-visual__text">
          <span className="billing-visual__title">Generation</span>
          <span className="billing-visual__detail">Billed by your provider</span>
        </span>
        <span className="billing-visual__tag">Free BYO</span>
      </div>
      <div className="billing-visual__divider">
        <span>Separate from</span>
      </div>
      <div className="billing-visual__row billing-visual__row--platform">
        <span className="icon-tile icon-tile--large accent-indigo">
          <Building2 size={22} focusable="false" />
        </span>
        <span className="billing-visual__text">
          <span className="billing-visual__title">Platform access</span>
          <span className="billing-visual__detail">Future paid access</span>
        </span>
        <span className="billing-visual__tag billing-visual__tag--tbc">To be confirmed</span>
      </div>
      <div className="billing-visual__row billing-visual__row--trial">
        <span className="icon-tile icon-tile--large accent-peach">
          <Cloud size={22} focusable="false" />
        </span>
        <span className="billing-visual__text">
          <span className="billing-visual__title">Hosted Trial</span>
          <span className="billing-visual__detail">Tightly bounded, where available</span>
        </span>
      </div>
    </div>
  );
}

export function PricingPage() {
  return (
    <>
      <section className="hero hero--page" aria-labelledby="pricing-title">
        <div className="hero__inner">
          <div className="hero__copy">
            <p className="eyebrow">Pricing</p>
            <h1 id="pricing-title" className="hero__title hero__title--page">
              Platform access and generation costs, kept separate
            </h1>
            <p className="hero__lead">
              Final pricing is not published yet. This page explains how billing is intended to work, so the model is
              clear before any prices are.
            </p>
            <p>
              <StatusBadge tone="provisional">Paid pricing to be confirmed</StatusBadge>
            </p>
            <div className="button-row hero__actions">
              <ButtonLink href={START_OPTIONS_HREF} size="large">
                Build your first production free
                <ArrowRight aria-hidden="true" focusable="false" size={18} />
              </ButtonLink>
              <ButtonLink href="#billing" variant="secondary" size="large">
                How billing works
              </ButtonLink>
            </div>
          </div>
          <div className="hero__visual">
            <BillingVisual />
          </div>
        </div>
      </section>

      <section id="billing" className="section section--lavender section--tight-bottom" aria-labelledby="billing-title">
        <div className="section__inner">
          <SectionHeading id="billing-title" eyebrow="Billing distinction" title="Generation costs and platform access, billed separately" align="center" />
          <div className="billing-grid">
            <article className="billing-card billing-card--provider" aria-labelledby="provider-billing-title">
              <div className="billing-card__band">
                <span className="icon-tile icon-tile--large accent-violet" aria-hidden="true">
                  <Receipt focusable="false" size={22} strokeWidth={1.9} />
                </span>
                <p className="billing-card__who">Billed by: your provider</p>
              </div>
              <h3 id="provider-billing-title" className="billing-card__title">
                Provider billing
              </h3>
              <p>
                For bring-your-own-provider generation, generation charges are billed directly by your provider, under
                your own account and agreement with them.
              </p>
            </article>
            <article className="billing-card billing-card--platform" aria-labelledby="platform-access-title">
              <div className="billing-card__band">
                <span className="icon-tile icon-tile--large accent-indigo" aria-hidden="true">
                  <Building2 focusable="false" size={22} strokeWidth={1.9} />
                </span>
                <p className="billing-card__who">Billed by: the platform, in future</p>
              </div>
              <h3 id="platform-access-title" className="billing-card__title">
                Platform access
              </h3>
              <p>
                Future paid subscriptions or entitlements may cover scale, workflow and professional delivery features.
                Terms are to be confirmed.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section section--tight-top" aria-labelledby="entry-title">
        <div className="section__inner">
          <SectionHeading id="entry-title" eyebrow="Entry choices" title="Two ways to start" align="center" />
          <EntryModelCards />
        </div>
      </section>

      <section className="section section--lavender section--pricing-professional" aria-labelledby="professional-title">
        <div className="section__inner">
          <SectionHeading id="professional-title" eyebrow="Paid access" title="Professional access" align="center">
            <p>
              <StatusBadge tone="provisional">To be confirmed</StatusBadge>
            </p>
            <p>
              Future paid access may cover the areas below. Plan names, prices, limits and inclusions are still to be
              confirmed.
            </p>
          </SectionHeading>
          <ul className="principle-grid">
            {PROFESSIONAL_CATEGORIES.map((category, index) => {
              const Icon = category.icon;
              return (
                <li key={category.title} className={`principle principle--${index + 1}`}>
                  <span className="icon-tile icon-tile--large" aria-hidden="true">
                    <Icon focusable="false" size={22} strokeWidth={1.9} />
                  </span>
                  <h3 className="principle__title">{category.title}</h3>
                  <p>{category.body}</p>
                  <p className="principle__status">Details to be confirmed</p>
                </li>
              );
            })}
          </ul>

          <article className="provisional-note" aria-labelledby="teams-organisations-title">
            <span className="icon-tile accent-teal" aria-hidden="true">
              <Users focusable="false" size={18} strokeWidth={1.9} />
            </span>
            <div className="provisional-note__text">
              <div className="provisional-note__heading">
                <h3 id="teams-organisations-title" className="provisional-note__title">
                  Teams &amp; organisations
                </h3>
                <StatusBadge tone="provisional">Under consideration</StatusBadge>
              </div>
              <p>
                Commercial access for teams and larger organisations is under consideration. Structure, permissions and
                pricing are to be confirmed.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section className="section section--pricing-compare section--tight-bottom" aria-labelledby="compare-title">
        <div className="section__inner">
          <SectionHeading id="compare-title" eyebrow="Compare" title="How the options differ today" align="center">
            <p>Descriptive differences only. Anything not yet decided is marked as such.</p>
          </SectionHeading>
          <div className="table-scroll" role="region" aria-label="Comparison table, scrollable" tabIndex={0}>
            <table className="compare-table">
              <caption className="visually-hidden">
                Comparison of Free BYO Provider, Hosted Trial and Professional access. Unresolved values are marked to
                be confirmed.
              </caption>
              <thead>
                <tr>
                  <td />
                  {COMPARISON_COLUMNS.map((column) => (
                    <th key={column} scope="col">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {row.values.map((value, index) => (
                      <td key={COMPARISON_COLUMNS[index]} className={value === TBC ? "is-tbc" : undefined}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="section section--lavender section--tight-top" aria-labelledby="faq-title">
        <div className="section__inner faq-layout">
          <SectionHeading id="faq-title" eyebrow="FAQ" title="Questions about pricing and free entry">
            <p>Short, plain answers. Where something is not decided, we say so.</p>
          </SectionHeading>
          <FaqList items={FAQ} />
        </div>
      </section>

      <ClosingCta
        id="pricing-closing-title"
        title="Choose your way to get started"
        secondary={{ href: "/solutions", label: "Explore solutions" }}
      >
        <p>Build your first production with your own provider account, or try the bounded hosted experience where available.</p>
      </ClosingCta>
    </>
  );
}
