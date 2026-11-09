import { useEffect } from "react";

import { SiteFooter } from "./components/site/SiteFooter";
import { SiteHeader } from "./components/site/SiteHeader";
import { HomePage } from "./pages/HomePage";
import { PricingPage } from "./pages/PricingPage";
import { SolutionsPage } from "./pages/SolutionsPage";
import { pageTitle } from "./productIdentity";
import { ROUTES, resolveRoute, type SiteRoute } from "./routes";

function PageContent({ route }: { route: SiteRoute | null }) {
  switch (route?.id) {
    case "home":
      return <HomePage />;
    case "solutions":
      return <SolutionsPage />;
    case "pricing":
      return <PricingPage />;
    default:
      return <NotFound />;
  }
}

/** Fallback for paths outside the three phase-1 routes. Not a marketing page. */
function NotFound() {
  return (
    <section className="page-intro" aria-labelledby="not-found-title">
      <div className="section__inner">
        <h1 id="not-found-title" className="page-title">
          Page not found
        </h1>
        <p className="page-intro__lead">This address does not match a page on this site.</p>
        <ul className="not-found__links">
          {ROUTES.map((route) => (
            <li key={route.id}>
              <a href={route.path} className="text-link">
                {route.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function App() {
  const route = resolveRoute(window.location.pathname);

  useEffect(() => {
    document.title = pageTitle(route === null ? "Page not found" : route.title);
  }, [route]);

  // A link such as /#start-options from another page loads the document
  // before React renders the target, so the browser cannot scroll to it.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id === "" ? null : document.getElementById(id);

    if (target !== null && typeof target.scrollIntoView === "function") {
      target.scrollIntoView();
    }
  }, []);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <SiteHeader currentRouteId={route?.id ?? null} />
      <main id="main-content" tabIndex={-1}>
        <PageContent route={route} />
      </main>
      <SiteFooter />
    </>
  );
}
