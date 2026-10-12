import { describe, expect, it } from "vitest";
import { baseSentryOptions, scrubEvent, sentryEnabled } from "@/lib/observability/sentry-options";

const DSN = "https://key@o1.ingest.sentry.io/2";

describe("sentryEnabled", () => {
  it("is off without a DSN, with a blank DSN, and in tests", () => {
    expect(sentryEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(sentryEnabled({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: "  " })).toBe(false);
    expect(sentryEnabled({ NODE_ENV: "test", NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(false);
  });

  it("is on with a DSN outside tests", () => {
    expect(sentryEnabled({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(true);
    expect(sentryEnabled({ NODE_ENV: "development", NEXT_PUBLIC_SENTRY_DSN: DSN })).toBe(true);
  });
});

describe("baseSentryOptions", () => {
  it("never sends default PII and scrubs every event", () => {
    const options = baseSentryOptions({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: DSN });
    expect(options.sendDefaultPii).toBe(false);
    expect(options.beforeSend).toBe(scrubEvent);
    expect(options).toMatchObject({ dsn: DSN, enabled: true });
  });

  it("samples every trace in development and 10% in production", () => {
    expect(baseSentryOptions({ NODE_ENV: "development" }).tracesSampleRate).toBe(1);
    expect(baseSentryOptions({ NODE_ENV: "production" }).tracesSampleRate).toBe(0.1);
  });

  it("is disabled with no DSN", () => {
    expect(baseSentryOptions({ NODE_ENV: "production" })).toMatchObject({ dsn: undefined, enabled: false });
  });

  it("does not enable replay or feedback", () => {
    const keys = Object.keys(baseSentryOptions({ NODE_ENV: "production", NEXT_PUBLIC_SENTRY_DSN: DSN }));
    expect(keys.filter((key) => /replay|feedback|integrations/i.test(key))).toEqual([]);
  });
});
