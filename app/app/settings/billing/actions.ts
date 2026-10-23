"use server";

import { auth, currentUser } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createBillingDeps } from "@/lib/billing";
import { BILLING_ERRORS } from "@/lib/billing/errors";
import { paidPlan } from "@/lib/schemas/enums";
import { ensureCurrentUser } from "@/lib/services/current-user";
import { cancelPaystackSubscription, checkPayment, paystackManageLink, startCheckout } from "@/lib/services/billing";

// Server actions are public POST endpoints: each one authenticates itself and
// takes the creator's id only from Clerk's session, never from the browser.

export type CheckoutActionState = { status: "idle" | "error"; message: string | null };

const checkoutInput = z.object({ plan: paidPlan });

/** Starts a Paystack checkout and sends the creator to Paystack's payment page. */
export async function startCheckoutAction(_prev: CheckoutActionState, formData: FormData): Promise<CheckoutActionState> {
  const { userId } = await auth.protect();
  const parsed = checkoutInput.safeParse({ plan: formData.get("plan") });
  if (!parsed.success) return { status: "error", message: BILLING_ERRORS.not_configured };

  const ensured = await ensureCurrentUser(userId);
  if (!ensured.ok) return { status: "error", message: BILLING_ERRORS.persistence_error };

  const deps = createBillingDeps();
  if (!deps) return { status: "error", message: BILLING_ERRORS.persistence_error };

  const email = (await currentUser())?.primaryEmailAddress?.emailAddress ?? null;

  const result = await startCheckout(deps, { userId, email, ...parsed.data });
  if (!result.ok) return { status: "error", message: BILLING_ERRORS[result.code] };
  // An external URL from the provider's own API response.
  redirect(result.url);
}

export type PaymentCheckResult = { ok: true; status: "succeeded" | "pending" | "failed" } | { ok: false; message: string };

/** "Check status" for one of the creator's pending payments. */
export async function checkPaymentAction(paymentId: unknown): Promise<PaymentCheckResult> {
  const { userId } = await auth.protect();
  const id = z.uuid().safeParse(paymentId);
  if (!id.success) return { ok: false, message: BILLING_ERRORS.not_found };

  const deps = createBillingDeps();
  if (!deps) return { ok: false, message: BILLING_ERRORS.persistence_error };

  const result = await checkPayment(deps, userId, id.data);
  if (!result.ok) return { ok: false, message: BILLING_ERRORS[result.code] };
  if (result.status !== "pending") revalidatePath("/app/settings/billing");
  return result;
}

export type SimpleActionResult = { ok: true } | { ok: false; message: string };

/** Stops a Paystack subscription renewing; access runs to the end of the paid month. */
export async function cancelSubscriptionAction(): Promise<SimpleActionResult> {
  const { userId } = await auth.protect();
  const deps = createBillingDeps();
  if (!deps) return { ok: false, message: BILLING_ERRORS.persistence_error };

  const result = await cancelPaystackSubscription(deps, userId);
  if (!result.ok) return { ok: false, message: BILLING_ERRORS[result.code] };
  revalidatePath("/app/settings/billing");
  return { ok: true };
}

/** Sends the creator to Paystack's page for updating the card on their subscription. */
export async function manageCardAction(): Promise<SimpleActionResult> {
  const { userId } = await auth.protect();
  const deps = createBillingDeps();
  if (!deps) return { ok: false, message: BILLING_ERRORS.persistence_error };

  const result = await paystackManageLink(deps, userId);
  if (!result.ok) return { ok: false, message: BILLING_ERRORS[result.code] };
  redirect(result.url);
}
