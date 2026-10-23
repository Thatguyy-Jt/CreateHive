"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import type { SubscriptionPlan } from "@/lib/schemas/enums";

// Plain links in the static HTML; once Clerk reports a session they point to
// Billing instead of sign-up. The hook (not the server `Show`) keeps /pricing
// prerendered, as `AuthActions` does on the home page.

/** Sign-up that lands on Settings › Billing with the Pro card focused. A constant: never user input. */
export const GET_PRO_HREF = `/sign-up?redirect_url=${encodeURIComponent("/app/settings/billing?plan=pro")}`;

export function PlanCta({ plan }: { plan: SubscriptionPlan }) {
  const { isLoaded, isSignedIn } = useAuth();
  const pro = plan === "pro";

  if (isLoaded && isSignedIn) {
    return (
      <Link href={pro ? "/app/settings/billing?plan=pro" : "/app"} className={`btn ${pro ? "btn-primary" : "btn-secondary"} w-full`}>
        {pro ? "Go to billing" : "Open app"}
      </Link>
    );
  }
  return (
    <div className="stack-sm">
      <Link href={pro ? GET_PRO_HREF : "/sign-up"} className={`btn ${pro ? "btn-primary" : "btn-secondary"} w-full`}>
        {pro ? "Get Pro" : "Start free"}
      </Link>
      <p className="field-help text-center">{pro ? "Card through Paystack · cancel any time" : "No card needed"}</p>
    </div>
  );
}
