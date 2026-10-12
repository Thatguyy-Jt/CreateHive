import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseConfig, getSupabaseSecretKey } from "./env";

/**
 * Service-role Supabase client. It BYPASSES Row Level Security.
 *
 * Only for trusted server work that is not limited to one signed-in creator:
 * webhooks, the AI service writing `ai_generations`, usage metering and
 * background jobs. Never use it to serve a creator's own request; use
 * `createUserClient()` from `./server` for that. `server-only` makes any
 * import from client code fail the build.
 */
export function createAdminClient() {
  const { url } = getSupabaseConfig();
  return createClient<Database>(url, getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AdminSupabaseClient = ReturnType<typeof createAdminClient>;
