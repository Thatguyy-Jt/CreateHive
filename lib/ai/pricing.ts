/**
 * USD per million tokens, from OpenAI's models page (checked 2026-10-11).
 * Bump the version whenever a price changes. Cached-input discounts are
 * ignored, so recorded cost is a conservative upper bound.
 */
export const PRICING_VERSION = "2026-10-11";

export const MODEL_PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-6.1-sol": { input: 2, output: 10 },
  "gpt-6-luna": { input: 0.1, output: 0.5 },
};

/**
 * Cost in micro-dollars, rounded up. A price in $/MTok equals µ$/token. The
 * arithmetic runs in hundredths of a µ$ so fractional prices like $0.10 stay
 * exact. Returns null for a model without a price rather than guessing.
 */
export function costMicros(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const price = Object.hasOwn(MODEL_PRICES_USD_PER_MTOK, modelId) ? MODEL_PRICES_USD_PER_MTOK[modelId] : undefined;
  if (!price) return null;
  const hundredths =
    inputTokens * Math.round(price.input * 100) + outputTokens * Math.round(price.output * 100);
  return Math.ceil(hundredths / 100);
}
