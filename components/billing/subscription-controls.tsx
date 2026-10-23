"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { cancelSubscriptionAction, manageCardAction } from "@/app/app/settings/billing/actions";

/** "Update card" (Paystack's hosted page) and, while it renews, "Cancel subscription" with a confirm step. */
export function SubscriptionControls({
  canCancel,
  endsOn,
  primaryUpdate,
}: {
  canCancel: boolean;
  /** "21 Nov 2026": when access ends if they cancel. */
  endsOn: string | null;
  /** Payment failed: updating the card is the main action. */
  primaryUpdate: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const keepButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  function run(action: typeof cancelSubscriptionAction, onDone?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onDone?.();
    });
  }

  const cancel = () =>
    run(cancelSubscriptionAction, () => {
      setConfirming(false);
      toast.success("Subscription cancelled", {
        description: endsOn ? `You keep your plan until ${endsOn}. You won't be charged again.` : "You won't be charged again.",
      });
    });

  return (
    <div className="stack-sm" aria-busy={pending}>
      {confirming ? (
        <div className="stack-sm">
          <p role="alert" className="font-semibold">
            Cancel your subscription? You won&apos;t be charged again{endsOn ? ` and you keep your plan until ${endsOn}` : ""}.
          </p>
          <div className="flex flex-col gap-2 min-[480px]:flex-row">
            <button type="button" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" onClick={cancel} disabled={pending}>
              {pending ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              ref={keepButton}
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep subscription
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 min-[480px]:flex-row">
          <button
            type="button"
            className={`btn ${primaryUpdate ? "btn-primary" : "btn-secondary"} btn-sm w-full min-[480px]:w-auto`}
            onClick={() => run(manageCardAction)}
            disabled={pending}
          >
            {pending ? "Opening…" : "Update card"}
          </button>
          {canCancel ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setConfirming(true)}
              disabled={pending}
            >
              Cancel subscription
            </button>
          ) : null}
        </div>
      )}
      {error ? (
        <p role="alert" className="alert text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </div>
  );
}
