import * as Sentry from "@sentry/nextjs";
import { baseSentryOptions } from "@/lib/observability/sentry-options";

// No replay and no feedback widget: both would record creator content.
Sentry.init(baseSentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
