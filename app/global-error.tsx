"use client";

import { ErrorScreen } from "@/components/errors/error-screen";
// This file replaces the root layout when active, so it must bring its own
// document and global styles (and cannot use the layout's fonts).
import "./globals.css";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full items-center justify-center px-4 py-8">
        <ErrorScreen error={error} retry={retry} homeHref="/" homeLabel="Go to homepage" />
      </body>
    </html>
  );
}
