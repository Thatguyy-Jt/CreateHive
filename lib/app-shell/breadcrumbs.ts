import { isActiveHref, navItems } from "./nav-items";

export interface Crumb {
  label: string;
  /** Absent on the current page. */
  href?: string;
}

// Detail routes have no nav item of their own; their label is fixed.
const DETAIL_LABELS: Record<string, string> = {
  "/app/studio": "Content package",
  "/app/analytics": "Post results",
};

// Named sub-sections, matched by prefix (Settings › Billing, including receipts).
const SUB_SECTIONS: readonly { prefix: string; label: string }[] = [{ prefix: "/app/settings/billing", label: "Billing" }];

/**
 * "Section › Detail" from the pathname alone. No data, so it can render in the
 * shell. Dashboard isn't repeated as a root crumb: the sidebar already links it.
 */
export function breadcrumbsFor(pathname: string | null): Crumb[] {
  if (!pathname || pathname === "/app" || !pathname.startsWith("/app/")) return [{ label: "Dashboard" }];

  const section = navItems.find(
    (item): item is Extract<(typeof navItems)[number], { status: "live" }> =>
      item.status === "live" && item.href !== "/app" && isActiveHref(item.href, pathname),
  );
  if (!section) return [{ label: "Dashboard" }];
  if (pathname === section.href) return [{ label: section.label }];

  const sub = SUB_SECTIONS.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (sub) return [{ label: section.label, href: section.href }, { label: sub.label }];

  const detail = DETAIL_LABELS[section.href];
  if (!detail) return [{ label: section.label }];
  return [{ label: section.label, href: section.href }, { label: detail }];
}
