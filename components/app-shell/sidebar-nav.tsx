"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { navItems } from "@/lib/app-shell/nav-items";

/**
 * Under a dynamic route (`/app/studio/[id]`) the pathname is only known at
 * request time, so the active-link reader sits behind Suspense. The fallback
 * is the same nav without an active link, so the shell still prerenders.
 */
export function SidebarNav({ label }: { label: string }) {
  return (
    <Suspense fallback={<NavList label={label} pathname={null} />}>
      <ActiveNav label={label} />
    </Suspense>
  );
}

function ActiveNav({ label }: { label: string }) {
  return <NavList label={label} pathname={usePathname()} />;
}

function NavList({ label, pathname }: { label: string; pathname: string | null }) {
  return (
    <nav aria-label={label}>
      <ul className="grid gap-1 text-sm font-semibold">
        {navItems.map((item) => {
          if (item.status === "soon") {
            return (
              <li key={item.label}>
                <span
                  aria-disabled="true"
                  className="flex min-h-11 cursor-not-allowed items-center justify-between gap-3 rounded-sm px-3 text-muted-foreground"
                >
                  {item.label}
                  <span className="rounded-pill border border-border px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide">
                    Soon
                  </span>
                </span>
              </li>
            );
          }

          const active = pathname === item.href;
          return (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-sm border-l-4 px-3 ${
                  active
                    ? "border-accent bg-surface-muted"
                    : "border-transparent hover:bg-surface-muted"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
