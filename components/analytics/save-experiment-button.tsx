"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { saveExperimentAction, type SaveExperimentState } from "@/app/app/analytics/actions";

const IDLE: SaveExperimentState = { status: "idle", message: null, submission: 0 };

/** Saves the next experiment as an idea once; afterwards it links to Saved ideas. */
export function SaveExperimentButton({ diagnosisId, itemId, saved }: { diagnosisId: string; itemId: string; saved: boolean }) {
  const [state, action, pending] = useActionState(saveExperimentAction, IDLE);
  const handled = useRef<SaveExperimentState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || handled.current === state) return;
    handled.current = state;
    toast.success("Saved to your ideas");
  }, [state]);

  if (saved || state.status === "ok") {
    return (
      <div>
        <Link href="/app/opportunities?view=saved" className="btn btn-secondary btn-sm w-full min-[480px]:w-auto">
          View in saved ideas
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="diagnosis_id" value={diagnosisId} />
      <input type="hidden" name="item_id" value={itemId} />
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save as idea"}
        </button>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
