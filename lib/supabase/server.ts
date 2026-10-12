import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseConfig } from "./env";

/**
 * Supabase client that acts as the signed-in creator. Every request carries
 * the creator's Clerk session token (verified by Supabase's Clerk third-party
 * auth), so Row Level Security limits it to the creator's own rows.
 *
 * Create one per request. Without a session the token is null and RLS
 * returns nothing; this never falls back to the secret key.
 */
export function createUserClient() {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient<Database>(url, publishableKey, {
    accessToken: async () => (await auth()).getToken(),
  });
}

export type UserSupabaseClient = ReturnType<typeof createUserClient>;
