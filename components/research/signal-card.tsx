"use client";

import { useActionState, useState } from "react";
import { deleteSignalAction, type DeleteSignalState } from "@/app/app/research/actions";
import { SIGNAL_SOURCE_LABELS, SIGNAL_TYPE_LABELS } from "@/lib/schemas/labels";
import type { StoredSignal } from "@/lib/schemas/research";

const IDLE: DeleteSignalState = { status: "idle", message: null };
const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

function describe(signal: StoredSignal) {
  if (signal.source === "youtube") {
    const p = signal.payload;
    return {
      heading: signal.title ?? "Untitled video",
      body: null,
      meta: [
        p.channel_title || null,
        `published ${DATE.format(new Date(p.published_at))}`,
        p.view_count !== null ? `${p.view_count.toLocaleString("en-US")} views` : null,
        signal.expires_at ? `kept until ${DATE.format(new Date(signal.expires_at))}` : null,
      ],
      linkText: "Watch on YouTube",
    };
  }
  return {
    heading: signal.payload.label ?? SIGNAL_TYPE_LABELS[signal.signal_type],
    body: signal.payload.text,
    meta: [`added ${DATE.format(new Date(signal.created_at))}`],
    linkText: "View source",
  };
}

/** One signal: where it came from, what it says, and a delete with confirmation. Text only. */
export function SignalCard({ signal }: { signal: StoredSignal }) {
  const [state, action, pending] = useActionState(deleteSignalAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  const { heading, body, meta, linkText } = describe(signal);
  const headingId = `signal-${signal.id}`;

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={pending}
      className={`card stack-sm transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="rounded-pill border border-border px-3 py-1 font-semibold">
          {SIGNAL_SOURCE_LABELS[signal.source]}
        </span>
        <span className="text-muted-foreground">{SIGNAL_TYPE_LABELS[signal.signal_type]}</span>
      </div>
      <h3 id={headingId} className="text-lg font-bold break-words">
        {heading}
      </h3>
      {body ? <p className="text-muted-foreground whitespace-pre-line break-words">{body}</p> : null}
      <p className="field-help">{meta.filter(Boolean).join(" · ")}</p>
      {signal.source === "youtube" ? <p className="field-help">Data from the YouTube API.</p> : null}

      {confirming || pending ? (
        <div className="card stack-sm bg-surface-muted">
          <p>Delete this signal? Ideas that already cite it keep their copy of the evidence.</p>
          <div className="flex flex-col-reverse gap-2 min-[480px]:flex-row">
            <button
              type="button"
              className="btn btn-sm btn-secondary w-full min-[480px]:w-auto"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancel
            </button>
            <form action={action}>
              <input type="hidden" name="id" value={signal.id} />
              <button type="submit" className="btn btn-sm btn-primary w-full min-[480px]:w-auto" disabled={pending}>
                {pending ? "Deleting…" : "Delete signal"}
              </button>
            </form>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 min-[480px]:flex-row">
          {signal.source_url ? (
            <a
              href={signal.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm btn-secondary w-full min-[480px]:w-auto"
            >
              {linkText}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          <button
            type="button"
            className="btn btn-sm btn-ghost w-full min-[480px]:w-auto"
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        </div>
      )}

      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </article>
  );
}
