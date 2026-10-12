import { checkDailyLimit, type AiDbClient } from "@/lib/ai/limits";
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
