"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { COMPARISON_TEXT } from "@/lib/analytics/baseline";
import { niceTicks, type ChartPoint } from "@/lib/analytics/chart-data";
import { formatCount } from "@/lib/analytics/format";
import { ChartTooltip, UsualKey } from "./chart-tooltip";
import { useWidth } from "./use-width";

export interface DrawnColumn extends ChartPoint {
  /** "Oct 2" in the creator's zone, formatted on the server. */
  dateLabel: string | null;
}

/** A surface-coloured outline behind label text, so it stays legible over marks. */
const HALO = { stroke: "var(--surface)", strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" } as const;

const PLOT_HEIGHT = 220;
const AXIS_BAND = 28;
const TOP_PAD = 24;
const LEFT_AXIS = 44;
const RIGHT_PAD = 8;
const MAX_BAR = 24;
const RADIUS = 4;

/** A column with a 4px rounded data end, square at the baseline. */
function columnPath(x: number, width: number, top: number, base: number): string {
  const r = Math.min(RADIUS, width / 2, base - top);
  return `M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${base} Z`;
}

function comparisonText(point: ChartPoint): string {
  if (point.label) return COMPARISON_TEXT[point.label];
  return point.settled ? "Not enough posts to compare yet" : "Early results";
}

/**
 * Views per post, oldest to newest, with the creator's usual as a reference
 * line. Settled posts in the accent, early ones in gray. Each column is a link
 * to its post with a hover and focus readout; a tap on touch shows the readout
 * first. Every value is also in the table view beside it.
 */
export function ColumnChart({ points, usual, label }: { points: DrawnColumn[]; usual: number | null; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const pointerType = useRef<string>("mouse");
  const router = useRouter();

  const max = Math.max(...points.map((p) => p.views), usual ?? 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotWidth = Math.max(1, width - LEFT_AXIS - RIGHT_PAD);
  const base = TOP_PAD + PLOT_HEIGHT;
  const y = (value: number) => base - (value / top) * PLOT_HEIGHT;
  const band = plotWidth / points.length;
  const barWidth = Math.max(4, Math.min(MAX_BAR, band * 0.6));
  const center = (index: number) => LEFT_AXIS + band * (index + 0.5);
  const highest = points.reduce((best, p, i) => (p.views > points[best].views ? i : best), 0);
  const height = base + AXIS_BAND;
  const current = active === null ? null : points[active];

  return (
    <div ref={ref} className="w-full" onPointerLeave={() => setActive(null)}>
      {usual !== null ? <UsualKey usual={usual} /> : null}
      <div className="relative">
        <svg width={width} height={height} role="group" aria-label={label} className="block overflow-visible">
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
                {formatCount(tick, true)}
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
                aria-label={`${point.title}${point.dateLabel ? `, ${point.dateLabel}` : ""}: ${formatCount(point.views)} views, ${comparisonText(point).toLowerCase()}`}
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
                  d={columnPath(x, barWidth, y(point.views), base)}
                  fill={point.settled ? "var(--chart-accent)" : "var(--chart-muted)"}
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

          {/* Direct label on the highest column only. */}
          <text
            x={center(highest)}
            y={y(points[highest].views) - 6}
            textAnchor="middle"
            {...HALO} className="fill-foreground text-xs font-semibold tabular-nums"
            aria-hidden="true"
          >
            {formatCount(points[highest].views, true)}
          </text>

          {usual !== null ? (
            <g aria-hidden="true" className="pointer-events-none">
              <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={y(usual)} y2={y(usual)} stroke="var(--foreground)" strokeWidth={1.5} />
            </g>
          ) : null}

          {/* x-axis: baseline and the first and last dates only. */}
          <g aria-hidden="true">
            <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={base} y2={base} stroke="var(--border)" strokeWidth={1} />
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
          <ChartTooltip x={center(active)} y={y(current.views)} width={width} value={`${formatCount(current.views)} views`}>
            <p className="font-semibold text-foreground break-words">{current.title}</p>
            {current.dateLabel ? <p>{current.dateLabel}</p> : null}
            <p>{comparisonText(current)}</p>
          </ChartTooltip>
        ) : null}
      </div>
    </div>
  );
}
