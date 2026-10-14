"use client";

import { useActionState } from "react";
import { startStudioItemAction, type StartStudioState } from "@/app/app/studio/actions";

const IDLE: StartStudioState = { status: "idle", message: null };

/** "Create in Studio" for a saved idea. Success redirects to the item; errors stay inline. */
export function StartStudioForm({ ideaId, primary = true }: { ideaId: string; primary?: boolean }) {
  const [state, action, pending] = useActionState(startStudioItemAction, IDLE);
  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="idea_id" value={ideaId} />
      <div>
        <button
          type="submit"
          className={`btn btn-sm w-full min-[480px]:w-auto ${primary ? "btn-primary" : "btn-secondary"}`}
          disabled={pending}
        >
          {pending ? "Opening Studio…" : "Create in Studio"}
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
