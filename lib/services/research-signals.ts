import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/observability/log";
import type { EvidenceKind } from "@/lib/schemas/opportunities";
import { parseWith } from "@/lib/schemas/parse";
import {
  SIGNAL_EVIDENCE_KIND,
  SIGNAL_TYPE_LABELS,
  storedSignal,
  type ManualSignalInput,
  type SignalSource,
  type SignalType,
  type StoredSignal,
} from "@/lib/schemas/research";
import type { Database, Json } from "@/lib/supabase/database.types";

type SignalClient = Pick<SupabaseClient<Database>, "from">;

/** Pasted signals a creator may keep. */
export const MANUAL_SIGNAL_LIMIT = 100;
/** Signals shown on /app/research. */
export const SIGNAL_LIST_LIMIT = 120;
/** Signals sent with one opportunity generation, and at most this many per source. */
export const PROMPT_SIGNAL_LIMIT = 12;
export const PROMPT_SIGNALS_PER_SOURCE = 6;
/** Characters of a signal's text sent to the model. */
export const PROMPT_EXCERPT_MAX = 240;

export const SIGNAL_COLUMNS = "id, source, signal_type, title, source_url, payload, fetched_at, expires_at, created_at";

function failed(event: string, stage: string, error: unknown) {
  logEvent("error", event, { stage, name: error instanceof Error ? error.name : typeof error });
}

/** Stable per-creator dedupe key for pasted text: case- and whitespace-insensitive. */
export function contentHash(type: SignalType, text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256").update(`${type}\n${normalized}`).digest("hex").slice(0, 32);
}

/** PostgREST filter: rows without an expiry, or not yet expired. */
export function notExpired(now: number): string {
  return `expires_at.is.null,expires_at.gt.${new Date(now).toISOString()}`;
}

