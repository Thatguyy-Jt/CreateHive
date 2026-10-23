// Product map for the /app sidebar. Only "live" items link anywhere; "soon"
// items are shown disabled until their route exists (AGENTS.md §14).
export type NavIconName =
  | "dashboard"
  | "strategy"
  | "opportunities"
  | "research"
  | "calendar"
  | "studio"
  | "analytics"
  | "insights"
  | "billing"
  | "settings";

/** Sidebar sections, in display order. `null` items are pinned at the bottom. */
export const NAV_GROUPS = ["Plan", "Create", "Measure"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number] | null;

export type NavItem =
  | {
      label: string;
      status: "live";
      icon: NavIconName;
      group: NavGroup;
      href:
        | "/app"
        | "/app/strategy"
        | "/app/opportunities"
        | "/app/research"
        | "/app/calendar"
        | "/app/studio"
        | "/app/analytics"
        | "/app/insights"
        | "/app/settings";
    }
  | { label: string; status: "soon"; icon: NavIconName; group: NavGroup };

export const navItems: NavItem[] = [
  { label: "Dashboard", status: "live", icon: "dashboard", group: "Plan", href: "/app" },
  { label: "Strategy", status: "live", icon: "strategy", group: "Plan", href: "/app/strategy" },
  { label: "Opportunities", status: "live", icon: "opportunities", group: "Plan", href: "/app/opportunities" },
  { label: "Research", status: "live", icon: "research", group: "Plan", href: "/app/research" },
  { label: "Calendar", status: "live", icon: "calendar", group: "Create", href: "/app/calendar" },
  { label: "Studio", status: "live", icon: "studio", group: "Create", href: "/app/studio" },
  { label: "Analytics", status: "live", icon: "analytics", group: "Measure", href: "/app/analytics" },
  { label: "Insights", status: "live", icon: "insights", group: "Measure", href: "/app/insights" },
  { label: "Settings", status: "live", icon: "settings", group: null, href: "/app/settings" },
];

/** `/app` matches only itself; every other item also owns its sub-routes. */
export function isActiveHref(href: string, pathname: string | null): boolean {
  if (!pathname) return false;
  if (href === "/app") return pathname === "/app";
  return pathname === href || pathname.startsWith(`${href}/`);
}
