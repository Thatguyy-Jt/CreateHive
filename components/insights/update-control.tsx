"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateInsightsAction } from "@/app/app/insights/actions";

/**
 * Asks the Learning Agent for an update. Success toasts, shows the run's notes
 * (they are not stored) and moves focus to the insights list; errors stay inline.
 */
export function UpdateControl({ again, left }: { again: boolean; left: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; retryable: boolean } | null>(null);
  const [notes, setNotes] = useState<string[]>([]);

  function update() {
    setError(null);
    start(async () => {
      const result = await updateInsightsAction();
      if (!result.ok) {
        setError({ message: result.message, retryable: result.retryable });
        return;
      }
      setNotes(result.notes);
      toast.success(
        result.count === 0 ? "No clear patterns yet" : result.count === 1 ? "1 insight found" : `${result.count} insights found`,
      );
      document.getElementById("insights-list-heading")?.focus();
    });
  }

  const label = pending ? "Looking for patterns…" : error?.retryable ? "Try again" : again ? "Update again" : "Update insights";
  return (
    <div className="stack-sm" aria-busy={pending}>
      <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center">
        <button
          type="button"
          className={`btn ${again ? "btn-secondary" : "btn-primary"} btn-sm w-full min-[480px]:w-auto`}
          onClick={update}
          disabled={pending || left <= 0}
        >
          {label}
        </button>
        <p className="field-help" aria-live="polite">
          {pending
            ? "This can take up to a minute."
            : left <= 0
              ? "You've used today's 3 updates. Try again tomorrow."
              : `Uses 1 AI generation · ${left} of 3 updates left today`}
        </p>
      </div>
      {error ? (
        <p role="alert" className="alert text-sm font-semibold">
          {error.message}
        </p>
      ) : null}
      {notes.length ? (
        <div className="stack-sm">
          <h3 className="text-base font-bold">Keep in mind</h3>
          <ul className="list-disc stack-sm pl-5 text-muted-foreground">
            {notes.map((note, index) => (
              <li key={index} className="break-words">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
