import * as Sentry from "@sentry/nextjs";

// Sentry Crons: each run reports in_progress then ok/error. A run that never
// reports (cron stopped, route broken) is flagged as missed by Sentry, which
// logs alone can't show. Without a DSN every call here is a no-op.

type MonitorConfig = NonNullable<Parameters<typeof Sentry.captureCheckIn>[1]>;

export interface CronMonitor {
  slug: string;
  /** Sent with each check-in, so Sentry creates and updates the monitor itself. */
  config: MonitorConfig;
}

export const DAILY_MAINTENANCE_MONITOR = {
  slug: "daily-maintenance",
  config: {
    // Must match vercel.json (tested).
    schedule: { type: "crontab", value: "0 4 * * *" },
    timezone: "Etc/UTC",
    // Vercel Hobby fires anywhere within the scheduled hour.
    checkinMargin: 90,
    maxRuntime: 5,
    failureIssueThreshold: 1,
    recoveryThreshold: 1,
  },
} satisfies CronMonitor;

const FLUSH_TIMEOUT_MS = 2000;

/** Sentry must never change a job's outcome. */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Serverless functions freeze after responding; send the check-in first. */
export async function flushMonitoring(): Promise<void> {
  try {
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  } catch {
    // Monitoring is best-effort.
  }
}

/** One failed check-in without a run, e.g. when setup fails before the job starts. */
export async function reportCronFailure(monitor: CronMonitor): Promise<void> {
  safely(() => Sentry.captureCheckIn({ monitorSlug: monitor.slug, status: "error" }, monitor.config));
  await flushMonitoring();
}

/** Runs a job between an in_progress and an ok/error check-in. A failed result (`ok: false`) reports error. */
export async function monitorCron<T extends { ok: boolean }>(monitor: CronMonitor, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const checkInId = safely(() =>
    Sentry.captureCheckIn({ monitorSlug: monitor.slug, status: "in_progress" }, monitor.config),
  );
  const finish = (status: "ok" | "error") =>
    safely(() => {
      const duration = (Date.now() - started) / 1000;
      if (checkInId) Sentry.captureCheckIn({ checkInId, monitorSlug: monitor.slug, status, duration }, monitor.config);
      else Sentry.captureCheckIn({ monitorSlug: monitor.slug, status }, monitor.config);
    });

  try {
    const result = await run();
    finish(result.ok ? "ok" : "error");
    return result;
  } catch (error) {
    finish("error");
    throw error;
  } finally {
    await flushMonitoring();
  }
}
