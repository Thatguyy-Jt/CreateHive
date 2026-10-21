"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { COMPARISON_TEXT, METRIC_LABELS, METRICS, MIN_BASELINE_POSTS, type Metric } from "@/lib/analytics/baseline";
import { CHART_POST_LIMIT } from "@/lib/analytics/chart-data";
import { formatMetric, formatPercent, formatSigned } from "@/lib/analytics/format";
import type { MetricKpi } from "@/lib/analytics/overview";
import { ColumnChart, METRIC_UNITS, type DrawnColumn } from "../charts/column-chart";

/** "▲ 32%" / "▼ 12%" / "+40": the latest post against the usual. */
function deltaText(metric: Metric, delta: number): string {
  if (metric === "follower_delta") return formatSigned(Math.round(delta));
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "";
  return `${arrow} ${formatPercent(Math.abs(delta))}`.trim();
}

function KpiDelta({ kpi }: { kpi: MetricKpi }) {
  if (kpi.usual === null) {
    return <span className="text-muted-foreground">Needs {MIN_BASELINE_POSTS} settled posts</span>;
  }
  if (kpi.delta === null) return <span className="text-muted-foreground">Your usual</span>;
  return (
    <span>
      <span className="font-bold text-foreground tabular-nums">{deltaText(kpi.metric, kpi.delta)}</span>{" "}
      <span className="text-muted-foreground">latest</span>
      <span className="sr-only"> post compared with your usual</span>
    </span>
  );
}

/** Empty-chart copy per metric. */
function emptyText(metric: Metric): string {
  if (metric === "retention_rate") return "Only video posts record % viewed. Add it with a video post's results to see this chart.";
  return "Add results to 2 or more posts to see this chart.";
}

/**
 * The analytics overview panel: one tab per metric (its usual and the latest
 * post's delta) above one column chart for the selected metric. Tabs switch
 * instantly; all series arrive with the page.
 */
export function MetricOverview({
  platformName,
  kpis,
  series,
}: {
  platformName: string;
  kpis: MetricKpi[];
  series: Record<Metric, DrawnColumn[]>;
}) {
  const [selected, setSelected] = useState<Metric>("views");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const tabId = (metric: Metric) => `${id}-tab-${metric}`;
  const panelId = `${id}-panel`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = METRICS.indexOf(selected);
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % METRICS.length
        : event.key === "ArrowLeft"
          ? (index - 1 + METRICS.length) % METRICS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? METRICS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(METRICS[next]);
    tabs.current[next]?.focus();
  };

  const kpi = kpis.find((k) => k.metric === selected)!;
  const points = series[selected];
  const both = points.some((p) => p.settled) && points.some((p) => !p.settled);
  const name = METRIC_LABELS[selected];
  const values = points.map((p) => p.value);

  return (
    <section className="chart-panel" aria-label={`Overview for ${platformName}`}>
      <div role="tablist" aria-label="Metric" className="kpi-tabs" onKeyDown={onKeyDown}>
        {METRICS.map((metric, index) => {
          const item = kpis.find((k) => k.metric === metric)!;
          const isSelected = metric === selected;
          return (
            <button
              key={metric}
              ref={(node) => {
                tabs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={tabId(metric)}
              aria-selected={isSelected}
              aria-controls={panelId}
              tabIndex={isSelected ? 0 : -1}
              className="kpi-tab"
              onClick={() => setSelected(metric)}
            >
              <span className="kpi-tab-label">{METRIC_LABELS[metric]}</span>
              <span className="kpi-tab-value">{item.usual !== null ? formatMetric(metric, item.usual) : "—"}</span>
              <span className="kpi-tab-delta">
                <KpiDelta kpi={item} />
              </span>
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} className="chart-panel-body stack-md">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm font-bold">
            {name} per post{points.length === CHART_POST_LIMIT ? ` (last ${CHART_POST_LIMIT})` : ""}
            {kpi.usual !== null ? (
              <span className="font-normal text-muted-foreground">
                {" "}
                · usual is the middle of {kpi.sample} settled posts
              </span>
            ) : null}
          </p>
          {both ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Legend">
              <li className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 rounded-[3px] [background-image:var(--bar-wash)] shadow-[inset_0_0_0_1px_var(--bar-edge)]"
                />
                Settled
              </li>
              <li className="flex items-center gap-2">
                <span aria-hidden="true" className="inline-block h-3 w-3 rounded-[3px] bg-[var(--chart-muted)]" />
                Early (first week)
              </li>
            </ul>
          ) : null}
        </div>

        {points.length >= 2 ? (
          <>
            <ColumnChart
              key={selected}
              points={points}
              metric={selected}
              usual={kpi.usual}
              label={`${name} per post on ${platformName}, oldest to newest: ${points.length} posts from ${formatMetric(selected, Math.min(...values))} to ${formatMetric(selected, Math.max(...values))}${kpi.usual !== null ? `; your usual is ${formatMetric(selected, kpi.usual)}` : ""}. Each column links to its post.`}
            />
            <details className="stack-sm">
              <summary className="min-h-11 cursor-pointer content-center text-sm font-bold">Show as table</summary>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">
                  {name} per post on {platformName}
                </caption>
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-bold">Post</th>
                    <th scope="col" className="py-2 pr-3 font-bold">Posted</th>
                    <th scope="col" className="py-2 pr-3 text-right font-bold">{name}</th>
                    <th scope="col" className="hidden py-2 font-bold min-[480px]:table-cell">Compared</th>
                  </tr>
                </thead>
                <tbody>
                  {points.toReversed().map((point) => (
                    <tr key={point.id} className="border-b border-border last:border-0">
                      <th scope="row" className="py-2 pr-3 font-normal break-words">
                        <Link href={`/app/analytics/${point.id}`} className="link">
                          {point.title}
                        </Link>
                      </th>
                      <td className="py-2 pr-3 whitespace-nowrap">{point.dateLabel ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMetric(selected, point.value)}
                        <span className="sr-only"> {METRIC_UNITS[selected]}</span>
                      </td>
                      <td className="hidden py-2 min-[480px]:table-cell">
                        {point.label ? COMPARISON_TEXT[point.label] : point.settled ? "Not compared" : "Early results"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        ) : (
          <p className="text-muted-foreground">{emptyText(selected)}</p>
        )}
      </div>
    </section>
  );
}
