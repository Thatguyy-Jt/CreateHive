"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import Link from "next/link";

// Sign-in / sign-up are plain links so they render in the static HTML and work
// even if Clerk's browser script is slow or blocked. Once Clerk reports a
// session they are swapped for "Open app". Using the hook (not the server
// `Show`) also keeps the marketing page prerendered.
export function AuthActions({
  size = "default",
  showSignIn = false,
  showUserButton = false,
  className = "",
}: {
  size?: "sm" | "default" | "lg";
  showSignIn?: boolean;
  showUserButton?: boolean;
  className?: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const sizeClass = size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : "";

  return (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${className}`}>
      {isLoaded && isSignedIn ? (
        <>
          <Link href="/app" className={`btn btn-primary ${sizeClass}`}>
            Open app
          </Link>
          {showUserButton && <UserButton />}
        </>
      ) : (
        <>
          {showSignIn && (
            <Link href="/sign-in" className={`btn btn-ghost ${sizeClass}`}>
              Sign in
            </Link>
          )}
          <Link href="/sign-up" className={`btn btn-primary ${sizeClass}`}>
            Get started
          </Link>
        </>
      )}
    </div>
  );
}
