import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "@/lib/observability/log";
import type { Database } from "@/lib/supabase/database.types";

type UsersClient = Pick<SupabaseClient<Database>, "from">;

export interface CreatorIdentity {
  /** Clerk user id from the verified server session. Never from the browser. */
  id: string;
  /** Called only when the row has to be created, to avoid a Clerk API call per request. */
  loadEmail: () => Promise<string | null>;
}

export type EnsureUserResult = { ok: true; created: boolean } | { ok: false };

const UNIQUE_VIOLATION = "23505";

function logFailure(stage: string, detail: { code?: string; name?: string }) {
  // No ids, emails or tokens in logs; `logEvent` only accepts safe fields.
  logEvent("error", "ensure_user_failed", { stage, ...detail });
}

/**
 * Makes sure the creator's `users` row exists, creating it on first visit.
 * Every other table references it.
 *
 * Runs as the creator (RLS: select/insert own row only). Select first, then
 * insert, because the creator role may not update `email`. Fail-soft: errors
 * are logged and reported as `{ ok: false }`, never thrown, so pages still
 * render; features that need the row must handle its absence.
 */
export async function ensureUser(
  client: UsersClient,
  identity: CreatorIdentity,
): Promise<EnsureUserResult> {
  try {
    const existing = await client.from("users").select("id").eq("id", identity.id).maybeSingle();
    if (existing.error) {
      logFailure("select", { code: existing.error.code });
      return { ok: false };
    }
    if (existing.data) return { ok: true, created: false };

    const email = await identity.loadEmail();
    const inserted = await client.from("users").insert({ id: identity.id, email });
    if (!inserted.error) return { ok: true, created: true };
    // A concurrent request created it first.
    if (inserted.error.code === UNIQUE_VIOLATION) return { ok: true, created: false };

    logFailure("insert", { code: inserted.error.code });
    return { ok: false };
  } catch (error) {
    logFailure("unexpected", { name: error instanceof Error ? error.name : typeof error });
    return { ok: false };
  }
}
