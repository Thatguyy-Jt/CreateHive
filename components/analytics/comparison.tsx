import {
  COMPARISON_TEXT,
  METRIC_LABELS,
  MIN_BASELINE_POSTS,
  SETTLED_AFTER_DAYS,
  type ComparisonLabel,
  type PostComparison,
} from "@/lib/analytics/baseline";
import { formatMetric, LABEL_ARROWS } from "@/lib/analytics/format";
import { PLATFORM_LABELS, type Platform } from "@/lib/schemas/creator";

export const platformName = (platform: Platform | null) => (platform ? PLATFORM_LABELS[platform] : "posts with no platform");

/** "↑ Above your usual" as text; the arrow is decorative. */
export function ComparisonPill({ label }: { label: ComparisonLabel }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-pill border border-border px-3 py-0.5 text-sm font-semibold whitespace-nowrap">
      <span aria-hidden="true">{LABEL_ARROWS[label]}</span>
      {COMPARISON_TEXT[label]}
    </span>
  );
}

/** Why a post isn't labelled yet, or null when it is. */
export function comparisonNote(comparison: PostComparison, platform: Platform | null, hasResults: boolean): string | null {
  if (!hasResults) return "No results yet. Add the numbers from the platform's insights.";
  if (!comparison.settled) {
    return `Early results (day ${comparison.ageDays ?? 0}). Update them after day ${SETTLED_AFTER_DAYS} for a fair comparison.`;
  }
  if (comparison.peers < MIN_BASELINE_POSTS) {
    return `Not enough posts yet: ${comparison.peers} of ${MIN_BASELINE_POSTS} on ${platformName(platform)}. Log a past post to compare sooner.`;
  }
  return null;
}

/**
 * This post against the creator's usual, one row per metric. A real table on
 * wider screens; stacked definition rows below 480px, so nothing scrolls sideways.
 */
export function ComparisonTable({ comparison, platform }: { comparison: PostComparison; platform: Platform | null }) {
  const rows = comparison.metrics.filter((m) => m.value !== null || m.median !== null);
  if (rows.length === 0) return null;
  const caption = `How this post compares with your usual on ${platformName(platform)}`;
  const usual = (m: (typeof rows)[number]) => (m.median === null ? "Not enough posts" : formatMetric(m.metric, m.median));
  const value = (m: (typeof rows)[number]) => (m.value === null ? "Not entered" : formatMetric(m.metric, m.value));
  const verdict = (m: (typeof rows)[number]) => (m.label ? <ComparisonPill label={m.label} /> : <span className="text-muted-foreground">—</span>);

  return (
    <>
      <table className="hidden w-full text-left text-sm min-[480px]:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Metric
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              This post
            </th>
            <th scope="col" className="py-2 pr-3 font-semibold">
              Your usual
            </th>
            <th scope="col" className="py-2 font-semibold">
              Compared
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.metric} className="border-b border-border last:border-0">
              <th scope="row" className="py-2 pr-3 font-semibold">
                {METRIC_LABELS[m.metric]}
              </th>
              <td className="py-2 pr-3 tabular-nums">{value(m)}</td>
              <td className="py-2 pr-3 tabular-nums">
                {usual(m)}
                {m.median !== null ? <span className="block field-help">based on {m.sampleSize} posts</span> : null}
              </td>
              <td className="py-2">{verdict(m)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="stack-sm min-[480px]:hidden" aria-label={caption}>
        {rows.map((m) => (
          <div key={m.metric} className="grid gap-1 border-b border-border pb-2 last:border-0">
            <dt className="font-semibold">{METRIC_LABELS[m.metric]}</dt>
            <dd className="tabular-nums">
              This post: {value(m)} · Your usual: {usual(m)}
              {m.median !== null ? ` (${m.sampleSize} posts)` : ""}
            </dd>
            {m.label ? (
              <dd>
                <ComparisonPill label={m.label} />
              </dd>
            ) : null}
          </div>
        ))}
      </dl>
    </>
  );
}
