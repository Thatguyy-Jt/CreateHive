import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_ERRORS, type AiErrorCode } from "@/lib/ai/errors";
import type { AiResult, RunStructuredRequest } from "@/lib/ai/run-structured";
import { logEvent } from "@/lib/observability/log";
import { platform as platformSchema, type Platform } from "@/lib/schemas/creator";
import { ideaStatus, type IdeaStatus, type SignalLevel } from "@/lib/schemas/enums";
import {
  canTransition,
  type EvidenceItem,
  type EvidenceKind,
  normalizeTopic,
  opportunityModelSchemaFor,
  opportunityOutputFor,
  storedOpportunity,
  type AllowedEvidenceKinds,
  type GeneratedOpportunity,
  type OpportunityModelOutput,
  type OpportunityOutput,
  type OpportunityView,
  type StoredOpportunity,
  VIEW_STATUSES,
} from "@/lib/schemas/opportunities";
import { parseWith } from "@/lib/schemas/parse";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildCreatorContext, renderContextForPrompt } from "./creator-context";
import { loadSignalsForPrompt, type PromptSignal } from "./research-signals";

type OpportunityClient = Pick<SupabaseClient<Database>, "from">;

/** An opportunity generation still pending inside this window blocks another one. */
export const IN_FLIGHT_WINDOW_MS = 2 * 60 * 1000;
/** Untriaged (`new`) ideas at which generation is refused until the creator reviews them. */
export const BACKLOG_LIMIT = 20;
/** Most recent non-dismissed topics the model is told not to repeat. */
export const PREVIOUS_TOPICS_LIMIT = 40;
/** Most recent dismissed topics the model is told not to repeat. */
export const DISMISSED_TOPICS_LIMIT = 20;
/** Topics read for the server-side duplicate check. */
export const EXISTING_TOPICS_LIMIT = 500;
/** Ideas shown per view. */
export const LIST_LIMIT = 50;

export type OpportunityErrorCode = AiErrorCode | "missing_context" | "backlog_full" | "in_progress";

export type GenerateOpportunitiesResult =
  | { ok: true; created: number }
  | { ok: false; code: OpportunityErrorCode; message: string; retryable: boolean };

/** Creator-facing messages: what happened and what to do next. */
export const OPPORTUNITY_ERRORS: Record<OpportunityErrorCode, { message: string; retryable: boolean }> = {
  ...AI_ERRORS,
  invalid_output: { message: "Your new ideas didn't come out right. Please try again.", retryable: true },
  persistence_error: {
    message: "We couldn't save your new ideas. Please try again in a moment.",
    retryable: true,
  },
  limit_reached: {
    message:
      "You've used all of your AI generations for now. Your allowance frees up as generations age past 24 hours.",
    retryable: false,
  },
  missing_context: {
    message: "Build your strategy first, so new ideas can fit your content pillars.",
    retryable: false,
  },
  backlog_full: {
    message: "Review your current ideas first: save or dismiss some, then generate more.",
    retryable: false,
  },
  in_progress: {
    message: "We're already finding ideas for you. Give it a minute, then refresh the page.",
    retryable: false,
  },
};

function fail(code: OpportunityErrorCode): GenerateOpportunitiesResult {
  return { ok: false, code, ...OPPORTUNITY_ERRORS[code] };
}

function failed(event: string, stage: string, error: unknown) {
  logEvent("error", event, { stage, name: error instanceof Error ? error.name : typeof error });
}

type RunOpportunities = (
  request: RunStructuredRequest<"content_opportunities", OpportunityModelOutput, OpportunityOutput>,
) => Promise<AiResult<OpportunityOutput>>;

export interface OpportunityDeps {
  /** `runStructured` from `@/lib/ai`; injected so tests never reach a provider. */
  run: RunOpportunities;
  now?: () => number;
}

type CitableSignal = Pick<PromptSignal, "id" | "source" | "type">;

/**
 * Server-computed, never from the model:
 * - `high`: 2+ distinct signals from 2+ different source/type combinations;
 * - `medium`: one signal, or the creator's own performance;
 * - `low`: only what the creator told us.
 * A creator's own note is their input, not independent evidence, so it never raises the level.
 */
