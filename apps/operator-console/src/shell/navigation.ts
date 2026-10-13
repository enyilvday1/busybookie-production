import { LayoutDashboard, type LucideIcon } from "lucide-react";

// Primary navigation model. D2 exposes Overview only; later milestones append
// destinations here as they become real (no placeholder or disabled entries).
export type NavigationItemId = "overview";

export type NavigationItem = Readonly<{
  id: NavigationItemId;
  label: string;
  href: string;
  icon: LucideIcon;
}>;

export const PRIMARY_NAVIGATION: readonly NavigationItem[] = Object.freeze([
  Object.freeze({
    id: "overview",
    label: "Overview",
    href: "/",
    icon: LayoutDashboard,
  }),
]);

export const MAIN_CONTENT_ID = "main-content";

// Desktop shell breakpoint (Step 992A 3H). Below it the primary navigation
// lives in the modal NavigationDrawer.
export const DESKTOP_MEDIA_QUERY = "(min-width: 64rem)";
