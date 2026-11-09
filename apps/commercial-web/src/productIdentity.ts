// Single source of truth for the public product identity.
//
// The commercial product name and domain are NOT decided. Every visible
// mention of the product name reads from here, so replacing the placeholder
// is a one-file change. Components, CSS classes, tokens and file names must
// never encode a prospective product name.
export const productIdentity = {
  name: "[Product Name]",
  isProvisional: true,
  category: "AI-powered creative-production platform",
  positioning:
    "Create children's, educational and family media — from stories and characters to video, audio, printables and branded content — in one AI-powered production platform.",
  compactDescription: "Stories, video, education, activities, audio, character IP and branded content.",
} as const;

export function pageTitle(pageName: string | null): string {
  return pageName === null ? productIdentity.name : `${pageName} · ${productIdentity.name}`;
}
