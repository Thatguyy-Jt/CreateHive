"use client";

import { UpgradeButton } from "@/components/billing/upgrade-button";
import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { regenerateSectionAction, type GeneratePackageState } from "@/app/app/studio/actions";
import type { SectionKey } from "@/lib/schemas/studio";

const IDLE: GeneratePackageState = { status: "idle", message: null, retryable: false, submission: 0 };
const INSTRUCTION_MAX = 200;

/** "Regenerate" for one section, with an optional note on what should change. Errors stay inline. */
export function RegenerateSectionForm({
  itemId,
  section,
  title,
  baseVersion,
}: {
  itemId: string;
  section: SectionKey;
  title: string;
  baseVersion: number;
}) {
  const [state, action, pending] = useActionState(regenerateSectionAction, IDLE);
  // Strict Mode runs effects twice in development; toast each result once.
  const toasted = useRef<GeneratePackageState | null>(null);

  useEffect(() => {
    if (state.status !== "ok" || toasted.current === state) return;
    toasted.current = state;
    toast.success(`${title} regenerated`);
  }, [state, title]);

  const error = state.status === "error" ? state : null;
  const fieldId = `regenerate-${section}`;

  return (
    <details className="stack-sm border-t border-border pt-2">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold">
        Regenerate<span className="sr-only"> {title.toLowerCase()}</span>
      </summary>
      <form action={action} className="stack-sm" aria-busy={pending}>
        <input type="hidden" name="item_id" value={itemId} />
        <input type="hidden" name="section" value={section} />
        <input type="hidden" name="base_version" value={baseVersion} />
        <div className="field">
          <label htmlFor={fieldId} className="field-label text-sm">
            What should change? <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={fieldId}
            name="instruction"
            className="textarea"
            rows={2}
            maxLength={INSTRUCTION_MAX}
            placeholder="For example: shorter, more playful"
          />
        </div>
        <div>
          <button type="submit" className="btn btn-secondary btn-sm w-full min-[480px]:w-auto" disabled={pending}>
            {pending ? "Regenerating…" : error?.retryable ? "Try again" : "Regenerate this section"}
          </button>
        </div>
        <p aria-live="polite" className="field-help">
          {pending ? "Regenerating… This can take up to a minute." : "Only this section changes. Uses 1 AI generation."}
        </p>
        {error?.message ? (
          <div role="alert" className="alert stack-sm">
            <p className="font-semibold">{error.message}</p>
            {error.upgrade ? <UpgradeButton /> : null}
          </div>
        ) : null}
      </form>
    </details>
  );
}
