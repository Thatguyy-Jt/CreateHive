"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { diagnosePostAction, type DiagnosisActionState } from "@/app/app/analytics/actions";

const IDLE: DiagnosisActionState = { status: "idle", message: null, retryable: false, submission: 0 };

/** Asks for a diagnosis. Success toasts and moves focus to the new diagnosis; errors stay inline. */
export function DiagnoseControl({ itemId, again }: { itemId: string; again: boolean }) {
  const [state, action, pending] = useActionState(diagnosePostAction, IDLE);
  // Strict Mode runs effects twice in development; react to each result once.
  const handled = useRef<DiagnosisActionState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || handled.current === state) return;
    handled.current = state;
    toast.success("Diagnosis ready");
    document.getElementById("post-diagnosis-headline")?.focus();
  }, [state]);

  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="item_id" value={itemId} />
      <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
        <button
          type="submit"
          className={`btn ${again ? "btn-secondary" : "btn-primary"} btn-sm w-full min-[480px]:w-auto`}
          disabled={pending}
        >
          {pending ? "Reading your results…" : state.status === "error" && state.retryable ? "Try again" : again ? "Diagnose again" : "Diagnose this post"}
        </button>
        <p className="field-help">{pending ? "This can take up to a minute." : "Uses 1 AI generation."}</p>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
