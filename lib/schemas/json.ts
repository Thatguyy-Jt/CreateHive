import { z } from "zod";

// Loose JSON objects for columns whose shape belongs to a later feature:
// `analytics_snapshots.raw` and `usage_events.metadata`. Tighten each when its
// feature defines it. `research_signals.payload` is typed in ./research.

export const jsonObject = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof jsonObject>;

export const analyticsRaw = jsonObject;
export const usageMetadata = jsonObject;
