// Product map for the /app sidebar. Only "live" items link anywhere; "soon"
// items are shown disabled until their route exists (AGENTS.md §14).
export type NavItem =
  | { label: string; status: "live"; href: "/app" | "/app/strategy" | "/app/settings" }
  | { label: string; status: "soon" };

export const navItems: NavItem[] = [
  { label: "Dashboard", status: "live", href: "/app" },
  { label: "Strategy", status: "live", href: "/app/strategy" },
  { label: "Opportunities", status: "soon" },
  { label: "Calendar", status: "soon" },
  { label: "Studio", status: "soon" },
  { label: "Analytics", status: "soon" },
  { label: "Insights", status: "soon" },
  { label: "Settings", status: "live", href: "/app/settings" },
];
