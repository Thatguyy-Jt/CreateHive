"use client";

import { useState, type KeyboardEvent, type PointerEvent } from "react";
import { niceTicks } from "@/lib/analytics/chart-data";
import { formatCount } from "@/lib/analytics/format";
import { ChartTooltip, UsualKey } from "./chart-tooltip";
import { useWidth } from "./use-width";

export interface LinePoint {
  /** Days since posting. */
  day: number;
  views: number;
  /** "Oct 2" in the creator's zone, formatted on the server. */
  dateLabel: string | null;
}

/** A surface-coloured outline behind label text, so it stays legible over marks. */
const HALO = { stroke: "var(--surface)", strokeWidth: 4, paintOrder: "stroke", strokeLinejoin: "round" } as const;

const PLOT_HEIGHT = 200;
const AXIS_BAND = 28;
const TOP_PAD = 24;
const LEFT_AXIS = 44;
const RIGHT_PAD = 16;

/**
 * Views across a post's check-ins: a 2px line with ringed dots, a 10% wash and
 * the creator's usual. A crosshair snaps to the nearest check-in; with focus,
 * the arrow keys move between check-ins. The list under the chart has every value.
 */
export function LineChart({ points, usual, label }: { points: LinePoint[]; usual: number | null; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...points.map((p) => p.views), usual ?? 0);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const first = points[0].day;
  const last = points[points.length - 1].day;
  const span = Math.max(1, last - first);
  const plotWidth = Math.max(1, width - LEFT_AXIS - RIGHT_PAD);
  const base = TOP_PAD + PLOT_HEIGHT;
  const x = (day: number) => LEFT_AXIS + ((day - first) / span) * plotWidth;
  const y = (value: number) => base - (value / top) * PLOT_HEIGHT;
  const height = base + AXIS_BAND;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.day)},${y(p.views)}`).join(" ");
  const area = `${line} L${x(last)},${base} L${x(first)},${base} Z`;
  const end = points[points.length - 1];
  const current = active === null ? null : points[active];

  const nearest = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - box.left + LEFT_AXIS;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(points[i].day) - pointerX) < Math.abs(x(points[best].day) - pointerX)) best = i;
    }
    setActive(best);
  };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    if (event.key in moves) {
      event.preventDefault();
      setActive((index) => Math.min(points.length - 1, Math.max(0, (index ?? -1) + moves[event.key])));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : points.length - 1);
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const describe = (p: LinePoint) => `${formatCount(p.views)} views on day ${p.day}${p.dateLabel ? ` (${p.dateLabel})` : ""}`;

  return (
    <div ref={ref} className="w-full">
      {usual !== null ? <UsualKey usual={usual} /> : null}
      <div className="relative">
        <svg
          width={width}
          height={height}
          role="application"
          aria-roledescription="line chart"
          aria-label={`${label}. Use the left and right arrow keys to move between check-ins.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setActive((index) => index ?? points.length - 1)}
          onBlur={() => setActive(null)}
          className="block overflow-visible rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
        >
          {ticks.map((tick) => (
            <g key={tick} aria-hidden="true">
              <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
              <text x={LEFT_AXIS - 8} y={y(tick)} dy="0.35em" textAnchor="end" className="fill-muted-foreground text-xs tabular-nums">
                {formatCount(tick, true)}
              </text>
            </g>
          ))}

          <path d={area} fill="var(--chart-accent)" opacity={0.1} aria-hidden="true" />

          {usual !== null ? (
            <g aria-hidden="true">
              <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={y(usual)} y2={y(usual)} stroke="var(--foreground)" strokeWidth={1.5} />
            </g>
          ) : null}

          {current ? (
            <line
              x1={x(current.day)}
              x2={x(current.day)}
              y1={TOP_PAD}
              y2={base}
              stroke="var(--muted-foreground)"
              strokeWidth={1}
              aria-hidden="true"
            />
          ) : null}

          <path
            d={line}
            fill="none"
            stroke="var(--chart-accent)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            aria-hidden="true"
          />
          {points.map((p, i) => (
            <circle
              key={`${p.day}-${i}`}
              cx={x(p.day)}
              cy={y(p.views)}
              r={active === i ? 6 : 4}
              fill="var(--chart-accent)"
              stroke="var(--surface)"
              strokeWidth={2}
              aria-hidden="true"
            />
          ))}

          {/* Direct label at the end of the line. */}
          <text
            x={x(end.day)}
            y={y(end.views) - 12}
            textAnchor={points.length > 1 ? "end" : "middle"}
            {...HALO} className="fill-foreground text-xs font-semibold tabular-nums"
            aria-hidden="true"
          >
            {formatCount(end.views, true)}
          </text>

          <g aria-hidden="true">
            <line x1={LEFT_AXIS} x2={width - RIGHT_PAD} y1={base} y2={base} stroke="var(--border)" strokeWidth={1} />
            <text x={LEFT_AXIS} y={base + 18} className="fill-muted-foreground text-xs">
              Day {first}
            </text>
            {last !== first ? (
              <text x={width - RIGHT_PAD} y={base + 18} textAnchor="end" className="fill-muted-foreground text-xs">
                Day {last}
              </text>
            ) : null}
          </g>

          {/* Crosshair hit area: the reader aims at a day, not a 2px line. */}
          <rect
            x={LEFT_AXIS}
            y={TOP_PAD}
            width={plotWidth}
            height={PLOT_HEIGHT}
            fill="transparent"
            onPointerMove={nearest}
            onPointerDown={nearest}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {current ? (
          <ChartTooltip x={x(current.day)} y={y(current.views)} width={width} value={`${formatCount(current.views)} views`}>
            <p>
              Day {current.day}
              {current.dateLabel ? ` · ${current.dateLabel}` : ""}
            </p>
          </ChartTooltip>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {current ? describe(current) : ""}
        </p>
      </div>
    </div>
  );
}
