"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { checkPaymentAction } from "@/app/app/settings/billing/actions";

const OUTCOME = {
  succeeded: () => toast.success("Payment confirmed", { description: "Your plan is active." }),
  failed: () => toast.error("Payment didn't go through", { description: "Nothing was charged." }),
  pending: () => toast.info("Still processing", { description: "The provider hasn't confirmed it yet. Try again shortly." }),
} as const;

/** Re-checks one pending payment with its provider. */
export function CheckStatusButton({ paymentId }: { paymentId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function check() {
    start(async () => {
      const result = await checkPaymentAction(paymentId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      OUTCOME[result.status]();
      if (result.status !== "pending") router.refresh();
    });
  }

  return (
    <button type="button" className="btn btn-ghost btn-sm" onClick={check} disabled={pending} aria-busy={pending}>
      {pending ? "Checking…" : "Check status"}
    </button>
  );
}