export function evidenceStrengthFor(
  idea: Pick<GeneratedOpportunity, "evidence">,
  signals: ReadonlyMap<string, CitableSignal> = new Map(),
): SignalLevel {
  const cited = new Map<string, string>();
  for (const item of idea.evidence) {
    const signal = item.signal_ref ? signals.get(item.signal_ref) : undefined;
    if (signal && signal.type !== "creator_note") cited.set(signal.id, `${signal.source}/${signal.type}`);
  }
  if (cited.size >= 2 && new Set(cited.values()).size >= 2) return "high";
  if (cited.size >= 1 || idea.evidence.some((item) => item.kind === "creator_history")) return "medium";
  return "low";
}

/** Stored evidence: the model's kind and summary; source, link and date come from the signal row. */
export function resolveEvidence(
  idea: Pick<GeneratedOpportunity, "evidence">,
  signals: ReadonlyMap<string, PromptSignal>,
): EvidenceItem[] {
  return idea.evidence.map(({ kind, summary, signal_ref }) => {
    const signal = signal_ref ? signals.get(signal_ref) : undefined;
    if (!signal) return { kind, summary };
    return {
      kind,
      summary,
      source: signal.label,
      ...(signal.source_url ? { source_url: signal.source_url } : {}),
      observed_at: signal.observed_at,
    };
  });
}

/**
 * Opportunity Agent: builds context from the creator's profile, voice,
 * strategy and history, generates a batch of ideas through the AI service,
 * validates and de-duplicates them, and stores them in one insert. Never throws.
 *
 * `client` acts as the creator (`createUserClient()`); `userId` comes from
 * Clerk's verified session. AI metering and the daily cap happen in `run`.
 */
