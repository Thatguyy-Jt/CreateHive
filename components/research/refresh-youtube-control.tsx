"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { refreshYouTubeAction, type RefreshYouTubeState } from "@/app/app/research/actions";

const IDLE: RefreshYouTubeState = { status: "idle", message: null, added: 0 };

/**
 * The refresh button, or why it isn't available (`children`). Stays mounted in
 * every state: a successful refresh re-renders the card as "cached", and the
 * toast must still fire.
 */
export function RefreshYouTubeControl({ canRefresh, children }: { canRefresh: boolean; children?: ReactNode }) {
  const [state, action, pending] = useActionState(refreshYouTubeAction, IDLE);
  const toasted = useRef<RefreshYouTubeState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success(
      state.added === 0
        ? "No new videos found this time"
        : state.added === 1
          ? "1 video added"
          : `${state.added} videos added`,
    );
  }, [state]);

  return (
    <div className="stack-sm">
      {canRefresh ? (
        <form action={action}>
          <button type="submit" className="btn btn-secondary w-full sm:w-auto" disabled={pending}>
            {pending ? "Fetching videos…" : "Refresh from YouTube"}
          </button>
        </form>
      ) : (
        children
      )}
      <p aria-live="polite" className="field-help">
        {pending ? "Fetching videos… this takes a few seconds." : ""}
      </p>
      {state.status === "error" && state.message ? (
        <div role="alert" className="alert">
          <p className="font-semibold">{state.message}</p>
        </div>
      ) : null}
    </div>
  );
}
