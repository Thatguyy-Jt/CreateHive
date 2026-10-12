import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { SidebarNav } from "./sidebar-nav";

// Mobile/tablet top bar. On desktop the sidebar takes over navigation and this
// bar only carries the user menu.
export function AppHeader() {
  return (
    <header className="site-header">
      <div className="flex min-h-16 items-center justify-between gap-4 px-4 md:px-6 lg:justify-end lg:px-8">
        <Link href="/app" aria-label="CreateHive dashboard" className="lg:hidden">
          <Logo />
        </Link>
        <div className="flex items-center gap-3">
          <details className="disclosure relative lg:hidden">
            <summary className="btn btn-ghost btn-sm" aria-label="Menu">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
              Menu
            </summary>
            <div className="card shadow-float absolute right-0 top-full z-50 mt-2 w-64 p-3 md:p-3">
              <SidebarNav label="Mobile" />
            </div>
          </details>
          <UserButton />
        </div>
      </div>
    </header>
  );
}
