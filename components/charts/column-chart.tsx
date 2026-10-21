"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { COMPARISON_TEXT, type Metric } from "@/lib/analytics/baseline";
import { niceTicks } from "@/lib/analytics/chart-data";
import { formatCount, formatMetric, formatPercent, formatSigned } from "@/lib/analytics/format";
import type { MetricPoint } from "@/lib/analytics/overview";
import { ChartTooltip, UsualKey } from "./chart-tooltip";
import { useWidth } from "./use-width";

export interface DrawnColumn extends MetricPoint {
  /** "Oct 2" in the creator's zone, formatted on the server. */
  dateLabel: string | null;
}

/** A surface-coloured outline behind label text, so it stays legible over marks. */
const HALO = { stroke: "var(--surface)", strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" } as const;

const PLOT_HEIGHT = 240;
const AXIS_BAND = 28;
const TOP_PAD = 24;
const LEFT_AXIS = 48;
const RIGHT_PAD = 8;
const MAX_BAR = 28;
const RADIUS = 4;

/** What follows the value in readouts: "1,200 views", "4.2% engagement". */
export const METRIC_UNITS: Record<Metric, string> = {
  views: "views",
  engagement_rate: "engagement",
  follower_delta: "followers",
  retention_rate: "viewed",
};

/** Short axis ticks per metric. */
function tickText(metric: Metric, value: number): string {
  if (metric === "engagement_rate" || metric === "retention_rate") return formatPercent(value);
  if (metric === "follower_delta") return formatSigned(value);
  return formatCount(value, true);
}

/**
 * A column from the zero line `zero` to the data end `end`, with a 4px rounded
 * data end (top for positive values, bottom for negative), square at zero.
 */
function columnPath(x: number, width: number, end: number, zero: number): string {
  const up = end <= zero;
  const r = Math.min(RADIUS, width / 2, Math.abs(zero - end));
  if (up) {
    return `M${x},${zero} V${end + r} Q${x},${end} ${x + r},${end} H${x + width - r} Q${x + width},${end} ${x + width},${end + r} V${zero} Z`;
  }
  return `M${x},${zero} V${end - r} Q${x},${end} ${x + r},${end} H${x + width - r} Q${x + width},${end} ${x + width},${end - r} V${zero} Z`;
}

/** Ticks covering every value and 0, on one step; negative values get their own ticks below 0. */
function signedTicks(values: readonly number[]): number[] {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const base = niceTicks(Math.max(hi, -lo));
  const step = base[1] - base[0];
  const top = Math.ceil(hi / step - 1e-9) * step;
  const bottom = -Math.ceil(-lo / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = bottom; value <= Math.max(top, step) + step / 2; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks.length >= 2 ? ticks : [0, step];
}

function comparisonText(point: MetricPoint): string {
  if (point.label) return COMPARISON_TEXT[point.label];
  return point.settled ? "Not enough posts to compare yet" : "Early results";
}

/**
 * One metric per post, oldest to newest, with the creator's usual as a
 * reference line. Settled posts in the prism wash, early ones in gray. Signed
 * metrics (follower change) hang below a zero line. Each column is a link to
 * its post with a hover and focus readout; a tap on touch shows the readout
 * first. Every value is also in the table view beside it.
 */
export function ColumnChart({
  points,
  metric,
  usual,
  label,
}: {
  points: DrawnColumn[];
  metric: Metric;
  usual: number | null;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const pointerType = useRef<string>("mouse");
  const router = useRouter();
  const washId = `${useId()}-wash`;

  const ticks = signedTicks([...points.map((p) => p.value), ...(usual !== null ? [usual] : [])]);
  const top = ticks[ticks.length - 1];
  const bottom = ticks[0];
  const plotWidth = Math.max(1, width - LEFT_AXIS - RIGHT_PAD);
  const base = TOP_PAD + PLOT_HEIGHT;
  const y = (value: number) => TOP_PAD + ((top - value) / (top - bottom)) * PLOT_HEIGHT;
  const zero = y(0);
  const band = plotWidth / points.length;
  const barWidth = Math.max(4, Math.min(MAX_BAR, band * 0.6));
  const center = (index: number) => LEFT_AXIS + band * (index + 0.5);
  const highest = points.reduce((best, p, i) => (Math.abs(p.value) > Math.abs(points[best].value) ? i : best), 0);
  const height = base + AXIS_BAND;
  const current = active === null ? null : points[active];
  const valueText = (value: number) => `${formatMetric(metric, value)} ${METRIC_UNITS[metric]}`;

  return (
    <div ref={ref} className="w-full" onPointerLeave={() => setActive(null)}>
      {usual !== null ? <UsualKey usual={usual} display={tickText(metric, usual)} /> : null}
      <div className="relative">
        <svg width={width} height={height} role="group" aria-label={label} className="block overflow-visible">
          {/* Settled columns wear the prism wash (the Today card and empty-state hues), bottom to top. */}
          <defs>
            <linearGradient id={washId} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" style={{ stopColor: "var(--wash-1)" }} />
              <stop offset="50%" style={{ stopColor: "var(--wash-2)" }} />
              <stop offset="100%" style={{ stopColor: "var(--wash-3)" }} />
            </linearGradient>
          </defs>
          {/* Grid and y-axis: hairlines a step off the surface. */}
          {ticks.map((tick) => (
            <g key={tick} aria-hidden="true">
              <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
              <text
                x={LEFT_AXIS - 8}
                y={y(tick)}
                dy="0.35em"
                textAnchor="end"
                className="fill-muted-foreground text-xs tabular-nums"
              >
                {tickText(metric, tick)}
              </text>
            </g>
          ))}

          {points.map((point, index) => {
            const x = center(index) - barWidth / 2;
            const isActive = active === index;
            return (
              <a
                key={point.id}
                href={`/app/analytics/${point.id}`}
                aria-label={`${point.title}${point.dateLabel ? `, ${point.dateLabel}` : ""}: ${valueText(point.value)}, ${comparisonText(point).toLowerCase()}`}
                onPointerDown={(event) => {
                  pointerType.current = event.pointerType;
                }}
                onPointerEnter={() => setActive(index)}
                onFocus={() => {
                  setActive(index);
                  setFocused(true);
                }}
                onBlur={() => {
                  setActive(null);
                  setFocused(false);
                }}
                onClick={(event) => {
                  event.preventDefault();
                  // On touch, the first tap shows the readout; the second opens the post.
                  if (pointerType.current === "touch" && !isActive) {
                    setActive(index);
                    return;
                  }
                  router.push(`/app/analytics/${point.id}`);
                }}
                className="outline-none"
              >
                {/* The whole band is the hit target, not just the painted column. */}
                <rect x={center(index) - band / 2} y={TOP_PAD} width={band} height={PLOT_HEIGHT} fill="transparent" />
                <path
                  d={columnPath(x, barWidth, y(point.value), zero)}
                  fill={point.settled ? `url(#${washId})` : "var(--chart-muted)"}
                  stroke={point.settled ? "var(--bar-edge)" : "none"}
                  strokeWidth={1}
                  opacity={active !== null && !isActive ? 0.55 : 1}
                />
                {isActive && focused ? (
                  <rect
                    x={center(index) - band / 2 + 1}
                    y={TOP_PAD - 4}
                    width={band - 2}
                    height={PLOT_HEIGHT + 4}
                    rx={4}
                    fill="none"
                    stroke="var(--ring)"
                    strokeWidth={2}
                  />
                ) : null}
              </a>
            );
          })}

          {/* Direct label on the largest column only. */}
          <text
            x={center(highest)}
            y={points[highest].value >= 0 ? y(points[highest].value) - 6 : y(points[highest].value) + 14}
            textAnchor="middle"
            {...HALO}
            className="fill-foreground text-xs font-semibold tabular-nums"
            aria-hidden="true"
          >
            {tickText(metric, points[highest].value)}
          </text>

          {usual !== null ? (
            <g aria-hidden="true" className="pointer-events-none">
              <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={y(usual)} y2={y(usual)} stroke="var(--foreground)" strokeWidth={1.5} />
            </g>
          ) : null}

          {/* Zero line, then the first and last dates only. */}
          <g aria-hidden="true">
            <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={zero} y2={zero} stroke="var(--muted-foreground)" strokeWidth={1} />
            {points[0].dateLabel ? (
              <text x={LEFT_AXIS} y={base + 18} className="fill-muted-foreground text-xs">
                {points[0].dateLabel}
              </text>
            ) : null}
            {points.length > 1 && points[points.length - 1].dateLabel ? (
              <text x={width - RIGHT_PAD} y={base + 18} textAnchor="end" className="fill-muted-foreground text-xs">
                {points[points.length - 1].dateLabel}
              </text>
            ) : null}
          </g>
        </svg>

        {current && active !== null ? (
          <ChartTooltip x={center(active)} y={Math.min(y(current.value), zero)} width={width} value={valueText(current.value)}>
            <p className="font-semibold text-foreground break-words">{current.title}</p>
            {current.dateLabel ? <p>{current.dateLabel}</p> : null}
            <p>{comparisonText(current)}</p>
          </ChartTooltip>
        ) : null}
      </div>
    </div>
  );
}
