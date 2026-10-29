"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteBreakdownAction,
  rerunBreakdownAction,
  saveBreakdownIdeaAction,
  type BreakdownItemState,
} from "@/app/app/breakdown/actions";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { StartStudioForm } from "@/components/studio/start-studio-form";

const IDLE: BreakdownItemState = { status: "idle", message: null, submission: 0 };

function ErrorAlert({ state }: { state: BreakdownItemState }) {
  if (state.status !== "error" || !state.message) return null;
  return (
    <div role="alert" className="alert stack-sm text-sm">
      <p className="font-semibold">{state.message}</p>
      {state.upgrade ? <UpgradeButton /> : null}
    </div>
  );
}

/** Save as idea once; afterwards Create in Studio and View in saved ideas. */
export function SaveIdeaControl({ breakdownId, savedIdeaId }: { breakdownId: string; savedIdeaId: string | null }) {
  const [state, action, pending] = useActionState(saveBreakdownIdeaAction, IDLE);
  const handled = useRef<BreakdownItemState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || handled.current === state) return;
    handled.current = state;
    toast.success("Saved to your ideas");
  }, [state]);

  const ideaId = state.ideaId ?? savedIdeaId;
  if (ideaId) {
    return (
      <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-start">
        <StartStudioForm ideaId={ideaId} />
        <div>
          <Link href="/app/opportunities?view=saved" className="btn btn-secondary btn-sm w-full min-[480px]:w-auto">
            View in saved ideas
          </Link>
        </div>
      </div>
    );
  }
  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="breakdown_id" value={breakdownId} />
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save as idea"}
        </button>
      </div>
      <ErrorAlert state={state} />
    </form>
  );
}

/** Breaks the same video down again. Counts toward the monthly allowance. */
export function RerunControl({ breakdownId, manual }: { breakdownId: string; manual: boolean }) {
  const [state, action, pending] = useActionState(rerunBreakdownAction, IDLE);
  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="breakdown_id" value={breakdownId} />
      <div>
        <button type="submit" className="btn btn-secondary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Breaking it down…" : "Break it down again"}
        </button>
      </div>
      <p className="field-help">
        {pending
          ? "This can take up to a minute."
          : manual
            ? "Uses 1 breakdown. Uses the numbers you entered; pasted comments aren't kept, so they won't be included."
            : "Uses 1 breakdown. Fetches the latest numbers from YouTube."}
      </p>
      <ErrorAlert state={state} />
    </form>
  );
}

/** Deletes the breakdown after a second confirmation. Ideas saved from it are kept. */
export function DeleteBreakdownControl({ breakdownId }: { breakdownId: string }) {
  const [state, action, pending] = useActionState(deleteBreakdownAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  return (
    <div className="stack-sm">
      {confirming ? (
        <form action={action} className="stack-sm" aria-busy={pending}>
          <input type="hidden" name="breakdown_id" value={breakdownId} />
          <p role="alert" className="font-semibold">
            Delete this breakdown? Ideas you saved from it are kept. This can&apos;t be undone.
          </p>
          <div className="flex flex-col gap-2 min-[480px]:flex-row">
            <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              ref={keepButton}
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Keep it
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" className="btn btn-ghost btn-sm w-full min-[480px]:w-auto" onClick={() => setConfirming(true)}>
            Delete breakdown
          </button>
        </div>
      )}
      <ErrorAlert state={state} />
    </div>
  );
}
