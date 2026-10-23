"use client";

import { UpgradeButton } from "@/components/billing/upgrade-button";
import { useActionState, useState } from "react";
import { generateStrategyAction, type StrategyActionState } from "@/app/app/strategy/actions";
import { REGENERATE_BUTTON_ID } from "@/lib/strategy-notices";

const IDLE: StrategyActionState = { status: "idle", message: null, retryable: false };

interface Props {
  mode: "generate" | "regenerate";
  /** An error carried over from onboarding (`?error=`), shown until the next attempt. */
  initialError?: { message: string; retryable: boolean } | null;
}

/**
 * Generate, retry or regenerate the strategy. Regenerating replaces the
 * current strategy and costs a generation, so it asks for confirmation first.
 * Success redirects with a toast notice; only failures come back as state.
 */
export function GenerateStrategyControl({ mode, initialError = null }: Props) {
  const [state, action, pending] = useActionState<StrategyActionState, FormData>(
    generateStrategyAction,
    initialError ? { status: "error", ...initialError } : IDLE,
  );
  const [confirming, setConfirming] = useState(false);

  const error = state.status === "error" ? state : null;
  const pendingLabel = mode === "generate" ? "Building your strategy…" : "Rebuilding your strategy…";

  const submit = (
    <form action={action}>
      <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
        {pending ? pendingLabel : error?.retryable ? "Try again" : mode === "generate" ? "Generate my strategy" : "Regenerate"}
      </button>
    </form>
  );

  return (
    <div className="stack-sm">
      {error?.message ? (
        <div role="alert" className="alert stack-sm">
          <p className="font-semibold">{error.message}</p>
          {error.upgrade ? <UpgradeButton /> : null}
        </div>
      ) : null}

      {mode === "generate" ? (
        error && !error.retryable ? null : submit
      ) : confirming || pending ? (
        <div className="card stack-sm bg-surface-muted">
          <p>This replaces your current strategy and uses 1 of your AI generations.</p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              className="btn btn-secondary w-full sm:w-auto"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </button>
            {submit}
          </div>
        </div>
      ) : (
        <div>
          <button
            id={REGENERATE_BUTTON_ID}
            type="button"
            className="btn btn-secondary w-full sm:w-auto"
            onClick={() => setConfirming(true)}
          >
            Regenerate strategy
          </button>
        </div>
      )}

      <p aria-live="polite" className="field-help">
        {pending ? "This can take up to a minute. Please keep this page open." : ""}
      </p>
    </div>
  );
}
