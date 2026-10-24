import { readAiConfig, isAiEnabled, type EnvSource } from "@/lib/ai/env";
import { readBillingConfig } from "@/lib/billing/plans";
import { readYouTubeConfig } from "@/lib/research/env";
import { logEvent } from "./log";

// `/api/health` for an uptime monitor. Down (503) only when the database is
// unreachable; missing optional config is "degraded" but still 200, so the
// monitor pages on outages, not on settings.

export type PingResult = { ok: true } | { ok: false; db_code?: string; name?: string };

export interface HealthDeps {
  pingDatabase: () => Promise<PingResult>;
  env: EnvSource;
}

type ConfigCheck = "configured" | "missing";

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  checks: {
    database: "ok" | "error";
    ai: ConfigCheck;
    billing: ConfigCheck;
    cron: ConfigCheck;
    account_webhook: ConfigCheck;
    youtube: ConfigCheck;
  };
}

const configured = (ok: boolean): ConfigCheck => (ok ? "configured" : "missing");

/** Never throws: a thrown ping counts as a database error. */
export async function runHealthCheck(deps: HealthDeps): Promise<HealthReport> {
  let ping: PingResult;
  try {
    ping = await deps.pingDatabase();
  } catch (error) {
    ping = { ok: false, name: error instanceof Error ? error.name : typeof error };
  }
  if (!ping.ok) logEvent("error", "health_check_failed", { stage: "database", db_code: ping.db_code, name: ping.name });

  const { env } = deps;
  const checks: HealthReport["checks"] = {
    database: ping.ok ? "ok" : "error",
    // A deliberate pause (AI_ENABLED=false) is not a configuration problem.
    ai: configured(!isAiEnabled(env) || readAiConfig(env).ok),
    billing: configured(readBillingConfig(env).paystack !== null),
    cron: configured(Boolean(env.CRON_SECRET?.trim())),
    account_webhook: configured(Boolean(env.CLERK_WEBHOOK_SIGNING_SECRET?.trim())),
    youtube: configured(readYouTubeConfig(env).ok),
  };

  const allConfigured = Object.entries(checks).every(([key, value]) => key === "database" || value === "configured");
  return { status: !ping.ok ? "down" : allConfigured ? "ok" : "degraded", checks };
}
