import { CONTENT_FAMILIES, type ContentFamily } from "../../content/siteContent";

type Detail = "summary" | "detailed";

/** Intrinsic size of every optimised family image (≈16:9), so the browser reserves space before load. */
const FAMILY_IMAGE_SIZE = { width: 1672, height: 941 } as const;

/** Local, optimised copies of the approved masters, served from public/images/content-families/. */
const FAMILY_IMAGES: Record<ContentFamily["id"], { file: string; alt: string }> = {
  "stories-publishing": {
    file: "stories-publishing.webp",
    alt: "An open illustrated storybook surrounded by picture-book pages showing a dragon, a sailing ship, a ringed planet and a castle.",
  },
  "video-entertainment": {
    file: "video-entertainment.webp",
    alt: "A cinema camera and a production monitor showing a fantasy castle landscape, with a clapperboard, a film reel, headphones and a studio light.",
  },
  "education-learning": {
    file: "education-learning.webp",
    alt: "A stack of gilded books, a globe and an open book on a desk beneath a glowing graduation cap and constellation diagram.",
  },
  "characters-ip": {
    file: "characters-creative-ip.webp",
    alt: "Character figures of a young adventurer, a fox and a wizard beside a concept board of expression and turnaround sketches, colour swatches and an open illustrated book.",
  },
  "audio-narration": {
    file: "audio-narration.webp",
    alt: "A studio microphone with a pop filter in front of a screen showing a sound waveform, with headphones, a mixing desk and an open book.",
  },
  "marketing-social": {
    file: "marketing-social-media.webp",
    alt: "A tablet showing an illustrated social post, surrounded by floating media cards, reaction icons, a megaphone, a storyboard sketchbook and a colour fan.",
  },
};

const FAMILY_IMAGE_BASE = "/images/content-families/";

type ContentFamilyGridProps = {
  /** "detailed" also lists the production assets each family draws on. */
  detail?: Detail;
};

/** Six illustrated capability cards, one per content family (3×2 on desktop). */
export function ContentFamilyGrid({ detail = "summary" }: ContentFamilyGridProps) {
  return (
    <ul className="family-grid">
      {CONTENT_FAMILIES.map((family) => (
        <li key={family.id} className="family-grid__item">
          <ContentFamilyCard family={family} detail={detail} />
        </li>
      ))}
    </ul>
  );
}

function ContentFamilyCard({ family, detail }: { family: ContentFamily; detail: Detail }) {
  const Icon = family.icon;
  const titleId = `${family.id}-title`;
  const image = FAMILY_IMAGES[family.id];

  return (
    <article className={`family-card accent-${family.accent}`} aria-labelledby={titleId}>
      <div className={`family-card__media family-card__media--${family.id}`}>
        <img
          src={`${FAMILY_IMAGE_BASE}${image.file}`}
          alt={image.alt}
          width={FAMILY_IMAGE_SIZE.width}
          height={FAMILY_IMAGE_SIZE.height}
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="family-card__body">
        <div className="family-card__heading">
          <span className="icon-tile" aria-hidden="true">
            <Icon focusable="false" size={20} strokeWidth={1.9} />
          </span>
          <h3 id={titleId} className="family-card__title">
            {family.name}
          </h3>
        </div>
        <p className="family-card__summary">{family.summary}</p>
        <ul className="tag-list" aria-label={`${family.name} examples`}>
          {family.examples.map((example) => (
            <li key={example} className="tag">
              {example}
            </li>
          ))}
        </ul>
        {detail === "detailed" ? (
          <p className="family-card__assets">
            <span className="family-card__assets-label">Built from:</span> {family.assets.join(", ")}
          </p>
        ) : null}
      </div>
    </article>
  );
}

/** Compact six-family category strip. Items are not headings: the cards below carry those. */
export function FamilyStrip() {
  return (
    <ul className="family-strip" aria-label="The six content families">
      {CONTENT_FAMILIES.map((family) => {
        const Icon = family.icon;
        return (
          <li key={family.id} className={`family-strip__item accent-${family.accent}`}>
            <span className="icon-tile icon-tile--large" aria-hidden="true">
              <Icon focusable="false" size={22} strokeWidth={1.9} />
            </span>
            <span className="family-strip__text">
              <span className="family-strip__name">{family.name}</span>
              <span className="family-strip__line">{family.stripLine}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
