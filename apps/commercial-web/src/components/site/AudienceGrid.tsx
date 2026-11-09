import { AUDIENCES } from "../../content/siteContent";

type AudienceMedia = "vignette" | "image";

type AudienceGridProps = {
  /** "image" shows the approved audience photography (Home); "vignette" keeps the stylised icon cards. */
  media?: AudienceMedia;
};

/** Intrinsic size of every optimised audience image (≈16:9), so the browser reserves space before load. */
const AUDIENCE_IMAGE_SIZE = { width: 1672, height: 941 } as const;

const AUDIENCE_IMAGE_BASE = "/images/audience/";

/** Local, optimised copies of the approved masters, served from public/images/audience/. */
const AUDIENCE_IMAGES: Record<string, { file: string; alt: string }> = {
  creators: {
    file: "independent-creators.webp",
    alt: "An independent creator working at a laptop with a microphone, storyboards and character sketches.",
  },
  publishers: {
    file: "publishers.webp",
    alt: "An open illustrated children's book showing a fox on a hillside, beside a stack of hardback books, pencil fox character sketches, storyboard proofs and a colour fan.",
  },
  educators: {
    file: "educators.webp",
    alt: "An educator writing in a lesson planner beside a globe, a tablet, books and illustrated picture cards.",
  },
  studios: {
    file: "agencies-studios.webp",
    alt: "A creative studio team collaborating around a production monitor with storyboards and colour swatches.",
  },
  brands: {
    file: "family-character-brands.webp",
    alt: "Two adults and a young girl developing a fox character together, with a sketchbook of fox poses, a character colour sheet, scene artwork, a plush fox and the fox on screen.",
  },
};

/**
 * Who the platform is designed for. Images and vignettes depict audience
 * categories, not customers; nothing here is a testimonial.
 */
export function AudienceGrid({ media = "vignette" }: AudienceGridProps) {
  return (
    <ul className="audience-grid">
      {AUDIENCES.map((audience) => {
        const Icon = audience.icon;
        const titleId = `audience-${audience.id}-title`;
        const image = media === "image" ? AUDIENCE_IMAGES[audience.id] : undefined;

        return (
          <li key={audience.id} className="audience-grid__item">
            <article className={`audience-card accent-${audience.accent}`} aria-labelledby={titleId}>
              {image === undefined ? (
                <div className="audience-card__vignette" aria-hidden="true">
                  <span className="audience-card__icon">
                    <Icon focusable="false" size={26} strokeWidth={1.75} />
                  </span>
                  <span className="audience-card__chip audience-card__chip--a">{audience.formats[0]}</span>
                  <span className="audience-card__chip audience-card__chip--b">{audience.formats[1]}</span>
                </div>
              ) : (
                <div className={`audience-card__media audience-card__media--${audience.id}`}>
                  <img
                    src={`${AUDIENCE_IMAGE_BASE}${image.file}`}
                    alt={image.alt}
                    width={AUDIENCE_IMAGE_SIZE.width}
                    height={AUDIENCE_IMAGE_SIZE.height}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              )}
              <h3 id={titleId} className="audience-card__title">
                {audience.title}
              </h3>
              <p className="audience-card__body">{audience.body}</p>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
