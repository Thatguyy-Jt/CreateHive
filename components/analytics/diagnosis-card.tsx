import type { ReactNode } from "react";
import { formatDay, localDateKey } from "@/lib/calendar/dates";
import { CONFIDENCE_LABELS, FACTOR_LABELS } from "@/lib/schemas/diagnosis";
import type { PostDetail } from "@/lib/services/analytics";
import type { LatestDiagnosis } from "@/lib/services/diagnosis";
import { DiagnoseControl } from "./diagnose-control";
import { SaveExperimentButton } from "./save-experiment-button";

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="card stack-md" aria-labelledby="post-diagnosis">
      <h2 id="post-diagnosis" className="text-heading">
        Why it did what it did
      </h2>
      {children}
    </section>
  );
}

function Diagnosed({ post, latest, tz }: { post: PostDetail; latest: LatestDiagnosis; tz: string | null }) {
  const diagnosis = latest.diagnosis!;
  const date = tz ? localDateKey(latest.created_at, tz) : null;
  const { next_experiment: experiment } = diagnosis;
  return (
    <>
      <p className="field-help">
        {date ? `Diagnosed ${formatDay(date)} · ` : ""}AI reading of your own numbers, not a prediction
      </p>
      <div className="stack-sm">
        <p id="post-diagnosis-headline" tabIndex={-1} className="text-lg font-semibold break-words outline-none">
          {diagnosis.headline}
        </p>
        <p className="break-words">{diagnosis.what_happened}</p>
      </div>

      <div className="stack-sm">
        <h3 className="text-base font-bold">What likely made the difference</h3>
        <ul className="stack-sm">
          {diagnosis.factors.map((factor, index) => (
            <li key={index} className="grid gap-1 border-b border-border pb-3 last:border-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="rounded-pill border border-border px-3 py-0.5 text-sm font-semibold">
                  {FACTOR_LABELS[factor.factor]}
                </span>
                <span className="text-sm text-muted-foreground">{CONFIDENCE_LABELS[factor.confidence]}</span>
              </div>
              <p className="break-words">{factor.observation}</p>
              <p className="field-help break-words">Based on: {factor.evidence}</p>
            </li>
          ))}
        </ul>
        {diagnosis.confidence_capped ? (
          <p className="field-help">Confidence is limited because there isn&apos;t much of your history to compare with yet.</p>
        ) : null}
      </div>

      <section className="stack-sm rounded-md border-2 border-foreground p-4" aria-labelledby="post-experiment">
        <h3 id="post-experiment" className="text-base font-bold">
          Try next
        </h3>
        <p className="font-semibold break-words">{experiment.change}</p>
        <p className="break-words">{experiment.why}</p>
        <p className="text-sm break-words">
          <span className="font-semibold">How to tell: </span>
          {experiment.how_to_tell}
        </p>
        <p className="text-sm text-muted-foreground break-words">
          Next post idea: {experiment.idea.topic}
          {experiment.idea.format ? ` (${experiment.idea.format})` : ""}
        </p>
        <SaveExperimentButton diagnosisId={latest.id} itemId={post.id} saved={latest.savedIdeaId !== null} />
      </section>

      {diagnosis.caveats.length ? (
        <div className="stack-sm">
          <h3 className="text-base font-bold">Keep in mind</h3>
          <ul className="list-disc stack-sm pl-5 text-muted-foreground">
            {diagnosis.caveats.map((caveat, index) => (
              <li key={index} className="break-words">
                {caveat}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/**
 * The post's latest AI diagnosis with its next experiment, or the control to
 * ask for one. Opening the page never calls AI.
 */
export function DiagnosisCard({
  post,
  latest,
  tz,
}: {
  post: PostDetail;
  /** `undefined` when the stored diagnosis couldn't be read from the database. */
  latest: LatestDiagnosis | null | undefined;
  tz: string | null;
}) {
  if (post.checkIns.length === 0) {
    return (
      <Card>
        <p className="text-muted-foreground">Add results first, then ask for a diagnosis.</p>
      </Card>
    );
  }
  if (latest === undefined) {
    return (
      <Card>
        <p className="text-muted-foreground">We couldn&apos;t load the diagnosis right now. Refresh the page to try again.</p>
      </Card>
    );
  }
  if (latest === null) {
    return (
      <Card>
        <p className="text-muted-foreground">Ask AI why this post did what it did, and what to try next.</p>
        {!post.comparison.settled ? (
          <p className="field-help">Results are early, so the diagnosis will be tentative.</p>
        ) : null}
        <DiagnoseControl itemId={post.id} again={false} />
      </Card>
    );
  }
  return (
    <Card>
      {latest.diagnosis ? (
        <Diagnosed post={post} latest={latest} tz={tz} />
      ) : (
        <p role="alert" className="alert font-semibold">
          This diagnosis couldn&apos;t be shown. Diagnose again to continue.
        </p>
      )}
      <div className="stack-sm border-t border-border pt-4">
        {latest.current ? (
          <p className="field-help">Your results haven&apos;t changed since this diagnosis.</p>
        ) : (
          <p className="field-help">You&apos;ve added results since this diagnosis.</p>
        )}
        <DiagnoseControl itemId={post.id} again />
      </div>
    </Card>
  );
}
