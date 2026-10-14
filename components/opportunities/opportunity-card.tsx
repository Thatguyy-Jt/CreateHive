"use client";

import Link from "next/link";
import { useActionState } from "react";
import { updateOpportunityStatusAction, type StatusActionState } from "@/app/app/opportunities/actions";
import { PLATFORM_LABELS } from "@/lib/schemas/creator";
import type { IdeaStatus, SignalLevel } from "@/lib/schemas/enums";
import type { StoredOpportunity } from "@/lib/schemas/opportunities";
import { StartStudioForm } from "../studio/start-studio-form";
import { EvidenceList } from "./evidence-list";

const IDLE: StatusActionState = { status: "idle", message: null };

const LEVEL: Record<SignalLevel, string> = { low: "Low", medium: "Medium", high: "High" };
const DIFFICULTY = { easy: "Easy", medium: "Medium", hard: "Hard" } as const;

type Action = { to: IdeaStatus; label: string; primary?: boolean };

/** The next steps each view allows; the server enforces the same table. */
const ACTIONS: Partial<Record<IdeaStatus, Action[]>> = {
  new: [
    { to: "saved", label: "Save", primary: true },
    { to: "dismissed", label: "Dismiss" },
  ],
  saved: [
    { to: "new", label: "Unsave" },
    { to: "dismissed", label: "Dismiss" },
  ],
  dismissed: [{ to: "new", label: "Restore" }],
};

function Detail({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="font-semibold">{label}</dt>
      <dd className="text-muted-foreground">{value}</dd>
    </div>
  );
}

/** Why the strength is what it is, in words: signals cited, past performance, or your profile. */
function strengthReason(evidence: StoredOpportunity["evidence"]): string {
  const signals = evidence.filter((item) => item.source).length;
  const parts = [
    signals ? (signals === 1 ? "1 signal" : `${signals} signals`) : null,
    evidence.some((item) => item.kind === "creator_history") ? "your past performance" : null,
    evidence.some((item) => item.kind === "creator_input" && !item.source) ? "your profile" : null,
  ];
  return parts.filter(Boolean).join(", ");
}

/** Where a `planned` idea sits on the calendar, formatted server-side in the creator's timezone. */
export interface PlannedSchedule {
  /** "Wed, Oct 14, 9:00 AM", or null when its item no longer has a date. */
  label: string | null;
  href: string;
}

/** One opportunity as a decision: make it or not. Text only: React escapes everything. */
export function OpportunityCard({ idea, schedule = null }: { idea: StoredOpportunity; schedule?: PlannedSchedule | null }) {
  const [state, action, pending] = useActionState(updateOpportunityStatusAction, IDLE);
  const headingId = `idea-${idea.id}`;
  const reason = strengthReason(idea.evidence);
  const meta = [idea.platform ? PLATFORM_LABELS[idea.platform] : null, idea.format].filter(Boolean).join(" · ");

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={pending}
      className={`card stack-sm transition-opacity ${pending ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {idea.pillar_name ? (
          <span className="rounded-pill border border-border px-3 py-1 font-semibold">{idea.pillar_name}</span>
        ) : null}
        {meta ? <span className="text-muted-foreground">{meta}</span> : null}
        {idea.difficulty ? <span className="text-muted-foreground">{DIFFICULTY[idea.difficulty]}</span> : null}
      </div>

      <h3 id={headingId} className="text-lg font-bold">
        {idea.topic}
      </h3>
      {idea.hook ? (
        <blockquote className="border-l-4 border-accent pl-4 font-accent text-lg italic">{idea.hook}</blockquote>
      ) : null}

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {idea.audience_fit ? (
          <div className="flex gap-1">
            <dt className="font-semibold">Audience fit:</dt>
            <dd>
              {LEVEL[idea.audience_fit]} <span className="text-muted-foreground">(AI judgment)</span>
            </dd>
          </div>
        ) : null}
        {idea.evidence_strength ? (
          <div className="flex gap-1">
            <dt className="font-semibold">Evidence:</dt>
            <dd>
              {LEVEL[idea.evidence_strength]}
              {reason ? <span className="text-muted-foreground"> · from {reason}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <details className="stack-sm">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Why this idea</summary>
        <dl className="stack-sm pt-2">
          <Detail label="Who it's for" value={idea.audience_need} />
          <Detail label="Angle" value={idea.angle} />
          <Detail label="Why it fits you" value={idea.rationale} />
          <Detail label="Call to action" value={idea.cta} />
          {idea.evidence.length ? (
            <div>
              <dt className="font-semibold">Evidence</dt>
              <dd>
                <EvidenceList evidence={idea.evidence} />
              </dd>
            </div>
          ) : null}
        </dl>
      </details>

      {idea.cta ? (
        <p className="text-sm">
          <span className="font-semibold">Next step:</span> {idea.cta}
        </p>
      ) : null}

      {idea.status === "planned" ? (
        <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-4">
          <p className="text-sm font-semibold">
            {schedule?.label ? `Scheduled for ${schedule.label}` : "Planned, not on a date"}
          </p>
          <Link href={schedule?.href ?? "/app/calendar"} className="btn btn-secondary btn-sm w-full min-[480px]:w-auto">
            View in calendar
          </Link>
        </div>
      ) : null}

      {idea.status === "in_production" ? (
        <div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:gap-4">
          <p className="text-sm font-semibold">In Studio</p>
          <Link
            href={idea.studio_item_id ? `/app/studio/${idea.studio_item_id}` : "/app/studio"}
            className="btn btn-secondary btn-sm w-full min-[480px]:w-auto"
          >
            Open in Studio
          </Link>
        </div>
      ) : null}

      {idea.status === "saved" ? <StartStudioForm ideaId={idea.id} /> : null}

      <div className="flex flex-col gap-2 min-[480px]:flex-row">
        {(ACTIONS[idea.status] ?? []).map((item) => (
          <form key={item.to} action={action}>
            <input type="hidden" name="id" value={idea.id} />
            <input type="hidden" name="status" value={item.to} />
            <button
              type="submit"
              className={`btn btn-sm w-full min-[480px]:w-auto ${item.primary ? "btn-primary" : "btn-ghost"}`}
              disabled={pending}
            >
              {item.label}
            </button>
          </form>
        ))}
      </div>

      {state.status === "error" && state.message ? (
        <p role="alert" className="alert text-sm font-semibold">
          {state.message}
        </p>
      ) : null}
    </article>
  );
}
