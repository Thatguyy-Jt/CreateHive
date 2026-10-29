"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  rescheduleItemAction,
  unscheduleItemAction,
  type CalendarActionState,
} from "@/app/app/calendar/actions";
import { formatDay, formatTime } from "@/lib/calendar/dates";
import { PLATFORM_LABELS } from "@/lib/schemas/labels";
import type { CalendarItem } from "@/lib/services/calendar";
import { DateTimeFields } from "./date-time-fields";

const IDLE: CalendarActionState = { status: "idle", message: null, submission: 0 };

/** One scheduled item in a day column: what it is, when, and Move / Remove. Text only. */
export function CalendarItemCard({ item, min, max }: { item: CalendarItem; min: string; max: string }) {
  const [moveState, moveAction, moving] = useActionState(rescheduleItemAction, IDLE);
  const [removeState, removeAction, removing] = useActionState(unscheduleItemAction, IDLE);
  const [editing, setEditing] = useState(false);
  // Strict Mode runs effects twice in development; react to each result once.
  const handled = useRef<CalendarActionState | null>(null);

  useEffect(() => {
    if (moveState.status !== "ok" || handled.current === moveState) return;
    handled.current = moveState;
    const day = moveState.date ? formatDay(moveState.date) : null;
    toast.success(day ? `Moved to ${day}` : "Moved");
  }, [moveState]);

  const pending = moving || removing;
  const headingId = `item-${item.id}`;
  const meta = [item.platform ? PLATFORM_LABELS[item.platform] : null, item.format].filter(Boolean).join(" · ");
  const error =
    (removeState.status === "error" && removeState.message) || (moveState.status === "error" && moveState.message);

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={pending}
      className={`stack-sm h-full min-w-0 rounded-md border border-border bg-surface p-4 transition-opacity ${
        pending ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
        <p>
          <span className="font-semibold">{formatTime(item.time)}</span>
          {item.passed ? <span className="text-muted-foreground"> · Date passed</span> : null}
        </p>
        {item.pillar_name ? (
          // One line, never a wrapped blob: long names are cut, the full name is in the title.
          <span
            title={item.pillar_name}
            className="min-w-0 max-w-[60%] truncate rounded-pill border border-border px-3 py-0.5 font-semibold"
          >
            {item.pillar_name}
          </span>
        ) : null}
      </div>
      <h3 id={headingId} className="text-base font-bold [overflow-wrap:anywhere]">
        {item.title}
      </h3>
      {meta ? <p className="field-help">{meta}</p> : null}
      {item.hook ? (
        <blockquote className="line-clamp-2 border-l-4 border-accent pl-3 font-accent text-sm italic">{item.hook}</blockquote>
      ) : null}

      {editing ? (
        <form
          action={(formData) => {
            setEditing(false);
            moveAction(formData);
          }}
          className="stack-sm"
        >
          <input type="hidden" name="id" value={item.id} />
          <DateTimeFields id={`move-${item.id}`} defaultDate={item.date} defaultTime={item.time} min={min} max={max} />
          <div className="flex flex-col gap-2 min-[480px]:flex-row">
            <button type="submit" className="btn btn-primary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
              Save
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3 min-[480px]:flex-row min-[480px]:flex-wrap">
          <Link
            href={`/app/studio/${item.id}`}
            className="btn btn-secondary btn-sm w-full min-[480px]:w-auto"
            aria-label={`Open ${item.title} in Studio`}
          >
            Open in Studio
          </Link>
          <Link
            href={`/app/studio/${item.id}#publish`}
            className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
            aria-label={`Mark ${item.title} as published`}
          >
            Mark as published
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
            onClick={() => setEditing(true)}
            disabled={pending}
            aria-label={`Move ${item.title}`}
          >
            {moving ? "Moving…" : "Move"}
          </button>
          <form action={removeAction}>
            <input type="hidden" name="id" value={item.id} />
            <button
              type="submit"
              className="btn btn-ghost btn-sm w-full min-[480px]:w-auto"
              disabled={pending}
              aria-label={`Remove ${item.title} from calendar`}
            >
              {removing ? "Removing…" : "Remove from calendar"}
            </button>
          </form>
        </div>
      )}

      {error ? (
        <p role="alert" className="alert text-sm font-semibold">
          {error}
        </p>
      ) : null}
    </article>
  );
}
