import { createBillingDeps } from "@/lib/billing";
import { checkCronAuth } from "@/lib/jobs/cron-auth";
import { runDailyMaintenance } from "@/lib/jobs/daily-maintenance";
import { logEvent } from "@/lib/observability/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseEnvError } from "@/lib/supabase/env";

// Daily maintenance, called by Vercel Cron (vercel.json) with the
// `CRON_SECRET` bearer token. 500 marks the run failed in Vercel's cron log;
// the next day's run retries, as every task is idempotent.

export const maxDuration = 60;

export async function GET(request: Request) {
  const authorized = checkCronAuth(request.headers.get("authorization"));
  if (authorized === "not_configured") {
    logEvent("error", "cron_rejected", { code: "not_configured", variables: ["CRON_SECRET"] });
    return new Response(null, { status: 503 });
  }
  if (authorized === "unauthorized") {
    logEvent("warn", "cron_rejected", { code: "unauthorized" });
    return new Response(null, { status: 401 });
  }

  let db;
  try {
    db = createAdminClient();
  } catch (error) {
    logEvent("error", "cron_task_failed", {
      name: "setup",
      variables: error instanceof SupabaseEnvError ? error.variables : [],
    });
    return new Response(null, { status: 500 });
  }

  const summary = await runDailyMaintenance({ db, billing: createBillingDeps(), now: Date.now });
  return Response.json(summary, { status: summary.ok ? 200 : 500, headers: { "Cache-Control": "no-store" } });
}
