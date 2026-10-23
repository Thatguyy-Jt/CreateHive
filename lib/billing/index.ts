import "server-only";
import { logEvent } from "@/lib/observability/log";
import type { BillingDeps } from "@/lib/services/billing";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseEnvError } from "@/lib/supabase/env";
import { createPaystackClient } from "./paystack";
import { readBillingConfig, readPlanCatalog } from "./plans";

/**
 * Builds the billing service's dependencies from env. Returns null (and logs
 * the missing variable names) when Supabase isn't configured.
 */
export function createBillingDeps(): BillingDeps | null {
  const config = readBillingConfig();
  const catalog = readPlanCatalog();
  if (catalog.invalid.length) logEvent("error", "billing_config_invalid", { variables: catalog.invalid });

  let db;
  try {
    db = createAdminClient();
  } catch (error) {
    logEvent("error", "billing_not_configured", {
      variables: error instanceof SupabaseEnvError ? error.variables : [],
    });
    return null;
  }

  return {
    db,
    config,
    plans: catalog.plans,
    paystack: config.paystack ? createPaystackClient(config.paystack) : null,
    now: Date.now,
  };
}