export async function generateContentOpportunities(
  client: OpportunityClient,
  userId: string,
  deps: OpportunityDeps,
): Promise<GenerateOpportunitiesResult> {
  const now = deps.now ?? Date.now;
  try {
    // 1. Context, plus active pillar ids for mapping the model's pillar names.
    const [built, pillarRows] = await Promise.all([
      buildCreatorContext(client, userId, {
        include: ["profile", "brand", "pillars", "strategy", "recentContent", "performance", "insights"],
      }),
      client.from("content_pillars").select("id, name").eq("user_id", userId).eq("is_active", true),
    ]);
    if (!built.ok) return fail("persistence_error");
    if (pillarRows.error) {
      logEvent("error", "opportunity_generation_failed", { stage: "pillars", db_code: pillarRows.error.code });
      return fail("persistence_error");
    }
    const { context } = built;
    const pillars = pillarRows.data ?? [];
    if (!context.profile || !context.strategy || pillars.length === 0) return fail("missing_context");

    const platforms = context.profile.platforms.filter((p): p is Platform => platformSchema.safeParse(p).success);
    if (platforms.length === 0) return fail("missing_context");

    // 2. Backlog cap: no AI call while too many ideas wait for review.
    const backlog = await client
      .from("content_ideas")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "new");
    if (backlog.error) {
      logEvent("error", "opportunity_generation_failed", { stage: "backlog_check", db_code: backlog.error.code });
      return fail("persistence_error");
    }
    if ((backlog.count ?? 0) >= BACKLOG_LIMIT) return fail("backlog_full");

    // 3. In-flight guard.
    const since = new Date(now() - IN_FLIGHT_WINDOW_MS).toISOString();
    const pending = await client
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("kind", "content_opportunities")
      .eq("status", "pending")
      .gte("created_at", since);
    if (pending.error) {
      logEvent("error", "opportunity_generation_failed", { stage: "in_flight_check", db_code: pending.error.code });
      return fail("persistence_error");
    }
    if ((pending.count ?? 0) > 0) return fail("in_progress");

    // 4. Existing topics: "don't repeat" lists for the prompt and the server-side dedupe.
    const existing = await client
      .from("content_ideas")
      .select("topic, status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(EXISTING_TOPICS_LIMIT);
    if (existing.error) {
      logEvent("error", "opportunity_generation_failed", { stage: "topics", db_code: existing.error.code });
      return fail("persistence_error");
    }
    const existingRows = existing.data ?? [];
    const previousTopics = existingRows
      .filter((row) => row.status !== "dismissed")
      .slice(0, PREVIOUS_TOPICS_LIMIT)
      .map((row) => row.topic);
    const dismissedTopics = existingRows
      .filter((row) => row.status === "dismissed")
      .slice(0, DISMISSED_TOPICS_LIMIT)
      .map((row) => row.topic);
    const seen = new Set(existingRows.map((row) => normalizeTopic(row.topic)));

    // 5. Research signals. Optional: a failure degrades to profile-only evidence.
    const loaded = await loadSignalsForPrompt(client, userId, now());
    if (!loaded.ok) logEvent("warn", "opportunity_signals_unavailable", { stage: "signals" });
    const signals = loaded.ok ? loaded.signals : [];
    const signalsByRef = new Map(signals.map((signal) => [signal.ref, signal]));

    // 6. Generate with per-request schemas: only evidence kinds and refs we can back up.
    const kinds = new Set<EvidenceKind>(["creator_input"]);
    if (context.performance?.length) kinds.add("creator_history");
    for (const signal of signals) kinds.add(signal.kind);
    const allowedEvidenceKinds = [...kinds] as unknown as AllowedEvidenceKinds;
    const schema = opportunityOutputFor({
      pillarNames: pillars.map((p) => p.name),
      platforms,
      allowedEvidenceKinds,
      signals: signals.map(({ ref, kind }) => ({ ref, kind })),
    });
    const result = await deps.run({
      userId,
      kind: "content_opportunities",
      input: {
        context: renderContextForPrompt(context),
        platforms,
        allowedEvidenceKinds,
        signals: signals.map(({ ref, type, source, kind, excerpt }) => ({ ref, type, source, kind, excerpt })),
        previousTopics,
        dismissedTopics,
      },
      schema: opportunityModelSchemaFor(
        allowedEvidenceKinds,
        signals.map((signal) => signal.ref),
      ),
      validate: (output) => parseWith(schema, output),
    });
    if (!result.ok) {
      logEvent("error", "opportunity_generation_failed", { stage: "ai", code: result.code });
      return fail(result.code);
    }

    // 7. Drop ideas that repeat an existing topic.
    const fresh = result.data.opportunities.filter((idea) => !seen.has(normalizeTopic(idea.topic)));
    if (fresh.length === 0) {
      logEvent("error", "opportunity_generation_failed", { stage: "dedupe", code: "invalid_output" });
      return fail("invalid_output");
    }

    // 8. Map pillars, resolve citations and compute signals server-side.
    const pillarIds = new Map(pillars.map((p) => [normalizeTopic(p.name), p.id]));
    const rows = fresh.map((idea) => ({
      user_id: userId,
      pillar_id: pillarIds.get(normalizeTopic(idea.pillar_name)) ?? null,
      topic: idea.topic,
      audience_need: idea.audience_need,
      angle: idea.angle,
      hook: idea.hook,
      format: idea.format,
      platform: idea.platform,
      rationale: idea.rationale,
      cta: idea.cta,
      difficulty: idea.difficulty,
      audience_fit: idea.audience_fit,
      evidence: resolveEvidence(idea, signalsByRef) as unknown as Json,
      evidence_strength: evidenceStrengthFor(idea, signalsByRef),
      // No defensible way to measure these yet: claim nothing.
      trend_signal: null,
      content_gap: null,
      source: "ai",
      status: "new",
      ai_generation_id: result.generationId,
    }));

    // 9. One statement, so the batch is stored atomically.
    const inserted = await client.from("content_ideas").insert(rows);
    if (inserted.error) {
      logEvent("error", "opportunity_save_failed", { stage: "insert", db_code: inserted.error.code });
      return fail("persistence_error");
    }
    return { ok: true, created: rows.length };
  } catch (error) {
    failed("opportunity_generation_failed", "unexpected", error);
    return fail("persistence_error");
  }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type OpportunityCounts = Record<OpportunityView, number>;

export type ListOpportunitiesResult =
  | { ok: true; hasStrategy: boolean; items: StoredOpportunity[]; counts: OpportunityCounts }
  | { ok: false };

const LIST_COLUMNS =
  "id, topic, audience_need, angle, hook, format, platform, rationale, cta, difficulty, audience_fit, evidence_strength, evidence, status, created_at, pillar:content_pillars(name), items:content_items(status, scheduled_for)";

/**
 * The creator's ideas for one view, newest first, plus per-view counts and
 * whether they have a strategy to generate from. The Saved view includes
 * `planned` ideas with their scheduled time. Rows that no longer validate are
 * skipped and logged rather than breaking the page. Never throws.
 */
export async function listOpportunities(
  client: OpportunityClient,
  userId: string,
  view: OpportunityView,
): Promise<ListOpportunitiesResult> {
  try {
    const count = (counted: OpportunityView) =>
      client
        .from("content_ideas")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("status", [...VIEW_STATUSES[counted]]);

    const [list, strategy, pillars, newCount, savedCount, dismissedCount] = await Promise.all([
      client
        .from("content_ideas")
        .select(LIST_COLUMNS)
        .eq("user_id", userId)
        .in("status", [...VIEW_STATUSES[view]])
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT),
      client.from("creator_strategies").select("id", { count: "exact", head: true }).eq("user_id", userId),
      client
        .from("content_pillars")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true),
      count("new"),
      count("saved"),
      count("dismissed"),
    ]);
    const error = [list, strategy, pillars, newCount, savedCount, dismissedCount].find((r) => r.error)?.error;
    if (error) {
      logEvent("error", "opportunity_read_failed", { stage: "select", db_code: error.code });
      return { ok: false };
    }

    const items: StoredOpportunity[] = [];
    for (const row of list.data ?? []) {
      const { pillar, items: contentItems, ...rest } = row as typeof row & {
        pillar: { name: string } | null;
        items: { status: string; scheduled_for: string | null }[] | null;
      };
      const scheduled = (contentItems ?? []).find((item) => item.status === "scheduled" && item.scheduled_for);
      const parsed = parseWith(storedOpportunity, {
        ...rest,
        pillar_name: pillar?.name ?? null,
        scheduled_for: rest.status === "planned" ? (scheduled?.scheduled_for ?? null) : null,
      });
      if (parsed.ok) items.push(parsed.data);
      else logEvent("warn", "opportunity_read_skipped", { stage: "validate" });
    }

    return {
      ok: true,
      hasStrategy: (strategy.count ?? 0) > 0 && (pillars.count ?? 0) > 0,
      items,
      counts: { new: newCount.count ?? 0, saved: savedCount.count ?? 0, dismissed: dismissedCount.count ?? 0 },
    };
  } catch (error) {
    failed("opportunity_read_failed", "unexpected", error);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export type StatusErrorCode = "not_found" | "invalid_transition" | "db_error";

export type UpdateStatusResult = { ok: true } | { ok: false; code: StatusErrorCode; message: string };

export const STATUS_ERRORS: Record<StatusErrorCode, string> = {
  not_found: "We couldn't find that idea. Refresh the page and try again.",
  invalid_transition: "That idea can't be moved there. Refresh the page to see its current state.",
  db_error: "We couldn't update that idea. Please try again in a moment.",
};

function statusFail(code: StatusErrorCode): UpdateStatusResult {
  return { ok: false, code, message: STATUS_ERRORS[code] };
}

/** Moves one of the creator's ideas between triage states, if the transition is allowed. Never throws. */
export async function updateOpportunityStatus(
  client: OpportunityClient,
  userId: string,
  ideaId: string,
  to: IdeaStatus,
): Promise<UpdateStatusResult> {
  try {
    // RLS-scoped read: another creator's idea is simply not found.
    const current = await client
      .from("content_ideas")
      .select("status")
      .eq("id", ideaId)
      .eq("user_id", userId)
      .maybeSingle();
    if (current.error) {
      logEvent("error", "opportunity_status_failed", { stage: "select", db_code: current.error.code });
      return statusFail("db_error");
    }
    if (!current.data) return statusFail("not_found");
    const from = ideaStatus.safeParse(current.data.status);
    if (!from.success || !canTransition(from.data, to)) return statusFail("invalid_transition");

    const updated = await client.from("content_ideas").update({ status: to }).eq("id", ideaId).eq("user_id", userId);
    if (updated.error) {
      logEvent("error", "opportunity_status_failed", { stage: "update", db_code: updated.error.code });
      return statusFail("db_error");
    }
    return { ok: true };
  } catch (error) {
    failed("opportunity_status_failed", "unexpected", error);
    return statusFail("db_error");
  }
}
