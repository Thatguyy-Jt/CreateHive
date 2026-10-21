"use client";

import { usePathname } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { Icon } from "./icons";
import { SidebarNav } from "./sidebar-nav";

/** Runs `onNavigate` whenever the route changes (client navigation keeps <details> open). */
function CloseOnNavigate({ onNavigate }: { onNavigate: () => void }) {
  const pathname = usePathname();
  useEffect(() => {
    onNavigate();
  }, [pathname, onNavigate]);
  return null;
}

/** Mobile/tablet menu: a native <details> panel holding the same nav as the sidebar. */
export function MobileNav() {
  const menu = useRef<HTMLDetailsElement>(null);

  const close = useCallback(() => {
    if (menu.current) menu.current.open = false;
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
    if (event.key !== "Escape" || !menu.current?.open) return;
    close();
    menu.current.querySelector("summary")?.focus();
  };

  // Tapping the current page's link doesn't change the route, so close here too.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a")) close();
  };

  return (
    <details ref={menu} className="disclosure app-mobile-menu" onKeyDown={onKeyDown}>
      <summary className="btn btn-ghost btn-sm" aria-label="Menu">
        <Icon name="menu" size={20} />
        <span className="hidden sm:inline">Menu</span>
      </summary>
      <div className="app-mobile-panel" onClick={onClick}>
        <SidebarNav label="Mobile" />
      </div>
      <Suspense>
        <CloseOnNavigate onNavigate={close} />
      </Suspense>
    </details>
  );
}
