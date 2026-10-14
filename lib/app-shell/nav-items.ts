// Product map for the /app sidebar. Only "live" items link anywhere; "soon"
// items are shown disabled until their route exists (AGENTS.md §14).
export type NavItem =
  | {
      label: string;
      status: "live";
      href:
        | "/app"
        | "/app/strategy"
        | "/app/opportunities"
        | "/app/research"
        | "/app/calendar"
        | "/app/studio"
        | "/app/settings";
    }
  | { label: string; status: "soon" };

export const navItems: NavItem[] = [
  { label: "Dashboard", status: "live", href: "/app" },
  { label: "Strategy", status: "live", href: "/app/strategy" },
  { label: "Opportunities", status: "live", href: "/app/opportunities" },
  { label: "Research", status: "live", href: "/app/research" },
  { label: "Calendar", status: "live", href: "/app/calendar" },
  { label: "Studio", status: "live", href: "/app/studio" },
  { label: "Analytics", status: "soon" },
  { label: "Insights", status: "soon" },
  { label: "Settings", status: "live", href: "/app/settings" },
];
