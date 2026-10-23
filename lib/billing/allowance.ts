import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnvSource } from "@/lib/ai/env";
import { logEvent } from "@/lib/observability/log";
import type { Database } from "@/lib/supabase/database.types";
import { FREE, resolveEntitlement, SUBSCRIPTION_STATE_COLUMNS, type Entitlement, type SubscriptionState } from "./entitlement";
import { readPlanCatalog, type Plan } from "./plans";

export type AllowanceDb = Pick<SupabaseClient<Database>, "from">;

export interface Allowance {
  entitlement: Entitlement;
  plan: Plan;
}

/**
 * The creator's plan right now. Used by the AI service to enforce its
 * allowances (service-role client) and by Settings and the dashboard to show it
 * (creator client, RLS), so the shown and enforced caps can't disagree.
 *
 * If the subscription can't be read, falls back to Free: cost
 * control never fails open. Never throws.
 */
export async function getAllowance(
  db: AllowanceDb,
  userId: string,
  now: number = Date.now(),
  env: EnvSource = process.env,
): Promise<Allowance> {
  const { plans } = readPlanCatalog(env);
  let entitlement: Entitlement = FREE;
  try {
    const { data, error } = await db
      .from("subscriptions")
      .select(SUBSCRIPTION_STATE_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      logEvent("error", "billing_entitlement_read_failed", { stage: "select", db_code: error.code });
    } else {
      entitlement = resolveEntitlement((data as SubscriptionState | null) ?? null, now);
    }
  } catch (error) {
    logEvent("error", "billing_entitlement_read_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
  }
  return { entitlement, plan: plans[entitlement.plan] };
}
