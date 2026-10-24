import { verifyWebhook } from "@clerk/nextjs/webhooks";
import type { NextRequest } from "next/server";
import { createBillingDeps } from "@/lib/billing";
import { logEvent } from "@/lib/observability/log";
import { deleteCreatorData } from "@/lib/services/account-data";

// Public endpoint, authenticated by Clerk's Svix signature instead of a
// session. A creator deleted at Clerk (dashboard or profile window) loses
// their data here too. 200 acknowledges; 500 asks Clerk to retry.

export async function POST(request: NextRequest) {
  if (!process.env.CLERK_WEBHOOK_SIGNING_SECRET?.trim()) {
    logEvent("error", "account_webhook_rejected", { code: "not_configured" });
    return new Response(null, { status: 503 });
  }

  let event;
  try {
    event = await verifyWebhook(request);
  } catch {
    logEvent("warn", "account_webhook_rejected", { code: "bad_signature" });
    return new Response(null, { status: 400 });
  }

  if (event.type !== "user.deleted" || typeof event.data.id !== "string") return new Response(null, { status: 200 });

  const deps = createBillingDeps();
  if (!deps) return new Response(null, { status: 500 });

  const result = await deleteCreatorData(deps, event.data.id);
  if (!result.ok) {
    logEvent("warn", "account_webhook_retry", { code: result.code });
    return new Response(null, { status: 500 });
  }
  return new Response(null, { status: 200 });
}
