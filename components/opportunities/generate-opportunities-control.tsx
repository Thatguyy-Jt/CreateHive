"use client";

import { UpgradeButton } from "@/components/billing/upgrade-button";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { generateOpportunitiesAction, type GenerateOpportunitiesState } from "@/app/app/opportunities/actions";

const IDLE: GenerateOpportunitiesState = { status: "idle", message: null, retryable: false, created: 0 };

/**
 * Generates a batch of ideas. Success re-renders the list on the server and
 * confirms with a toast; failures stay inline.
 */
export function GenerateOpportunitiesControl() {
  const [state, action, pending] = useActionState(generateOpportunitiesAction, IDLE);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<GenerateOpportunitiesState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success(state.created === 1 ? "1 new idea added" : `${state.created} new ideas added`);
  }, [state]);

  const error = state.status === "error" ? state : null;

  return (
    <div className="stack-sm sm:items-end">
      <form action={action}>
        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
          {pending ? "Finding ideas…" : error?.retryable ? "Try again" : "Generate ideas"}
        </button>
      </form>
      <p aria-live="polite" className="field-help sm:text-right">
        {pending ? "Finding ideas… this can take up to a minute." : "Uses 1 AI generation for 5 ideas."}
      </p>
      {error?.message ? (
        <div role="alert" className="alert stack-sm">
          <p className="font-semibold">{error.message}</p>
          {error.upgrade ? <UpgradeButton /> : null}
        </div>
      ) : null}
    </div>
  );
}