function parseRows(rows: unknown[], event: string): StoredSignal[] {
  const signals: StoredSignal[] = [];
  for (const row of rows) {
    const parsed = parseWith(storedSignal, row);
    if (parsed.ok) signals.push(parsed.data);
    else logEvent("warn", event, { stage: "validate" });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Pasted signals
// ---------------------------------------------------------------------------

export type SignalErrorCode = "limit_reached" | "duplicate" | "not_found" | "db_error";

export const SIGNAL_ERRORS: Record<SignalErrorCode, string> = {
  limit_reached: `You can keep up to ${MANUAL_SIGNAL_LIMIT} pasted signals. Delete some you no longer need, then add more.`,
  duplicate: "You've already added this signal.",
  not_found: "We couldn't find that signal. Refresh the page and try again.",
  db_error: "We couldn't save that change. Please try again in a moment.",
};

export type SignalResult = { ok: true } | { ok: false; code: SignalErrorCode; message: string };

function signalFail(code: SignalErrorCode): SignalResult {
  return { ok: false, code, message: SIGNAL_ERRORS[code] };
}

/** Stores a pasted signal for the creator, under the per-creator cap. Never throws. */
export async function addManualSignal(
  client: SignalClient,
  userId: string,
  input: ManualSignalInput,
): Promise<SignalResult> {
  try {
    const existing = await client
      .from("research_signals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "manual");
    if (existing.error) {
      logEvent("error", "signal_save_failed", { stage: "count", db_code: existing.error.code });
      return signalFail("db_error");
    }
    if ((existing.count ?? 0) >= MANUAL_SIGNAL_LIMIT) return signalFail("limit_reached");

    const inserted = await client.from("research_signals").insert({
      user_id: userId,
      source: "manual",
      external_id: contentHash(input.type, input.text),
      signal_type: input.type,
      title: input.label,
      source_url: input.source_url,
      payload: { text: input.text, label: input.label } satisfies Json,
      expires_at: null,
    });
    if (inserted.error) {
      if (inserted.error.code === "23505") return signalFail("duplicate");
      logEvent("error", "signal_save_failed", { stage: "insert", db_code: inserted.error.code });
      return signalFail("db_error");
    }
    return { ok: true };
  } catch (error) {
    failed("signal_save_failed", "unexpected", error);
    return signalFail("db_error");
  }
}

/** Deletes one of the creator's signals. Ideas that cited it keep their copy of the evidence. Never throws. */
export async function deleteSignal(client: SignalClient, userId: string, signalId: string): Promise<SignalResult> {
  try {
    const deleted = await client
      .from("research_signals")
      .delete()
      .eq("id", signalId)
      .eq("user_id", userId)
      .select("id");
    if (deleted.error) {
      logEvent("error", "signal_delete_failed", { stage: "delete", db_code: deleted.error.code });
      return signalFail("db_error");
    }
    if (!deleted.data?.length) return signalFail("not_found");
    return { ok: true };
  } catch (error) {
    failed("signal_delete_failed", "unexpected", error);
    return signalFail("db_error");
  }
}

export type ListSignalsResult = { ok: true; signals: StoredSignal[] } | { ok: false };

/** The creator's unexpired signals, newest first. Rows that no longer validate are skipped. Never throws. */
export async function listSignals(
  client: SignalClient,
  userId: string,
  now: number = Date.now(),
): Promise<ListSignalsResult> {
  try {
    const rows = await client
      .from("research_signals")
      .select(SIGNAL_COLUMNS)
      .eq("user_id", userId)
      .or(notExpired(now))
      .order("fetched_at", { ascending: false })
      .limit(SIGNAL_LIST_LIMIT);
    if (rows.error) {
      logEvent("error", "signal_read_failed", { stage: "select", db_code: rows.error.code });
      return { ok: false };
    }
    return { ok: true, signals: parseRows(rows.data ?? [], "signal_read_skipped") };
  } catch (error) {
    failed("signal_read_failed", "unexpected", error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Signals for the Opportunity Agent
// ---------------------------------------------------------------------------

/** One signal as the model sees it (`ref`, `type`, `source`, `excerpt`) plus what the server resolves later. */
export interface PromptSignal {
  ref: string;
  type: SignalType;
  source: SignalSource;
  kind: EvidenceKind;
  /** Sent to the model: trimmed text, no URLs or ids. */
  excerpt: string;
  /** Server-side only, never sent to the model. */
  id: string;
  label: string;
  source_url: string | null;
  observed_at: string;
}

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function toPromptSignal(signal: StoredSignal, ref: string): PromptSignal {
  const base = { ref, id: signal.id, type: signal.signal_type, source: signal.source, source_url: signal.source_url };
  if (signal.source === "youtube") {
    const p = signal.payload;
    const parts = [
      signal.title ?? "Untitled video",
      p.channel_title ? `channel: ${p.channel_title}` : null,
      `published ${DATE.format(new Date(p.published_at))}`,
      p.view_count !== null ? `${p.view_count.toLocaleString("en-US")} views` : null,
    ].filter(Boolean);
    return {
      ...base,
      kind: SIGNAL_EVIDENCE_KIND.video,
      excerpt: clip(parts.join(" | "), PROMPT_EXCERPT_MAX),
      label: clip(`YouTube: ${signal.title ?? "video"}`, 200),
      observed_at: signal.fetched_at,
    };
  }
  const { text, label } = signal.payload;
  return {
    ...base,
    kind: SIGNAL_EVIDENCE_KIND[signal.signal_type],
    excerpt: clip(label ? `${label}: ${text}` : text, PROMPT_EXCERPT_MAX),
    label: clip(`${SIGNAL_TYPE_LABELS[signal.signal_type]}${label ? `: ${label}` : ""}`, 200),
    observed_at: signal.created_at,
  };
}

/** Newest first, at most `perSource` from each source and `total` overall, with refs S1, S2… */
export function selectPromptSignals(
  signals: readonly StoredSignal[],
  total = PROMPT_SIGNAL_LIMIT,
  perSource = PROMPT_SIGNALS_PER_SOURCE,
): PromptSignal[] {
  const taken = new Map<SignalSource, number>();
  const selected: PromptSignal[] = [];
  for (const signal of signals) {
    if (selected.length >= total) break;
    const count = taken.get(signal.source) ?? 0;
    if (count >= perSource) continue;
    taken.set(signal.source, count + 1);
    selected.push(toPromptSignal(signal, `S${selected.length + 1}`));
  }
  return selected;
}

export type PromptSignalsResult = { ok: true; signals: PromptSignal[] } | { ok: false };

/** The curated, capped signal set for one generation. Never throws. */
export async function loadSignalsForPrompt(
  client: SignalClient,
  userId: string,
  now: number = Date.now(),
): Promise<PromptSignalsResult> {
  const listed = await listSignals(client, userId, now);
  if (!listed.ok) return { ok: false };
  return { ok: true, signals: selectPromptSignals(listed.signals) };
}
