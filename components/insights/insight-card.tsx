import Link from "next/link";
import { CONFIDENCE_LABELS, INSIGHT_TYPE_LABELS, type StoredInsight } from "@/lib/schemas/insights";
import { DismissButton } from "./dismiss-button";

/** One learned pattern: what we noticed, what to try, how sure we are and why. */
export function InsightCard({ insight, livePostIds }: { insight: StoredInsight; livePostIds: ReadonlySet<string> }) {
  const headingId = `insight-${insight.id}`;
  const posts = insight.sample_size ?? insight.evidence.length;
  return (
    <li>
      <article className="card stack-sm" aria-labelledby={headingId}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="rounded-pill border border-border px-3 py-0.5 text-sm font-semibold">
            {INSIGHT_TYPE_LABELS[insight.insight_type]}
          </span>
          {insight.confidence ? (
            <span className="text-sm text-muted-foreground">{CONFIDENCE_LABELS[insight.confidence]}</span>
          ) : null}
        </div>
        <h3 id={headingId} className="text-lg font-semibold break-words">
          {insight.summary}
        </h3>
        {insight.next_step ? (
          <div className="stack-sm rounded-md border-2 border-foreground p-3">
            <p className="break-words">
              <span className="font-semibold">Try next: </span>
              {insight.next_step}
            </p>
            <div>
              <Link href="/app/opportunities" className="link link-arrow text-sm font-semibold">
                Turn into idea
              </Link>
            </div>
          </div>
        ) : null}
        {insight.evidence.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold">
              Based on {posts} {posts === 1 ? "post" : "posts"}
            </summary>
            <ul className="mt-2 stack-sm">
              {insight.evidence.map((item, index) => (
                <li key={index} className="break-words text-muted-foreground">
                  {item.content_item_id && livePostIds.has(item.content_item_id) ? (
                    <Link href={`/app/analytics/${item.content_item_id}`} className="link">
                      {item.observation}
                    </Link>
                  ) : (
                    item.observation
                  )}
                </li>
              ))}
            </ul>
          </details>
        ) : posts ? (
          <p className="field-help">
            Based on {posts} {posts === 1 ? "post" : "posts"}
          </p>
        ) : null}
        <DismissButton id={insight.id} summary={insight.summary} />
      </article>
    </li>
  );
}
