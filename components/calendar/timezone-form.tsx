"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { saveTimezoneAction, type CalendarActionState } from "@/app/app/calendar/actions";

const IDLE: CalendarActionState = { status: "idle", message: null, submission: 0 };

const noSubscribe = () => () => {};
const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

/**
 * Timezone picker. With no saved value it is prefilled from the browser after
 * hydration; nothing is saved until the creator presses the button.
 */
export function TimezoneForm({
  id,
  options,
  current,
  submitLabel,
}: {
  /** Prefix for element ids, unique on the page. */
  id: string;
  options: readonly string[];
  current: string | null;
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(saveTimezoneAction, IDLE);
  const detected = useSyncExternalStore(noSubscribe, browserTimezone, () => null);
  const [chosen, setChosen] = useState<string | null>(null);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<CalendarActionState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success("Timezone saved");
  }, [state]);

  const fallback = detected && options.includes(detected) ? detected : "UTC";
  const value = chosen ?? current ?? fallback;
  const selectId = `${id}-timezone`;
  const helpId = `${id}-timezone-help`;

  return (
    <form action={action} className="stack-sm">
      <div className="field">
        <label htmlFor={selectId} className="field-label">
          Timezone
        </label>
        <p id={helpId} className="field-help">
          {current
            ? "Your week runs Monday to Sunday in this timezone."
            : detected && options.includes(detected)
              ? "We picked this from your browser. Change it if it's wrong."
              : "Choose where you are, so your week runs Monday to Sunday in your time."}
        </p>
        <select
          id={selectId}
          name="timezone"
          className="select"
          value={value}
          onChange={(event) => setChosen(event.currentTarget.value)}
          aria-describedby={helpId}
        >
          {options.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </div>
      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
