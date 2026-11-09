import { productIdentity } from "../../productIdentity";
import { ROUTES, START_OPTIONS_HREF } from "../../routes";
import { Wordmark } from "./Wordmark";

// Only destinations that exist in this slice. No placeholder company,
// legal, help or resource links.
const START_LINKS = [
  { href: START_OPTIONS_HREF, label: "Free entry options" },
  { href: "/pricing#billing", label: "How billing works" },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Wordmark />
          <p className="site-footer__description">{productIdentity.compactDescription}</p>
        </div>
        <nav aria-label="Footer" className="site-footer__nav">
          <div className="site-footer__column">
            <p id="footer-product" className="site-footer__heading">
              Product
            </p>
            <ul aria-labelledby="footer-product">
              {ROUTES.map((route) => (
                <li key={route.id}>
                  <a href={route.path}>{route.label}</a>
                </li>
              ))}
            </ul>
          </div>
          <div className="site-footer__column">
            <p id="footer-start" className="site-footer__heading">
              Start
            </p>
            <ul aria-labelledby="footer-start">
              {START_LINKS.map((link) => (
                <li key={link.href}>
                  <a href={link.href}>{link.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <p className="site-footer__notice">
          {productIdentity.name} is a provisional name. The platform is in development: capabilities, availability and
          commercial terms described on this site may change, and product previews are conceptual.
        </p>
      </div>
    </footer>
  );
}
