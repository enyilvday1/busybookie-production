import { productIdentity } from "../../productIdentity";
import { PRIMARY_NAV, START_OPTIONS_HREF, type RouteId } from "../../routes";
import { ButtonLink } from "./ButtonLink";
import { MobileNavigation } from "./MobileNavigation";
import { Wordmark } from "./Wordmark";

type SiteHeaderProps = {
  currentRouteId: RouteId | null;
};

export function SiteHeader({ currentRouteId }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <a href="/" className="site-header__home" aria-label={`${productIdentity.name} home`}>
          <Wordmark />
        </a>
        <nav aria-label="Primary" className="primary-nav">
          <ul className="primary-nav__list">
            {PRIMARY_NAV.map((route) => (
              <li key={route.id}>
                <a
                  href={route.path}
                  className="primary-nav__link"
                  aria-current={route.id === currentRouteId ? "page" : undefined}
                >
                  {route.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ButtonLink href={START_OPTIONS_HREF} className="site-header__cta">
          Explore free options
        </ButtonLink>
        <MobileNavigation currentRouteId={currentRouteId} />
      </div>
    </header>
  );
}
