// Phase-1 public routes. Exactly three pages; resolution is a pure function
// of window.location.pathname so no router dependency is needed.
export type RouteId = "home" | "solutions" | "pricing";

export type SiteRoute = {
  id: RouteId;
  path: string;
  label: string;
  /** Page name for the document title; null uses the bare product name. */
  title: string | null;
};

export const ROUTES: readonly SiteRoute[] = [
  { id: "home", path: "/", label: "Home", title: null },
  { id: "solutions", path: "/solutions", label: "Solutions", title: "Solutions" },
  { id: "pricing", path: "/pricing", label: "Pricing", title: "Pricing" },
];

/** Links shown in the primary navigation (the wordmark links Home). */
export const PRIMARY_NAV: readonly SiteRoute[] = ROUTES.filter((route) => route.id !== "home");

/** The truthful in-site destination for every "start free" call to action. */
export const START_OPTIONS_HREF = "/#start-options";

export function resolveRoute(pathname: string): SiteRoute | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const path = normalized === "" || normalized === "/index.html" ? "/" : normalized.toLowerCase();
  return ROUTES.find((route) => route.path === path) ?? null;
}
