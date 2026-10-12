import { z } from "zod";

// Loose JSON objects for columns whose shape belongs to a later feature:
// `research_signals.payload`, `analytics_snapshots.raw` and
// `usage_events.metadata`. Tighten each when its feature defines it.

export const jsonObject = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof jsonObject>;

export const researchSignalPayload = jsonObject;
export const analyticsRaw = jsonObject;
export const usageMetadata = jsonObject;
