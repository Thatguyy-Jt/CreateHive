import { timingSafeEqual } from "node:crypto";

type EnvSource = Record<string, string | undefined>;

export type CronAuth = "ok" | "not_configured" | "unauthorized";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in
 * constant time; without a secret every request is refused (fail closed).
 */
export function checkCronAuth(authorization: string | null, env: EnvSource = process.env): CronAuth {
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return "not_configured";
  if (!authorization) return "unauthorized";

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  if (expected.length !== received.length) return "unauthorized";
  return timingSafeEqual(expected, received) ? "ok" : "unauthorized";
}
