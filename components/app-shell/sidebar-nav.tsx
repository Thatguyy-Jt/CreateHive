"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { isActiveHref, NAV_GROUPS, navItems, type NavItem } from "@/lib/app-shell/nav-items";
import { Icon } from "./icons";

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
  const pinned = navItems.filter((item) => item.group === null);
  return (
    <nav aria-label={label} className="app-nav">
      {NAV_GROUPS.map((group) => {
        const items = navItems.filter((item) => item.group === group);
        if (!items.length) return null;
        const groupId = `nav-${label}-${group}`.toLowerCase();
        return (
          <div key={group} className="app-nav-group">
            <p id={groupId} className="app-nav-group-label">
              {group}
            </p>
            <ul aria-labelledby={groupId} className="grid gap-0.5">
              {items.map((item) => (
                <NavEntry key={item.label} item={item} pathname={pathname} />
              ))}
            </ul>
          </div>
        );
      })}
      {pinned.length ? (
        <ul className="app-nav-pinned grid gap-0.5">
          {pinned.map((item) => (
            <NavEntry key={item.label} item={item} pathname={pathname} />
          ))}
        </ul>
      ) : null}
    </nav>
  );
}

function NavEntry({ item, pathname }: { item: NavItem; pathname: string | null }) {
  if (item.status === "soon") {
    return (
      <li>
        <span aria-disabled="true" className="app-nav-item cursor-not-allowed">
          <Icon name={item.icon} size={20} />
          <span className="flex-1">{item.label}</span>
          <span className="badge-soon">
            Soon
          </span>
        </span>
      </li>
    );
  }

  const active = isActiveHref(item.href, pathname);
  return (
    <li>
      <Link href={item.href} aria-current={active ? "page" : undefined} className="app-nav-item">
        <Icon name={item.icon} size={20} className="app-nav-icon" />
        {item.label}
      </Link>
    </li>
  );
}
