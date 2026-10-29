import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/observability/log";
import type { Database } from "@/lib/supabase/database.types";
import type { BillingDeps } from "./billing";

// Download-my-data and delete-my-account. Export reads as the creator (RLS);
// deletion uses the service-role client because creators have no delete grant
// on `users`. Every creator-owned table cascades from `users`, so one delete
// removes everything.

type Tables = Database["public"]["Tables"];
type ReadDb = Pick<SupabaseClient<Database>, "from">;

/** Creator-owned tables with a `user_id` column, and the columns left out of an export. */
export const EXPORT_TABLES = {
  creator_profiles: { omit: [] },
  brand_profiles: { omit: [] },
  creator_strategies: { omit: [] },
  content_pillars: { omit: [] },
  content_ideas: { omit: [] },
  content_items: { omit: [] },
  content_versions: { omit: [] },
  analytics_snapshots: { omit: [] },
  content_diagnoses: { omit: [] },
  creator_insights: { omit: [] },
  research_signals: { omit: [] },
  competitors: { omit: [] },
  video_breakdowns: { omit: [] },
  assets: { omit: [] },
  notifications: { omit: [] },
  // Provider handles and the email token: no use to the creator, and the token can manage the subscription.
  subscriptions: {
    omit: ["provider_customer_id", "provider_subscription_id", "provider_plan_code", "provider_email_token"],
  },
  payments: { omit: ["provider_order_id", "provider_customer_id"] },
  ai_generations: { omit: [] },
  usage_events: { omit: [] },
} as const satisfies Partial<Record<keyof Tables, { omit: readonly string[] }>>;

export type ExportTable = keyof typeof EXPORT_TABLES;

/** PostgREST's default row cap per request. */
export const EXPORT_PAGE_SIZE = 1000;

type Row = Record<string, unknown>;

export interface CreatorExport {
  format_version: 1;
  exported_at: string;
  account: { email: string | null; display_name: string | null; created_at: string } | null;
  tables: Record<ExportTable, Row[]>;
}

function strip(row: Row, omit: readonly string[]): Row {
  const copy: Row = { ...row };
  delete copy.user_id;
  for (const column of omit) delete copy[column];
  return copy;
}

async function readTable(client: ReadDb, table: ExportTable, userId: string): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("id")
      .range(from, from + EXPORT_PAGE_SIZE - 1);
    if (error || !data) {
      logEvent("error", "account_export_failed", { stage: table, db_code: error?.code });
      return null;
    }
    for (const row of data as Row[]) rows.push(strip(row, EXPORT_TABLES[table].omit));
    if (data.length < EXPORT_PAGE_SIZE) return rows;
  }
}

/**
 * Everything stored for the creator, as one object. `client` must act as the
 * creator (RLS); the explicit `user_id` filter sits on top. Any failed read
 * fails the whole export, so a partial file never looks complete. Never throws.
 */
export async function exportCreatorData(
  client: ReadDb,
  userId: string,
  now: number,
): Promise<{ ok: true; data: CreatorExport } | { ok: false }> {
  try {
    const account = await client
      .from("users")
      .select("email, display_name, created_at")
      .eq("id", userId)
      .maybeSingle();
    if (account.error) {
      logEvent("error", "account_export_failed", { stage: "users", db_code: account.error.code });
      return { ok: false };
    }

    const tables = {} as Record<ExportTable, Row[]>;
    for (const table of Object.keys(EXPORT_TABLES) as ExportTable[]) {
      const rows = await readTable(client, table, userId);
      if (!rows) return { ok: false };
      tables[table] = rows;
    }

    return {
      ok: true,
      data: { format_version: 1, exported_at: new Date(now).toISOString(), account: account.data, tables },
    };
  } catch (error) {
    logEvent("error", "account_export_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------

export type AccountErrorCode =
  | "billing_unavailable"
  | "billing_cancel_failed"
  | "persistence_error"
  | "login_delete_failed"
  | "confirmation";

const BILLING_MESSAGE =
  "We couldn't reach our payment provider to stop your Pro renewal, so nothing was deleted. Try again in a few minutes, or cancel your plan in Billing first.";

/** Creator-facing messages: what happened and what to do next. */
export const ACCOUNT_ERRORS: Record<AccountErrorCode, string> = {
  billing_unavailable: BILLING_MESSAGE,
  billing_cancel_failed: BILLING_MESSAGE,
  persistence_error: "We couldn't delete your data right now. Nothing was removed. Please try again in a minute.",
  login_delete_failed: "Your data was deleted, but we couldn't close your login. Please try again.",
  confirmation: "Type DELETE to confirm.",
};

/** Service-role client and the Paystack adapter, from `createBillingDeps()`. */
export type AccountDeps = Pick<BillingDeps, "db" | "paystack">;

type RenewalFields = Pick<
  Tables["subscriptions"]["Row"],
  "provider" | "provider_subscription_id" | "status" | "cancel_at_period_end"
>;

/** A Paystack subscription that will charge the card again unless it is disabled. */
export function isRenewingPaystack(row: RenewalFields | null): boolean {
  return Boolean(
    row &&
      row.provider === "paystack" &&
      row.provider_subscription_id &&
      row.status !== "canceled" &&
      !row.cancel_at_period_end,
  );
}

/** For the delete confirmation copy. `client` acts as the creator. Errors read as "not renewing". */
export async function hasRenewingPlan(client: ReadDb, userId: string): Promise<boolean> {
  try {
    const { data, error } = await client
      .from("subscriptions")
      .select("provider, provider_subscription_id, status, cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    return !error && isRenewingPaystack(data);
  } catch {
    return false;
  }
}

export type DeleteResult =
  | { ok: true }
  | { ok: false; code: Extract<AccountErrorCode, "billing_unavailable" | "billing_cancel_failed" | "persistence_error"> };

/**
 * Stops any Paystack renewal, then deletes the creator's `users` row, which
 * cascades to every table. Billing goes first: data gone but a card still
 * charged is the worst outcome, so if the renewal can't be stopped nothing is
 * deleted. Idempotent: a missing row is success. Never throws. Does not touch
 * the Clerk user; callers handle that.
 */
export async function deleteCreatorData(deps: AccountDeps, userId: string): Promise<DeleteResult> {
  try {
    const subscription = await deps.db
      .from("subscriptions")
      .select("provider, provider_subscription_id, provider_email_token, status, cancel_at_period_end")
      .eq("user_id", userId)
      .maybeSingle();
    if (subscription.error) {
      logEvent("error", "account_delete_failed", { stage: "subscription", db_code: subscription.error.code });
      return { ok: false, code: "persistence_error" };
    }

    const row = subscription.data;
    if (row && isRenewingPaystack(row)) {
      if (!deps.paystack || !row.provider_email_token) return { ok: false, code: "billing_unavailable" };
      const disabled = await deps.paystack.disableSubscription(row.provider_subscription_id!, row.provider_email_token);
      if (!disabled.ok) {
        logEvent("error", "billing_provider_failed", { provider: "paystack", stage: "account_delete", code: disabled.code });
        return { ok: false, code: "billing_cancel_failed" };
      }
    }

    const deleted = await deps.db.from("users").delete().eq("id", userId);
    if (deleted.error) {
      logEvent("error", "account_delete_failed", { stage: "db", db_code: deleted.error.code });
      return { ok: false, code: "persistence_error" };
    }
    return { ok: true };
  } catch (error) {
    logEvent("error", "account_delete_failed", {
      stage: "unexpected",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false, code: "persistence_error" };
  }
}
