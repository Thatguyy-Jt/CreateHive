import { describe, expect, it } from "vitest";
import { checkCronAuth } from "@/lib/jobs/cron-auth";

const ENV = { CRON_SECRET: "s3cret-value-that-is-long-enough" };

describe("checkCronAuth", () => {
  it.each([{}, { CRON_SECRET: "" }, { CRON_SECRET: "   " }])("refuses everything without a secret (%o)", (env) => {
    expect(checkCronAuth(`Bearer ${ENV.CRON_SECRET}`, env)).toBe("not_configured");
  });

  it.each([
    ["no header", null],
    ["the wrong scheme", `Basic ${ENV.CRON_SECRET}`],
    ["a wrong secret of the same length", `Bearer ${"x".repeat(ENV.CRON_SECRET.length)}`],
    ["a shorter secret", "Bearer s3cret"],
    ["the bare secret", ENV.CRON_SECRET],
  ])("rejects %s", (_label, header) => {
    expect(checkCronAuth(header, ENV)).toBe("unauthorized");
  });

  it("accepts the exact bearer token", () => {
    expect(checkCronAuth(`Bearer ${ENV.CRON_SECRET}`, ENV)).toBe("ok");
  });
});
