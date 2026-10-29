import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/observability/log";
import { reconcilePaystack, type BillingDeps } from "@/lib/services/billing";
import type { Database } from "@/lib/supabase/database.types";

// The daily maintenance run (Vercel Cron → /api/cron/daily). Every task is
// idempotent: Vercel doesn't retry, so a failed task is retried by the next
// day's run. Tasks run independently; one failing doesn't stop the others.

type AdminDb = Pick<SupabaseClient<Database>, "from">;

/** Real calls finish within ~2 minutes (60s timeout, one retry); older pending rows were abandoned. */
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;
/** Stored in `ai_generations.error_code`; like provider failures, it doesn't count toward limits. */
export const ABANDONED_CODE = "abandoned";

export type TaskName = "abandoned_generations" | "expired_signals" | "expired_breakdown_sources" | "paystack";
export type TaskResult = { ok: boolean; count?: number; skipped?: boolean };
export interface MaintenanceSummary {
  ok: boolean;
  tasks: Record<TaskName, TaskResult>;
}

export interface MaintenanceDeps {
  /** Service-role client. */
  db: AdminDb;
  /** Null when billing isn't configured: Paystack reconciliation is skipped. */
  billing: BillingDeps | null;
  now: () => number;
}

type CountResult = { ok: true; count: number } | { ok: false; db_code?: string };

/** Marks `pending` generations older than 15 minutes as failed / abandoned. */
export async function expireAbandonedGenerations(db: AdminDb, now: number): Promise<CountResult> {
  const { error, count } = await db
    .from("ai_generations")
    .update(
      { status: "failed", error_code: ABANDONED_CODE, completed_at: new Date(now).toISOString() },
      { count: "exact" },
    )
    .eq("status", "pending")
    .lt("created_at", new Date(now - ABANDONED_AFTER_MS).toISOString());
  return error ? { ok: false, db_code: error.code } : { ok: true, count: count ?? 0 };
}

/** Deletes every research signal past its `expires_at`, for every creator. Rows without one are kept. */
export async function deleteExpiredSignals(db: AdminDb, now: number): Promise<CountResult> {
  const { error, count } = await db
    .from("research_signals")
    .delete({ count: "exact" })
    .lt("expires_at", new Date(now).toISOString());
  return error ? { ok: false, db_code: error.code } : { ok: true, count: count ?? 0 };
}

/**
 * Drops YouTube API data from video breakdowns past `source_expires_at` (30
 * days, the YouTube API Services storage limit). The creator's input and the
 * AI breakdown are kept. Served by `video_breakdowns_source_expires_idx`.
 */
export async function expireBreakdownSources(db: AdminDb, now: number): Promise<CountResult> {
  const { error, count } = await db
    .from("video_breakdowns")
    .update({ source_data: null }, { count: "exact" })
    .not("source_data", "is", null)
    .lt("source_expires_at", new Date(now).toISOString());
  return error ? { ok: false, db_code: error.code } : { ok: true, count: count ?? 0 };
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

async function runCountTask(name: TaskName, task: () => Promise<CountResult>): Promise<TaskResult> {
  try {
    const result = await task();
    if (!result.ok) {
      logEvent("error", "cron_task_failed", { name, db_code: result.db_code });
      return { ok: false };
    }
    logEvent("info", "cron_task_done", { name, count: result.count });
    return { ok: true, count: result.count };
  } catch (error) {
    logEvent("error", "cron_task_failed", { name, stage: "unexpected", code: errorName(error) });
    return { ok: false };
  }
}

async function runPaystack(billing: BillingDeps | null): Promise<TaskResult> {
  const name = "paystack";
  if (!billing) return { ok: true, skipped: true };
  try {
    const result = await reconcilePaystack(billing);
    if (!result.ok) {
      // The service logged the stage and code.
      logEvent("error", "cron_task_failed", { name });
      return { ok: false };
    }
    if (result.skipped) return { ok: true, skipped: true };
    const count = result.subscriptions + result.payments;
    logEvent("info", "cron_task_done", { name, count });
    return { ok: true, count };
  } catch (error) {
    logEvent("error", "cron_task_failed", { name, stage: "unexpected", code: errorName(error) });
    return { ok: false };
  }
}

/** Runs every task in order and reports each one. Never throws. */
export async function runDailyMaintenance(deps: MaintenanceDeps): Promise<MaintenanceSummary> {
  const tasks: Record<TaskName, TaskResult> = {
    abandoned_generations: await runCountTask("abandoned_generations", () =>
      expireAbandonedGenerations(deps.db, deps.now()),
    ),
    expired_signals: await runCountTask("expired_signals", () => deleteExpiredSignals(deps.db, deps.now())),
    expired_breakdown_sources: await runCountTask("expired_breakdown_sources", () =>
      expireBreakdownSources(deps.db, deps.now()),
    ),
    paystack: await runPaystack(deps.billing),
  };
  return { ok: Object.values(tasks).every((t) => t.ok), tasks };
}
