import { z } from "zod";
import { MANUAL_SIGNAL_TYPES, SIGNAL_SOURCES, SIGNAL_TYPES, type SignalType } from "./labels";
import { MANUAL_TEXT_MAX } from "./limits";
import type { EvidenceKind } from "./opportunities";

// Research signals (`research_signals`). `source` and `signal_type` are
// unconstrained text in the database; the closed vocabularies live in code.
// Signals are inputs the creator can inspect, never facts (AGENTS.md §12).

// Value lists, labels and MANUAL_TEXT_MAX are in the zod-free ./labels and
// ./limits (client components import them from there); re-exported here.
export { SIGNAL_SOURCE_LABELS, SIGNAL_TYPE_LABELS } from "./labels";
export type { ManualSignalType, SignalSource, SignalType } from "./labels";
export { MANUAL_TEXT_MAX } from "./limits";

export const signalSource = z.enum(SIGNAL_SOURCES);
export const manualSignalType = z.enum(MANUAL_SIGNAL_TYPES);
export const signalType = z.enum(SIGNAL_TYPES);

/** The evidence kind an opportunity uses when it cites a signal of this type. */
export const SIGNAL_EVIDENCE_KIND: Record<SignalType, EvidenceKind> = {
  audience_comment: "audience_comment",
  competitor_note: "competitor",
  creator_note: "creator_input",
  video: "research_signal",
};

export const MANUAL_LABEL_MAX = 120;
export const SOURCE_URL_MAX = 500;

// ---------------------------------------------------------------------------
// Payloads (validated on write and re-validated on read)
// ---------------------------------------------------------------------------

export const manualSignalPayload = z.object({
  text: z.string().trim().min(1).max(MANUAL_TEXT_MAX),
  label: z.string().trim().min(1).max(MANUAL_LABEL_MAX).nullable(),
});
export type ManualSignalPayload = z.infer<typeof manualSignalPayload>;

export const youtubeSignalPayload = z.object({
  video_id: z.string().min(1).max(64),
  channel_title: z.string().max(200),
  published_at: z.iso.datetime({ offset: true }),
  view_count: z.number().int().nonnegative().nullable(),
  like_count: z.number().int().nonnegative().nullable(),
  comment_count: z.number().int().nonnegative().nullable(),
  query: z.string().max(300),
});
export type YouTubeSignalPayload = z.infer<typeof youtubeSignalPayload>;

/** Either payload shape; `research_signals.payload`. */
export const researchSignalPayload = z.union([manualSignalPayload, youtubeSignalPayload]);

// ---------------------------------------------------------------------------
// Creator input
// ---------------------------------------------------------------------------

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, { error: message })
    .transform((value) => (value === "" ? null : value));

/** An `https` link only: stored and shown as a link, never fetched. */
export const httpsUrl = z
  .url({ protocol: /^https$/, error: "Use a full link that starts with https://" })
  .max(SOURCE_URL_MAX, { error: `Keep the link under ${SOURCE_URL_MAX} characters.` });

export const manualSignalInput = z.object({
  type: z.enum(manualSignalType.options, { error: "Choose what kind of signal this is." }),
  text: z
    .string()
    .trim()
    .min(1, { error: "Paste or write the signal." })
    .max(MANUAL_TEXT_MAX, { error: `Keep it under ${MANUAL_TEXT_MAX.toLocaleString("en-US")} characters.` }),
  label: optionalText(MANUAL_LABEL_MAX, `Keep the label under ${MANUAL_LABEL_MAX} characters.`),
  source_url: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(httpsUrl.nullable()),
});
export type ManualSignalInput = z.infer<typeof manualSignalInput>;

// ---------------------------------------------------------------------------
// Stored rows
// ---------------------------------------------------------------------------

const rowBase = {
  id: z.string(),
  title: z.string().nullable(),
  source_url: httpsUrl.nullable(),
  fetched_at: z.string(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
};

export const storedSignal = z.discriminatedUnion("source", [
  z.object({ ...rowBase, source: z.literal("manual"), signal_type: manualSignalType, payload: manualSignalPayload }),
  z.object({ ...rowBase, source: z.literal("youtube"), signal_type: z.literal("video"), payload: youtubeSignalPayload }),
]);
export type StoredSignal = z.infer<typeof storedSignal>;
