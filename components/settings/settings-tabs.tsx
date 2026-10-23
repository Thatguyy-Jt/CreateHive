"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/app/settings", label: "General" },
  { href: "/app/settings/billing", label: "Billing" },
] as const;

/** General / Billing. Billing owns its sub-routes (receipts). */
export function SettingsTabs() {
  return <TabList pathname={usePathname()} />;
}

/** The same tabs with none marked current: the Suspense fallback while the pathname is read. */
export function SettingsTabsFallback() {
  return <TabList pathname={null} />;
}

function TabList({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Settings sections" className="-mx-1 overflow-x-auto px-1">
      <ul className="flex gap-2">
        {TABS.map(({ href, label }) => {
          const active = href === "/app/settings" ? pathname === href : pathname?.startsWith(href) === true;
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-pill border px-4 text-sm font-semibold ${
                  active ? "border-foreground bg-surface-muted" : "border-border hover:border-muted-foreground"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
