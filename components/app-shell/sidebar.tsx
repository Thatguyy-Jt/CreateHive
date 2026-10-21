import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { SidebarNav } from "./sidebar-nav";

/** Desktop sidebar: logo, then grouped nav. */
export function Sidebar() {
  return (
    <aside className="app-sidebar hidden lg:flex">
      <div className="app-sidebar-brand">
        <Link href="/app" aria-label="CreateHive dashboard">
          <Logo />
        </Link>
      </div>
      <SidebarNav label="App" />
    </aside>
  );
}
