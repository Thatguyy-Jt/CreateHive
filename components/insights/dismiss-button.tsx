"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setInsightStatusAction } from "@/app/app/insights/actions";

/** Dismisses an insight; the toast offers Undo. No AI call. */
export function DismissButton({ id, summary }: { id: string; summary: string }) {
  const [pending, start] = useTransition();

  // The card is gone by the time Undo is clicked, so this doesn't touch component state.
  async function undo() {
    const result = await setInsightStatusAction(id, "active");
    if (result.ok) toast.success("Insight restored");
    else toast.error(result.message);
  }

  function dismiss() {
    start(async () => {
      const result = await setInsightStatusAction(id, "dismissed");
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Insight dismissed. It won't be suggested again.", { action: { label: "Undo", onClick: undo } });
    });
  }

  return (
    <div>
      <button
        type="button"
        className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
        onClick={dismiss}
        disabled={pending}
        aria-label={`Dismiss insight: ${summary}`}
      >
        {pending ? "Dismissing…" : "Dismiss"}
      </button>
    </div>
  );
}
