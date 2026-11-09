import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { ROUTES, START_OPTIONS_HREF, type RouteId } from "../../routes";
import { ButtonLink } from "./ButtonLink";

/** Matches the CSS breakpoint at which the full header navigation appears. */
export const FULL_NAVIGATION_QUERY = "(min-width: 48rem)";

type MobileNavigationProps = {
  currentRouteId: RouteId | null;
};

/**
 * Disclosure-pattern navigation for narrow viewports. The toggle reports its
 * state with aria-expanded; Escape closes the panel and returns focus to the
 * toggle; following a link or widening past the breakpoint closes it.
 */
export function MobileNavigation({ currentRouteId }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia(FULL_NAVIGATION_QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        setOpen(false);
      }
    };

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="mobile-nav">
      <button
        ref={toggleRef}
        type="button"
        className="mobile-nav__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <X aria-hidden="true" focusable="false" size={20} />
        ) : (
          <Menu aria-hidden="true" focusable="false" size={20} />
        )}
        <span>Menu</span>
      </button>
      <div id={panelId} className="mobile-nav__panel" hidden={!open}>
        <nav aria-label="Mobile">
          <ul className="mobile-nav__list">
            {ROUTES.map((route) => (
              <li key={route.id}>
                <a
                  href={route.path}
                  className="mobile-nav__link"
                  aria-current={route.id === currentRouteId ? "page" : undefined}
                  onClick={close}
                >
                  {route.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <ButtonLink href={START_OPTIONS_HREF} block onClick={close}>
          Explore free options
        </ButtonLink>
      </div>
    </div>
  );
}
