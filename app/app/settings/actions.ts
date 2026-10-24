"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { createBillingDeps } from "@/lib/billing";
import { logEvent } from "@/lib/observability/log";
import { ACCOUNT_ERRORS, deleteCreatorData } from "@/lib/services/account-data";

// Server actions are public POST endpoints: each one authenticates itself and
// takes the creator's id only from Clerk's session, never from the browser.

export type DeleteAccountState = { status: "idle" | "error" | "deleted"; message: string | null };

const confirmation = z.string().trim().pipe(z.literal("DELETE"));

/**
 * Deletes the creator's account: Paystack renewal, then every row, then the
 * Clerk login. A retry after a failed Clerk delete repeats the first two
 * harmlessly. The browser signs out once this returns `deleted`.
 */
export async function deleteAccountAction(_prev: DeleteAccountState, formData: FormData): Promise<DeleteAccountState> {
  const { userId } = await auth.protect();
  if (!confirmation.safeParse(formData.get("confirmation")).success) {
    return { status: "error", message: ACCOUNT_ERRORS.confirmation };
  }

  const deps = createBillingDeps();
  if (!deps) return { status: "error", message: ACCOUNT_ERRORS.persistence_error };

  const deleted = await deleteCreatorData(deps, userId);
  if (!deleted.ok) return { status: "error", message: ACCOUNT_ERRORS[deleted.code] };

  try {
    await (await clerkClient()).users.deleteUser(userId);
  } catch (error) {
    // Already gone (for example a retry after the Clerk webhook ran).
    const status = (error as { status?: unknown } | null)?.status;
    if (status !== 404) {
      logEvent("error", "account_delete_failed", { stage: "clerk", name: error instanceof Error ? error.name : typeof error });
      return { status: "error", message: ACCOUNT_ERRORS.login_delete_failed };
    }
  }
  return { status: "deleted", message: null };
}
