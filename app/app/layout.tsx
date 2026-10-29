import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import { nunitoSans } from "@/app/app-font";
import { AppHeader } from "@/components/app-shell/app-header";
import { Sidebar } from "@/components/app-shell/sidebar";
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
    <div className={`app-shell ${nunitoSans.variable}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Suspense>
        <RequireSession />
      </Suspense>
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main id="main" className="app-main">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
