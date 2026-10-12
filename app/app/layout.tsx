import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-shell/app-header";
import { SidebarNav } from "@/components/app-shell/sidebar-nav";
import { Logo } from "@/components/marketing/logo";
import { Toaster } from "@/components/ui/toaster";
import { ensureCurrentUser } from "@/lib/services/current-user";

// The session read sits behind Suspense because Cache Components forbids
// request data in the static shell. This is an extra layer only: every page
// under /app runs its own `auth.protect()`. It also creates the creator's
// `users` row on first visit; that is fail-soft and never blocks the page.
async function RequireSession() {
  const { userId } = await auth.protect();
  await ensureCurrentUser(userId);
  return null;
}

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Suspense>
        <RequireSession />
      </Suspense>
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface lg:block">
          <div className="sticky top-0 flex flex-col gap-8 p-6">
            <Link href="/app" aria-label="CreateHive dashboard">
              <Logo />
            </Link>
            <SidebarNav label="App" />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />
          <main id="main" className="container-wide flex-1 py-8 md:py-12">
            {children}
          </main>
        </div>
      </div>
      <Toaster />
    </>
  );
}
