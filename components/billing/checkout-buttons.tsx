"use client";

import { useActionState } from "react";
import { startCheckoutAction, type CheckoutActionState } from "@/app/app/settings/billing/actions";
import type { CheckoutOption } from "@/lib/billing/plan-options";
import type { PaidPlan } from "@/lib/schemas/enums";

const IDLE: CheckoutActionState = { status: "idle", message: null };

/** The pay buttons on a plan card. Each submits the plan and provider; the server does the rest. */
export function CheckoutButtons({ plan, options }: { plan: PaidPlan; options: CheckoutOption[] }) {
  const [state, action, pending] = useActionState(startCheckoutAction, IDLE);

  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="plan" value={plan} />
      {options.map((option, index) => (
        <div key={option.provider} className="flex flex-col gap-1">
          <button
            type="submit"
            name="provider"
            value={option.provider}
            className={`btn ${index === 0 ? "btn-primary" : "btn-secondary"} btn-sm w-full`}
            disabled={pending || option.blocked !== null}
          >
            {option.label}
          </button>
          <p className="field-help text-center">{option.blocked ?? option.hint}</p>
        </div>
      ))}
      {pending ? (
        <p className="field-help text-center" aria-live="polite">
          Opening the payment page…
        </p>
      ) : null}
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold text-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
