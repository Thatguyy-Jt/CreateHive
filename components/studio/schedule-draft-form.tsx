"use client";

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { scheduleStudioItemAction, type ScheduleStudioState } from "@/app/app/studio/actions";
import { DateTimeFields } from "@/components/calendar/date-time-fields";
import { formatDay } from "@/lib/calendar/dates";

const IDLE: ScheduleStudioState = { status: "idle", message: null, submission: 0 };

/** Puts a Studio draft on the calendar. Errors stay inline; success toasts and the page re-renders as scheduled. */
export function ScheduleDraftForm({
  itemId,
  defaultDate,
  min,
  max,
}: {
  itemId: string;
  defaultDate: string;
  min: string;
  max: string;
}) {
  const [state, action, pending] = useActionState(scheduleStudioItemAction, IDLE);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<ScheduleStudioState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    const day = state.date ? formatDay(state.date) : null;
    toast.success(day ? `Scheduled for ${day}` : "Scheduled");
  }, [state]);

  return (
    <form action={action} className="stack-sm" aria-busy={pending}>
      <input type="hidden" name="item_id" value={itemId} />
      <DateTimeFields id={`studio-${itemId}`} defaultDate={defaultDate} min={min} max={max} />
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
