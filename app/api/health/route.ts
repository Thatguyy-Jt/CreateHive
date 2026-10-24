import { checkCronAuth } from "@/lib/jobs/cron-auth";
import { runHealthCheck, type PingResult } from "@/lib/observability/health";
import { createAdminClient } from "@/lib/supabase/admin";

// Public, for an uptime monitor: `{ status }` only. The per-check breakdown is
// added for requests carrying the `CRON_SECRET` bearer token.

const PING_TIMEOUT_MS = 3000;

async function pingDatabase(): Promise<PingResult> {
  let db;
  try {
    db = createAdminClient();
  } catch (error) {
    return { ok: false, name: error instanceof Error ? error.name : typeof error };
  }
  const { error } = await db
    .from("users")
    .select("id", { head: true, count: "exact" })
    .limit(1)
    .abortSignal(AbortSignal.timeout(PING_TIMEOUT_MS));
  return error ? { ok: false, db_code: error.code || undefined, name: error.name || undefined } : { ok: true };
}

export async function GET(request: Request) {
  const report = await runHealthCheck({ pingDatabase, env: process.env });
  const detailed = checkCronAuth(request.headers.get("authorization")) === "ok";
  return Response.json(detailed ? report : { status: report.status }, {
    status: report.status === "down" ? 503 : 200,
    headers: { "Cache-Control": "no-store" },
  });
}
