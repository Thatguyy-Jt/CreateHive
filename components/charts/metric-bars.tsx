import { METRIC_LABELS, type MetricComparison } from "@/lib/analytics/baseline";
import { signedDomain } from "@/lib/analytics/chart-data";
import { formatMetric } from "@/lib/analytics/format";
import { ComparisonPill } from "../analytics/comparison";

const PAD = 1.15;

/** Where `value` sits in `[min, max]`, as a 0–100 percentage. */
const at = (value: number, [min, max]: [number, number]) => ((value - min) / (max - min)) * 100;

function MetricBar({ metric, settled }: { metric: MetricComparison; settled: boolean }) {
  const values = [metric.value, metric.median].filter((v): v is number => v !== null);
  // Each metric has its own scale: different units never share an axis.
  const domain: [number, number] =
    metric.metric === "follower_delta" ? signedDomain(values, PAD) : [0, Math.max(...values, 0) * PAD || 1];
  const zero = at(0, domain);
  const value = metric.value === null ? null : at(metric.value, domain);
  const usual = metric.median === null ? null : at(metric.median, domain);
  const negative = metric.value !== null && metric.value < 0;

  return (
    <li className="grid gap-2 border-b border-border pb-3 last:border-0 @[34rem]:grid-cols-[9rem_1fr_auto] @[34rem]:items-center @[34rem]:gap-4">
      <div>
        <p className="text-sm font-semibold">{METRIC_LABELS[metric.metric]}</p>
        <p className="text-lg font-semibold">
          {metric.value === null ? <span className="text-sm font-normal text-muted-foreground">Not entered</span> : formatMetric(metric.metric, metric.value)}
        </p>
      </div>

      <div className="relative h-11" aria-hidden="true">
        {/* Track and zero line: recessive. */}
        <div className="absolute inset-x-0 top-[14px] h-px bg-border" />
        {zero > 0 ? <div className="absolute top-[6px] h-[18px] w-px bg-muted-foreground" style={{ left: `${zero}%` }} /> : null}
        {value !== null ? (
          <div
            className={`absolute top-[8px] h-[14px] ${negative ? "rounded-l-[4px]" : "rounded-r-[4px]"}`}
            style={{
              left: `${Math.min(zero, value)}%`,
              width: `${Math.max(Math.abs(value - zero), 0.5)}%`,
              background: settled ? "var(--chart-accent)" : "var(--chart-muted)",
            }}
          />
        ) : null}
        {usual !== null ? (
          <>
            <div className="absolute top-[2px] h-[26px] w-[2px] -translate-x-1/2 bg-foreground" style={{ left: `${usual}%` }} />
            <p
              className={`absolute top-[28px] text-xs whitespace-nowrap text-muted-foreground ${
                usual > 70 ? "-translate-x-full" : usual < 30 ? "" : "-translate-x-1/2"
              }`}
              style={{ left: `${usual}%` }}
            >
              usual {formatMetric(metric.metric, metric.median!)}
            </p>
          </>
        ) : null}
      </div>

      <div className="@[34rem]:justify-self-end">
        {metric.label ? (
          <ComparisonPill label={metric.label} />
        ) : (
          <span className="text-sm text-muted-foreground">{metric.median === null ? "No usual yet" : "Not compared"}</span>
        )}
      </div>
    </li>
  );
}

/**
 * One row per metric: this post's value as a bar (gray while early) and the
 * creator's usual as a tick. Every number is printed as text beside its bar.
 */
export function MetricBars({ metrics, settled }: { metrics: MetricComparison[]; settled: boolean }) {
  const rows = metrics.filter((m) => m.value !== null || m.median !== null);
  if (rows.length === 0) return null;
  return (
    // Laid out by the card's width, not the viewport's, so the bar never collapses in a narrow card.
    <ul className="@container stack-sm">
      {rows.map((metric) => (
        <MetricBar key={metric.metric} metric={metric} settled={settled} />
      ))}
    </ul>
  );
}
