import { describe, expect, it } from "vitest";
import { costMicros } from "@/lib/ai/pricing";

describe("costMicros", () => {
  it("prices input and output tokens in micro-dollars ($/MTok = µ$/token)", () => {
    // 1,000 × $2 + 500 × $10 per million = 2,000 + 5,000 µ$
    expect(costMicros("gpt-6.1-sol", 1_000, 500)).toBe(7_000);
    // 120 × $0.10 + 30 × $0.50 per million = 12 + 15 µ$
    expect(costMicros("gpt-6-luna", 120, 30)).toBe(27);
  });

  it("rounds fractional micro-dollars up", () => {
    // 1 × $0.10 per million = 0.1 µ$ → 1
    expect(costMicros("gpt-6-luna", 1, 0)).toBe(1);
    // 3 × 0.1 + 1 × 0.5 = 0.8 µ$ → 1, with no floating-point drift above it
    expect(costMicros("gpt-6-luna", 3, 1)).toBe(1);
    expect(costMicros("gpt-6-luna", 10, 0)).toBe(1);
    expect(costMicros("gpt-6-luna", 0, 0)).toBe(0);
  });

  it("returns null for a model without a price", () => {
    expect(costMicros("gpt-unknown", 100, 100)).toBeNull();
    expect(costMicros("constructor", 100, 100)).toBeNull();
  });
});
