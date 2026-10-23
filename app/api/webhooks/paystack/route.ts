import { createBillingDeps } from "@/lib/billing";
import { verifyPaystackSignature } from "@/lib/billing/paystack";
import { readBillingConfig } from "@/lib/billing/plans";
import { logEvent } from "@/lib/observability/log";
import { handlePaystackEvent, paystackEventSchema } from "@/lib/services/billing";

// Public endpoint, authenticated by Paystack's HMAC signature instead of a
// session. Unsigned or mis-signed requests are rejected before any work.
// 200 acknowledges; 500 asks Paystack to retry (it does so for up to 72 hours).

export async function POST(request: Request) {
  const config = readBillingConfig().paystack;
  if (!config) {
    logEvent("error", "billing_webhook_rejected", { provider: "paystack", code: "not_configured" });
    return new Response(null, { status: 503 });
  }

  // The exact bytes received: re-serialized JSON would not match the signature.
  const rawBody = await request.text();
  if (!verifyPaystackSignature(rawBody, request.headers.get("x-paystack-signature"), config.secretKey)) {
    logEvent("warn", "billing_webhook_rejected", { provider: "paystack", code: "bad_signature" });
    return new Response(null, { status: 401 });
  }

  let event;
  try {
    event = paystackEventSchema.parse(JSON.parse(rawBody));
  } catch {
    // Signed but unreadable: retrying won't help.
    logEvent("error", "billing_webhook_rejected", { provider: "paystack", code: "invalid_body" });
    return new Response(null, { status: 200 });
  }

  const deps = createBillingDeps();
  if (!deps) return new Response(null, { status: 500 });

  const outcome = await handlePaystackEvent(deps, event);
  if (outcome.status !== 200) logEvent("warn", "billing_webhook_retry", { provider: "paystack", code: event.event });
  return new Response(null, { status: outcome.status });
}
