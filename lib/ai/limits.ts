import type { SupabaseClient } from "@supabase/supabase-js";
import { ALLOWANCE_WINDOW_MS } from "@/lib/billing/features";
import type { Database } from "@/lib/supabase/database.types";

export type AiDbClient = Pick<SupabaseClient<Database>, "from">;

export const LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type LimitCheck = { ok: true; used: number; reached: boolean } | { ok: false; code?: string };

/**
 * Counts the creator's generations in the rolling window. Provider failures
 * (failed rows whose error is not `invalid_output`) are excluded, so an outage
 * doesn't burn the allowance; bad model output does count. Pending rows count.
 * Served by `ai_generations_user_id_created_at_idx`.
 *
 * Check-then-insert is not atomic: simultaneous requests can overshoot the
 * cap slightly. Acceptable for cost control.
 */
export async function checkDailyLimit(
  db: AiDbClient,
  userId: string,
  limit: number,
  now: number,
): Promise<LimitCheck> {
  const since = new Date(now - LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await db
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since)
    .or("status.neq.failed,error_code.eq.invalid_output");
  if (error || count === null) return { ok: false, code: error?.code };
  return { ok: true, used: count, reached: count >= limit };
}

/**
 * Counts the creator's generations of one kind in the allowance window, with
 * the same rule as `checkDailyLimit` (provider failures don't count). Same
 * non-atomic caveat.
 */
export async function checkMonthlyAllowance(
  db: AiDbClient,
  userId: string,
  kind: string,
  allowance: number,
  now: number,
): Promise<LimitCheck> {
  const since = new Date(now - ALLOWANCE_WINDOW_MS).toISOString();
  const { count, error } = await db
    .from("ai_generations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since)
    .or("status.neq.failed,error_code.eq.invalid_output");
  if (error || count === null) return { ok: false, code: error?.code };
  return { ok: true, used: count, reached: count >= allowance };
}
