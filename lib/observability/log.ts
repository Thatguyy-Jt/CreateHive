import * as Sentry from "@sentry/nextjs";

/**
 * The only fields a log event may carry. Each is a scalar or a list of
 * variable names, so prompts, responses, ids and emails cannot be added by
 * accident: any other key is a type error.
 */
export interface SafeLogFields {
  kind?: string;
  model?: string;
  code?: string;
  latency_ms?: number;
  db_code?: string;
  stage?: string;
  name?: string;
  /** Payment provider (`paystack`). */
  provider?: string;
  /** Names of missing or invalid environment variables, never their values. */
  variables?: string[];
  /** How many rows a job touched. */
  count?: number;
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "model",
  "code",
  "latency_ms",
  "db_code",
  "stage",
  "name",
  "provider",
  "variables",
  "count",
]);

function sanitize(fields: SafeLogFields): SafeLogFields {
  // Types stop bad keys at compile time; this stops them if a cast gets past.
  return Object.fromEntries(Object.entries(fields).filter(([key]) => ALLOWED_KEYS.has(key))) as SafeLogFields;
}

const AREAS: readonly [prefix: string, area: string][] = [
  ["billing_", "billing"],
  ["account_", "account"],
  ["cron_", "cron"],
  ["ai_", "ai"],
  ["health_", "health"],
  ["youtube_", "research"],
];

/** The Sentry `area` tag for an event name, so alert rules can target billing, account, cron… */
export function areaFor(event: string): string {
  return AREAS.find(([prefix]) => event.startsWith(prefix))?.[1] ?? "app";
}

/**
 * One JSON line to the console, as before. Errors are also sent to Sentry as a
 * message tagged with the same fields. Never pass or forward `Error` objects:
 * provider errors contain the prompt. Warnings and info stay in the console.
 */
export function logEvent(level: "error" | "warn" | "info", event: string, fields: SafeLogFields = {}): void {
  const safe = sanitize(fields);
  console[level](JSON.stringify({ event, ...safe }));

  if (level !== "error") return;
  try {
    const tags: Record<string, string> = { area: areaFor(event) };
    for (const [key, value] of Object.entries(safe)) {
      tags[key] = Array.isArray(value) ? value.join(",") : String(value);
    }
    Sentry.captureMessage(event, { level: "error", tags });
  } catch {
    // A broken monitoring tool must never take down a request.
  }
}
