import type { Event } from "@sentry/nextjs";

// Shared by the server, edge and browser init files. Sentry stays off unless a
// DSN is set, so local dev, CI and tests behave exactly as without it.

type EnvSource = Record<string, string | undefined>;

export function sentryEnabled(env: EnvSource = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SENTRY_DSN?.trim()) && env.NODE_ENV !== "test";
}

/**
 * Removes everything that could identify a creator or carry their content:
 * cookies, headers, request bodies, query strings and the user. Pure, so it is
 * unit tested. Runs as `beforeSend` on every runtime.
 */
export function scrubEvent<T extends Event>(event: T): T {
  if (event.request) {
    const { cookies, headers, data, query_string, ...request } = event.request;
    void cookies;
    void headers;
    void data;
    void query_string;
    event.request = request;
  }
  delete event.user;
  return event;
}

export function baseSentryOptions(env: EnvSource = process.env) {
  return {
    dsn: env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined,
    enabled: sentryEnabled(env),
    // No IP addresses or cookies by default. Replay and the feedback widget are
    // deliberately not enabled: they would record creator content.
    sendDefaultPii: false,
    tracesSampleRate: env.NODE_ENV === "development" ? 1.0 : 0.1,
    beforeSend: scrubEvent,
  };
}
