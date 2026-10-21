import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { Breadcrumbs } from "./breadcrumbs";
import { MobileNav } from "./mobile-nav";

// Top bar on every breakpoint. Desktop: where you are and who you are.
// Mobile/tablet: logo, menu and account.
export function AppHeader() {
  return (
    <header className="app-topbar">
      <Link href="/app" aria-label="CreateHive dashboard" className="lg:hidden">
        <Logo />
      </Link>
      <div className="hidden min-w-0 flex-1 lg:block">
        <Breadcrumbs />
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="lg:hidden">
          <MobileNav />
        </div>
        <div className="hidden lg:block">
          <UserButton showName />
        </div>
        <div className="lg:hidden">
          <UserButton />
        </div>
      </div>
    </header>
  );
}
