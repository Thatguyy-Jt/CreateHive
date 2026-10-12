import "server-only";
import { currentUser } from "@clerk/nextjs/server";
import { logEvent } from "@/lib/observability/log";
import { createUserClient } from "@/lib/supabase/server";
import { ensureUser, type EnsureUserResult } from "./users";

/**
 * Ensures the signed-in creator's `users` row exists. Call only after
 * `auth.protect()` has returned `userId`. Never throws (see `ensureUser`).
 */
export async function ensureCurrentUser(userId: string): Promise<EnsureUserResult> {
  let client;
  try {
    client = createUserClient();
  } catch (error) {
    logEvent("error", "ensure_user_failed", {
      stage: "client",
      name: error instanceof Error ? error.name : typeof error,
    });
    return { ok: false };
  }

  return ensureUser(client, {
    id: userId,
    loadEmail: async () => (await currentUser())?.primaryEmailAddress?.emailAddress ?? null,
  });
}
