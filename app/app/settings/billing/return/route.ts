import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createBillingDeps } from "@/lib/billing";
import { billingProvider } from "@/lib/schemas/enums";
import { confirmReturn } from "@/lib/services/billing";

const params = z.object({
  provider: billingProvider,
  reference: z.string().regex(/^ch_[0-9a-f]{32}$/),
});

/**
 * Where Paystack sends the creator back after checkout. Verifies the
 * payment with the provider (the webhook may not have arrived yet), but only
 * for a payment that belongs to the signed-in creator, then lands on Billing.
 */
export async function GET(request: Request) {
  const { userId } = await auth.protect();
  const search = new URL(request.url).searchParams;
  const parsed = params.safeParse({ provider: search.get("provider"), reference: search.get("reference") });
  if (!parsed.success) redirect("/app/settings/billing");

  const deps = createBillingDeps();
  if (!deps) redirect("/app/settings/billing?checkout=pending");

  const result = await confirmReturn(deps, userId, parsed.data.provider, parsed.data.reference);
  if (!result.ok) {
    if (result.code === "not_found") return new Response("Not found", { status: 404 });
    redirect("/app/settings/billing?checkout=pending");
  }
  redirect(`/app/settings/billing?checkout=${result.status === "succeeded" ? "success" : result.status}`);
}
