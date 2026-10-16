"use client";

import { useEffect, useRef, useState } from "react";
import { deletePostAction, deleteResultsAction } from "@/app/app/analytics/actions";
import { FormAlert } from "./fields";
import { useAnalyticsForm } from "./use-analytics-form";

/** Deletes a post and its results after a second confirmation. Success goes to /app/analytics. */
export function DeletePostControl({ itemId, fromStudio }: { itemId: string; fromStudio: boolean }) {
  const [state, action, pending] = useAnalyticsForm(deletePostAction);
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  return (
    <section className="stack-sm border-t border-border pt-6" aria-labelledby="post-delete">
      <h2 id="post-delete" className="text-base font-bold">
        Delete this post
      </h2>
      {confirming ? (
        <form action={action} className="stack-sm" aria-busy={pending}>
          <input type="hidden" name="item_id" value={itemId} />
          <p role="alert" className="font-semibold">
            {fromStudio
              ? "Delete this post, all its results and its Studio package? This can't be undone."
              : "Delete this post and all its results? This can't be undone."}
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
        <>
          <p className="field-help">Logged by mistake? Deleting it also removes it from your usual numbers.</p>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setConfirming(true)}
            >
              Delete post
            </button>
          </div>
        </>
      )}
      <FormAlert message={state.status === "error" ? state.message : null} />
    </section>
  );
}

/** Deletes one results entry (to fix a typo). */
export function DeleteResultsButton({ snapshotId, label }: { snapshotId: string; label: string }) {
  const [state, action, pending] = useAnalyticsForm(deleteResultsAction, "Results deleted");
  return (
    <form action={action} className="stack-sm">
      <input type="hidden" name="snapshot_id" value={snapshotId} />
      <button
        type="submit"
        className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
        disabled={pending}
        aria-label={`Delete results from ${label}`}
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      <FormAlert message={state.status === "error" ? state.message : null} />
    </form>
  );
}
