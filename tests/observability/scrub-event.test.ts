import type { Event } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrubEvent } from "@/lib/observability/sentry-options";

describe("scrubEvent", () => {
  it("removes cookies, headers, body, query string and user, and keeps the rest", () => {
    const event: Event = {
      message: "ai_generation_failed",
      tags: { kind: "smoke_test" },
      user: { id: "user_123", email: "creator@example.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://example.com/app/settings",
        method: "POST",
        cookies: { __session: "secret" },
        headers: { authorization: "Bearer secret", cookie: "__session=secret" },
        data: { prompt: "private creator text" },
        query_string: "email=creator@example.com",
      },
    };

    const result = scrubEvent(event);

    expect(result.user).toBeUndefined();
    expect(result.request).toEqual({ url: "https://example.com/app/settings", method: "POST" });
    expect(result.message).toBe("ai_generation_failed");
    expect(result.tags).toEqual({ kind: "smoke_test" });
    expect(JSON.stringify(result)).not.toMatch(/secret|creator@example|private creator text|1\.2\.3\.4/);
  });

  it("handles events without a request or user", () => {
    expect(scrubEvent({ message: "x" })).toEqual({ message: "x" });
  });
});
