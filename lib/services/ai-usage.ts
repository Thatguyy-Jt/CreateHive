import { checkDailyLimit, type AiDbClient } from "@/lib/ai/limits";
import { getAllowance, type Allowance } from "@/lib/billing/allowance";
import { ALLOWANCE_WINDOW_MS, PLAN_ALLOWANCES, QUOTA_FEATURES, type QuotaFeature } from "@/lib/billing/features";
import type { SubscriptionPlan } from "@/lib/schemas/enums";
import { logEvent } from "@/lib/observability/log";

export type AiUsageResult = { ok: true; used: number; limit: number; remaining: number } | { ok: false };

/**
 * The creator's AI generations in the rolling 24-hour window, counted exactly
 * as the AI service counts them (it reuses `checkDailyLimit`), so the settings
 * page and the cap can never disagree.
 *
 * Pass a client acting as the creator (`createUserClient()`): RLS then limits
 * the count to their own rows. Fail-soft: errors are logged and returned as
 * `{ ok: false }`, never thrown.
 */
export async function getAiUsage(
  client: AiDbClient,
  userId: string,
  limit: number,
  // Read here, not in the component: render must stay pure.
  now: number = Date.now(),
): Promise<AiUsageResult> {
  try {
    const result = await checkDailyLimit(client, userId, limit, now);
    if (!result.ok) {
      logEvent("error", "ai_usage_read_failed", { stage: "count", db_code: result.code });
      return { ok: false };
    }
    return { ok: true, used: result.used, limit, remaining: Math.max(0, limit - result.used) };
  } catch (error) {
    logEvent("error", "ai_usage_read_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

export interface FeatureUsage extends QuotaFeature {
  used: number;
  limit: number;
}

export type MonthlyUsageResult = { ok: true; features: FeatureUsage[] } | { ok: false };

/**
 * Uses of each metered AI feature in the allowance window, against the plan's
 * allowance, counted with the AI service's rule (provider failures excluded).
 * One read of the creator's own rows (RLS client). Fail-soft.
 */
export async function getMonthlyUsage(
  client: AiDbClient,
  userId: string,
  plan: SubscriptionPlan,
  now: number,
): Promise<MonthlyUsageResult> {
  return applyAllowances(await countMonthlyUses(client, userId, now), plan);
}

type KindCounts = { ok: true; counts: Map<string, number> } | { ok: false };

/** Uses per AI kind in the allowance window. Independent of the plan, so it can run alongside the plan read. */
async function countMonthlyUses(client: AiDbClient, userId: string, now: number): Promise<KindCounts> {
  try {
    const { data, error } = await client
      .from("ai_generations")
      .select("kind")
      .eq("user_id", userId)
      .gte("created_at", new Date(now - ALLOWANCE_WINDOW_MS).toISOString())
      .or("status.neq.failed,error_code.eq.invalid_output");
    if (error) {
      logEvent("error", "ai_usage_read_failed", { stage: "monthly", db_code: error.code });
      return { ok: false };
    }
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { kind: string }[]) counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
    return { ok: true, counts };
  } catch (error) {
    logEvent("error", "ai_usage_read_failed", {
      stage: "monthly_unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

function applyAllowances(result: KindCounts, plan: SubscriptionPlan): MonthlyUsageResult {
  if (!result.ok) return { ok: false };
  return {
    ok: true,
    features: QUOTA_FEATURES.map((feature) => ({
      ...feature,
      used: result.counts.get(feature.kind) ?? 0,
      limit: PLAN_ALLOWANCES[plan][feature.kind],
    })),
  };
}

export interface PlanUsage {
  /** The instant the reads used, for anything else the page computes. */
  now: number;
  allowance: Allowance;
  monthly: MonthlyUsageResult;
}

/** The creator's plan and their monthly usage against it, read at one instant. The two reads run in parallel. */
export async function getPlanUsage(client: AiDbClient, userId: string, now: number = Date.now()): Promise<PlanUsage> {
  const [allowance, counts] = await Promise.all([getAllowance(client, userId, now), countMonthlyUses(client, userId, now)]);
  return { now, allowance, monthly: applyAllowances(counts, allowance.plan.id) };
}
