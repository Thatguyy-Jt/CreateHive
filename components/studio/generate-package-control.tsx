"use client";

import { UpgradeButton } from "@/components/billing/upgrade-button";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { generatePackageAction, type GeneratePackageState } from "@/app/app/studio/actions";

const IDLE: GeneratePackageState = { status: "idle", message: null, retryable: false, submission: 0 };

/**
 * Create package / Regenerate package. Success re-renders the page on the
 * server and confirms with a toast; failures stay inline. Keep it at one tree
 * position across both states, or a first success unmounts it before its toast.
 */
export function GeneratePackageControl({ itemId, hasPackage }: { itemId: string; hasPackage: boolean }) {
  const [state, action, pending] = useActionState(generatePackageAction, IDLE);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<GeneratePackageState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success(state.versionNo && state.versionNo > 1 ? "New package ready" : "Package created");
  }, [state]);

  const error = state.status === "error" ? state : null;
  const label = error?.retryable ? "Try again" : hasPackage ? "Regenerate package" : "Create package";

  return (
    <div className="stack-sm">
      <form action={action} aria-busy={pending}>
        <input type="hidden" name="item_id" value={itemId} />
        <button
          type="submit"
          className={`btn w-full min-[480px]:w-auto ${hasPackage ? "btn-secondary" : "btn-primary"}`}
          disabled={pending}
        >
          {pending ? "Creating your package…" : label}
        </button>
      </form>
      <p aria-live="polite" className="field-help">
        {pending
          ? "Creating your package… This can take up to a minute."
          : hasPackage
            ? "Your current package is kept. Uses 1 AI generation."
            : "Uses 1 AI generation."}
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
