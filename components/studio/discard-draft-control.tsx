"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { discardStudioItemAction, type VersionActionState } from "@/app/app/studio/actions";

const IDLE: VersionActionState = { status: "idle", message: null };

/** Deletes a draft and all its versions after a second confirmation. Success goes to the Studio list. */
export function DiscardDraftControl({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(discardStudioItemAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const keepButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (confirming) keepButton.current?.focus();
  }, [confirming]);

  return (
    <section className="stack-sm border-t border-border pt-6" aria-labelledby="studio-discard">
      <h2 id="studio-discard" className="text-base font-bold">
        Discard this draft
      </h2>
      {confirming ? (
        <form action={action} className="stack-sm" aria-busy={pending}>
          <input type="hidden" name="item_id" value={itemId} />
          <p role="alert" className="font-semibold">
            Delete this draft and all its versions? This can&apos;t be undone. The idea goes back to your saved ideas.
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
          <p className="field-help">Not going to make this one? Delete the draft and send the idea back to Saved.</p>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setConfirming(true)}
            >
              Discard draft
            </button>
          </div>
        </>
      )}
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
