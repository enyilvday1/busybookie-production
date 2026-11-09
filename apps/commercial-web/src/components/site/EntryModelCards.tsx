import { Check, CircleDashed, Cloud, KeyRound } from "lucide-react";

import { ENTRY_MODELS, type EntryModel } from "../../content/siteContent";

/**
 * The two complementary free-entry models, side by side on wider layouts.
 * Both cards share one size and emphasis: neither is presented as superior.
 */
export function EntryModelCards() {
  return (
    <div className="entry-grid">
      {ENTRY_MODELS.map((model) => (
        <EntryModelCard key={model.id} model={model} />
      ))}
    </div>
  );
}

function EntryModelCard({ model }: { model: EntryModel }) {
  const titleId = `entry-${model.id}-title`;
  const Icon = model.id === "byo" ? KeyRound : Cloud;

  return (
    <article className={`entry-card entry-card--${model.id}`} aria-labelledby={titleId}>
      <div className="entry-card__head">
        <span className="icon-tile icon-tile--large" aria-hidden="true">
          <Icon focusable="false" size={22} strokeWidth={1.9} />
        </span>
        <div>
          <p className="entry-card__kicker">{model.kicker}</p>
          <h3 id={titleId} className="entry-card__name">
            {model.name}
          </h3>
        </div>
      </div>
      <p className="entry-card__headline">{model.headline}</p>
      <ul className="check-list">
        {model.points.map((point) => (
          <li key={point}>
            <Check aria-hidden="true" focusable="false" size={18} strokeWidth={2.25} />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <dl className="entry-card__billing">
        <dt>{model.billingLabel}</dt>
        <dd>{model.billingValue}</dd>
      </dl>
      <p className="entry-card__status">
        <CircleDashed aria-hidden="true" focusable="false" size={16} />
        {model.status}
      </p>
    </article>
  );
}
