"use client";

import { UpgradeButton } from "@/components/billing/upgrade-button";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { acceptPlanAction, generateWeeklyPlanAction } from "@/app/app/calendar/actions";
import { formatDay } from "@/lib/calendar/dates";
import type { ProposedSlot } from "@/lib/schemas/calendar";
import { PLATFORM_LABELS } from "@/lib/schemas/labels";

interface Proposal {
  slots: ProposedSlot[];
  note: string | null;
}

/**
 * "Suggest my week" and the proposal it returns. The proposal lives in this
 * component only: nothing is scheduled until the creator accepts, and a
 * refresh discards it.
 */
export function WeekPlanner({ weekStart, unavailable }: { weekStart: string; unavailable: string | null }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState<{ message: string; retryable: boolean; upgrade?: boolean } | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [suggesting, startSuggest] = useTransition();
  const [accepting, startAccept] = useTransition();

  function suggest() {
    setError(null);
    setAcceptError(null);
    startSuggest(async () => {
      const result = await generateWeeklyPlanAction(weekStart);
      if (result.ok) setProposal({ slots: result.slots, note: result.note });
      else setError({ message: result.message, retryable: result.retryable, upgrade: result.upgrade });
    });
  }

  function accept() {
    if (!proposal?.slots.length) return;
    setAcceptError(null);
    const slots = proposal.slots.map(({ idea_id, date, time }) => ({ idea_id, date, time }));
    startAccept(async () => {
      const result = await acceptPlanAction(slots);
      if (!result.ok) {
        setAcceptError(result.message);
        return;
      }
      setProposal(null);
      toast.success(result.scheduled === 1 ? "1 idea scheduled" : `${result.scheduled} ideas scheduled`);
    });
  }

  const remove = (ideaId: string) =>
    setProposal((current) => (current ? { ...current, slots: current.slots.filter((s) => s.idea_id !== ideaId) } : current));

  const days = proposal ? [...new Set(proposal.slots.map((slot) => slot.date))] : [];

  return (
    <div className="stack-md">
      <div className="stack-sm sm:items-start">
        <div>
          <button
            type="button"
            className="btn btn-primary w-full sm:w-auto"
            onClick={suggest}
            disabled={suggesting || accepting || unavailable !== null}
          >
            {suggesting ? "Suggesting your week…" : error?.retryable ? "Try again" : "Suggest my week"}
          </button>
        </div>
        <p className="field-help" aria-live="polite">
          {suggesting
            ? "Suggesting your week… this can take up to a minute."
            : (unavailable ?? "Arranges your saved ideas into this week. Uses 1 AI generation.")}
        </p>
        {error ? (
          <div role="alert" className="alert stack-sm">
            <p className="font-semibold">{error.message}</p>
            {error.upgrade ? <UpgradeButton /> : null}
          </div>
        ) : null}
      </div>

      <div aria-live="polite">
        {proposal ? (
          <section className="card card-offset stack-md max-w-3xl" aria-labelledby="proposal-heading">
            <div className="stack-sm">
              <h2 id="proposal-heading" className="text-heading">
                Suggested week
              </h2>
              <p className="field-help">
                Nothing is scheduled until you accept. Each idea is set for 9:00 AM; you can move it afterwards.
              </p>
              {proposal.note ? <p>{proposal.note}</p> : null}
            </div>

            {proposal.slots.length === 0 ? (
              <p className="text-muted-foreground">No slots left in this suggestion.</p>
            ) : (
              days.map((date) => (
                <div key={date} className="stack-sm">
                  <h3 className="text-base font-bold">{formatDay(date)}</h3>
                  <ul className="stack-sm">
                    {proposal.slots
                      .filter((slot) => slot.date === date)
                      .map((slot) => {
                        const meta = [
                          slot.idea.pillar_name,
                          slot.idea.platform ? PLATFORM_LABELS[slot.idea.platform] : null,
                          slot.idea.format,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <li
                            key={slot.idea_id}
                            className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-start sm:justify-between"
                          >
                            <div className="stack-sm min-w-0">
                              <p className="font-bold break-words">{slot.idea.topic}</p>
                              {meta ? <p className="field-help break-words">{meta}</p> : null}
                              <p className="text-sm break-words">{slot.reason}</p>
                            </div>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm w-full shrink-0 sm:w-auto"
                              onClick={() => remove(slot.idea_id)}
                              disabled={accepting}
                              aria-label={`Remove ${slot.idea.topic} from the suggestion`}
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                  </ul>
                </div>
              ))
            )}

            {acceptError ? (
              <div role="alert" className="alert">
                <p className="font-semibold">{acceptError}</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 min-[480px]:flex-row">
              <button
                type="button"
                className="btn btn-primary w-full min-[480px]:w-auto"
                onClick={accept}
                disabled={accepting || proposal.slots.length === 0}
              >
                {accepting ? "Scheduling…" : "Accept plan"}
              </button>
              <button
                type="button"
                className="btn btn-ghost w-full min-[480px]:w-auto"
                onClick={() => {
                  setProposal(null);
                  setAcceptError(null);
                }}
                disabled={accepting}
              >
                Discard
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
