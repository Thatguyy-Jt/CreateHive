"use client";

import { useState } from "react";
import { COMPARISON_TEXT, type ComparisonLabel } from "@/lib/analytics/baseline";
import { formatPercent } from "@/lib/analytics/format";
import type { ComparisonMix } from "@/lib/analytics/overview";

const SIZE = 160;
const STROKE = 22;
/** Surface gap between segments, in px along the ring. */
const GAP = 2;
const R = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Diverging: two hues and a neutral midpoint (validated with the dataviz palette script). */
const ORDER: { key: ComparisonLabel; color: string }[] = [
  { key: "above", color: "var(--compare-above)" },
  { key: "around", color: "var(--compare-around)" },
  { key: "below", color: "var(--compare-below)" },
];

/** Each non-empty segment's start and painted length along the ring, a surface gap after each. */
function segmentsFor(mix: ComparisonMix, total: number) {
  const present = ORDER.filter(({ key }) => mix[key] > 0);
  const lengths = present.map(({ key }) => (total ? mix[key] / total : 0) * CIRCUMFERENCE);
  return present.map(({ key, color }, index) => ({
    key,
    color,
    offset: lengths.slice(0, index).reduce((sum, length) => sum + length, 0),
    length: Math.max(0, lengths[index] - (present.length > 1 ? GAP : 0)),
  }));
}

/**
 * Part-to-whole of settled posts above, around and below the creator's usual
 * views. The legend carries every count and share as text; hovering a row or a
 * segment emphasises that segment.
 */
export function ComparisonDonut({ mix }: { mix: ComparisonMix }) {
  const [active, setActive] = useState<ComparisonLabel | null>(null);
  const total = mix.above + mix.around + mix.below;
  const share = (count: number) => (total ? count / total : 0);
  const summary = ORDER.map(({ key }) => `${mix[key]} ${COMPARISON_TEXT[key].toLowerCase()}`).join(", ");

  const segments = segmentsFor(mix, total);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center" onPointerLeave={() => setActive(null)}>
      <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={`${total} settled posts compared with your usual views: ${summary}.`}
        >
          <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--fog)" strokeWidth={STROKE} />
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {segments.map((segment) => (
              <circle
                key={segment.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={segment.color}
                strokeWidth={STROKE}
                strokeDasharray={`${segment.length} ${CIRCUMFERENCE}`}
                strokeDashoffset={-segment.offset}
                opacity={active && active !== segment.key ? 0.3 : 1}
                onPointerEnter={() => setActive(segment.key)}
                style={{ transition: "opacity 150ms ease" }}
              >
                <title>{`${COMPARISON_TEXT[segment.key]}: ${mix[segment.key]} (${formatPercent(share(mix[segment.key]))})`}</title>
              </circle>
            ))}
          </g>
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="text-[1.75rem] leading-none font-extrabold tabular-nums">{total}</span>
          <span className="text-[0.8125rem] text-muted-foreground">posts</span>
        </div>
      </div>
      <ul className="donut-legend" aria-label="Legend">
        {ORDER.map(({ key, color }) => (
          <li
            key={key}
            data-active={active === key || undefined}
            onPointerEnter={() => setActive(key)}
            className="donut-legend-row"
          >
            <span aria-hidden="true" className="donut-swatch" style={{ backgroundColor: color }} />
            <span className="flex-1">{COMPARISON_TEXT[key]}</span>
            <span className="tabular-nums">
              <span className="font-bold">{mix[key]}</span>
              <span className="text-muted-foreground"> · {formatPercent(share(mix[key]))}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
