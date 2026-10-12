"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect, useRef } from "react";

interface ErrorScreenProps {
  error: Error & { digest?: string };
  retry: () => void;
  /** Where the secondary action goes: the dashboard inside the app, the homepage at the root. */
  homeHref: string;
  homeLabel: string;
}

/**
 * Shared body for `app/app/error.tsx` and `app/global-error.tsx`. Shows what
 * happened and what to do next, plus the digest as a reference code. It never
 * shows the error message or stack.
 */
export function ErrorScreen({ error, retry, homeHref, homeLabel }: ErrorScreenProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Errors rendered on the server are already reported by `onRequestError`;
    // this covers browser-side errors and passes through the same scrubbing.
    Sentry.captureException(error);
  }, [error]);

  useEffect(() => {
    // Announce the failure to screen readers by moving focus to the heading.
    heading.current?.focus();
  }, []);

  return (
    <section className="card stack-sm w-full max-w-xl" aria-labelledby="error-heading">
      <h1 id="error-heading" ref={heading} tabIndex={-1} className="text-heading">
        Something went wrong
      </h1>
      <p className="text-muted-foreground">
        We&apos;ve been notified and are looking into it. Your work is saved. Try again, and if it keeps
        happening, mention this code when you contact us.
      </p>
      {error.digest ? (
        <p className="font-mono text-sm text-muted-foreground">Reference: {error.digest}</p>
      ) : null}
      <div className="flex flex-col gap-3 pt-2 min-[480px]:flex-row">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          Try again
        </button>
        <Link href={homeHref} className="btn btn-secondary">
          {homeLabel}
        </Link>
      </div>
    </section>
  );
}
