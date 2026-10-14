"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { scheduleIdeaAction, type CalendarActionState } from "@/app/app/calendar/actions";
import { formatDay } from "@/lib/calendar/dates";
import { DateTimeFields } from "./date-time-fields";

const IDLE: CalendarActionState = { status: "idle", message: null, submission: 0 };

/** Puts one saved idea on a local date and time. Errors stay inline; success toasts. */
export function ScheduleIdeaForm({
  ideaId,
  defaultDate,
  min,
  max,
}: {
  ideaId: string;
  defaultDate: string;
  min: string;
  max: string;
}) {
  const [state, action, pending] = useActionState(scheduleIdeaAction, IDLE);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<CalendarActionState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    const day = state.date ? formatDay(state.date) : null;
    toast.success(day ? `Scheduled for ${day}` : "Scheduled");
  }, [state]);

  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="idea_id" value={ideaId} />
      <DateTimeFields id={`schedule-${ideaId}`} defaultDate={defaultDate} min={min} max={max} />
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
          {pending ? "Scheduling…" : "Schedule"}
        </button>
      </div>
    </form>
  );
}
