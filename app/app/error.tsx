"use client";

import { ErrorScreen } from "@/components/errors/error-screen";

// Route boundary inside the app shell: navigation stays usable while this shows.
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorScreen error={error} retry={retry} homeHref="/app" homeLabel="Back to dashboard" />;
}
