import type { ApplicationRoute, ApplicationRouter } from "../createCommercialApiServer.js";

// The first router that recognises a path handles it. Routers own disjoint
// path prefixes, so order only matters for clarity.
export function combineApplicationRouters(...routers: readonly ApplicationRouter[]): ApplicationRouter {
  return Object.freeze({
    route: (pathname: string): ApplicationRoute | null => {
      for (const router of routers) {
        const route = router.route(pathname);
        if (route !== null) return route;
      }
      return null;
    },
  });
}
