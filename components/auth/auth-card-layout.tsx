import { ClerkFailed, ClerkLoading } from "@clerk/nextjs";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Logo } from "@/components/marketing/logo";

// Clerk's <SignIn />/<SignUp /> read the URL on a catch-all route, which Cache
// Components only allows behind Suspense. The form itself is drawn by a script
// Clerk downloads in the browser, so we also cover the "still loading" and
// "script blocked / failed" states instead of leaving a blank page.
export function AuthCardLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="hero-backdrop flex flex-1 flex-col items-center gap-8 px-4 py-12 md:py-20">
      <Link href="/" aria-label="CreateHive home">
        <Logo />
      </Link>
      <ClerkLoading>
        <div
          role="status"
          aria-live="polite"
          className="card w-full max-w-[25rem] text-center font-semibold"
        >
          Loading secure sign-in…
        </div>
      </ClerkLoading>
      <ClerkFailed>
        <div role="alert" className="card w-full max-w-[25rem] stack-sm text-center">
          <h2 className="text-heading">We couldn&apos;t load sign-in</h2>
          <p className="text-muted-foreground">
            The sign-in form comes from our authentication provider and didn&apos;t load. Check your
            connection, disable any ad or tracking blocker for this site, then reload the page.
          </p>
        </div>
      </ClerkFailed>
      <Suspense>{children}</Suspense>
    </main>
  );
}
