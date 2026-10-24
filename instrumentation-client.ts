import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/observability/sentry-options";

// No replay and no feedback widget: both would record creator content.
// Next.js inlines `process.env.NEXT_PUBLIC_*` only when written out literally;
// the `process.env` object itself is empty in the browser, so pass each one.
Sentry.init(
  baseSentryOptions({
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
  }),
);

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
