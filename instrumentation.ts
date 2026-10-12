import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Server Component, route handler, action and proxy errors. They pass through
// the same `beforeSend` scrubbing as every other event.
export const onRequestError = Sentry.captureRequestError;
